use super::storage::{
    find_item_mut, load_agent_board_data, now_seconds, save_agent_board_data, validate_lane_move,
    with_agent_board_data_mut,
};
use super::types::{
    AgentBoardItem, AgentBoardLane, CreateAgentBoardItemRequest, SessionAgentBoardAssociation,
    UpdateAgentBoardItemRequest,
};
use crate::chat::storage::{load_metadata, save_metadata};
use crate::chat::types::{Backend, RunStatus};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use uuid::Uuid;

const WORKTREE_READY_TIMEOUT: Duration = Duration::from_secs(60);
const WORKTREE_READY_POLL_INTERVAL: Duration = Duration::from_millis(250);

fn backend_arg(backend: &Backend) -> String {
    match backend {
        Backend::Claude => "claude",
        Backend::Codex => "codex",
        Backend::Opencode => "opencode",
    }
    .to_string()
}

fn fallback_title(prompt: &str) -> String {
    let words: Vec<&str> = prompt.split_whitespace().take(7).collect();
    let title = words.join(" ");
    if title.is_empty() {
        "Untitled task".to_string()
    } else {
        title
            .trim_matches(|c: char| !c.is_alphanumeric())
            .chars()
            .take(80)
            .collect()
    }
}

fn project_default_branch(app: &AppHandle, project_id: &str) -> Result<Option<String>, String> {
    let data = crate::projects::storage::load_projects_data(app)?;
    Ok(data
        .projects
        .iter()
        .find(|project| project.id == project_id)
        .map(|project| project.default_branch.clone()))
}

fn worktree_for_id(
    app: &AppHandle,
    worktree_id: &str,
) -> Result<crate::projects::types::Worktree, String> {
    let data = crate::projects::storage::load_projects_data(app)?;
    data.worktrees
        .iter()
        .find(|worktree| worktree.id == worktree_id)
        .cloned()
        .ok_or_else(|| format!("Worktree not found: {worktree_id}"))
}

async fn wait_for_worktree(
    app: &AppHandle,
    worktree_id: &str,
) -> Result<crate::projects::types::Worktree, String> {
    let started = Instant::now();
    loop {
        match worktree_for_id(app, worktree_id) {
            Ok(worktree) => return Ok(worktree),
            Err(error) if started.elapsed() >= WORKTREE_READY_TIMEOUT => {
                return Err(format!(
                    "Timed out waiting for agent board worktree {worktree_id}: {error}"
                ));
            }
            Err(_) => {
                tokio::time::sleep(WORKTREE_READY_POLL_INTERVAL).await;
            }
        }
    }
}

fn associate_session(app: &AppHandle, session_id: &str, item_id: &str) -> Result<(), String> {
    if let Some(mut metadata) = load_metadata(app, session_id)? {
        metadata.agent_board_item_id = Some(item_id.to_string());
        save_metadata(app, &metadata)?;
    }
    Ok(())
}

async fn create_board_worktree(
    app: AppHandle,
    item: &AgentBoardItem,
    suffix: &str,
) -> Result<crate::projects::types::Worktree, String> {
    let base_branch = project_default_branch(&app, &item.project_id)?;
    let pending_worktree = crate::projects::create_worktree(
        app.clone(),
        item.project_id.clone(),
        base_branch,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(format!(
            "agent-{}-{suffix}",
            item.id.chars().take(8).collect::<String>()
        )),
        None,
        None,
    )
    .await?;

    log::info!(
        "[AgentBoard] waiting for worktree {} before starting item {}",
        pending_worktree.id,
        item.id
    );
    wait_for_worktree(&app, &pending_worktree.id).await
}

async fn create_board_session(
    app: AppHandle,
    item: &AgentBoardItem,
    worktree_id: &str,
    name_suffix: &str,
) -> Result<crate::chat::types::Session, String> {
    let worktree = worktree_for_id(&app, worktree_id)?;
    let session = crate::chat::create_session(
        app.clone(),
        worktree.id.clone(),
        worktree.path.clone(),
        Some(format!("{} {name_suffix}", item.title)),
        Some(backend_arg(&item.backend)),
    )
    .await?;
    associate_session(&app, &session.id, &item.id)?;
    Ok(session)
}

async fn send_board_prompt(
    app: AppHandle,
    item: &AgentBoardItem,
    worktree_id: &str,
    session_id: &str,
    execution_mode: &str,
) -> Result<(), String> {
    let worktree = worktree_for_id(&app, worktree_id)?;
    let message = if execution_mode == "build" {
        format!(
            "{}\n\nInstruction: implement this without asking follow-up questions unless blocked by missing credentials or destructive actions.",
            item.prompt
        )
    } else {
        item.prompt.clone()
    };

    crate::chat::send_chat_message(
        app,
        session_id.to_string(),
        worktree.id,
        worktree.path,
        message,
        None,
        Some(execution_mode.to_string()),
        None,
        item.effort_level.clone(),
        None,
        None,
        None,
        None,
        None,
        None,
        Some(backend_arg(&item.backend)),
    )
    .await
    .map(|_| ())
}

async fn run_lane_side_effect(app: AppHandle, item: &mut AgentBoardItem) -> Result<(), String> {
    match item.lane {
        AgentBoardLane::Planning => {
            if item.worktree_id.is_none() {
                let worktree = create_board_worktree(app.clone(), item, "plan").await?;
                item.worktree_id = Some(worktree.id);
            }
            if item.planning_session_id.is_none() {
                let worktree_id = item.worktree_id.clone().expect("worktree set");
                let session = create_board_session(app.clone(), item, &worktree_id, "plan").await?;
                item.planning_session_id = Some(session.id);
            }
            let worktree_id = item.worktree_id.clone().expect("worktree set");
            let session_id = item.planning_session_id.clone().expect("session set");
            send_board_prompt(app, item, &worktree_id, &session_id, "plan").await?;
        }
        AgentBoardLane::Implementing => {
            if item.worktree_id.is_none() {
                let worktree = create_board_worktree(app.clone(), item, "build").await?;
                item.worktree_id = Some(worktree.id);
            }
            if item.implementation_session_id.is_none() {
                item.implementation_session_id = item.planning_session_id.clone();
            }
            if item.implementation_session_id.is_none() {
                let worktree_id = item.worktree_id.clone().expect("worktree set");
                let session =
                    create_board_session(app.clone(), item, &worktree_id, "build").await?;
                item.implementation_session_id = Some(session.id);
            }
            let worktree_id = item.worktree_id.clone().expect("worktree set");
            let session_id = item.implementation_session_id.clone().expect("session set");
            send_board_prompt(app, item, &worktree_id, &session_id, "build").await?;
        }
        AgentBoardLane::PrOpened => {
            let worktree_id = item
                .worktree_id
                .clone()
                .or_else(|| item.yolo_worktree_id.clone())
                .ok_or_else(|| "Cannot open a PR before work starts".to_string())?;
            let url = crate::projects::open_pull_request(
                app,
                worktree_id,
                Some(item.title.clone()),
                Some(item.prompt.clone()),
                Some(false),
            )
            .await?;
            item.pr_url = Some(url);
        }
        AgentBoardLane::Yoloing => {
            if item.yolo_worktree_id.is_none() {
                let worktree = create_board_worktree(app.clone(), item, "yolo").await?;
                item.yolo_worktree_id = Some(worktree.id);
            }
            if item.yolo_session_id.is_none() {
                let worktree_id = item.yolo_worktree_id.clone().expect("worktree set");
                let session = create_board_session(app.clone(), item, &worktree_id, "yolo").await?;
                item.yolo_session_id = Some(session.id);
            }
            let worktree_id = item.yolo_worktree_id.clone().expect("worktree set");
            let session_id = item.yolo_session_id.clone().expect("session set");
            send_board_prompt(app, item, &worktree_id, &session_id, "yolo").await?;
        }
        AgentBoardLane::Archived => {
            let now = now_seconds();
            item.archived_at = Some(now);
            if let Some(worktree_id) = item.worktree_id.clone() {
                let _ = crate::projects::archive_worktree(app.clone(), worktree_id).await;
            }
            if let Some(worktree_id) = item.yolo_worktree_id.clone() {
                let _ = crate::projects::archive_worktree(app.clone(), worktree_id).await;
            }
        }
        _ => {}
    }
    Ok(())
}

fn sync_item_from_sessions(app: &AppHandle, item: &mut AgentBoardItem) {
    if let Some(session_id) = item.planning_session_id.as_deref() {
        if let Ok(Some(metadata)) = load_metadata(app, session_id) {
            if metadata.waiting_for_input
                && metadata.waiting_for_input_type.as_deref() == Some("plan")
            {
                item.lane = AgentBoardLane::Planned;
            }
        }
    }

    if let Some(session_id) = item.implementation_session_id.as_deref() {
        if let Ok(Some(metadata)) = load_metadata(app, session_id) {
            match metadata.runs.last().map(|run| &run.status) {
                Some(RunStatus::Running | RunStatus::Resumable) => {
                    if item.lane == AgentBoardLane::Implemented {
                        item.lane = AgentBoardLane::Implementing;
                    }
                }
                Some(RunStatus::Completed) => {
                    if item.lane == AgentBoardLane::Implementing {
                        item.lane = AgentBoardLane::Implemented;
                    }
                }
                _ => {}
            }
        }
    }

    if let Some(session_id) = item.yolo_session_id.as_deref() {
        if let Ok(Some(metadata)) = load_metadata(app, session_id) {
            match metadata.runs.last().map(|run| &run.status) {
                Some(RunStatus::Running | RunStatus::Resumable) => {
                    if item.lane == AgentBoardLane::Yoloed {
                        item.lane = AgentBoardLane::Yoloing;
                    }
                }
                Some(RunStatus::Completed | RunStatus::Cancelled | RunStatus::Crashed) => {
                    if item.lane == AgentBoardLane::Yoloing {
                        item.lane = AgentBoardLane::Yoloed;
                    }
                }
                _ => {}
            }
        }
    }
}

#[tauri::command]
pub async fn list_agent_board_items(app: AppHandle) -> Result<Vec<AgentBoardItem>, String> {
    refresh_agent_board_items(app).await
}

#[tauri::command]
pub async fn create_agent_board_item(
    app: AppHandle,
    request: CreateAgentBoardItemRequest,
) -> Result<AgentBoardItem, String> {
    let now = now_seconds();
    let title = request
        .title
        .filter(|title| !title.trim().is_empty())
        .unwrap_or_else(|| fallback_title(&request.prompt));
    let item = AgentBoardItem {
        id: Uuid::new_v4().to_string(),
        title,
        prompt: request.prompt,
        project_id: request.project_id,
        backend: request.backend.unwrap_or_default(),
        effort_level: request.effort_level,
        lane: AgentBoardLane::Todo,
        worktree_id: None,
        planning_session_id: None,
        implementation_session_id: None,
        yolo_worktree_id: None,
        yolo_session_id: None,
        pr_url: None,
        created_at: now,
        updated_at: now,
        archived_at: None,
        last_error: None,
    };

    with_agent_board_data_mut(&app, |data| {
        data.items.push(item.clone());
        Ok(item)
    })
}

#[tauri::command]
pub async fn update_agent_board_item(
    app: AppHandle,
    item_id: String,
    patch: UpdateAgentBoardItemRequest,
) -> Result<AgentBoardItem, String> {
    with_agent_board_data_mut(&app, |data| {
        let item = find_item_mut(data, &item_id)?;
        if let Some(title) = patch.title {
            item.title = title;
        }
        if let Some(prompt) = patch.prompt {
            item.prompt = prompt;
        }
        if let Some(project_id) = patch.project_id {
            item.project_id = project_id;
        }
        if let Some(backend) = patch.backend {
            item.backend = backend;
        }
        if let Some(effort_level) = patch.effort_level {
            item.effort_level = effort_level;
        }
        if let Some(pr_url) = patch.pr_url {
            item.pr_url = pr_url;
        }
        item.updated_at = now_seconds();
        Ok(item.clone())
    })
}

#[tauri::command]
pub async fn move_agent_board_item(
    app: AppHandle,
    item_id: String,
    lane: AgentBoardLane,
) -> Result<AgentBoardItem, String> {
    let mut data = load_agent_board_data(&app)?;
    let item_index = data
        .items
        .iter()
        .position(|item| item.id == item_id)
        .ok_or_else(|| format!("Agent board item not found: {item_id}"))?;
    let from_lane = data.items[item_index].lane;
    log::info!(
        "[AgentBoard] moving item {item_id} from {:?} to {:?}",
        from_lane,
        lane
    );
    validate_lane_move(data.items[item_index].lane, lane)?;
    data.items[item_index].lane = lane;
    data.items[item_index].updated_at = now_seconds();
    data.items[item_index].last_error = None;
    save_agent_board_data(&app, &data)?;

    let item = &mut data.items[item_index];
    if let Err(error) = run_lane_side_effect(app.clone(), item).await {
        log::warn!(
            "[AgentBoard] move item {item_id} from {:?} to {:?} failed: {error}",
            from_lane,
            lane
        );
        item.last_error = Some(error.clone());
        save_agent_board_data(&app, &data)?;
        return Err(error);
    }

    let result = item.clone();
    save_agent_board_data(&app, &data)?;
    log::info!(
        "[AgentBoard] moved item {item_id} from {:?} to {:?}",
        from_lane,
        lane
    );
    Ok(result)
}

#[tauri::command]
pub async fn refresh_agent_board_items(app: AppHandle) -> Result<Vec<AgentBoardItem>, String> {
    let mut data = load_agent_board_data(&app)?;
    for item in &mut data.items {
        let before = item.lane;
        sync_item_from_sessions(&app, item);
        if item.lane != before {
            item.updated_at = now_seconds();
        }
    }
    let items = data.items.clone();
    save_agent_board_data(&app, &data)?;
    Ok(items)
}

#[tauri::command]
pub async fn get_agent_board_item_for_session(
    app: AppHandle,
    session_id: String,
) -> Result<Option<SessionAgentBoardAssociation>, String> {
    let metadata = match load_metadata(&app, &session_id)? {
        Some(metadata) => metadata,
        None => return Ok(None),
    };
    let Some(item_id) = metadata.agent_board_item_id else {
        return Ok(None);
    };

    let data = load_agent_board_data(&app)?;
    let Some(item) = data.items.into_iter().find(|item| item.id == item_id) else {
        return Ok(None);
    };

    let session_role = if item.planning_session_id.as_deref() == Some(&session_id) {
        "planning"
    } else if item.implementation_session_id.as_deref() == Some(&session_id) {
        "implementation"
    } else if item.yolo_session_id.as_deref() == Some(&session_id) {
        "yolo"
    } else {
        "associated"
    };

    Ok(Some(SessionAgentBoardAssociation {
        item,
        session_role: session_role.to_string(),
    }))
}
