use std::path::{Path, PathBuf};
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::{AppHandle, Manager};

use super::types::{Project, ProjectsData};

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

    let data = ProjectsData {
        projects: data.projects,
        worktrees: valid_worktrees,
    };

    // Save cleaned data if any orphans were removed
    if removed_count > 0 {
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
    use crate::projects::types::{Project, ProjectsData, Worktree};

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
                linear_api_key: None,
                linear_team_id: None,
                hide_github_issues_and_prs: false,
                linked_project_ids: vec![],
                default_editor: Some("zed".to_string()),
            }],
            worktrees: vec![],
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
}
