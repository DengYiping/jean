use super::storage::{
    find_item_mut, load_agent_board_data, now_seconds, save_agent_board_data, validate_lane_move,
    with_agent_board_data_mut,
};
use super::types::{
    AgentBoardItem, AgentBoardLane, CreateAgentBoardItemRequest, SessionAgentBoardAssociation,
    UpdateAgentBoardItemRequest,
};
use crate::chat::storage::{load_metadata, save_metadata};
use crate::chat::types::{Backend, RunEntry, RunStatus, SessionMetadata};
use crate::http_server::EmitExt;
use std::time::{Duration, Instant};
use tauri::AppHandle;
use uuid::Uuid;

const WORKTREE_READY_TIMEOUT: Duration = Duration::from_secs(60);
const WORKTREE_READY_POLL_INTERVAL: Duration = Duration::from_millis(250);
const DEFAULT_PLAN_APPROVAL_BUILD_PROMPT: &str =
    "Plan approved. Begin implementing the changes now. Do not re-explain the plan - start writing code.";
const DEFAULT_PLAN_APPROVAL_CODEX_PROMPT: &str =
    "Execute the plan you created. Implement all changes described.";

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

fn emit_agent_board_cache_invalidation(app: &AppHandle) {
    if let Err(e) = app.emit_all(
        "cache:invalidate",
        &serde_json::json!({ "keys": ["agent-board", "sessions", "projects"] }),
    ) {
        log::error!("Failed to emit cache:invalidate for agent board: {e}");
    }
}

fn persist_agent_board_item_snapshot(
    app: &AppHandle,
    snapshot: &AgentBoardItem,
) -> Result<(), String> {
    with_agent_board_data_mut(app, |data| {
        let item = find_item_mut(data, &snapshot.id)?;
        *item = snapshot.clone();
        Ok(())
    })?;
    emit_agent_board_cache_invalidation(app);
    Ok(())
}

fn configured_plan_approval_message(app: &AppHandle, backend: &Backend) -> String {
    let preferences = crate::load_preferences_sync(app).unwrap_or_default();
    let configured = match backend {
        Backend::Codex => preferences.magic_prompts.plan_approval_codex,
        Backend::Claude | Backend::Opencode => preferences.magic_prompts.plan_approval_build,
    };

    configured
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .unwrap_or_else(|| match backend {
            Backend::Codex => DEFAULT_PLAN_APPROVAL_CODEX_PROMPT.to_string(),
            Backend::Claude | Backend::Opencode => DEFAULT_PLAN_APPROVAL_BUILD_PROMPT.to_string(),
        })
}

fn clear_board_session_attention_for_run(
    metadata: &mut SessionMetadata,
    now: u64,
    approve_pending_plan: bool,
) {
    if approve_pending_plan {
        if let Some(message_id) = metadata.pending_plan_message_id.clone() {
            if !metadata.approved_plan_message_ids.contains(&message_id) {
                metadata.approved_plan_message_ids.push(message_id);
            }
        }
    }
    metadata.waiting_for_input = false;
    metadata.waiting_for_input_type = None;
    metadata.pending_plan_message_id = None;
    metadata.attention_updated_at = None;
    metadata.last_opened_at = Some(now);
    metadata.selected_execution_mode = Some("build".to_string());
}

fn attached_worktree_ids(item: &AgentBoardItem) -> Vec<String> {
    let mut worktree_ids = Vec::new();
    for worktree_id in [&item.worktree_id, &item.yolo_worktree_id]
        .into_iter()
        .flatten()
    {
        if !worktree_ids.contains(worktree_id) {
            worktree_ids.push(worktree_id.clone());
        }
    }
    worktree_ids
}

async fn mark_board_session_started(
    app: &AppHandle,
    session_id: &str,
    approve_pending_plan: bool,
) -> Result<(), String> {
    if let Some(mut metadata) = load_metadata(app, session_id)? {
        clear_board_session_attention_for_run(&mut metadata, now_seconds(), approve_pending_plan);
        save_metadata(app, &metadata)?;
        crate::chat::emit_sessions_cache_invalidation(app);
        let _ = crate::chat::broadcast_session_setting(
            app.clone(),
            session_id.to_string(),
            "executionMode".to_string(),
            "build".to_string(),
        )
        .await;
        let _ = crate::chat::broadcast_session_setting(
            app.clone(),
            session_id.to_string(),
            "waitingForInput".to_string(),
            "false".to_string(),
        )
        .await;
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
    message_override: Option<String>,
) -> Result<(), String> {
    let worktree = worktree_for_id(&app, worktree_id)?;
    let message = if let Some(message) = message_override {
        message
    } else if execution_mode == "build" {
        format!(
            "{}\n\nInstruction: implement this without asking follow-up questions unless blocked by missing credentials or destructive actions.",
            item.prompt
        )
    } else {
        item.prompt.clone()
    };

    if let Some(effort_level) = item.effort_level.clone() {
        crate::chat::set_session_effort_level(
            app.clone(),
            worktree.id.clone(),
            worktree.path.clone(),
            session_id.to_string(),
            effort_level,
        )
        .await?;
        crate::chat::emit_sessions_cache_invalidation(&app);
    }

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

async fn run_lane_side_effect(
    app: AppHandle,
    item: &mut AgentBoardItem,
    from_lane: AgentBoardLane,
) -> Result<(), String> {
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
            persist_agent_board_item_snapshot(&app, item)?;
            let worktree_id = item.worktree_id.clone().expect("worktree set");
            let session_id = item.planning_session_id.clone().expect("session set");
            send_board_prompt(app, item, &worktree_id, &session_id, "plan", None).await?;
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
            persist_agent_board_item_snapshot(&app, item)?;
            let worktree_id = item.worktree_id.clone().expect("worktree set");
            let session_id = item.implementation_session_id.clone().expect("session set");
            let approve_pending_plan = from_lane == AgentBoardLane::Planned
                && item.planning_session_id.as_deref() == Some(session_id.as_str());
            let message_override =
                approve_pending_plan.then(|| configured_plan_approval_message(&app, &item.backend));
            mark_board_session_started(&app, &session_id, approve_pending_plan).await?;
            send_board_prompt(
                app,
                item,
                &worktree_id,
                &session_id,
                "build",
                message_override,
            )
            .await?;
        }
        AgentBoardLane::PrOpened => {
            let worktree_id = item
                .worktree_id
                .clone()
                .or_else(|| item.yolo_worktree_id.clone())
                .ok_or_else(|| "Cannot open a PR before work starts".to_string())?;
            let worktree = worktree_for_id(&app, &worktree_id)?;
            let session_id = if item.yolo_worktree_id.as_deref() == Some(worktree_id.as_str()) {
                item.yolo_session_id.clone()
            } else {
                item.implementation_session_id
                    .clone()
                    .or_else(|| item.planning_session_id.clone())
            };
            let preferences = crate::load_preferences_sync(&app).unwrap_or_default();
            let result = crate::projects::create_pr_with_ai_content(
                app,
                worktree.path,
                session_id,
                preferences.magic_prompts.pr_content,
                Some(preferences.magic_prompt_models.pr_content_model),
                preferences.magic_prompt_providers.pr_content_provider,
                preferences.magic_prompt_efforts.pr_content_effort,
                Some(false),
            )
            .await?;
            item.pr_url = Some(result.pr_url);
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
            persist_agent_board_item_snapshot(&app, item)?;
            let worktree_id = item.yolo_worktree_id.clone().expect("worktree set");
            let session_id = item.yolo_session_id.clone().expect("session set");
            send_board_prompt(app, item, &worktree_id, &session_id, "yolo", None).await?;
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
    item.active_run_status = None;

    if let Some(session_id) = item.planning_session_id.as_deref() {
        if let Ok(Some(metadata)) = load_metadata(app, session_id) {
            sync_item_from_planning_session(item, &metadata);
        }
    }

    if let Some(session_id) = item.implementation_session_id.as_deref() {
        if let Ok(Some(metadata)) = load_metadata(app, session_id) {
            sync_item_from_implementation_session(item, &metadata);
        }
    }

    if let Some(session_id) = item.yolo_session_id.as_deref() {
        if let Ok(Some(metadata)) = load_metadata(app, session_id) {
            sync_item_from_yolo_session(item, &metadata);
        }
    }
}

fn sync_item_from_worktree_prs(
    item: &mut AgentBoardItem,
    worktrees: &[crate::projects::types::Worktree],
) {
    if !matches!(
        item.lane,
        AgentBoardLane::Implementing
            | AgentBoardLane::Implemented
            | AgentBoardLane::Yoloing
            | AgentBoardLane::Yoloed
            | AgentBoardLane::PrOpened
    ) {
        return;
    }

    for worktree_id in attached_worktree_ids(item) {
        let Some(worktree) = worktrees.iter().find(|worktree| worktree.id == worktree_id) else {
            continue;
        };
        let Some(pr_url) = worktree.pr_url.as_ref().filter(|url| !url.is_empty()) else {
            continue;
        };
        item.pr_url = Some(pr_url.clone());
        item.lane = AgentBoardLane::PrOpened;
        return;
    }
}

fn latest_run(metadata: &SessionMetadata) -> Option<&RunEntry> {
    metadata.runs.last()
}

fn latest_run_status(metadata: &SessionMetadata) -> Option<&RunStatus> {
    latest_run(metadata).map(|run| &run.status)
}

fn latest_execution_mode(metadata: &SessionMetadata) -> Option<&str> {
    latest_run(metadata)
        .and_then(|run| run.execution_mode.as_deref())
        .or(metadata.selected_execution_mode.as_deref())
}

fn sync_item_from_planning_session(item: &mut AgentBoardItem, metadata: &SessionMetadata) {
    item.active_run_status = latest_run_status(metadata).cloned();

    if matches!(
        item.lane,
        AgentBoardLane::Planning | AgentBoardLane::Planned
    ) && metadata.waiting_for_input
        && metadata.waiting_for_input_type.as_deref() == Some("plan")
    {
        item.lane = AgentBoardLane::Planned;
        return;
    }

    let latest_run = latest_run(metadata);
    let latest_run_status = latest_run_status(metadata);
    let latest_run_is_build =
        latest_run.and_then(|run| run.execution_mode.as_deref()) == Some("build");
    let completed_plan_approved_for_build = metadata.selected_execution_mode.as_deref()
        == Some("build")
        && latest_run.and_then(|run| run.execution_mode.as_deref()) == Some("plan")
        && matches!(latest_run_status, Some(RunStatus::Completed));
    let session_is_build = latest_run_is_build || completed_plan_approved_for_build;
    if !session_is_build {
        return;
    }

    if matches!(
        item.lane,
        AgentBoardLane::Planning | AgentBoardLane::Planned
    ) {
        if item.implementation_session_id.is_none() {
            item.implementation_session_id = item.planning_session_id.clone();
        }
        if latest_run_is_build && matches!(latest_run_status, Some(RunStatus::Completed)) {
            item.lane = AgentBoardLane::Implemented;
        } else {
            item.lane = AgentBoardLane::Implementing;
        }
    }
}

fn sync_item_from_implementation_session(item: &mut AgentBoardItem, metadata: &SessionMetadata) {
    item.active_run_status = latest_run_status(metadata).cloned();

    let latest_run = latest_run(metadata);
    let latest_run_is_build =
        latest_run.and_then(|run| run.execution_mode.as_deref()) == Some("build");
    let legacy_selected_build_run = latest_run.is_some_and(|run| run.execution_mode.is_none())
        && metadata.selected_execution_mode.as_deref() == Some("build");

    if !latest_run_is_build && !legacy_selected_build_run {
        return;
    }

    match latest_run_status(metadata) {
        Some(RunStatus::Running | RunStatus::Resumable) => {
            if item.lane == AgentBoardLane::Implemented {
                item.lane = AgentBoardLane::Implementing;
            }
        }
        Some(RunStatus::Completed) => {
            if latest_run_is_build && item.lane == AgentBoardLane::Implementing {
                item.lane = AgentBoardLane::Implemented;
            }
        }
        _ => {}
    }
}

fn sync_item_from_yolo_session(item: &mut AgentBoardItem, metadata: &SessionMetadata) {
    item.active_run_status = latest_run_status(metadata).cloned();

    if latest_execution_mode(metadata).is_some_and(|mode| mode != "yolo") {
        return;
    }

    match latest_run_status(metadata) {
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
        active_run_status: None,
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
pub async fn delete_agent_board_item(app: AppHandle, item_id: String) -> Result<(), String> {
    let data = load_agent_board_data(&app)?;
    let item = data
        .items
        .iter()
        .find(|item| item.id == item_id)
        .cloned()
        .ok_or_else(|| format!("Agent board item not found: {item_id}"))?;
    if item.lane != AgentBoardLane::Archived {
        return Err("Only archived agent board items can be deleted".to_string());
    }

    for worktree_id in attached_worktree_ids(&item) {
        match crate::projects::permanently_delete_worktree(app.clone(), worktree_id.clone()).await {
            Ok(()) => {}
            Err(error) if error.starts_with("Worktree not found:") => {
                log::warn!(
                    "[AgentBoard] archived item {item_id} references missing worktree {worktree_id}; removing card anyway"
                );
            }
            Err(error) => return Err(error),
        }
    }

    with_agent_board_data_mut(&app, |data| {
        let before = data.items.len();
        data.items.retain(|item| item.id != item_id);
        if data.items.len() == before {
            return Err(format!("Agent board item not found: {item_id}"));
        }
        Ok(())
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
    if let Err(error) = run_lane_side_effect(app.clone(), item, from_lane).await {
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
    let projects_data = crate::projects::storage::load_projects_data(&app)?;
    for item in &mut data.items {
        let before = item.lane;
        let before_implementation_session_id = item.implementation_session_id.clone();
        let before_pr_url = item.pr_url.clone();
        sync_item_from_sessions(&app, item);
        sync_item_from_worktree_prs(item, &projects_data.worktrees);
        if item.lane != before
            || item.implementation_session_id != before_implementation_session_id
            || item.pr_url != before_pr_url
        {
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

#[cfg(test)]
mod tests {
    use super::*;

    fn test_item(lane: AgentBoardLane) -> AgentBoardItem {
        AgentBoardItem {
            id: "item-1".to_string(),
            title: "Test".to_string(),
            prompt: "Do the thing".to_string(),
            project_id: "project-1".to_string(),
            backend: Backend::Codex,
            effort_level: None,
            lane,
            worktree_id: Some("worktree-1".to_string()),
            planning_session_id: Some("session-1".to_string()),
            implementation_session_id: None,
            yolo_worktree_id: None,
            yolo_session_id: None,
            pr_url: None,
            created_at: 1,
            updated_at: 1,
            archived_at: None,
            last_error: None,
            active_run_status: None,
        }
    }

    fn test_metadata() -> SessionMetadata {
        SessionMetadata::new(
            "session-1".to_string(),
            "worktree-1".to_string(),
            "Session 1".to_string(),
            0,
        )
    }

    fn test_run(execution_mode: &str, status: RunStatus) -> RunEntry {
        RunEntry {
            run_id: "run-1".to_string(),
            user_message_id: "message-1".to_string(),
            user_message: "message".to_string(),
            model: None,
            execution_mode: Some(execution_mode.to_string()),
            thinking_level: None,
            effort_level: None,
            started_at: 1,
            ended_at: None,
            status,
            assistant_message_id: None,
            cancelled: false,
            recovered: false,
            claude_session_id: None,
            pid: None,
            usage: None,
        }
    }

    fn test_worktree(pr_url: Option<String>) -> crate::projects::types::Worktree {
        crate::projects::types::Worktree {
            id: "worktree-1".to_string(),
            project_id: "project-1".to_string(),
            name: "Worktree".to_string(),
            path: "/tmp/worktree".to_string(),
            stable_slot_id: None,
            branch: "branch".to_string(),
            base_branch: Some("main".to_string()),
            created_at: 1,
            setup_output: None,
            setup_script: None,
            setup_success: None,
            session_type: crate::projects::types::SessionType::Worktree,
            pr_number: pr_url.as_ref().map(|_| 123),
            pr_url,
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
            pr_push_remote: None,
            pr_push_branch: None,
            order: 0,
            label: None,
            archived_at: None,
            last_opened_at: None,
            automation_id: None,
            automation_name: None,
            automation_owned: false,
        }
    }

    #[test]
    fn clear_board_session_attention_for_run_clears_waiting_and_unread_marker() {
        let mut metadata = SessionMetadata::new(
            "session-1".to_string(),
            "worktree-1".to_string(),
            "Session 1".to_string(),
            0,
        );
        metadata.waiting_for_input = true;
        metadata.waiting_for_input_type = Some("plan".to_string());
        metadata.pending_plan_message_id = Some("plan-msg-1".to_string());
        metadata.attention_updated_at = Some(metadata.created_at + 1);

        let opened_at = metadata.created_at + 2;
        clear_board_session_attention_for_run(&mut metadata, opened_at, false);

        assert!(!metadata.waiting_for_input);
        assert_eq!(metadata.waiting_for_input_type, None);
        assert_eq!(metadata.pending_plan_message_id, None);
        assert_eq!(metadata.attention_updated_at, None);
        assert_eq!(metadata.last_opened_at, Some(opened_at));
        assert_eq!(metadata.selected_execution_mode.as_deref(), Some("build"));
        assert!(metadata.approved_plan_message_ids.is_empty());
    }

    #[test]
    fn clear_board_session_attention_for_run_marks_pending_plan_approved() {
        let mut metadata = SessionMetadata::new(
            "session-1".to_string(),
            "worktree-1".to_string(),
            "Session 1".to_string(),
            0,
        );
        metadata.waiting_for_input = true;
        metadata.waiting_for_input_type = Some("plan".to_string());
        metadata.pending_plan_message_id = Some("plan-msg-1".to_string());

        let opened_at = metadata.created_at + 1;
        clear_board_session_attention_for_run(&mut metadata, opened_at, true);

        assert_eq!(metadata.approved_plan_message_ids, vec!["plan-msg-1"]);
        assert_eq!(metadata.pending_plan_message_id, None);
    }

    #[test]
    fn clear_board_session_attention_for_run_does_not_duplicate_approved_plan_ids() {
        let mut metadata = SessionMetadata::new(
            "session-1".to_string(),
            "worktree-1".to_string(),
            "Session 1".to_string(),
            0,
        );
        metadata.pending_plan_message_id = Some("plan-msg-1".to_string());
        metadata
            .approved_plan_message_ids
            .push("plan-msg-1".to_string());

        let opened_at = metadata.created_at + 1;
        clear_board_session_attention_for_run(&mut metadata, opened_at, true);

        assert_eq!(metadata.approved_plan_message_ids, vec!["plan-msg-1"]);
    }

    #[test]
    fn planning_session_build_selection_moves_card_to_implementing() {
        let mut item = test_item(AgentBoardLane::Planned);
        let mut metadata = test_metadata();
        metadata.selected_execution_mode = Some("build".to_string());
        metadata.runs.push(test_run("plan", RunStatus::Completed));

        sync_item_from_planning_session(&mut item, &metadata);

        assert_eq!(item.lane, AgentBoardLane::Implementing);
        assert_eq!(item.implementation_session_id.as_deref(), Some("session-1"));
    }

    #[test]
    fn completed_plan_run_does_not_mark_implementation_complete() {
        let mut item = test_item(AgentBoardLane::Implementing);
        item.implementation_session_id = Some("session-1".to_string());
        let mut metadata = test_metadata();
        metadata.selected_execution_mode = Some("build".to_string());
        metadata.runs.push(test_run("plan", RunStatus::Completed));

        sync_item_from_implementation_session(&mut item, &metadata);

        assert_eq!(item.lane, AgentBoardLane::Implementing);
    }

    #[test]
    fn cancelled_plan_run_with_build_selected_stays_in_plan() {
        let mut item = test_item(AgentBoardLane::Planned);
        let mut metadata = test_metadata();
        metadata.selected_execution_mode = Some("build".to_string());
        metadata.runs.push(test_run("plan", RunStatus::Cancelled));

        sync_item_from_planning_session(&mut item, &metadata);

        assert_eq!(item.lane, AgentBoardLane::Planned);
        assert_eq!(item.implementation_session_id, None);
        assert_eq!(item.active_run_status, Some(RunStatus::Cancelled));
    }

    #[test]
    fn completed_build_run_moves_card_to_implemented() {
        let mut item = test_item(AgentBoardLane::Implementing);
        item.implementation_session_id = Some("session-1".to_string());
        let mut metadata = test_metadata();
        metadata.runs.push(test_run("build", RunStatus::Completed));

        sync_item_from_implementation_session(&mut item, &metadata);

        assert_eq!(item.lane, AgentBoardLane::Implemented);
    }

    #[test]
    fn stale_plan_waiting_state_does_not_move_implementation_back_to_plan() {
        let mut item = test_item(AgentBoardLane::Implementing);
        item.implementation_session_id = Some("session-1".to_string());
        let mut metadata = test_metadata();
        metadata.waiting_for_input = true;
        metadata.waiting_for_input_type = Some("plan".to_string());
        metadata.runs.push(test_run("build", RunStatus::Completed));

        sync_item_from_planning_session(&mut item, &metadata);
        sync_item_from_implementation_session(&mut item, &metadata);

        assert_eq!(item.lane, AgentBoardLane::Implemented);
    }

    #[test]
    fn cancelled_build_run_updates_active_status_without_marking_complete() {
        let mut item = test_item(AgentBoardLane::Implementing);
        item.implementation_session_id = Some("session-1".to_string());
        let mut metadata = test_metadata();
        metadata.runs.push(test_run("build", RunStatus::Cancelled));

        sync_item_from_implementation_session(&mut item, &metadata);

        assert_eq!(item.lane, AgentBoardLane::Implementing);
        assert_eq!(item.active_run_status, Some(RunStatus::Cancelled));
    }

    #[test]
    fn attached_worktree_ids_deduplicates_planning_and_yolo_worktrees() {
        let mut item = test_item(AgentBoardLane::Archived);
        item.yolo_worktree_id = Some("worktree-1".to_string());

        assert_eq!(attached_worktree_ids(&item), vec!["worktree-1"]);
    }

    #[test]
    fn worktree_pr_sync_moves_implemented_card_to_pr_opened() {
        let mut item = test_item(AgentBoardLane::Implemented);
        item.implementation_session_id = Some("session-1".to_string());
        let worktree = test_worktree(Some("https://github.com/acme/repo/pull/123".to_string()));

        sync_item_from_worktree_prs(&mut item, &[worktree]);

        assert_eq!(item.lane, AgentBoardLane::PrOpened);
        assert_eq!(
            item.pr_url.as_deref(),
            Some("https://github.com/acme/repo/pull/123")
        );
    }

    #[test]
    fn worktree_pr_sync_leaves_plan_card_in_plan() {
        let mut item = test_item(AgentBoardLane::Planned);
        let worktree = test_worktree(Some("https://github.com/acme/repo/pull/123".to_string()));

        sync_item_from_worktree_prs(&mut item, &[worktree]);

        assert_eq!(item.lane, AgentBoardLane::Planned);
        assert_eq!(item.pr_url, None);
    }
}
