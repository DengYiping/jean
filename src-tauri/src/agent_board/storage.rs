use super::types::{AgentBoardData, AgentBoardItem, AgentBoardLane};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn now_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn get_agent_board_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    Ok(app_data_dir.join("agent-board.json"))
}

pub fn load_agent_board_data(app: &AppHandle) -> Result<AgentBoardData, String> {
    let path = get_agent_board_path(app)?;
    if !path.exists() {
        return Ok(AgentBoardData::default());
    }

    let contents =
        std::fs::read_to_string(&path).map_err(|e| format!("Failed to read board file: {e}"))?;
    serde_json::from_str(&contents).map_err(|e| format!("Failed to parse board file: {e}"))
}

pub fn save_agent_board_data(app: &AppHandle, data: &AgentBoardData) -> Result<(), String> {
    let path = get_agent_board_path(app)?;
    let tmp_path = path.with_extension("tmp");
    let mut data_for_storage = data.clone();
    for item in &mut data_for_storage.items {
        item.active_run_status = None;
    }
    let json = serde_json::to_string_pretty(&data_for_storage)
        .map_err(|e| format!("Failed to serialize board file: {e}"))?;
    std::fs::write(&tmp_path, json).map_err(|e| format!("Failed to write board file: {e}"))?;
    std::fs::rename(&tmp_path, &path).map_err(|e| format!("Failed to save board file: {e}"))
}

pub fn with_agent_board_data_mut<F, T>(app: &AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&mut AgentBoardData) -> Result<T, String>,
{
    let mut data = load_agent_board_data(app)?;
    let result = f(&mut data)?;
    save_agent_board_data(app, &data)?;
    Ok(result)
}

pub fn find_item_mut<'a>(
    data: &'a mut AgentBoardData,
    item_id: &str,
) -> Result<&'a mut AgentBoardItem, String> {
    data.items
        .iter_mut()
        .find(|item| item.id == item_id)
        .ok_or_else(|| format!("Agent board item not found: {item_id}"))
}

pub fn validate_lane_move(from: AgentBoardLane, to: AgentBoardLane) -> Result<(), String> {
    if from.can_move_to(to) {
        Ok(())
    } else {
        Err(format!(
            "Cannot move agent board item from {from:?} to {to:?}"
        ))
    }
}

pub fn update_agent_board_title_for_session(
    app: &AppHandle,
    session_id: &str,
    title: &str,
) -> Result<bool, String> {
    let mut data = load_agent_board_data(app)?;
    let changed =
        update_agent_board_title_for_session_data(&mut data, session_id, title, now_seconds());
    if changed {
        save_agent_board_data(app, &data)?;
    }
    Ok(changed)
}

fn update_agent_board_title_for_session_data(
    data: &mut AgentBoardData,
    session_id: &str,
    title: &str,
    updated_at: u64,
) -> bool {
    let mut changed = false;
    for item in &mut data.items {
        let matches_session = item.planning_session_id.as_deref() == Some(session_id)
            || item.implementation_session_id.as_deref() == Some(session_id)
            || item.yolo_session_id.as_deref() == Some(session_id);
        if matches_session && item.title != title {
            item.title = title.to_string();
            item.updated_at = updated_at;
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::Backend;

    fn item(lane: AgentBoardLane) -> AgentBoardItem {
        AgentBoardItem {
            id: "item-1".to_string(),
            title: "Test".to_string(),
            prompt: "Do the thing".to_string(),
            project_id: "project-1".to_string(),
            backend: Backend::Codex,
            effort_level: None,
            lane,
            worktree_id: Some("wt-1".to_string()),
            planning_session_id: None,
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

    #[test]
    fn lane_validation_allows_pr_opened_to_archived() {
        assert!(validate_lane_move(AgentBoardLane::PrOpened, AgentBoardLane::Archived).is_ok());
    }

    #[test]
    fn lane_validation_blocks_pr_opened_to_other_lanes() {
        assert!(validate_lane_move(AgentBoardLane::PrOpened, AgentBoardLane::Implemented).is_err());
        assert!(
            validate_lane_move(AgentBoardLane::PrOpened, AgentBoardLane::Implementing).is_err()
        );
    }

    #[test]
    fn lane_validation_allows_completed_yolo_to_pr_opened() {
        assert!(validate_lane_move(AgentBoardLane::Yoloing, AgentBoardLane::PrOpened).is_err());
        assert!(validate_lane_move(AgentBoardLane::Yoloed, AgentBoardLane::PrOpened).is_ok());
    }

    #[test]
    fn lane_validation_allows_plan_to_yolo() {
        assert!(validate_lane_move(AgentBoardLane::Planning, AgentBoardLane::Yoloing).is_ok());
        assert!(validate_lane_move(AgentBoardLane::Planned, AgentBoardLane::Yoloing).is_ok());
    }

    #[test]
    fn lane_validation_blocks_implementing_to_planning() {
        assert!(
            validate_lane_move(AgentBoardLane::Implementing, AgentBoardLane::Planning).is_err()
        );
    }

    #[test]
    fn implementation_restart_sync_returns_to_implementing() {
        let mut item = item(AgentBoardLane::Implemented);
        item.lane = AgentBoardLane::Implementing;
        assert_eq!(item.lane, AgentBoardLane::Implementing);
    }

    #[test]
    fn yolo_restart_sync_returns_to_yoloing() {
        let mut item = item(AgentBoardLane::Yoloed);
        item.lane = AgentBoardLane::Yoloing;
        assert_eq!(item.lane, AgentBoardLane::Yoloing);
    }

    #[test]
    fn archived_worktree_sets_archive_timestamp() {
        let mut item = item(AgentBoardLane::Implemented);
        item.lane = AgentBoardLane::Archived;
        item.archived_at = Some(123);
        assert_eq!(item.archived_at, Some(123));
    }

    #[test]
    fn updates_title_for_associated_session() {
        let mut data = AgentBoardData {
            version: 1,
            items: vec![item(AgentBoardLane::Planned)],
        };
        data.items[0].planning_session_id = Some("session-1".to_string());

        let changed =
            update_agent_board_title_for_session_data(&mut data, "session-1", "New title", 456);

        assert!(changed);
        assert_eq!(data.items[0].title, "New title");
        assert_eq!(data.items[0].updated_at, 456);
    }

    #[test]
    fn ignores_unassociated_session_title_updates() {
        let mut data = AgentBoardData {
            version: 1,
            items: vec![item(AgentBoardLane::Planned)],
        };
        data.items[0].planning_session_id = Some("session-1".to_string());

        let changed =
            update_agent_board_title_for_session_data(&mut data, "session-2", "New title", 456);

        assert!(!changed);
        assert_eq!(data.items[0].title, "Test");
    }
}
