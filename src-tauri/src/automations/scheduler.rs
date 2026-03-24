use chrono::{Datelike, Duration, Local, LocalResult, TimeZone, Timelike, Weekday};
use tauri::AppHandle;

use super::storage::{ensure_memory_file, load_automations, with_automations_mut};
use super::types::{Automation, AutomationLastRunStatus, AutomationStatus};
use crate::automations::AutomationManager;
use crate::chat::storage::{load_metadata, with_sessions_mut};
use crate::chat::types::{Backend, EffortLevel, Session, ThinkingLevel};
use crate::chat::{resolve_default_backend, send_chat_message};
use crate::http_server::EmitExt;
use crate::projects::storage::load_projects_data;
use crate::projects::types::Worktree;

pub const AUTOMATION_TICK_INTERVAL_SECS: u64 = 30;

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn compute_next_run_at(rrule: &str, now: u64) -> Result<Option<u64>, String> {
    let schedule = ParsedSchedule::parse(rrule)?;
    schedule.next_after(now).map(Some)
}

pub async fn run_due_automations(manager: &AutomationManager) -> Result<(), String> {
    let now = now_secs();
    let due_ids: Vec<String> = load_automations(&manager.app)?
        .into_iter()
        .filter(|automation| automation.status == AutomationStatus::Enabled)
        .filter(|automation| automation.next_run_at.is_some_and(|next| next <= now))
        .map(|automation| automation.id)
        .collect();

    for automation_id in due_ids {
        manager.spawn_automation_run(automation_id, true, false);
    }

    Ok(())
}

pub async fn run_automation_by_id(
    manager: &AutomationManager,
    automation_id: &str,
    advance_schedule: bool,
    allow_paused: bool,
) -> Result<(), String> {
    if !manager.try_mark_running(automation_id) {
        return Ok(());
    }

    let run_result =
        run_automation_inner(manager, automation_id, advance_schedule, allow_paused).await;
    manager.clear_running(automation_id);
    run_result
}

async fn run_automation_inner(
    manager: &AutomationManager,
    automation_id: &str,
    advance_schedule: bool,
    allow_paused: bool,
) -> Result<(), String> {
    let now = now_secs();
    let automation = with_automations_mut(&manager.app, |automations| {
        let automation = automations
            .iter_mut()
            .find(|automation| automation.id == automation_id)
            .ok_or_else(|| "Automation not found.".to_string())?;

        if automation.status == AutomationStatus::Paused && !allow_paused {
            return Err("Automation is paused.".to_string());
        }

        automation.updated_at = now;
        automation.last_error = None;
        automation.last_run_status = Some(AutomationLastRunStatus::Running);
        if advance_schedule {
            automation.next_run_at = compute_next_run_at(&automation.schedule_rrule, now)?;
        }

        Ok(automation.clone())
    })?;

    emit_automations_invalidation(&manager.app, &automation.id);

    let run_outcome = run_targets(&manager.app, &automation).await;
    let completed_at = now_secs();
    with_automations_mut(&manager.app, |automations| {
        let automation = automations
            .iter_mut()
            .find(|automation| automation.id == automation_id)
            .ok_or_else(|| "Automation not found.".to_string())?;
        automation.updated_at = completed_at;
        automation.last_run_at = Some(completed_at);
        match &run_outcome {
            Ok(summary) => {
                automation.last_run_status = Some(summary.clone());
                automation.last_error = None;
            }
            Err(error) => {
                automation.last_run_status = Some(AutomationLastRunStatus::Failed);
                automation.last_error = Some(error.clone());
            }
        }
        Ok(())
    })?;
    emit_automations_invalidation(&manager.app, automation_id);

    run_outcome.map(|_| ())
}

async fn run_targets(
    app: &AppHandle,
    automation: &Automation,
) -> Result<AutomationLastRunStatus, String> {
    if automation.target_worktree_ids.is_empty() {
        return Ok(AutomationLastRunStatus::Skipped);
    }

    let projects_data = load_projects_data(app)?;
    let mut any_success = false;
    let mut failures = Vec::new();

    for worktree_id in &automation.target_worktree_ids {
        let Some(worktree) = projects_data.find_worktree(worktree_id).cloned() else {
            failures.push(format!("Missing target worktree: {worktree_id}"));
            continue;
        };

        if worktree.archived_at.is_some() {
            failures.push(format!("Target worktree is archived: {}", worktree.name));
            continue;
        }

        let session_id = ensure_automation_session(app, automation, &worktree)?;
        let prompt = build_automation_prompt(app, automation)?;

        let send_result = send_chat_message(
            app.clone(),
            session_id,
            worktree.id.clone(),
            worktree.path.clone(),
            prompt,
            automation.model.clone(),
            automation.execution_mode.clone(),
            parse_thinking_level(automation.thinking_level.as_deref())?,
            parse_effort_level(automation.effort_level.as_deref())?,
            None,
            None,
            None,
            None,
            Some(false),
            automation.provider.clone(),
            automation.backend.clone(),
        )
        .await;

        match send_result {
            Ok(_) => any_success = true,
            Err(error) => failures.push(format!("{}: {error}", worktree.name)),
        }
    }

    if any_success && failures.is_empty() {
        Ok(AutomationLastRunStatus::Completed)
    } else if any_success {
        Err(failures.join("\n"))
    } else if failures.is_empty() {
        Ok(AutomationLastRunStatus::Skipped)
    } else {
        Err(failures.join("\n"))
    }
}

fn ensure_automation_session(
    app: &AppHandle,
    automation: &Automation,
    worktree: &Worktree,
) -> Result<String, String> {
    if let Some(existing_session_id) = automation.session_ids_by_worktree_id.get(&worktree.id) {
        if load_metadata(app, existing_session_id)?.is_some() {
            return Ok(existing_session_id.clone());
        }
    }

    let backend = parse_backend(automation.backend.as_deref())
        .unwrap_or_else(|| resolve_default_backend(app, Some(&worktree.id)));
    let session_name = format!("Automation: {}", automation.name);
    let created_session_id = with_sessions_mut(app, &worktree.path, &worktree.id, |sessions| {
        let order = sessions.sessions.len() as u32;
        let mut session = Session::new(session_name.clone(), order, backend.clone());
        session.automation_id = Some(automation.id.clone());
        session.automation_name = Some(automation.name.clone());
        session.automation_target_worktree_id = Some(worktree.id.clone());
        session.automation_owned = true;
        session.selected_model = automation.model.clone();
        session.selected_provider = automation.provider.clone();
        session.selected_execution_mode = automation.execution_mode.clone();
        session.selected_thinking_level =
            parse_thinking_level(automation.thinking_level.as_deref())?;
        sessions.sessions.push(session.clone());
        Ok(session.id)
    })?;

    with_automations_mut(app, |automations| {
        let automation_entry = automations
            .iter_mut()
            .find(|entry| entry.id == automation.id)
            .ok_or_else(|| "Automation not found.".to_string())?;
        automation_entry
            .session_ids_by_worktree_id
            .insert(worktree.id.clone(), created_session_id.clone());
        automation_entry.updated_at = now_secs();
        Ok(())
    })?;
    emit_automations_invalidation(app, &automation.id);

    Ok(created_session_id)
}

fn build_automation_prompt(app: &AppHandle, automation: &Automation) -> Result<String, String> {
    let memory_path = ensure_memory_file(app, &automation.id)?;
    let last_run = automation
        .last_run_at
        .map(format_timestamp)
        .unwrap_or_else(|| "never".to_string());
    Ok(format!(
        "Automation: {}\nAutomation ID: {}\nAutomation memory: {}\nLast run: {}\n\n{}",
        automation.name,
        automation.id,
        memory_path.display(),
        last_run,
        automation.prompt
    ))
}

fn format_timestamp(timestamp: u64) -> String {
    match Local.timestamp_opt(timestamp as i64, 0) {
        LocalResult::Single(datetime) => datetime.to_rfc3339(),
        _ => timestamp.to_string(),
    }
}

fn parse_backend(value: Option<&str>) -> Option<Backend> {
    match value {
        Some("claude") => Some(Backend::Claude),
        Some("codex") => Some(Backend::Codex),
        Some("opencode") => Some(Backend::Opencode),
        _ => None,
    }
}

fn parse_thinking_level(value: Option<&str>) -> Result<Option<ThinkingLevel>, String> {
    match value {
        None | Some("") => Ok(None),
        Some("off") => Ok(Some(ThinkingLevel::Off)),
        Some("think") => Ok(Some(ThinkingLevel::Think)),
        Some("megathink") => Ok(Some(ThinkingLevel::Megathink)),
        Some("ultrathink") => Ok(Some(ThinkingLevel::Ultrathink)),
        Some(other) => Err(format!("Unsupported thinking level: {other}")),
    }
}

fn parse_effort_level(value: Option<&str>) -> Result<Option<EffortLevel>, String> {
    match value {
        None | Some("") => Ok(None),
        Some("off") => Ok(Some(EffortLevel::Off)),
        Some("low") => Ok(Some(EffortLevel::Low)),
        Some("medium") => Ok(Some(EffortLevel::Medium)),
        Some("high") => Ok(Some(EffortLevel::High)),
        Some("max") => Ok(Some(EffortLevel::Max)),
        Some(other) => Err(format!("Unsupported effort level: {other}")),
    }
}

fn emit_automations_invalidation(app: &AppHandle, automation_id: &str) {
    let _ = app.emit_all(
        "cache:invalidate",
        &serde_json::json!({ "keys": ["automations", "sessions"] }),
    );
    let _ = app.emit_all(
        "automation:run-updated",
        &super::types::AutomationRunEvent {
            automation_id: automation_id.to_string(),
        },
    );
}

#[derive(Debug, Clone)]
struct ParsedSchedule {
    frequency: Frequency,
    interval: u32,
    byhour: Option<u32>,
    byminute: Option<u32>,
    byday: Vec<Weekday>,
}

#[derive(Debug, Clone, Copy)]
enum Frequency {
    Hourly,
    Daily,
    Weekly,
}

impl ParsedSchedule {
    fn parse(rrule: &str) -> Result<Self, String> {
        let mut frequency = None;
        let mut interval = 1u32;
        let mut byhour = None;
        let mut byminute = None;
        let mut byday = Vec::new();

        for component in rrule.split(';') {
            let (key, value) = component
                .split_once('=')
                .ok_or_else(|| format!("Invalid RRULE component: {component}"))?;
            match key.trim().to_ascii_uppercase().as_str() {
                "FREQ" => {
                    frequency = Some(match value.trim().to_ascii_uppercase().as_str() {
                        "HOURLY" => Frequency::Hourly,
                        "DAILY" => Frequency::Daily,
                        "WEEKLY" => Frequency::Weekly,
                        other => return Err(format!("Unsupported RRULE frequency: {other}")),
                    });
                }
                "INTERVAL" => {
                    interval = value
                        .trim()
                        .parse::<u32>()
                        .map_err(|_| "RRULE INTERVAL must be a positive integer.".to_string())?;
                    if interval == 0 {
                        return Err("RRULE INTERVAL must be at least 1.".to_string());
                    }
                }
                "BYHOUR" => {
                    byhour = Some(parse_time_component(value, 23, "BYHOUR")?);
                }
                "BYMINUTE" => {
                    byminute = Some(parse_time_component(value, 59, "BYMINUTE")?);
                }
                "BYDAY" => {
                    byday = value
                        .split(',')
                        .map(parse_weekday)
                        .collect::<Result<Vec<_>, _>>()?;
                }
                "WKST" => {}
                other => return Err(format!("Unsupported RRULE field: {other}")),
            }
        }

        let frequency = frequency.ok_or_else(|| "RRULE is missing FREQ.".to_string())?;
        if matches!(frequency, Frequency::Daily | Frequency::Weekly) && byhour.is_none() {
            return Err("Daily and weekly schedules require BYHOUR.".to_string());
        }
        if matches!(frequency, Frequency::Weekly) && byday.is_empty() {
            return Err("Weekly schedules require BYDAY.".to_string());
        }

        Ok(Self {
            frequency,
            interval,
            byhour,
            byminute,
            byday,
        })
    }

    fn next_after(&self, now: u64) -> Result<u64, String> {
        let current = match Local.timestamp_opt(now as i64, 0) {
            LocalResult::Single(value) => value,
            _ => return Err("Failed to resolve schedule timestamp.".to_string()),
        };

        match self.frequency {
            Frequency::Hourly => self.next_hourly(current),
            Frequency::Daily => self.next_daily(current),
            Frequency::Weekly => self.next_weekly(current),
        }
    }

    fn next_hourly(&self, current: chrono::DateTime<Local>) -> Result<u64, String> {
        let target_minute = self.byminute.unwrap_or(0);
        let current_block = current
            .with_second(0)
            .and_then(|value| value.with_nanosecond(0))
            .ok_or_else(|| "Failed to normalize hourly schedule.".to_string())?;
        for offset in 0..=(24 * 365) {
            let candidate_base = current_block + Duration::hours(offset.into());
            if candidate_base.hour().is_multiple_of(self.interval) {
                let candidate = candidate_base
                    .with_minute(target_minute)
                    .and_then(|value| value.with_second(0))
                    .ok_or_else(|| "Failed to build hourly schedule.".to_string())?;
                if candidate.timestamp() > current.timestamp() {
                    return Ok(candidate.timestamp() as u64);
                }
            }
        }
        Err("Could not compute next hourly schedule.".to_string())
    }

    fn next_daily(&self, current: chrono::DateTime<Local>) -> Result<u64, String> {
        let target_hour = self.byhour.unwrap_or(9);
        let target_minute = self.byminute.unwrap_or(0);
        let base = current.date_naive();
        for offset in 0..=(366 * 5) {
            let candidate_date = base + Duration::days(offset.into());
            if days_since_epoch(candidate_date) % self.interval as i64 != 0 {
                continue;
            }
            let candidate = candidate_date
                .and_hms_opt(target_hour, target_minute, 0)
                .and_then(localize_naive)
                .ok_or_else(|| "Failed to build daily schedule.".to_string())?;
            if candidate.timestamp() > current.timestamp() {
                return Ok(candidate.timestamp() as u64);
            }
        }
        Err("Could not compute next daily schedule.".to_string())
    }

    fn next_weekly(&self, current: chrono::DateTime<Local>) -> Result<u64, String> {
        let target_hour = self.byhour.unwrap_or(9);
        let target_minute = self.byminute.unwrap_or(0);
        let base = current.date_naive();
        for offset in 0..=(366 * 5) {
            let candidate_date = base + Duration::days(offset.into());
            if !self.byday.contains(&candidate_date.weekday()) {
                continue;
            }
            if weeks_since_epoch(candidate_date) % self.interval as i64 != 0 {
                continue;
            }
            let candidate = candidate_date
                .and_hms_opt(target_hour, target_minute, 0)
                .and_then(localize_naive)
                .ok_or_else(|| "Failed to build weekly schedule.".to_string())?;
            if candidate.timestamp() > current.timestamp() {
                return Ok(candidate.timestamp() as u64);
            }
        }
        Err("Could not compute next weekly schedule.".to_string())
    }
}

fn parse_time_component(value: &str, max: u32, field: &str) -> Result<u32, String> {
    let parsed = value
        .trim()
        .parse::<u32>()
        .map_err(|_| format!("RRULE {field} must be an integer."))?;
    if parsed > max {
        return Err(format!("RRULE {field} must be <= {max}."));
    }
    Ok(parsed)
}

fn parse_weekday(value: &str) -> Result<Weekday, String> {
    match value.trim().to_ascii_uppercase().as_str() {
        "MO" => Ok(Weekday::Mon),
        "TU" => Ok(Weekday::Tue),
        "WE" => Ok(Weekday::Wed),
        "TH" => Ok(Weekday::Thu),
        "FR" => Ok(Weekday::Fri),
        "SA" => Ok(Weekday::Sat),
        "SU" => Ok(Weekday::Sun),
        other => Err(format!("Unsupported RRULE weekday: {other}")),
    }
}

fn days_since_epoch(date: chrono::NaiveDate) -> i64 {
    let epoch = chrono::NaiveDate::from_ymd_opt(1970, 1, 1).unwrap();
    date.signed_duration_since(epoch).num_days()
}

fn weeks_since_epoch(date: chrono::NaiveDate) -> i64 {
    days_since_epoch(date) / 7
}

fn localize_naive(naive: chrono::NaiveDateTime) -> Option<chrono::DateTime<Local>> {
    match Local.from_local_datetime(&naive) {
        LocalResult::Single(value) => Some(value),
        LocalResult::Ambiguous(first, _) => Some(first),
        LocalResult::None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_next_daily_run() {
        let next = compute_next_run_at("FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=30", 1_710_000_000)
            .expect("schedule")
            .expect("next");
        assert!(next > 1_710_000_000);
    }

    #[test]
    fn computes_next_weekly_run() {
        let next = compute_next_run_at(
            "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;BYHOUR=10;BYMINUTE=0",
            1_710_000_000,
        )
        .expect("schedule")
        .expect("next");
        assert!(next > 1_710_000_000);
    }
}
