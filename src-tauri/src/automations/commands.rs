use tauri::{AppHandle, State};

use super::scheduler::{compute_next_run_at, now_secs};
use super::storage::{load_automations, with_automations_mut};
use super::types::{Automation, AutomationStatus};
use super::AutomationManager;

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
    if target_worktree_ids.is_empty() {
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
