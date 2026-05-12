use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::AppHandle;
use uuid::Uuid;

use super::git;
use super::storage::{
    get_project_worktrees_dir, sanitize_directory_name, save_projects_data, with_projects_data_mut,
};
use super::types::{Project, ProjectsData, WorktreeSlot, WorktreeSlotState};

const MAX_IDLE_SLOTS_PER_PROJECT: usize = 4;
pub(crate) const PRESERVED_SLOT_DIRS: &[&str] = &[
    "target",
    ".idea",
    "node_modules",
    ".venv",
    "venv",
    ".gradle",
    "build",
    "dist",
    ".next",
    ".pnpm-store",
    ".bun",
];

#[derive(Debug, Clone)]
pub struct SlotReservation {
    pub slot_id: String,
    pub path: String,
    pub reused: bool,
    pub requires_worktree_create: bool,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn reserve_slot(
    app: &AppHandle,
    project: &Project,
    worktree_id: &str,
    branch: &str,
) -> Result<Option<SlotReservation>, String> {
    if !project.stable_worktree_slots_enabled {
        return Ok(None);
    }

    with_projects_data_mut(app, |data| {
        let now = now();
        if let Some(slot) = data
            .worktree_slots
            .iter_mut()
            .filter(|slot| slot.project_id == project.id && slot.state == WorktreeSlotState::Idle)
            .min_by_key(|slot| slot.last_used_at)
        {
            slot.state = WorktreeSlotState::Active;
            slot.worktree_id = Some(worktree_id.to_string());
            slot.branch = Some(branch.to_string());
            slot.last_used_at = now;
            slot.last_error = None;
            return Ok(Some(SlotReservation {
                slot_id: slot.id.clone(),
                path: slot.path.clone(),
                reused: true,
                requires_worktree_create: !Path::new(&slot.path).join(".git").exists(),
            }));
        }

        let slot_number = next_slot_number(data, &project.id);
        let slot_path =
            get_project_worktrees_dir(app, &project.name, project.worktrees_dir.as_deref())?
                .join(".jean-slots")
                .join(slot_folder_name(&project.name, slot_number));
        if let Some(parent) = slot_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create slots directory: {e}"))?;
        }
        let path = slot_path
            .to_str()
            .ok_or_else(|| "Invalid slot path".to_string())?
            .to_string();
        let slot_id = Uuid::new_v4().to_string();

        data.worktree_slots.push(WorktreeSlot {
            id: slot_id.clone(),
            project_id: project.id.clone(),
            path: path.clone(),
            state: WorktreeSlotState::Active,
            worktree_id: Some(worktree_id.to_string()),
            branch: Some(branch.to_string()),
            created_at: now,
            last_used_at: now,
            last_error: None,
        });

        Ok(Some(SlotReservation {
            slot_id,
            path,
            reused: false,
            requires_worktree_create: false,
        }))
    })
}

fn next_slot_number(data: &ProjectsData, project_id: &str) -> usize {
    let mut n = 1;
    loop {
        let suffix = format!("slot-{n}");
        if !data
            .worktree_slots
            .iter()
            .any(|slot| slot.project_id == project_id && slot.path.ends_with(&suffix))
        {
            return n;
        }
        n += 1;
    }
}

fn slot_folder_name(project_name: &str, slot_number: usize) -> String {
    format!(
        "{}-slot-{slot_number}",
        sanitize_directory_name(project_name)
    )
}

pub fn prepare_reused_slot(
    project_path: &str,
    slot_path: &str,
    branch: &str,
    base: &str,
) -> Result<(), String> {
    if !Path::new(slot_path).join(".git").exists() {
        return Err("Slot path is not a git worktree".to_string());
    }
    if git::is_main_worktree(project_path, slot_path) {
        return Err("Slot path points at the main worktree".to_string());
    }
    git::reset_hard(slot_path)?;
    git::clean_for_slot_reuse(slot_path)?;
    git::detach_head(slot_path)?;
    git::checkout_new_branch_from(slot_path, branch, base)?;
    Ok(())
}

pub fn create_worktree_in_preserved_slot(
    project_path: &str,
    slot_path: &str,
    branch: &str,
    base: &str,
) -> Result<(), String> {
    with_preserved_heavy_dirs(slot_path, |slot_path| {
        git::create_worktree(project_path, &slot_path.to_string_lossy(), branch, base)
    })
}

pub fn create_existing_branch_worktree_in_preserved_slot(
    project_path: &str,
    slot_path: &str,
    branch: &str,
) -> Result<(), String> {
    with_preserved_heavy_dirs(slot_path, |slot_path| {
        git::create_worktree_from_existing_branch(
            project_path,
            &slot_path.to_string_lossy(),
            branch,
        )
    })
}

pub fn release_slot_path_preserving_heavy_dirs(
    project_path: &str,
    slot_path: &str,
    branch: &str,
) -> Result<(), String> {
    with_preserved_heavy_dirs(slot_path, |slot_path| {
        git::remove_worktree(project_path, &slot_path.to_string_lossy())?;
        git::delete_branch(project_path, branch)
    })
}

pub fn restore_heavy_dirs_to_slot_after_archive(
    archive_path: &str,
    slot_path: &str,
) -> Result<(), String> {
    let archive_path = Path::new(archive_path);
    let slot_path = Path::new(slot_path);
    let staging_dir = stage_heavy_dirs(archive_path)?;
    if slot_path.exists() {
        std::fs::remove_dir_all(slot_path)
            .map_err(|e| format!("Failed to clear archived slot path: {e}"))?;
    }
    std::fs::create_dir_all(slot_path)
        .map_err(|e| format!("Failed to recreate archived slot path: {e}"))?;
    restore_staged_heavy_dirs(slot_path, staging_dir)
}

pub fn release_slot_for_worktree(
    app: &AppHandle,
    data: &mut ProjectsData,
    project: &Project,
    _worktree_id: &str,
    branch: &str,
    slot_id: &str,
    slot_path: &str,
) -> Result<(), String> {
    release_slot_path_preserving_heavy_dirs(&project.path, slot_path, branch)?;

    if let Some(slot) = data
        .worktree_slots
        .iter_mut()
        .find(|slot| slot.id == slot_id)
    {
        slot.state = WorktreeSlotState::Idle;
        slot.worktree_id = None;
        slot.branch = None;
        slot.last_used_at = now();
        slot.last_error = None;
    }
    enforce_idle_limit(data, project);
    save_projects_data(app, data)?;
    Ok(())
}

pub fn mark_slot_idle(data: &mut ProjectsData, project: &Project, slot_id: &str) {
    if let Some(slot) = data
        .worktree_slots
        .iter_mut()
        .find(|slot| slot.id == slot_id)
    {
        slot.state = WorktreeSlotState::Idle;
        slot.worktree_id = None;
        slot.branch = None;
        slot.last_used_at = now();
        slot.last_error = None;
    }
    enforce_idle_limit(data, project);
}

pub fn mark_slot_error(
    app: &AppHandle,
    data: &mut ProjectsData,
    slot_id: &str,
    error: String,
) -> Result<(), String> {
    if let Some(slot) = data
        .worktree_slots
        .iter_mut()
        .find(|slot| slot.id == slot_id)
    {
        slot.state = WorktreeSlotState::Error;
        slot.last_error = Some(error);
        slot.worktree_id = None;
        slot.branch = None;
    }
    save_projects_data(app, data)
}

pub fn abandon_reservation(
    app: &AppHandle,
    data: &mut ProjectsData,
    reservation: &SlotReservation,
) -> Result<(), String> {
    if reservation.reused {
        if let Some(slot) = data
            .worktree_slots
            .iter_mut()
            .find(|slot| slot.id == reservation.slot_id)
        {
            slot.state = WorktreeSlotState::Idle;
            slot.worktree_id = None;
            slot.branch = None;
            slot.last_used_at = now();
            slot.last_error = None;
        }
    } else {
        data.worktree_slots
            .retain(|slot| slot.id != reservation.slot_id);
        if Path::new(&reservation.path).exists() {
            let _ = std::fs::remove_dir_all(&reservation.path);
        }
    }
    save_projects_data(app, data)
}

pub fn reset_slot(app: &AppHandle, project_id: &str, slot_id: &str) -> Result<(), String> {
    let mut data = super::storage::load_projects_data(app)?;
    let slot = data
        .worktree_slots
        .iter()
        .find(|slot| slot.project_id == project_id && slot.id == slot_id)
        .cloned()
        .ok_or_else(|| format!("Slot not found: {slot_id}"))?;
    if slot.state == WorktreeSlotState::Active {
        return Err("Active slots can't be reset".to_string());
    }
    remove_slot_path(&slot);
    data.worktree_slots.retain(|slot| slot.id != slot_id);
    save_projects_data(app, &data)
}

pub fn reset_idle_slots(app: &AppHandle, project_id: &str) -> Result<(), String> {
    let mut data = super::storage::load_projects_data(app)?;
    let removable: Vec<String> = data
        .worktree_slots
        .iter()
        .filter(|slot| {
            slot.project_id == project_id
                && matches!(
                    slot.state,
                    WorktreeSlotState::Idle | WorktreeSlotState::Error
                )
        })
        .map(|slot| slot.id.clone())
        .collect();

    for slot_id in &removable {
        if let Some(slot) = data.worktree_slots.iter().find(|slot| &slot.id == slot_id) {
            remove_slot_path(slot);
        }
    }
    data.worktree_slots
        .retain(|slot| !removable.contains(&slot.id));
    save_projects_data(app, &data)
}

pub fn slots_for_project(app: &AppHandle, project_id: &str) -> Result<Vec<WorktreeSlot>, String> {
    let data = super::storage::load_projects_data(app)?;
    Ok(data
        .worktree_slots
        .into_iter()
        .filter(|slot| slot.project_id == project_id)
        .collect())
}

fn enforce_idle_limit(data: &mut ProjectsData, project: &Project) {
    let mut idle_slots: Vec<WorktreeSlot> = data
        .worktree_slots
        .iter()
        .filter(|slot| slot.project_id == project.id && slot.state == WorktreeSlotState::Idle)
        .cloned()
        .collect();
    idle_slots.sort_by_key(|slot| slot.last_used_at);

    let remove_count = idle_slots.len().saturating_sub(MAX_IDLE_SLOTS_PER_PROJECT);
    let remove_ids: Vec<String> = idle_slots
        .into_iter()
        .take(remove_count)
        .map(|slot| {
            remove_slot_path(&slot);
            slot.id
        })
        .collect();
    data.worktree_slots
        .retain(|slot| !remove_ids.contains(&slot.id));
}

fn remove_slot_path(slot: &WorktreeSlot) {
    if Path::new(&slot.path).exists() {
        let _ = std::fs::remove_dir_all(&slot.path);
    }
}

fn with_preserved_heavy_dirs<F>(slot_path: &str, action: F) -> Result<(), String>
where
    F: FnOnce(&Path) -> Result<(), String>,
{
    let slot_path = Path::new(slot_path);
    let staging_dir = stage_heavy_dirs(slot_path)?;
    if slot_path.exists() {
        std::fs::remove_dir_all(slot_path)
            .map_err(|e| format!("Failed to clear slot path: {e}"))?;
    }

    let action_result = action(slot_path);
    if action_result.is_ok() {
        std::fs::create_dir_all(slot_path)
            .map_err(|e| format!("Failed to recreate slot path: {e}"))?;
    } else if !slot_path.exists() {
        std::fs::create_dir_all(slot_path)
            .map_err(|e| format!("Failed to restore slot path after failure: {e}"))?;
    }

    let restore_result = restore_staged_heavy_dirs(slot_path, staging_dir);
    action_result.and(restore_result)
}

fn stage_heavy_dirs(path: &Path) -> Result<Option<PathBuf>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let parent = path
        .parent()
        .ok_or_else(|| "Slot path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|e| format!("Failed to create slot parent directory: {e}"))?;
    let staging_dir = parent.join(format!(".jean-preserved-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to create slot preservation directory: {e}"))?;

    let mut moved_any = false;
    for entry in std::fs::read_dir(path).map_err(|e| format!("Failed to read slot path: {e}"))? {
        let entry = entry.map_err(|e| format!("Failed to read slot entry: {e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to inspect slot entry: {e}"))?;
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(name_str) = name.to_str() else {
            continue;
        };
        if !PRESERVED_SLOT_DIRS.contains(&name_str) {
            continue;
        }
        std::fs::rename(entry.path(), staging_dir.join(&name))
            .map_err(|e| format!("Failed to preserve slot directory {name_str}: {e}"))?;
        moved_any = true;
    }

    if moved_any {
        Ok(Some(staging_dir))
    } else {
        let _ = std::fs::remove_dir_all(&staging_dir);
        Ok(None)
    }
}

fn restore_staged_heavy_dirs(slot_path: &Path, staging_dir: Option<PathBuf>) -> Result<(), String> {
    let Some(staging_dir) = staging_dir else {
        return Ok(());
    };
    std::fs::create_dir_all(slot_path)
        .map_err(|e| format!("Failed to create slot path for preserved directories: {e}"))?;
    for entry in std::fs::read_dir(&staging_dir)
        .map_err(|e| format!("Failed to read preserved dirs: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read preserved dir entry: {e}"))?;
        let destination = slot_path.join(entry.file_name());
        if destination.exists() {
            std::fs::remove_dir_all(&destination)
                .map_err(|e| format!("Failed to replace preserved directory: {e}"))?;
        }
        std::fs::rename(entry.path(), &destination)
            .map_err(|e| format!("Failed to restore preserved directory: {e}"))?;
    }
    std::fs::remove_dir_all(&staging_dir)
        .map_err(|e| format!("Failed to remove slot preservation directory: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn test_project() -> Project {
        Project {
            id: "project-1".to_string(),
            name: "demo".to_string(),
            path: "/tmp/demo".to_string(),
            default_branch: "main".to_string(),
            added_at: 0,
            order: 0,
            parent_id: None,
            is_folder: false,
            avatar_path: None,
            default_avatar_path: None,
            enabled_mcp_servers: None,
            known_mcp_servers: vec![],
            custom_system_prompt: None,
            default_provider: None,
            default_backend: None,
            github_account_host: None,
            github_account_user: None,
            worktrees_dir: None,
            stable_worktree_slots_enabled: true,
            linear_api_key: None,
            linear_team_id: None,
            default_editor: None,
            hide_github_issues_and_prs: false,
            linked_project_ids: vec![],
        }
    }

    fn test_slot(id: &str, project_id: &str, n: usize, last_used_at: u64) -> WorktreeSlot {
        WorktreeSlot {
            id: id.to_string(),
            project_id: project_id.to_string(),
            path: format!("/tmp/demo/.jean-slots/demo-slot-{n}"),
            state: WorktreeSlotState::Idle,
            worktree_id: None,
            branch: None,
            created_at: last_used_at,
            last_used_at,
            last_error: None,
        }
    }

    fn git(repo_path: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(repo_path)
            .output()
            .expect("git command");
        assert!(
            output.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn test_repo() -> tempfile::TempDir {
        let temp = tempfile::tempdir().expect("tempdir");
        git(temp.path(), &["init", "-b", "main"]);
        git(temp.path(), &["config", "user.email", "test@example.com"]);
        git(temp.path(), &["config", "user.name", "Test User"]);
        std::fs::write(temp.path().join("README.md"), "hello\n").expect("readme");
        git(temp.path(), &["add", "README.md"]);
        git(temp.path(), &["commit", "-m", "initial"]);
        temp
    }

    fn make_git_worktree(repo_path: &Path, slot_path: &Path, branch: &str) {
        let slot_path = slot_path.to_string_lossy().to_string();
        git(
            repo_path,
            &["worktree", "add", "-b", branch, &slot_path, "main"],
        );
    }

    fn add_slot_contents(slot_path: &Path) {
        std::fs::create_dir_all(slot_path.join("target/debug")).expect("target");
        std::fs::write(slot_path.join("target/debug/sentinel"), "target").expect("target file");
        std::fs::create_dir_all(slot_path.join(".idea")).expect("idea");
        std::fs::write(slot_path.join(".idea/workspace.xml"), "idea").expect("idea file");
        std::fs::create_dir_all(slot_path.join("node_modules/pkg")).expect("node_modules");
        std::fs::write(slot_path.join("node_modules/pkg/sentinel"), "node").expect("node file");
        std::fs::write(slot_path.join("scratch.txt"), "delete me").expect("scratch");
    }

    #[test]
    fn slot_folder_name_includes_sanitized_project_name() {
        assert_eq!(slot_folder_name("demo", 3), "demo-slot-3");
        assert_eq!(slot_folder_name("fleet badger", 3), "fleet-badger-slot-3");
    }

    #[test]
    fn next_slot_number_skips_existing_project_slots() {
        let data = ProjectsData {
            projects: vec![],
            worktrees: vec![],
            worktree_slots: vec![
                test_slot("slot-a", "project-1", 1, 1),
                test_slot("slot-b", "project-1", 2, 2),
                test_slot("slot-c", "project-2", 3, 3),
            ],
        };

        assert_eq!(next_slot_number(&data, "project-1"), 3);
        assert_eq!(next_slot_number(&data, "project-2"), 1);
    }

    #[test]
    fn enforce_idle_limit_removes_least_recently_used_slots() {
        let project = test_project();
        let mut data = ProjectsData {
            projects: vec![project.clone()],
            worktrees: vec![],
            worktree_slots: vec![
                test_slot("slot-1", &project.id, 1, 1),
                test_slot("slot-2", &project.id, 2, 2),
                test_slot("slot-3", &project.id, 3, 3),
                test_slot("slot-4", &project.id, 4, 4),
                test_slot("slot-5", &project.id, 5, 5),
            ],
        };

        enforce_idle_limit(&mut data, &project);

        let ids: Vec<String> = data
            .worktree_slots
            .iter()
            .map(|slot| slot.id.clone())
            .collect();
        assert_eq!(ids, vec!["slot-2", "slot-3", "slot-4", "slot-5"]);
    }

    #[test]
    fn release_preserves_heavyweight_dirs_without_git_metadata() {
        let repo = test_repo();
        let slot_path = repo.path().join(".jean-slots").join("demo-slot-1");
        make_git_worktree(repo.path(), &slot_path, "feature-delete");
        add_slot_contents(&slot_path);

        release_slot_path_preserving_heavy_dirs(
            &repo.path().to_string_lossy(),
            &slot_path.to_string_lossy(),
            "feature-delete",
        )
        .expect("release slot");

        assert!(slot_path.exists());
        assert!(!slot_path.join(".git").exists());
        assert!(slot_path.join("target/debug/sentinel").exists());
        assert!(slot_path.join(".idea/workspace.xml").exists());
        assert!(slot_path.join("node_modules/pkg/sentinel").exists());
        assert!(!slot_path.join("scratch.txt").exists());
    }

    #[test]
    fn reusable_preserved_slot_restores_heavyweight_dirs_after_worktree_add() {
        let repo = test_repo();
        let slot_path = repo.path().join(".jean-slots").join("demo-slot-1");
        make_git_worktree(repo.path(), &slot_path, "feature-delete");
        add_slot_contents(&slot_path);
        release_slot_path_preserving_heavy_dirs(
            &repo.path().to_string_lossy(),
            &slot_path.to_string_lossy(),
            "feature-delete",
        )
        .expect("release slot");

        create_worktree_in_preserved_slot(
            &repo.path().to_string_lossy(),
            &slot_path.to_string_lossy(),
            "feature-reuse",
            "main",
        )
        .expect("reuse slot");

        assert!(slot_path.join(".git").exists());
        assert!(slot_path.join("README.md").exists());
        assert!(slot_path.join("target/debug/sentinel").exists());
        assert!(slot_path.join(".idea/workspace.xml").exists());
        assert!(slot_path.join("node_modules/pkg/sentinel").exists());
    }

    #[test]
    fn archive_restores_heavyweight_dirs_to_slot_path() {
        let repo = test_repo();
        let slot_path = repo.path().join(".jean-slots").join("demo-slot-1");
        let archive_path = repo.path().join("archived-feature");
        make_git_worktree(repo.path(), &slot_path, "feature-archive");
        add_slot_contents(&slot_path);

        git::move_worktree(
            &repo.path().to_string_lossy(),
            &slot_path.to_string_lossy(),
            &archive_path.to_string_lossy(),
        )
        .expect("move worktree");
        restore_heavy_dirs_to_slot_after_archive(
            &archive_path.to_string_lossy(),
            &slot_path.to_string_lossy(),
        )
        .expect("restore heavy dirs");

        assert!(archive_path.join(".git").exists());
        assert!(!slot_path.join(".git").exists());
        assert!(slot_path.join("target/debug/sentinel").exists());
        assert!(slot_path.join(".idea/workspace.xml").exists());
        assert!(slot_path.join("node_modules/pkg/sentinel").exists());
        assert!(!archive_path.join("target/debug/sentinel").exists());
        assert!(!archive_path.join(".idea/workspace.xml").exists());
        assert!(!archive_path.join("node_modules/pkg/sentinel").exists());
    }
}
