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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
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

fn resolve_default_project_from_data(data: &ProjectsData) -> Result<Project, String> {
    let prefs = load_cli_yolo_preferences()?;
    let project_id = prefs.default_project_id.ok_or_else(|| {
        "No default repo configured. Set one in Jean Settings > General > Default repo for CLI yolo, or pass --project <id-or-name>."
            .to_string()
    })?;

    data.find_project(&project_id)
        .filter(|project| !project.is_folder)
        .cloned()
        .ok_or_else(|| "Configured default repo was not found. Update Jean Settings > General > Default repo for CLI yolo, or pass --project <id-or-name>.".to_string())
}

pub fn resolve_project_selector(data: &ProjectsData, selector: &str) -> Result<Project, String> {
    let selector = selector.trim();
    if selector.is_empty() {
        return Err("--project requires a project ID or name".to_string());
    }

    if let Some(project) = data
        .projects
        .iter()
        .find(|project| !project.is_folder && project.id == selector)
    {
        return Ok(project.clone());
    }

    let name_matches: Vec<&Project> = data
        .projects
        .iter()
        .filter(|project| !project.is_folder && project.name == selector)
        .collect();

    match name_matches.as_slice() {
        [project] => Ok((*project).clone()),
        [] => Err(format!(
            "No Jean project found for '{selector}'. Run `jean projects list` to see available projects."
        )),
        matches => {
            let details = matches
                .iter()
                .map(|project| format!("{} ({}) - {}", project.name, project.id, project.path))
                .collect::<Vec<_>>()
                .join("\n");
            Err(format!(
                "Multiple Jean projects named '{selector}'. Use a project ID instead:\n{details}"
            ))
        }
    }
}

fn resolve_cli_yolo_project(project_selector: Option<&str>) -> Result<Project, String> {
    let data = load_projects_data_for_cli()?;
    if let Some(selector) = project_selector {
        resolve_project_selector(&data, selector)
    } else {
        resolve_default_project_from_data(&data)
    }
}

pub fn format_cli_project_list(data: &ProjectsData) -> String {
    let mut projects: Vec<&Project> = data
        .projects
        .iter()
        .filter(|project| !project.is_folder)
        .collect();
    projects.sort_by_key(|project| project.order);

    if projects.is_empty() {
        return "No Jean projects found.".to_string();
    }

    let id_width = projects
        .iter()
        .map(|project| project.id.len())
        .max()
        .unwrap_or(2)
        .max("ID".len());
    let name_width = projects
        .iter()
        .map(|project| project.name.len())
        .max()
        .unwrap_or(4)
        .max("Name".len());
    let branch_width = projects
        .iter()
        .map(|project| project.default_branch.len())
        .max()
        .unwrap_or(6)
        .max("Branch".len());

    let mut lines = vec![format!(
        "{:<id_width$}  {:<name_width$}  {:<branch_width$}  Path",
        "ID", "Name", "Branch"
    )];

    for project in projects {
        lines.push(format!(
            "{:<id_width$}  {:<name_width$}  {:<branch_width$}  {}",
            project.id, project.name, project.default_branch, project.path
        ));
    }

    lines.join("\n")
}

pub fn list_cli_projects() -> Result<String, String> {
    let data = load_projects_data_for_cli()?;
    Ok(format_cli_project_list(&data))
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

pub fn enqueue_cli_yolo_request(
    prompt: &str,
    project_selector: Option<&str>,
) -> Result<PendingCliYoloRequest, String> {
    let project = resolve_cli_yolo_project(project_selector)?;
    let prompt = prompt.trim();
    if prompt.is_empty() {
        return Err("Yolo prompt cannot be empty".to_string());
    }

    let request = PendingCliYoloRequest {
        id: Uuid::new_v4().to_string(),
        prompt: prompt.to_string(),
        project_id: Some(project.id.clone()),
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
    project_id: Option<String>,
) -> Result<CliYoloSessionResult, String> {
    let trimmed_prompt = prompt.trim().to_string();
    if trimmed_prompt.is_empty() {
        return Err("Yolo prompt cannot be empty".to_string());
    }

    let data = load_projects_data(&app)?;
    let project = if let Some(project_id) = project_id {
        data.find_project(&project_id)
            .filter(|project| !project.is_folder)
            .cloned()
            .ok_or_else(|| {
                format!(
                    "Queued Jean project '{project_id}' was not found. Run `jean projects list` to see available projects."
                )
            })?
    } else {
        let prefs = crate::load_preferences_sync(&app)?;
        let project_id = prefs.default_project_id.ok_or_else(|| {
            "No default repo configured. Set one in Jean Settings > General > Default repo for CLI yolo."
                .to_string()
        })?;
        data.find_project(&project_id)
            .filter(|project| !project.is_folder)
            .cloned()
            .ok_or_else(|| {
                "Configured default repo was not found. Update Jean Settings > General > Default repo for CLI yolo."
                    .to_string()
            })?
    };

    let worktree = create_base_session(app.clone(), project.id.clone()).await?;
    let session = crate::chat::create_session(
        app,
        worktree.id.clone(),
        worktree.path.clone(),
        None,
        None,
        None,
        None,
        None,
        None,
    )
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
    project_id: Option<String>,
) -> Result<CliYoloSessionResult, String> {
    prepare_cli_yolo_session(app, prompt, project_id).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_project(id: &str, name: &str, path: &str, order: u32) -> Project {
        Project {
            id: id.to_string(),
            name: name.to_string(),
            path: path.to_string(),
            default_branch: "main".to_string(),
            added_at: 0,
            order,
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
            linked_project_ids: Vec::new(),
        }
    }

    fn test_folder(id: &str, name: &str, order: u32) -> Project {
        Project {
            is_folder: true,
            path: String::new(),
            default_branch: String::new(),
            ..test_project(id, name, "", order)
        }
    }

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

    #[test]
    fn resolve_project_selector_matches_project_id() {
        let data = ProjectsData {
            projects: vec![test_project("project-1", "Jean", "/repo/jean", 0)],
            worktrees: Vec::new(),
            worktree_slots: Vec::new(),
        };

        let project = resolve_project_selector(&data, "project-1").unwrap();

        assert_eq!(project.id, "project-1");
    }

    #[test]
    fn resolve_project_selector_matches_exact_project_name() {
        let data = ProjectsData {
            projects: vec![test_project("project-1", "Jean", "/repo/jean", 0)],
            worktrees: Vec::new(),
            worktree_slots: Vec::new(),
        };

        let project = resolve_project_selector(&data, "Jean").unwrap();

        assert_eq!(project.id, "project-1");
    }

    #[test]
    fn resolve_project_selector_rejects_duplicate_names() {
        let data = ProjectsData {
            projects: vec![
                test_project("project-1", "Jean", "/repo/one", 0),
                test_project("project-2", "Jean", "/repo/two", 1),
            ],
            worktrees: Vec::new(),
            worktree_slots: Vec::new(),
        };

        let error = resolve_project_selector(&data, "Jean").unwrap_err();

        assert!(error.contains("Multiple Jean projects named"));
        assert!(error.contains("project-1"));
        assert!(error.contains("project-2"));
    }

    #[test]
    fn resolve_project_selector_excludes_folders() {
        let data = ProjectsData {
            projects: vec![test_folder("folder-1", "Jean", 0)],
            worktrees: Vec::new(),
            worktree_slots: Vec::new(),
        };

        let error = resolve_project_selector(&data, "folder-1").unwrap_err();

        assert!(error.contains("No Jean project found"));
    }

    #[test]
    fn format_cli_project_list_outputs_non_folder_projects_by_order() {
        let data = ProjectsData {
            projects: vec![
                test_project("project-2", "Second", "/repo/second", 2),
                test_folder("folder-1", "Folder", 0),
                test_project("project-1", "First", "/repo/first", 1),
            ],
            worktrees: Vec::new(),
            worktree_slots: Vec::new(),
        };

        let output = format_cli_project_list(&data);

        assert!(output.contains("ID"));
        assert!(output.contains("project-1"));
        assert!(output.contains("First"));
        assert!(output.contains("/repo/first"));
        assert!(output.contains("project-2"));
        assert!(!output.contains("folder-1"));
        assert!(output.find("project-1") < output.find("project-2"));
    }
}
