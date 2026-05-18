use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use super::scheduler::{compute_next_run_at, now_secs};
use super::storage::{load_automations, with_automations_mut};
use super::types::{Automation, AutomationStatus, AutomationTargetMode};
use super::AutomationManager;
use crate::chat::storage::load_sessions;
use crate::chat::types::Session;
use crate::projects::storage::load_projects_data;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct AutomationThreadCleanupResult {
    pub archived_sessions: u32,
    pub affected_worktrees: u32,
    pub skipped_archived_sessions: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
struct AutomationThreadScan {
    active_session_ids: Vec<String>,
    skipped_archived_sessions: u32,
}

#[tauri::command]
pub async fn list_automations(
    app: AppHandle,
    project_id: Option<String>,
) -> Result<Vec<Automation>, String> {
    let mut automations = load_automations(&app)?;
    if let Some(project_id) = project_id {
        automations.retain(|automation| automation.project_id == project_id);
    }
    automations.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(automations)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_automation(
    app: AppHandle,
    state: State<'_, AutomationManager>,
    project_id: String,
    name: String,
    prompt: String,
    target_mode: AutomationTargetMode,
    target_worktree_ids: Vec<String>,
    backend: Option<String>,
    model: Option<String>,
    provider: Option<String>,
    execution_mode: Option<String>,
    thinking_level: Option<String>,
    effort_level: Option<String>,
    schedule_rrule: String,
    run_window_start_hour: Option<u32>,
    run_window_end_hour: Option<u32>,
) -> Result<Automation, String> {
    validate_automation_inputs(
        &name,
        &prompt,
        &target_mode,
        &target_worktree_ids,
        &schedule_rrule,
        run_window_start_hour,
        run_window_end_hour,
    )?;

    let now = now_secs();
    let mut automation = Automation::new(
        project_id,
        name,
        prompt,
        target_mode,
        target_worktree_ids,
        schedule_rrule,
    );
    automation.backend = normalize_opt(backend);
    automation.model = normalize_opt(model);
    automation.provider = normalize_opt(provider);
    automation.execution_mode = normalize_opt(execution_mode);
    automation.thinking_level = normalize_opt(thinking_level);
    automation.effort_level = normalize_opt(effort_level);
    automation.run_window_start_hour = run_window_start_hour;
    automation.run_window_end_hour = run_window_end_hour;
    automation.next_run_at = compute_next_run_at(
        &automation.schedule_rrule,
        automation.run_window_start_hour,
        automation.run_window_end_hour,
        now,
    )?;

    let created = with_automations_mut(&app, |automations| {
        automations.push(automation.clone());
        Ok(automation.clone())
    })?;

    state.emit_updated(&created.id);
    Ok(created)
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn update_automation(
    app: AppHandle,
    state: State<'_, AutomationManager>,
    id: String,
    name: String,
    prompt: String,
    target_mode: AutomationTargetMode,
    target_worktree_ids: Vec<String>,
    backend: Option<String>,
    model: Option<String>,
    provider: Option<String>,
    execution_mode: Option<String>,
    thinking_level: Option<String>,
    effort_level: Option<String>,
    schedule_rrule: String,
    run_window_start_hour: Option<u32>,
    run_window_end_hour: Option<u32>,
    status: Option<AutomationStatus>,
) -> Result<Automation, String> {
    validate_automation_inputs(
        &name,
        &prompt,
        &target_mode,
        &target_worktree_ids,
        &schedule_rrule,
        run_window_start_hour,
        run_window_end_hour,
    )?;
    let now = now_secs();

    let updated = with_automations_mut(&app, |automations| {
        let automation = automations
            .iter_mut()
            .find(|automation| automation.id == id)
            .ok_or_else(|| "Automation not found.".to_string())?;
        automation.name = name.clone();
        automation.prompt = prompt.clone();
        automation.target_mode = target_mode.clone();
        automation.target_worktree_ids = target_worktree_ids.clone();
        automation.backend = normalize_opt(backend.clone());
        automation.model = normalize_opt(model.clone());
        automation.provider = normalize_opt(provider.clone());
        automation.execution_mode = normalize_opt(execution_mode.clone());
        automation.thinking_level = normalize_opt(thinking_level.clone());
        automation.effort_level = normalize_opt(effort_level.clone());
        automation.schedule_rrule = schedule_rrule.clone();
        automation.run_window_start_hour = run_window_start_hour;
        automation.run_window_end_hour = run_window_end_hour;
        automation.status = status.clone().unwrap_or_else(|| automation.status.clone());
        automation.updated_at = now;
        automation.next_run_at = compute_next_run_at(
            &automation.schedule_rrule,
            automation.run_window_start_hour,
            automation.run_window_end_hour,
            now,
        )?;
        Ok(automation.clone())
    })?;

    state.emit_updated(&updated.id);
    Ok(updated)
}

#[tauri::command]
pub async fn delete_automation(
    app: AppHandle,
    state: State<'_, AutomationManager>,
    id: String,
) -> Result<bool, String> {
    let deleted = with_automations_mut(&app, |automations| {
        let before = automations.len();
        automations.retain(|automation| automation.id != id);
        Ok(automations.len() != before)
    })?;

    if deleted {
        state.emit_updated(&id);
    }
    Ok(deleted)
}

#[tauri::command]
pub async fn cleanup_automation_threads(
    app: AppHandle,
    state: State<'_, AutomationManager>,
    id: String,
) -> Result<AutomationThreadCleanupResult, String> {
    let automation = load_automations(&app)?
        .into_iter()
        .find(|automation| automation.id == id)
        .ok_or_else(|| "Automation not found.".to_string())?;
    let projects_data = load_projects_data(&app)?;
    let mut targets = Vec::new();
    let mut skipped_archived_sessions = 0u32;

    for worktree in projects_data
        .worktrees
        .iter()
        .filter(|worktree| worktree.project_id == automation.project_id)
    {
        let sessions = match load_sessions(&app, &worktree.path, &worktree.id) {
            Ok(sessions) => sessions,
            Err(error) => {
                log::warn!(
                    "Failed to load sessions for automation cleanup in worktree {}: {error}",
                    worktree.id
                );
                continue;
            }
        };
        let scan = scan_automation_threads(&sessions.sessions, &automation.id);
        skipped_archived_sessions =
            skipped_archived_sessions.saturating_add(scan.skipped_archived_sessions);
        for session_id in scan.active_session_ids {
            targets.push((worktree.id.clone(), worktree.path.clone(), session_id));
        }
    }

    let mut archived_session_ids = Vec::new();
    let mut affected_worktree_ids = HashSet::new();
    for (worktree_id, worktree_path, session_id) in targets {
        crate::chat::archive_session(
            app.clone(),
            worktree_id.clone(),
            worktree_path,
            session_id.clone(),
        )
        .await?;
        archived_session_ids.push(session_id);
        affected_worktree_ids.insert(worktree_id);
    }

    if !archived_session_ids.is_empty() {
        with_automations_mut(&app, |automations| {
            let automation = automations
                .iter_mut()
                .find(|automation| automation.id == id)
                .ok_or_else(|| "Automation not found.".to_string())?;
            prune_cleaned_automation_session_mappings(automation, &archived_session_ids);
            automation.updated_at = now_secs();
            Ok(())
        })?;
    }

    let result = AutomationThreadCleanupResult {
        archived_sessions: archived_session_ids.len() as u32,
        affected_worktrees: affected_worktree_ids.len() as u32,
        skipped_archived_sessions,
    };

    state.emit_updated(&id);
    Ok(result)
}

#[tauri::command]
pub async fn run_automation_now(
    state: State<'_, AutomationManager>,
    id: String,
) -> Result<(), String> {
    state.spawn_automation_run(id, false, true);
    Ok(())
}

#[tauri::command]
pub async fn pause_automation(
    app: AppHandle,
    state: State<'_, AutomationManager>,
    id: String,
) -> Result<Automation, String> {
    let updated = with_automations_mut(&app, |automations| {
        let automation = automations
            .iter_mut()
            .find(|automation| automation.id == id)
            .ok_or_else(|| "Automation not found.".to_string())?;
        automation.status = AutomationStatus::Paused;
        automation.updated_at = now_secs();
        Ok(automation.clone())
    })?;
    state.emit_updated(&updated.id);
    Ok(updated)
}

#[tauri::command]
pub async fn resume_automation(
    app: AppHandle,
    state: State<'_, AutomationManager>,
    id: String,
) -> Result<Automation, String> {
    let updated = with_automations_mut(&app, |automations| {
        let automation = automations
            .iter_mut()
            .find(|automation| automation.id == id)
            .ok_or_else(|| "Automation not found.".to_string())?;
        automation.status = AutomationStatus::Enabled;
        automation.updated_at = now_secs();
        automation.next_run_at = compute_next_run_at(
            &automation.schedule_rrule,
            automation.run_window_start_hour,
            automation.run_window_end_hour,
            now_secs(),
        )?;
        Ok(automation.clone())
    })?;
    state.emit_updated(&updated.id);
    Ok(updated)
}

fn validate_automation_inputs(
    name: &str,
    prompt: &str,
    target_mode: &AutomationTargetMode,
    target_worktree_ids: &[String],
    schedule_rrule: &str,
    run_window_start_hour: Option<u32>,
    run_window_end_hour: Option<u32>,
) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Automation name cannot be empty.".to_string());
    }
    if prompt.trim().is_empty() {
        return Err("Automation prompt cannot be empty.".to_string());
    }
    if matches!(target_mode, AutomationTargetMode::ExistingWorktrees)
        && target_worktree_ids.is_empty()
    {
        return Err("Select at least one target worktree.".to_string());
    }
    let _ = compute_next_run_at(
        schedule_rrule,
        run_window_start_hour,
        run_window_end_hour,
        now_secs(),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chat::types::{Backend, Session};

    #[test]
    fn fresh_worktree_mode_allows_empty_targets() {
        let result = validate_automation_inputs(
            "Daily triage",
            "Do the work",
            &AutomationTargetMode::FreshWorktree,
            &[],
            "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
            None,
            None,
        );
        assert!(result.is_ok());
    }

    #[test]
    fn existing_worktree_mode_requires_targets() {
        let result = validate_automation_inputs(
            "Daily triage",
            "Do the work",
            &AutomationTargetMode::ExistingWorktrees,
            &[],
            "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
            None,
            None,
        );
        assert!(result.is_err());
    }

    #[test]
    fn scan_automation_threads_finds_only_active_sessions_for_automation() {
        let mut active = Session::new("Automation".to_string(), 0, Backend::Codex);
        active.id = "session-active".to_string();
        active.automation_id = Some("automation-1".to_string());
        active.automation_owned = true;

        let mut archived = Session::new("Archived automation".to_string(), 1, Backend::Codex);
        archived.id = "session-archived".to_string();
        archived.automation_id = Some("automation-1".to_string());
        archived.automation_owned = true;
        archived.archived_at = Some(123);

        let mut other = Session::new("Other automation".to_string(), 2, Backend::Codex);
        other.id = "session-other".to_string();
        other.automation_id = Some("automation-2".to_string());
        other.automation_owned = true;

        let scan = scan_automation_threads(&[active, archived, other], "automation-1");

        assert_eq!(scan.active_session_ids, vec!["session-active".to_string()]);
        assert_eq!(scan.skipped_archived_sessions, 1);
    }

    #[test]
    fn prune_cleaned_automation_session_mappings_removes_archived_session_ids() {
        let mut automation = Automation::new(
            "project-1".to_string(),
            "Daily triage".to_string(),
            "Do the work".to_string(),
            AutomationTargetMode::ExistingWorktrees,
            vec!["worktree-1".to_string(), "worktree-2".to_string()],
            "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0".to_string(),
        );
        automation
            .session_ids_by_worktree_id
            .insert("worktree-1".to_string(), "session-cleaned".to_string());
        automation
            .session_ids_by_worktree_id
            .insert("worktree-2".to_string(), "session-kept".to_string());

        prune_cleaned_automation_session_mappings(
            &mut automation,
            &["session-cleaned".to_string()],
        );

        assert_eq!(
            automation.session_ids_by_worktree_id.get("worktree-2"),
            Some(&"session-kept".to_string())
        );
        assert!(!automation
            .session_ids_by_worktree_id
            .contains_key("worktree-1"));
    }
}

fn normalize_opt(value: Option<String>) -> Option<String> {
    value.and_then(|value| {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn scan_automation_threads(sessions: &[Session], automation_id: &str) -> AutomationThreadScan {
    let mut scan = AutomationThreadScan::default();
    for session in sessions {
        if session.automation_id.as_deref() != Some(automation_id) {
            continue;
        }
        if session.archived_at.is_some() {
            scan.skipped_archived_sessions = scan.skipped_archived_sessions.saturating_add(1);
        } else {
            scan.active_session_ids.push(session.id.clone());
        }
    }
    scan
}

fn prune_cleaned_automation_session_mappings(
    automation: &mut Automation,
    archived_session_ids: &[String],
) {
    let archived_session_ids: HashSet<&str> =
        archived_session_ids.iter().map(String::as_str).collect();
    automation
        .session_ids_by_worktree_id
        .retain(|_, session_id| !archived_session_ids.contains(session_id.as_str()));
}
