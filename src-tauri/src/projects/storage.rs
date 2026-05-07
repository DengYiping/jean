use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::{AppHandle, Manager};

use super::types::{Project, ProjectsData, WorktreeSlot, WorktreeSlotState};

/// Global mutex to prevent concurrent read-modify-write races on projects.json.
/// Multiple threads (e.g., fetch_worktrees_status) can call save_projects_data simultaneously,
/// causing race conditions with the atomic write pattern (temp file + rename).
static PROJECTS_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

/// Get the path to the projects.json data file
pub fn get_projects_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    // Ensure the directory exists
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    Ok(app_data_dir.join("projects.json"))
}

fn expand_home_path(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }

    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }

    PathBuf::from(path)
}

/// Get the legacy default base directory for all worktrees (~/jean)
fn get_default_worktrees_base_dir() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir().ok_or_else(|| "Failed to get home directory".to_string())?;

    let jean_dir = home_dir.join("jean");

    // Ensure the directory exists
    std::fs::create_dir_all(&jean_dir)
        .map_err(|e| format!("Failed to create jean directory: {e}"))?;

    Ok(jean_dir)
}

/// Get the effective base directory for worktrees.
/// Project-specific overrides win. Otherwise the global preference is used.
pub fn get_worktrees_base_dir(
    app: &AppHandle,
    configured_base_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let base_dir = if let Some(dir) = configured_base_dir {
        expand_home_path(dir)
    } else if let Ok(preferences) = crate::load_preferences_sync(app) {
        preferences
            .worktrees_base_dir
            .as_deref()
            .map(expand_home_path)
            .unwrap_or(get_default_worktrees_base_dir()?)
    } else {
        get_default_worktrees_base_dir()?
    };

    std::fs::create_dir_all(&base_dir)
        .map_err(|e| format!("Failed to create worktrees base directory: {e}"))?;

    Ok(base_dir)
}

/// Get the directory for a specific project's worktrees.
/// When `custom_base_dir` is Some, uses that instead of the global default base.
/// In both cases, `<project-name>` subdirectory is appended.
pub fn get_project_worktrees_dir(
    app: &AppHandle,
    project_name: &str,
    custom_base_dir: Option<&str>,
) -> Result<PathBuf, String> {
    let base_dir = get_worktrees_base_dir(app, custom_base_dir)?;
    let project_dir = base_dir.join(sanitize_directory_name(project_name));

    // Ensure the directory exists
    std::fs::create_dir_all(&project_dir)
        .map_err(|e| format!("Failed to create project worktrees directory: {e}"))?;

    Ok(project_dir)
}

/// Sanitize a string for use as a directory name
pub fn sanitize_directory_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Load projects data from disk (internal, no locking)
fn load_projects_data_internal(app: &AppHandle) -> Result<ProjectsData, String> {
    log::trace!("Loading projects data from disk");
    let path = get_projects_path(app)?;

    if !path.exists() {
        log::trace!("Projects file not found, returning empty data");
        return Ok(ProjectsData::default());
    }

    let contents = std::fs::read_to_string(&path).map_err(|e| {
        log::error!("Failed to read projects file: {e}");
        format!("Failed to read projects file: {e}")
    })?;

    let data: ProjectsData = serde_json::from_str(&contents).map_err(|e| {
        log::error!("Failed to parse projects JSON: {e}");
        format!("Failed to parse projects data: {e}")
    })?;

    let original_count = data.worktrees.len();

    // Filter out worktrees where path doesn't exist on disk
    // Skip recently created worktrees (< 5 min) - they may still be initializing in a background thread
    let now_ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let five_minutes_ago = now_ts.saturating_sub(300);

    let valid_worktrees: Vec<_> = data
        .worktrees
        .into_iter()
        .filter(|w| {
            let exists = std::path::Path::new(&w.path).exists();
            if !exists {
                if w.created_at > five_minutes_ago {
                    log::trace!(
                        "Keeping recently created worktree '{}' - path doesn't exist yet (created {}s ago)",
                        w.name,
                        now_ts - w.created_at
                    );
                    return true;
                }
                log::warn!(
                    "Removing orphaned worktree '{}' - path does not exist: {}",
                    w.name,
                    w.path
                );
            }
            exists
        })
        .collect();

    let removed_count = original_count - valid_worktrees.len();

    let mut data = ProjectsData {
        projects: data.projects,
        worktrees: valid_worktrees,
        worktree_slots: data.worktree_slots,
    };

    let slots_changed = reconcile_worktree_slots(&mut data);

    // Save cleaned data if any orphans were removed
    if removed_count > 0 || slots_changed {
        log::trace!("Cleaned up {removed_count} orphaned worktree(s)");
        save_projects_data_internal(app, &data)?;
    }

    log::trace!(
        "Loaded {} projects and {} worktrees",
        data.projects.len(),
        data.worktrees.len()
    );
    Ok(data)
}

fn reconcile_worktree_slots(data: &mut ProjectsData) -> bool {
    let mut changed = false;
    let recent_reservation_cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .saturating_sub(300);
    let worktree_ids: HashSet<String> = data.worktrees.iter().map(|w| w.id.clone()).collect();
    let mut existing_slot_ids: HashSet<String> = data
        .worktree_slots
        .iter()
        .map(|slot| slot.id.clone())
        .collect();

    for slot in &mut data.worktree_slots {
        let live_worktree = data
            .worktrees
            .iter()
            .filter(|worktree| worktree.archived_at.is_none())
            .filter(|worktree| worktree.stable_slot_id.as_deref() == Some(slot.id.as_str()))
            .max_by_key(|worktree| worktree.created_at);

        if let Some(worktree) = live_worktree {
            let slot_path_usable = is_usable_slot_path(&worktree.path);
            if slot.path != worktree.path {
                slot.path = worktree.path.clone();
                changed = true;
            }
            if slot_path_usable {
                if slot.state != WorktreeSlotState::Active {
                    slot.state = WorktreeSlotState::Active;
                    changed = true;
                }
                if slot.worktree_id.as_deref() != Some(worktree.id.as_str()) {
                    slot.worktree_id = Some(worktree.id.clone());
                    changed = true;
                }
                if slot.branch.as_deref() != Some(worktree.branch.as_str()) {
                    slot.branch = Some(worktree.branch.clone());
                    changed = true;
                }
                if slot.last_error.take().is_some() {
                    changed = true;
                }
                continue;
            }

            let error = slot_path_error(&worktree.path);
            if slot.state != WorktreeSlotState::Error {
                slot.state = WorktreeSlotState::Error;
                changed = true;
            }
            if slot.last_error.as_deref() != Some(error) {
                slot.last_error = Some(error.to_string());
                changed = true;
            }
            if slot.worktree_id.as_deref() != Some(worktree.id.as_str()) {
                slot.worktree_id = Some(worktree.id.clone());
                changed = true;
            }
            if slot.branch.as_deref() != Some(worktree.branch.as_str()) {
                slot.branch = Some(worktree.branch.clone());
                changed = true;
            }
            continue;
        }

        match slot.state {
            WorktreeSlotState::Active => {
                let Some(worktree_id) = slot.worktree_id.as_ref() else {
                    if is_usable_slot_path(&slot.path) {
                        slot.state = WorktreeSlotState::Idle;
                        slot.branch = None;
                        slot.last_error = None;
                    } else {
                        slot.state = WorktreeSlotState::Error;
                        slot.last_error = Some(slot_path_error(&slot.path).to_string());
                    }
                    changed = true;
                    continue;
                };

                if !worktree_ids.contains(worktree_id) {
                    if slot.created_at > recent_reservation_cutoff {
                        continue;
                    }
                    if is_usable_slot_path(&slot.path) {
                        slot.state = WorktreeSlotState::Idle;
                        slot.worktree_id = None;
                        slot.branch = None;
                        slot.last_error = None;
                    } else {
                        slot.state = WorktreeSlotState::Error;
                        slot.last_error = Some(slot_path_error(&slot.path).to_string());
                    }
                    changed = true;
                    continue;
                }

                if !is_usable_slot_path(&slot.path) {
                    slot.state = WorktreeSlotState::Error;
                    slot.last_error = Some(slot_path_error(&slot.path).to_string());
                    changed = true;
                }
            }
            WorktreeSlotState::Idle => {
                if !is_usable_slot_path(&slot.path) {
                    slot.state = WorktreeSlotState::Error;
                    slot.last_error = Some(slot_path_error(&slot.path).to_string());
                    changed = true;
                }
            }
            WorktreeSlotState::Error => {}
        }
    }

    for worktree in data
        .worktrees
        .iter()
        .filter(|worktree| worktree.archived_at.is_none())
        .filter(|worktree| worktree.path.contains("/.jean-slots/"))
    {
        let Some(slot_id) = worktree.stable_slot_id.as_ref() else {
            continue;
        };
        if existing_slot_ids.contains(slot_id) {
            continue;
        }
        if !is_usable_slot_path(&worktree.path) {
            continue;
        }
        data.worktree_slots.push(WorktreeSlot {
            id: slot_id.clone(),
            project_id: worktree.project_id.clone(),
            path: worktree.path.clone(),
            state: WorktreeSlotState::Active,
            worktree_id: Some(worktree.id.clone()),
            branch: Some(worktree.branch.clone()),
            created_at: worktree.created_at,
            last_used_at: worktree.created_at,
            last_error: None,
        });
        existing_slot_ids.insert(slot_id.clone());
        changed = true;
    }

    changed
}

fn is_usable_slot_path(path: &str) -> bool {
    let path = Path::new(path);
    path.exists() && path.join(".git").exists()
}

fn slot_path_error(path: &str) -> &'static str {
    if Path::new(path).exists() {
        "Slot path is not a git worktree"
    } else {
        "Slot path no longer exists"
    }
}

/// Load projects data from disk (with locking for thread safety)
pub fn load_projects_data(app: &AppHandle) -> Result<ProjectsData, String> {
    let _lock = PROJECTS_LOCK.lock().unwrap();
    load_projects_data_internal(app)
}

/// Save projects data to disk (internal, no locking - atomic write: temp file + rename)
fn save_projects_data_internal(app: &AppHandle, data: &ProjectsData) -> Result<(), String> {
    log::trace!("Saving projects data to disk");
    let path = get_projects_path(app)?;

    let json_content = serde_json::to_string_pretty(data).map_err(|e| {
        log::error!("Failed to serialize projects data: {e}");
        format!("Failed to serialize projects data: {e}")
    })?;

    // Write to a temporary file first, then rename (atomic operation)
    let temp_path = path.with_extension("tmp");

    std::fs::write(&temp_path, json_content).map_err(|e| {
        log::error!("Failed to write projects file: {e}");
        format!("Failed to write projects file: {e}")
    })?;

    std::fs::rename(&temp_path, &path).map_err(|e| {
        log::error!("Failed to finalize projects file: {e}");
        format!("Failed to finalize projects file: {e}")
    })?;

    log::trace!(
        "Saved {} projects and {} worktrees to {path:?}",
        data.projects.len(),
        data.worktrees.len()
    );
    Ok(())
}

/// Save projects data to disk (with locking for thread safety)
pub fn save_projects_data(app: &AppHandle, data: &ProjectsData) -> Result<(), String> {
    let _lock = PROJECTS_LOCK.lock().unwrap();
    save_projects_data_internal(app, data)
}

/// Load, mutate, and save projects data while holding the projects lock.
pub fn with_projects_data_mut<F, T>(app: &AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&mut ProjectsData) -> Result<T, String>,
{
    let _lock = PROJECTS_LOCK.lock().unwrap();
    let mut data = load_projects_data_internal(app)?;
    let result = f(&mut data)?;
    save_projects_data_internal(app, &data)?;
    Ok(result)
}

fn canonicalize_for_matching(path: &str) -> PathBuf {
    Path::new(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
}

fn path_depth(path: &Path) -> usize {
    path.components().count()
}

fn candidate_root<'a>(data: &'a ProjectsData, path: &str) -> Option<&'a Project> {
    if let Some(project) = data
        .projects
        .iter()
        .find(|project| !project.is_folder && project.path == path)
    {
        return Some(project);
    }

    let worktree = data
        .worktrees
        .iter()
        .find(|worktree| worktree.path == path)?;
    data.find_project(&worktree.project_id)
}

/// Find the project owning a repository path.
///
/// The path may be either the base project repository path or a tracked worktree path.
pub fn find_project_for_repo_path<'a>(
    data: &'a ProjectsData,
    repo_path: &str,
) -> Option<&'a Project> {
    candidate_root(data, repo_path)
}

/// Find the project owning any path under a project repo or tracked worktree.
pub fn find_project_for_path<'a>(data: &'a ProjectsData, path: &str) -> Option<&'a Project> {
    if let Some(project) = candidate_root(data, path) {
        return Some(project);
    }

    let target = canonicalize_for_matching(path);
    let mut best_match: Option<(&Project, usize)> = None;

    for project in data.projects.iter().filter(|project| !project.is_folder) {
        let root = canonicalize_for_matching(&project.path);
        if target.starts_with(&root) {
            let depth = path_depth(&root);
            if best_match.is_none_or(|(_, best_depth)| depth > best_depth) {
                best_match = Some((project, depth));
            }
        }
    }

    for worktree in &data.worktrees {
        let root = canonicalize_for_matching(&worktree.path);
        if !target.starts_with(&root) {
            continue;
        }
        let Some(project) = data.find_project(&worktree.project_id) else {
            continue;
        };
        let depth = path_depth(&root);
        if best_match.is_none_or(|(_, best_depth)| depth > best_depth) {
            best_match = Some((project, depth));
        }
    }

    best_match.map(|(project, _)| project)
}

pub fn resolve_editor_for_path(
    data: &ProjectsData,
    path: &str,
    explicit_editor: Option<&str>,
    global_editor: Option<&str>,
) -> String {
    explicit_editor
        .filter(|editor| !editor.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            find_project_for_path(data, path).and_then(|project| project.default_editor.clone())
        })
        .or_else(|| {
            global_editor
                .filter(|editor| !editor.is_empty())
                .map(ToOwned::to_owned)
        })
        .unwrap_or_else(|| "zed".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projects::types::{Project, ProjectsData, Worktree, WorktreeSlot};

    fn test_worktree(id: &str, slot_id: Option<&str>, path: &str) -> Worktree {
        Worktree {
            id: id.to_string(),
            project_id: "project-1".to_string(),
            name: id.to_string(),
            path: path.to_string(),
            stable_slot_id: slot_id.map(ToOwned::to_owned),
            branch: format!("{id}-branch"),
            base_branch: None,
            created_at: 10,
            setup_output: None,
            setup_script: None,
            setup_success: None,
            session_type: Default::default(),
            pr_number: None,
            pr_url: None,
            pr_push_remote: None,
            pr_push_branch: None,
            issue_number: None,
            linear_issue_identifier: None,
            security_alert_number: None,
            security_alert_url: None,
            advisory_ghsa_id: None,
            advisory_url: None,
            cached_pr_status: None,
            cached_check_status: None,
            cached_behind_count: None,
            cached_ahead_count: None,
            cached_status_at: None,
            cached_uncommitted_added: None,
            cached_uncommitted_removed: None,
            cached_branch_diff_added: None,
            cached_branch_diff_removed: None,
            cached_base_branch_ahead_count: None,
            cached_base_branch_behind_count: None,
            cached_worktree_ahead_count: None,
            cached_unpushed_count: None,
            order: 0,
            label: None,
            archived_at: None,
            last_opened_at: None,
            automation_id: None,
            automation_name: None,
            automation_owned: false,
        }
    }

    fn test_slot(id: &str, path: &str, state: WorktreeSlotState) -> WorktreeSlot {
        WorktreeSlot {
            id: id.to_string(),
            project_id: "project-1".to_string(),
            path: path.to_string(),
            state,
            worktree_id: None,
            branch: None,
            created_at: 1,
            last_used_at: 1,
            last_error: Some("old error".to_string()),
        }
    }

    fn make_git_like_slot(temp: &tempfile::TempDir, name: &str) -> String {
        let slot_path = temp.path().join(".jean-slots").join(name);
        std::fs::create_dir_all(&slot_path).expect("slot dir");
        std::fs::write(slot_path.join(".git"), "gitdir: test").expect("git marker");
        slot_path.to_string_lossy().to_string()
    }

    #[test]
    fn test_sanitize_directory_name() {
        assert_eq!(sanitize_directory_name("my-project"), "my-project");
        assert_eq!(sanitize_directory_name("my project"), "my-project");
        assert_eq!(sanitize_directory_name("my/project"), "my-project");
        assert_eq!(sanitize_directory_name("my_project"), "my_project");
        assert_eq!(sanitize_directory_name("MyProject123"), "MyProject123");
    }

    #[test]
    fn find_project_for_path_matches_nested_repo_and_worktree_paths() {
        let data = ProjectsData {
            projects: vec![
                Project {
                    id: "project-1".to_string(),
                    name: "demo".to_string(),
                    path: "/tmp/demo".to_string(),
                    default_branch: "main".to_string(),
                    added_at: 1,
                    order: 0,
                    parent_id: None,
                    is_folder: false,
                    avatar_path: None,
                    enabled_mcp_servers: None,
                    known_mcp_servers: vec![],
                    custom_system_prompt: None,
                    default_provider: None,
                    default_backend: None,
                    github_account_host: None,
                    github_account_user: None,
                    worktrees_dir: None,
                    stable_worktree_slots_enabled: false,
                    linear_api_key: None,
                    linear_team_id: None,
                    hide_github_issues_and_prs: false,
                    linked_project_ids: vec![],
                    default_editor: Some("zed".to_string()),
                },
                Project {
                    id: "project-2".to_string(),
                    name: "other".to_string(),
                    path: "/tmp/other".to_string(),
                    default_branch: "main".to_string(),
                    added_at: 1,
                    order: 1,
                    parent_id: None,
                    is_folder: false,
                    avatar_path: None,
                    enabled_mcp_servers: None,
                    known_mcp_servers: vec![],
                    custom_system_prompt: None,
                    default_provider: None,
                    default_backend: None,
                    github_account_host: None,
                    github_account_user: None,
                    worktrees_dir: None,
                    stable_worktree_slots_enabled: false,
                    linear_api_key: None,
                    linear_team_id: None,
                    hide_github_issues_and_prs: false,
                    linked_project_ids: vec![],
                    default_editor: Some("cursor".to_string()),
                },
            ],
            worktrees: vec![Worktree {
                id: "worktree-1".to_string(),
                project_id: "project-1".to_string(),
                name: "feature".to_string(),
                path: "/tmp/demo/.worktrees/feature".to_string(),
                stable_slot_id: None,
                branch: "feature".to_string(),
                base_branch: None,
                created_at: 1,
                setup_output: None,
                setup_script: None,
                setup_success: None,
                session_type: Default::default(),
                pr_number: None,
                pr_url: None,
                pr_push_remote: None,
                pr_push_branch: None,
                issue_number: None,
                linear_issue_identifier: None,
                security_alert_number: None,
                security_alert_url: None,
                advisory_ghsa_id: None,
                advisory_url: None,
                cached_pr_status: None,
                cached_check_status: None,
                cached_behind_count: None,
                cached_ahead_count: None,
                cached_status_at: None,
                cached_uncommitted_added: None,
                cached_uncommitted_removed: None,
                cached_branch_diff_added: None,
                cached_branch_diff_removed: None,
                cached_base_branch_ahead_count: None,
                cached_base_branch_behind_count: None,
                cached_worktree_ahead_count: None,
                cached_unpushed_count: None,
                order: 0,
                label: None,
                archived_at: None,
                last_opened_at: None,
                automation_id: None,
                automation_name: None,
                automation_owned: false,
            }],
            worktree_slots: vec![],
        };

        let project = find_project_for_path(&data, "/tmp/demo/src/main.ts").unwrap();
        assert_eq!(project.id, "project-1");

        let project =
            find_project_for_path(&data, "/tmp/demo/.worktrees/feature/src/App.tsx").unwrap();
        assert_eq!(project.id, "project-1");

        let project = find_project_for_path(&data, "/tmp/other/README.md").unwrap();
        assert_eq!(project.id, "project-2");
    }

    #[test]
    fn resolve_editor_for_path_prefers_explicit_then_project_then_global() {
        let data = ProjectsData {
            projects: vec![Project {
                id: "project-1".to_string(),
                name: "demo".to_string(),
                path: "/tmp/demo".to_string(),
                default_branch: "main".to_string(),
                added_at: 1,
                order: 0,
                parent_id: None,
                is_folder: false,
                avatar_path: None,
                enabled_mcp_servers: None,
                known_mcp_servers: vec![],
                custom_system_prompt: None,
                default_provider: None,
                default_backend: None,
                github_account_host: None,
                github_account_user: None,
                worktrees_dir: None,
                stable_worktree_slots_enabled: false,
                linear_api_key: None,
                linear_team_id: None,
                hide_github_issues_and_prs: false,
                linked_project_ids: vec![],
                default_editor: Some("zed".to_string()),
            }],
            worktrees: vec![],
            worktree_slots: vec![],
        };

        assert_eq!(
            resolve_editor_for_path(
                &data,
                "/tmp/demo/src/main.ts",
                Some("cursor"),
                Some("vscode")
            ),
            "cursor"
        );
        assert_eq!(
            resolve_editor_for_path(&data, "/tmp/demo/src/main.ts", None, Some("vscode")),
            "zed"
        );
        assert_eq!(
            resolve_editor_for_path(&data, "/tmp/unknown/file.ts", None, Some("vscode")),
            "vscode"
        );
        assert_eq!(
            resolve_editor_for_path(&data, "/tmp/unknown/file.ts", None, None),
            "zed"
        );
    }

    #[test]
    fn reconcile_repairs_error_slot_referenced_by_live_worktree() {
        let temp = tempfile::tempdir().expect("tempdir");
        let slot_path = make_git_like_slot(&temp, "demo-slot-1");
        let mut data = ProjectsData {
            projects: vec![],
            worktrees: vec![test_worktree("worktree-1", Some("slot-1"), &slot_path)],
            worktree_slots: vec![test_slot(
                "slot-1",
                "/missing/old-path",
                WorktreeSlotState::Error,
            )],
        };

        assert!(reconcile_worktree_slots(&mut data));

        let slot = &data.worktree_slots[0];
        assert_eq!(slot.state, WorktreeSlotState::Active);
        assert_eq!(slot.path, slot_path);
        assert_eq!(slot.worktree_id.as_deref(), Some("worktree-1"));
        assert_eq!(slot.branch.as_deref(), Some("worktree-1-branch"));
        assert_eq!(slot.last_error, None);
    }

    #[test]
    fn reconcile_recreates_missing_slot_for_live_slotted_worktree() {
        let temp = tempfile::tempdir().expect("tempdir");
        let slot_path = make_git_like_slot(&temp, "demo-slot-2");
        let mut data = ProjectsData {
            projects: vec![],
            worktrees: vec![test_worktree("worktree-2", Some("slot-2"), &slot_path)],
            worktree_slots: vec![],
        };

        assert!(reconcile_worktree_slots(&mut data));

        let slot = &data.worktree_slots[0];
        assert_eq!(slot.id, "slot-2");
        assert_eq!(slot.state, WorktreeSlotState::Active);
        assert_eq!(slot.worktree_id.as_deref(), Some("worktree-2"));
    }

    #[test]
    fn reconcile_keeps_corrupt_live_slot_in_error_state() {
        let temp = tempfile::tempdir().expect("tempdir");
        let slot_path = temp
            .path()
            .join(".jean-slots")
            .join("demo-slot-3")
            .to_string_lossy()
            .to_string();
        std::fs::create_dir_all(&slot_path).expect("slot dir");
        let mut data = ProjectsData {
            projects: vec![],
            worktrees: vec![test_worktree("worktree-3", Some("slot-3"), &slot_path)],
            worktree_slots: vec![test_slot("slot-3", &slot_path, WorktreeSlotState::Idle)],
        };

        assert!(reconcile_worktree_slots(&mut data));

        let slot = &data.worktree_slots[0];
        assert_eq!(slot.state, WorktreeSlotState::Error);
        assert_eq!(
            slot.last_error.as_deref(),
            Some("Slot path is not a git worktree")
        );
        assert_eq!(slot.worktree_id.as_deref(), Some("worktree-3"));
    }

    #[test]
    fn reconcile_active_slot_without_live_worktree_becomes_idle_when_usable() {
        let temp = tempfile::tempdir().expect("tempdir");
        let slot_path = make_git_like_slot(&temp, "demo-slot-4");
        let mut slot = test_slot("slot-4", &slot_path, WorktreeSlotState::Active);
        slot.worktree_id = Some("missing-worktree".to_string());
        let mut data = ProjectsData {
            projects: vec![],
            worktrees: vec![],
            worktree_slots: vec![slot],
        };

        assert!(reconcile_worktree_slots(&mut data));

        let slot = &data.worktree_slots[0];
        assert_eq!(slot.state, WorktreeSlotState::Idle);
        assert_eq!(slot.worktree_id, None);
        assert_eq!(slot.branch, None);
        assert_eq!(slot.last_error, None);
    }

    #[test]
    fn reconcile_keeps_recent_active_reservation_without_worktree_record() {
        let recent = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        let mut slot = test_slot(
            "slot-5",
            "/tmp/demo/.jean-slots/demo-slot-5",
            WorktreeSlotState::Active,
        );
        slot.worktree_id = Some("pending-worktree".to_string());
        slot.created_at = recent;
        let mut data = ProjectsData {
            projects: vec![],
            worktrees: vec![],
            worktree_slots: vec![slot],
        };

        assert!(!reconcile_worktree_slots(&mut data));

        let slot = &data.worktree_slots[0];
        assert_eq!(slot.state, WorktreeSlotState::Active);
        assert_eq!(slot.worktree_id.as_deref(), Some("pending-worktree"));
    }
}
