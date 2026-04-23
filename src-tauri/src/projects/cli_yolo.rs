use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use tauri::AppHandle;
use uuid::Uuid;

use crate::chat::types::Session;

use super::commands::create_base_session;
use super::storage::load_projects_data;
use super::types::{Project, ProjectsData, Worktree};

const APP_IDENTIFIER: &str = "com.jean.desktop";
const CLI_YOLO_DIR_NAME: &str = "cli-yolo";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingCliYoloRequest {
    pub id: String,
    pub prompt: String,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliYoloSessionResult {
    pub project: Project,
    pub worktree: Worktree,
    pub session: Session,
    pub prompt: String,
}

#[derive(Debug, Deserialize)]
struct CliYoloPreferences {
    #[serde(default)]
    default_project_id: Option<String>,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn app_data_dir() -> Result<PathBuf, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or_else(|| "Failed to locate local data directory".to_string())?;
    let app_dir = data_dir.join(APP_IDENTIFIER);
    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;
    Ok(app_dir)
}

fn cli_yolo_dir() -> Result<PathBuf, String> {
    let yolo_dir = app_data_dir()?.join(CLI_YOLO_DIR_NAME);
    std::fs::create_dir_all(&yolo_dir)
        .map_err(|e| format!("Failed to create CLI yolo directory: {e}"))?;
    Ok(yolo_dir)
}

fn preferences_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("preferences.json"))
}

fn projects_path() -> Result<PathBuf, String> {
    Ok(app_data_dir()?.join("projects.json"))
}

fn load_cli_yolo_preferences() -> Result<CliYoloPreferences, String> {
    let prefs_path = preferences_path()?;
    if !prefs_path.exists() {
        return Ok(CliYoloPreferences {
            default_project_id: None,
        });
    }

    let contents = std::fs::read_to_string(&prefs_path)
        .map_err(|e| format!("Failed to read preferences file: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse preferences: {e}"))
}

fn load_projects_data_for_cli() -> Result<ProjectsData, String> {
    let data_path = projects_path()?;
    if !data_path.exists() {
        return Ok(ProjectsData::default());
    }

    let contents = std::fs::read_to_string(&data_path)
        .map_err(|e| format!("Failed to read projects file: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse projects data: {e}"))
}

fn resolve_default_project_for_cli() -> Result<Project, String> {
    let prefs = load_cli_yolo_preferences()?;
    let project_id = prefs.default_project_id.ok_or_else(|| {
        "No default repo configured. Set one in Jean Settings > General > Default repo for CLI yolo."
            .to_string()
    })?;

    let data = load_projects_data_for_cli()?;
    data.find_project(&project_id)
        .filter(|project| !project.is_folder)
        .cloned()
        .ok_or_else(|| "Configured default repo was not found. Update Jean Settings > General > Default repo for CLI yolo.".to_string())
}

fn sorted_request_paths(yolo_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(yolo_dir)
        .map_err(|e| format!("Failed to read CLI yolo directory: {e}"))?
    {
        let entry = entry.map_err(|e| format!("Failed to read CLI yolo entry: {e}"))?;
        let path = entry.path();
        if path.extension() == Some(OsStr::new("json")) {
            entries.push(path);
        }
    }
    entries.sort();
    Ok(entries)
}

pub fn enqueue_cli_yolo_request(prompt: &str) -> Result<PendingCliYoloRequest, String> {
    let project = resolve_default_project_for_cli()?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Yolo prompt cannot be empty".to_string());
    }

    let request = PendingCliYoloRequest {
        id: Uuid::new_v4().to_string(),
        prompt: prompt.to_string(),
        created_at: now(),
    };

    let request_path = cli_yolo_dir()?.join(format!("{}-{}.json", request.created_at, request.id));
    let payload = serde_json::to_string_pretty(&request)
        .map_err(|e| format!("Failed to serialize CLI yolo request: {e}"))?;
    std::fs::write(&request_path, payload)
        .map_err(|e| format!("Failed to write CLI yolo request: {e}"))?;

    log::trace!(
        "Queued CLI yolo request for project {} ({})",
        project.name,
        project.id
    );
    Ok(request)
}

pub fn take_pending_cli_yolo_requests() -> Result<Vec<PendingCliYoloRequest>, String> {
    let yolo_dir = cli_yolo_dir()?;
    let mut requests = Vec::new();

    for request_path in sorted_request_paths(&yolo_dir)? {
        let contents = std::fs::read_to_string(&request_path)
            .map_err(|e| format!("Failed to read CLI yolo request: {e}"))?;
        let request: PendingCliYoloRequest = serde_json::from_str(&contents)
            .map_err(|e| format!("Failed to parse CLI yolo request: {e}"))?;
        std::fs::remove_file(&request_path)
            .map_err(|e| format!("Failed to consume CLI yolo request: {e}"))?;
        requests.push(request);
    }

    Ok(requests)
}

pub async fn prepare_cli_yolo_session(
    app: AppHandle,
    prompt: String,
) -> Result<CliYoloSessionResult, String> {
    let trimmed_prompt = prompt.trim().to_string();
    if trimmed_prompt.is_empty() {
        return Err("Yolo prompt cannot be empty".to_string());
    }

    let prefs = crate::load_preferences_sync(&app)?;
    let project_id = prefs.default_project_id.ok_or_else(|| {
        "No default repo configured. Set one in Jean Settings > General > Default repo for CLI yolo."
            .to_string()
    })?;

    let data = load_projects_data(&app)?;
    let project = data
        .find_project(&project_id)
        .filter(|project| !project.is_folder)
        .cloned()
        .ok_or_else(|| {
            "Configured default repo was not found. Update Jean Settings > General > Default repo for CLI yolo."
                .to_string()
        })?;

    let worktree = create_base_session(app.clone(), project.id.clone()).await?;
    let session =
        crate::chat::create_session(app, worktree.id.clone(), worktree.path.clone(), None, None)
            .await?;

    Ok(CliYoloSessionResult {
        project,
        worktree,
        session,
        prompt: trimmed_prompt,
    })
}

#[tauri::command]
pub async fn consume_pending_cli_yolo_requests() -> Result<Vec<PendingCliYoloRequest>, String> {
    take_pending_cli_yolo_requests()
}

#[tauri::command]
pub async fn prepare_cli_yolo_from_pending_request(
    app: AppHandle,
    prompt: String,
) -> Result<CliYoloSessionResult, String> {
    prepare_cli_yolo_session(app, prompt).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn sorted_request_paths_sorts_oldest_first() {
        let temp = tempdir().unwrap();
        let newer = temp.path().join("2-b.json");
        let older = temp.path().join("1-a.json");
        std::fs::write(&newer, "{}").unwrap();
        std::fs::write(&older, "{}").unwrap();

        let sorted = sorted_request_paths(temp.path()).unwrap();

        assert_eq!(sorted, vec![older, newer]);
    }
}
