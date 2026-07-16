use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use super::commands::{add_project, create_base_session};
use super::git;
use super::storage::load_projects_data;
use super::types::{Project, Worktree};

const APP_IDENTIFIER: &str = "com.jean.desktop";
const CLI_IMPORT_DIR_NAME: &str = "cli-imports";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingCliImportRequest {
    pub id: String,
    pub path: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliImportedProjectResult {
    pub project: Project,
    pub worktree: Worktree,
    pub session_id: String,
    pub created: bool,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn cli_imports_dir_from_data_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(APP_IDENTIFIER).join(CLI_IMPORT_DIR_NAME)
}

fn cli_imports_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or_else(|| "Failed to locate local data directory".to_string())?;
    let imports_dir = cli_imports_dir_from_data_dir(&data_dir);
    std::fs::create_dir_all(&imports_dir)
        .map_err(|e| format!("Failed to create CLI imports directory: {e}"))?;
    Ok(imports_dir)
}

pub fn normalize_cli_import_path(path: &str, current_dir: &Path) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Import path cannot be empty".to_string());
    }

    let joined = if Path::new(trimmed).is_absolute() {
        PathBuf::from(trimmed)
    } else {
        current_dir.join(trimmed)
    };

    let canonical = joined
        .canonicalize()
        .map_err(|e| format!("Failed to resolve import path '{}': {e}", joined.display()))?;

    Ok(canonical.to_string_lossy().to_string())
}

fn canonicalize_existing_project_path(path: &str) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok()
}

fn find_existing_project_for_path<'a>(
    projects: &'a [Project],
    canonical_path: &Path,
) -> Option<&'a Project> {
    projects.iter().find(|project| {
        !project.is_folder
            && canonicalize_existing_project_path(&project.path).as_deref() == Some(canonical_path)
    })
}

pub fn enqueue_cli_import_request(path: &str) -> Result<PendingCliImportRequest, String> {
    let current_dir =
        std::env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?;
    let normalized_path = normalize_cli_import_path(path, &current_dir)?;

    if !git::validate_git_repo(&normalized_path)? {
        return Err(format!(
            "The selected folder is not a git repository.\n\n\
            To add this project, first initialize it as a git repository by running:\n\
            cd \"{normalized_path}\" && git init"
        ));
    }

    let request = PendingCliImportRequest {
        id: Uuid::new_v4().to_string(),
        path: normalized_path,
        created_at: now(),
    };

    let request_path =
        cli_imports_dir()?.join(format!("{}-{}.json", request.created_at, request.id));
    let payload = serde_json::to_string_pretty(&request)
        .map_err(|e| format!("Failed to serialize CLI import request: {e}"))?;
    std::fs::write(&request_path, payload)
        .map_err(|e| format!("Failed to write CLI import request: {e}"))?;

    Ok(request)
}

fn sorted_request_paths(imports_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(imports_dir)
        .map_err(|e| format!("Failed to read CLI imports directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read CLI import entry: {e}"))?;
        let path = entry.path();
        if path.extension() == Some(OsStr::new("json")) {
            entries.push(path);
        }
    }
    entries.sort();
    Ok(entries)
}

pub fn take_pending_cli_import_requests() -> Result<Vec<PendingCliImportRequest>, String> {
    let imports_dir = cli_imports_dir()?;
    let mut requests = Vec::new();

    for request_path in sorted_request_paths(&imports_dir)? {
        let contents = std::fs::read_to_string(&request_path)
            .map_err(|e| format!("Failed to read CLI import request: {e}"))?;
        let request: PendingCliImportRequest = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse CLI import request: {e}"))?;
        std::fs::remove_file(&request_path)
            .map_err(|e| format!("Failed to consume CLI import request: {e}"))?;
        requests.push(request);
    }

    Ok(requests)
}

pub async fn import_project_for_cli(
    app: AppHandle,
    path: String,
) -> Result<CliImportedProjectResult, String> {
    let current_dir =
        std::env::current_dir().map_err(|e| format!("Failed to get current directory: {e}"))?;
    let normalized_path = normalize_cli_import_path(&path, &current_dir)?;

    if !git::validate_git_repo(&normalized_path)? {
        return Err(format!(
            "The selected folder is not a git repository.\n\n\
            To add this project, first initialize it as a git repository by running:\n\
            cd \"{normalized_path}\" && git init"
        ));
    }

    let normalized_path_buf = PathBuf::from(&normalized_path);
    let existing_project = {
        let data = load_projects_data(&app)?;
        find_existing_project_for_path(&data.projects, &normalized_path_buf).cloned()
    };

    let (project, created) = if let Some(project) = existing_project {
        (project, false)
    } else {
        (
            add_project(app.clone(), normalized_path.clone(), None).await?,
            true,
        )
    };

    let worktree = create_base_session(app.clone(), project.id.clone()).await?;
    let sessions = crate::chat::get_sessions(
        app,
        worktree.id.clone(),
        worktree.path.clone(),
        Some(false),
        Some(false),
    )
    .await?;

    let session_id = sessions
        .active_session_id
        .or_else(|| sessions.sessions.first().map(|session| session.id.clone()))
        .ok_or_else(|| format!("No active session found for worktree {}", worktree.id))?;

    Ok(CliImportedProjectResult {
        project,
        worktree,
        session_id,
        created,
    })
}

#[tauri::command]
pub async fn consume_pending_cli_import_requests() -> Result<Vec<PendingCliImportRequest>, String> {
    take_pending_cli_import_requests()
}

#[tauri::command]
pub async fn import_project_from_cli_path(
    app: AppHandle,
    path: String,
) -> Result<CliImportedProjectResult, String> {
    import_project_for_cli(app, path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn normalize_cli_import_path_resolves_relative_paths() {
        let temp = tempdir().unwrap();
        let repo_dir = temp.path().join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();

        let resolved = normalize_cli_import_path("repo", temp.path()).unwrap();

        assert_eq!(PathBuf::from(resolved), repo_dir.canonicalize().unwrap());
    }

    #[test]
    fn normalize_cli_import_path_rejects_empty_path() {
        let temp = tempdir().unwrap();

        let error = normalize_cli_import_path("   ", temp.path()).unwrap_err();

        assert!(error.contains("cannot be empty"));
    }

    #[test]
    fn find_existing_project_for_path_matches_canonical_paths() {
        let temp = tempdir().unwrap();
        let repo_dir = temp.path().join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();
        let canonical = repo_dir.canonicalize().unwrap();

        let projects = vec![Project {
            id: "project-1".to_string(),
            name: "repo".to_string(),
            path: repo_dir.to_string_lossy().to_string(),
            default_branch: "main".to_string(),
            added_at: 0,
            order: 0,
            parent_id: None,
            is_folder: false,
            avatar_path: None,
            default_avatar_path: None,
            enabled_mcp_servers: None,
            known_mcp_servers: Vec::new(),
            custom_system_prompt: None,
            default_provider: None,
            default_backend: None,
            github_account_host: None,
            github_account_user: None,
            worktrees_dir: None,
            stable_worktree_slots_enabled: false,
            linear_api_key: None,
            linear_team_id: None,
            default_editor: None,
            hide_github_issues_and_prs: false,
            sentry_auth_token: None,
            sentry_organization_slug: None,
            sentry_project_slug: None,
            linked_project_ids: Vec::new(),
        }];

        let found = find_existing_project_for_path(&projects, &canonical).unwrap();

        assert_eq!(found.id, "project-1");
    }

    #[test]
    fn cli_imports_dir_from_data_dir_nests_under_app_identifier() {
        let base = Path::new("/tmp/jean-cli-import-test");
        let imports_dir = cli_imports_dir_from_data_dir(base);

        assert_eq!(
            imports_dir,
            PathBuf::from("/tmp/jean-cli-import-test")
                .join(APP_IDENTIFIER)
                .join(CLI_IMPORT_DIR_NAME)
        );
    }
}
