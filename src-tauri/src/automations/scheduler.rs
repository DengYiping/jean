use chrono::{Datelike, Duration, Local, LocalResult, TimeZone, Timelike, Weekday};
use tauri::AppHandle;
use uuid::Uuid;

use super::storage::{ensure_memory_file, load_automations, with_automations_mut};
use super::types::{Automation, AutomationLastRunStatus, AutomationStatus, AutomationTargetMode};
use crate::automations::AutomationManager;
use crate::chat::storage::{load_metadata, with_sessions_mut};
use crate::chat::types::{Backend, EffortLevel, Session, ThinkingLevel};
use crate::chat::{resolve_default_backend, send_chat_message};
use crate::http_server::EmitExt;
use crate::projects::storage::{load_projects_data, sanitize_directory_name};
use crate::projects::types::{AutomationWorktreeMetadata, Worktree};
use crate::projects::{archive_worktree, create_worktree};

pub const AUTOMATION_TICK_INTERVAL_SECS: u64 = 30;

pub fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn compute_next_run_at(
    rrule: &str,
    run_window_start_hour: Option<u32>,
    run_window_end_hour: Option<u32>,
    now: u64,
) -> Result<Option<u64>, String> {
    let schedule = ParsedSchedule::parse(rrule, run_window_start_hour, run_window_end_hour)?;
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
            automation.next_run_at = compute_next_run_at(
                &automation.schedule_rrule,
                automation.run_window_start_hour,
                automation.run_window_end_hour,
                now,
            )?;
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
    match automation.target_mode {
        AutomationTargetMode::ExistingWorktrees => run_existing_targets(app, automation).await,
        AutomationTargetMode::FreshWorktree => run_fresh_target(app, automation).await,
    }
}

async fn run_existing_targets(
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

async fn run_fresh_target(
    app: &AppHandle,
    automation: &Automation,
) -> Result<AutomationLastRunStatus, String> {
    let pending_worktree = create_worktree(
        app.clone(),
        automation.project_id.clone(),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        Some(build_fresh_worktree_name(&automation.name, now_secs())),
        Some(AutomationWorktreeMetadata {
            automation_id: automation.id.clone(),
            automation_name: automation.name.clone(),
        }),
    )
    .await?;

    let worktree = wait_for_worktree_ready(app, &pending_worktree.id).await?;
    let session_id = ensure_automation_session(app, automation, &worktree)?;
    let prompt = build_automation_prompt(app, automation)?;

    send_chat_message(
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
    .await?;

    archive_previous_fresh_runs(app, automation, &worktree.id).await?;
    Ok(AutomationLastRunStatus::Completed)
}

async fn wait_for_worktree_ready(app: &AppHandle, worktree_id: &str) -> Result<Worktree, String> {
    let deadline = now_secs() + 120;
    loop {
        if let Some(worktree) = load_projects_data(app)?.find_worktree(worktree_id).cloned() {
            return Ok(worktree);
        }
        if now_secs() >= deadline {
            return Err(format!(
                "Timed out waiting for automation worktree {worktree_id} to be created."
            ));
        }
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    }
}

async fn archive_previous_fresh_runs(
    app: &AppHandle,
    automation: &Automation,
    keep_worktree_id: &str,
) -> Result<(), String> {
    let worktree_ids: Vec<String> = load_projects_data(app)?
        .worktrees
        .into_iter()
        .filter(|worktree| worktree.project_id == automation.project_id)
        .filter(|worktree| worktree.archived_at.is_none())
        .filter(|worktree| worktree.automation_owned)
        .filter(|worktree| worktree.automation_id.as_deref() == Some(automation.id.as_str()))
        .filter(|worktree| worktree.id != keep_worktree_id)
        .map(|worktree| worktree.id)
        .collect();

    for worktree_id in worktree_ids {
        archive_worktree(app.clone(), worktree_id).await?;
    }

    Ok(())
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
        &serde_json::json!({ "keys": ["automations", "sessions", "projects"] }),
    );
    let _ = app.emit_all(
        "automation:run-updated",
        &super::types::AutomationRunEvent {
            automation_id: automation_id.to_string(),
        },
    );
}

fn build_fresh_worktree_name(automation_name: &str, timestamp: u64) -> String {
    let sanitized = sanitize_directory_name(automation_name)
        .to_ascii_lowercase()
        .trim_matches('-')
        .to_string();
    let sanitized = if sanitized.is_empty() {
        "automation".to_string()
    } else {
        sanitized
    };
    let suffix = Uuid::new_v4()
        .to_string()
        .split('-')
        .next()
        .unwrap_or("run")
        .to_string();
    format!("automation-{sanitized}-{timestamp}-{suffix}")
}

#[derive(Debug, Clone)]
struct ParsedSchedule {
    frequency: Frequency,
    interval: u32,
    byhour: Option<u32>,
    byminute: Option<u32>,
    byday: Vec<Weekday>,
    run_window: Option<RunWindow>,
}

#[derive(Debug, Clone, Copy)]
struct RunWindow {
    start_hour: u32,
    end_hour: u32,
}

#[derive(Debug, Clone, Copy)]
enum Frequency {
    Hourly,
    Daily,
    Weekly,
}

impl ParsedSchedule {
    fn parse(
        rrule: &str,
        run_window_start_hour: Option<u32>,
        run_window_end_hour: Option<u32>,
    ) -> Result<Self, String> {
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
        let run_window = parse_run_window(frequency, run_window_start_hour, run_window_end_hour)?;
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
            run_window,
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
        if let Some(run_window) = self.run_window {
            return self.next_hourly_in_window(current, run_window);
        }

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

    fn next_hourly_in_window(
        &self,
        current: chrono::DateTime<Local>,
        run_window: RunWindow,
    ) -> Result<u64, String> {
        let target_minute = self.byminute.unwrap_or(0);
        let base = current.date_naive();

        for day_offset in 0..=(366 * 5) {
            let candidate_date = base + Duration::days(day_offset.into());
            let mut hour = run_window.start_hour;

            while hour < run_window.end_hour {
                let candidate = candidate_date
                    .and_hms_opt(hour, target_minute, 0)
                    .and_then(localize_naive)
                    .ok_or_else(|| "Failed to build hourly schedule.".to_string())?;
                if candidate.timestamp() > current.timestamp() {
                    return Ok(candidate.timestamp() as u64);
                }
                hour = hour.saturating_add(self.interval);
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

fn parse_run_window(
    frequency: Frequency,
    run_window_start_hour: Option<u32>,
    run_window_end_hour: Option<u32>,
) -> Result<Option<RunWindow>, String> {
    match (run_window_start_hour, run_window_end_hour) {
        (None, None) => Ok(None),
        (Some(_), None) | (None, Some(_)) => {
            Err("Run window requires both start and end hours.".to_string())
        }
        (Some(start_hour), Some(end_hour)) => {
            if start_hour > 23 || end_hour > 23 {
                return Err("Run window hours must be between 0 and 23.".to_string());
            }
            if !matches!(frequency, Frequency::Hourly) {
                return Err("Run window is only supported for hourly schedules.".to_string());
            }
            if start_hour >= end_hour {
                return Err("Run window start hour must be earlier than the end hour.".to_string());
            }

            Ok(Some(RunWindow {
                start_hour,
                end_hour,
            }))
        }
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
        let next = compute_next_run_at(
            "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=30",
            None,
            None,
            1_710_000_000,
        )
        .expect("schedule")
        .expect("next");
        assert!(next > 1_710_000_000);
    }

    #[test]
    fn computes_next_weekly_run() {
        let next = compute_next_run_at(
            "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE;BYHOUR=10;BYMINUTE=0",
            None,
            None,
            1_710_000_000,
        )
        .expect("schedule")
        .expect("next");
        assert!(next > 1_710_000_000);
    }

    #[test]
    fn computes_next_hourly_run_in_window() {
        let current = Local
            .with_ymd_and_hms(2026, 4, 9, 8, 15, 0)
            .single()
            .expect("current");
        let next = compute_next_run_at(
            "FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
            Some(9),
            Some(17),
            current.timestamp() as u64,
        )
        .expect("schedule")
        .expect("next");
        let next = Local
            .timestamp_opt(next as i64, 0)
            .single()
            .expect("next ts");
        assert_eq!(next.hour(), 9);
        assert_eq!(next.minute(), 0);
    }

    #[test]
    fn anchors_hourly_window_interval_to_start_hour() {
        let current = Local
            .with_ymd_and_hms(2026, 4, 9, 9, 5, 0)
            .single()
            .expect("current");
        let next = compute_next_run_at(
            "FREQ=HOURLY;INTERVAL=2;BYMINUTE=0",
            Some(9),
            Some(17),
            current.timestamp() as u64,
        )
        .expect("schedule")
        .expect("next");
        let next = Local
            .timestamp_opt(next as i64, 0)
            .single()
            .expect("next ts");
        assert_eq!(next.hour(), 11);
    }

    #[test]
    fn rolls_hourly_window_to_next_day_after_end() {
        let current = Local
            .with_ymd_and_hms(2026, 4, 9, 16, 30, 0)
            .single()
            .expect("current");
        let next = compute_next_run_at(
            "FREQ=HOURLY;INTERVAL=2;BYMINUTE=0",
            Some(9),
            Some(17),
            current.timestamp() as u64,
        )
        .expect("schedule")
        .expect("next");
        let next = Local
            .timestamp_opt(next as i64, 0)
            .single()
            .expect("next ts");
        assert_eq!(
            next.date_naive(),
            (current + Duration::days(1)).date_naive()
        );
        assert_eq!(next.hour(), 9);
    }

    #[test]
    fn rejects_partial_run_window() {
        let error = compute_next_run_at(
            "FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
            Some(9),
            None,
            1_710_000_000,
        )
        .expect_err("partial window should fail");
        assert!(error.contains("both start and end"));
    }

    #[test]
    fn rejects_run_window_for_daily_schedule() {
        let error = compute_next_run_at(
            "FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0",
            Some(9),
            Some(17),
            1_710_000_000,
        )
        .expect_err("daily window should fail");
        assert!(error.contains("only supported for hourly"));
    }

    #[test]
    fn builds_fresh_worktree_name_from_automation_name() {
        let name = build_fresh_worktree_name("Daily Triage!", 1_760_000_000);
        assert!(name.starts_with("automation-daily-triage-1760000000-"));
        assert!(!name.contains(' '));
    }
}
