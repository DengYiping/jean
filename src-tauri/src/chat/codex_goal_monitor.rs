use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use once_cell::sync::Lazy;
use tauri::AppHandle;
use uuid::Uuid;

use super::codex_server::{self, ServerEvent, SessionContext};
use super::run_log;
use super::storage::{list_all_session_ids, load_metadata};
use super::types::{Backend, RunStatus, SessionMetadata};
use crate::http_server::EmitExt;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct MonitorKey {
    session_id: String,
    thread_id: String,
}

#[derive(Debug, Clone)]
struct MonitorHandle {
    stop: Arc<AtomicBool>,
    active_turn_id: Arc<Mutex<Option<String>>>,
}

struct MonitorRuntime {
    app: AppHandle,
    session_id: String,
    worktree_id: String,
    thread_id: String,
    event_rx: std::sync::mpsc::Receiver<ServerEvent>,
    registration_id: u64,
    stop: Arc<AtomicBool>,
    active_turn_id: Arc<Mutex<Option<String>>>,
}

static MONITORS: Lazy<Mutex<HashMap<MonitorKey, MonitorHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

fn lock_monitors() -> std::sync::MutexGuard<'static, HashMap<MonitorKey, MonitorHandle>> {
    match MONITORS.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            log::error!("Recovering poisoned Codex goal monitor registry");
            poisoned.into_inner()
        }
    }
}

fn key(session_id: &str, thread_id: &str) -> MonitorKey {
    MonitorKey {
        session_id: session_id.to_string(),
        thread_id: thread_id.to_string(),
    }
}

fn metadata_has_active_goal(metadata: &SessionMetadata) -> bool {
    metadata.backend == Backend::Codex
        && metadata
            .codex_goal
            .as_ref()
            .is_some_and(|goal| !goal.trim().is_empty())
        && metadata
            .codex_thread_id
            .as_ref()
            .is_some_and(|thread_id| !thread_id.trim().is_empty())
}

fn metadata_has_running_run(metadata: &SessionMetadata) -> bool {
    metadata
        .runs
        .iter()
        .any(|run| matches!(run.status, RunStatus::Running | RunStatus::Resumable))
}

#[cfg(test)]
pub(crate) fn is_monitoring(session_id: &str, thread_id: &str) -> bool {
    lock_monitors().contains_key(&key(session_id, thread_id))
}

pub(crate) fn is_autonomous_turn_active(session_id: &str) -> bool {
    lock_monitors().iter().any(|(key, handle)| {
        key.session_id == session_id
            && handle
                .active_turn_id
                .lock()
                .map(|turn| turn.is_some())
                .unwrap_or(false)
    })
}

pub(crate) fn stop_session(session_id: &str) {
    let handles: Vec<_> = lock_monitors()
        .iter()
        .filter(|(key, _)| key.session_id == session_id)
        .map(|(_, handle)| handle.clone())
        .collect();
    for handle in handles {
        handle.stop.store(true, Ordering::SeqCst);
    }
}

pub(crate) fn stop_monitor(session_id: &str, thread_id: &str) {
    if let Some(handle) = lock_monitors().get(&key(session_id, thread_id)).cloned() {
        handle.stop.store(true, Ordering::SeqCst);
    }
}

fn remove_monitor_if_current(session_id: &str, thread_id: &str, stop: &Arc<AtomicBool>) {
    let monitor_key = key(session_id, thread_id);
    let mut monitors = lock_monitors();
    if monitors
        .get(&monitor_key)
        .is_some_and(|handle| Arc::ptr_eq(&handle.stop, stop))
    {
        monitors.remove(&monitor_key);
    }
}

pub(crate) fn start_for_session(
    app: &AppHandle,
    session_id: &str,
    worktree_id: &str,
    thread_id: &str,
) -> Result<bool, String> {
    if thread_id.trim().is_empty() {
        return Ok(false);
    }

    let monitor_key = key(session_id, thread_id);
    {
        let mut monitors = lock_monitors();
        if monitors.contains_key(&monitor_key) {
            return Ok(false);
        }

        codex_server::ensure_running(app)?;

        let stop = Arc::new(AtomicBool::new(false));
        let active_turn_id = Arc::new(Mutex::new(None));
        monitors.insert(
            monitor_key.clone(),
            MonitorHandle {
                stop: stop.clone(),
                active_turn_id: active_turn_id.clone(),
            },
        );

        let (event_tx, event_rx) = std::sync::mpsc::channel();
        let ctx = SessionContext {
            registration_id: 0,
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            event_tx,
        };
        let registration_id = codex_server::register_session(thread_id, ctx);

        let app = app.clone();
        let session_id = session_id.to_string();
        let worktree_id = worktree_id.to_string();
        let thread_id = thread_id.to_string();
        std::thread::spawn(move || {
            run_monitor(MonitorRuntime {
                app,
                session_id,
                worktree_id,
                thread_id,
                event_rx,
                registration_id,
                stop,
                active_turn_id,
            });
        });
    }

    Ok(true)
}

pub(crate) fn start_for_completed_turn(app: &AppHandle, session_id: &str) -> Result<bool, String> {
    let Some(metadata) = load_metadata(app, session_id)? else {
        return Ok(false);
    };
    if !metadata_has_active_goal(&metadata) {
        return Ok(false);
    }
    let Some(thread_id) = metadata.codex_thread_id.clone() else {
        return Ok(false);
    };
    start_for_session(app, session_id, &metadata.worktree_id, &thread_id)
}

pub(crate) fn start_for_active_goal_sessions(app: &AppHandle) -> Result<usize, String> {
    let mut started = 0;
    for session_id in list_all_session_ids(app)? {
        let Some(metadata) = load_metadata(app, &session_id)? else {
            continue;
        };
        if !metadata_has_active_goal(&metadata) || metadata_has_running_run(&metadata) {
            continue;
        }
        let Some(thread_id) = metadata.codex_thread_id.clone() else {
            continue;
        };
        if start_for_session(app, &session_id, &metadata.worktree_id, &thread_id)? {
            started += 1;
        }
    }
    Ok(started)
}

pub(crate) fn clear_goal_after_autonomous_cancel(
    app: &AppHandle,
    session_id: &str,
    worktree_id: &str,
    thread_id: &str,
) {
    if !is_autonomous_turn_active(session_id) {
        return;
    }
    stop_session(session_id);
    if let Err(error) = super::commands::persist_codex_goal(app, worktree_id, "", session_id, None)
    {
        log::warn!("Failed to clear Codex goal after autonomous cancel: {error}");
    }
    let thread_id = thread_id.to_string();
    std::thread::spawn(move || {
        let _ = codex_server::send_request(
            "thread/goal/clear",
            serde_json::json!({ "threadId": thread_id }),
        );
    });
}

fn run_monitor(runtime: MonitorRuntime) {
    let MonitorRuntime {
        app,
        session_id,
        worktree_id,
        thread_id,
        event_rx,
        registration_id,
        stop,
        active_turn_id,
    } = runtime;

    log::info!("Starting Codex goal monitor for session={session_id} thread={thread_id}");

    while !stop.load(Ordering::SeqCst) {
        let event = match event_rx.recv_timeout(Duration::from_millis(250)) {
            Ok(event) => event,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };

        match event {
            ServerEvent::Notification { method, params } if method == "turn/started" => {
                let initial_event = ServerEvent::Notification { method, params };
                if let Err(error) = run_autonomous_turn(
                    &app,
                    &session_id,
                    &worktree_id,
                    &thread_id,
                    &event_rx,
                    initial_event,
                    &active_turn_id,
                ) {
                    log::warn!(
                        "Codex goal autonomous turn failed for session {session_id}: {error}"
                    );
                }
            }
            ServerEvent::Notification { method, params: _ } if method == "thread/goal/cleared" => {
                if let Err(error) =
                    super::commands::persist_codex_goal(&app, &worktree_id, "", &session_id, None)
                {
                    log::warn!("Failed to persist monitored Codex goal clear: {error}");
                }
                stop.store(true, Ordering::SeqCst);
            }
            ServerEvent::Notification { method, params } if method == "thread/goal/updated" => {
                let goal = super::commands::extract_codex_goal_objective(&params);
                if let Err(error) =
                    super::commands::persist_codex_goal(&app, &worktree_id, "", &session_id, goal)
                {
                    log::warn!("Failed to persist monitored Codex goal update: {error}");
                }
            }
            ServerEvent::ServerDied => break,
            _ => {}
        }
    }

    codex_server::unregister_session(&thread_id, registration_id);
    remove_monitor_if_current(&session_id, &thread_id, &stop);
    log::info!("Stopped Codex goal monitor for session={session_id} thread={thread_id}");
}

fn run_autonomous_turn(
    app: &AppHandle,
    session_id: &str,
    worktree_id: &str,
    thread_id: &str,
    event_rx: &std::sync::mpsc::Receiver<ServerEvent>,
    initial_event: ServerEvent,
    active_turn_id: &Arc<Mutex<Option<String>>>,
) -> Result<(), String> {
    let metadata = load_metadata(app, session_id)?
        .ok_or_else(|| format!("Session metadata not found: {session_id}"))?;
    if !metadata_has_active_goal(&metadata) {
        return Ok(());
    }

    let latest_run = metadata.runs.last();
    let model = latest_run
        .and_then(|run| run.model.as_deref())
        .or(metadata.selected_model.as_deref());
    let effort_level = latest_run
        .and_then(|run| run.effort_level.as_deref())
        .or_else(|| {
            metadata
                .selected_effort_level
                .as_ref()
                .and_then(|e| e.effort_value())
        });
    let execution_mode = metadata.selected_execution_mode.as_deref();
    let user_message_id = Uuid::new_v4().to_string();

    let mut writer = run_log::start_run(
        app,
        session_id,
        worktree_id,
        &metadata.name,
        metadata.order,
        &user_message_id,
        "",
        model,
        execution_mode,
        None,
        effort_level,
        Some(Backend::Codex),
    )?;
    let output_file = writer.output_file_path()?;

    if let Some(turn_id) = turn_id_from_started_event(&initial_event) {
        *active_turn_id.lock().map_err(|e| e.to_string())? = Some(turn_id.clone());
        super::registry::register_codex_turn(
            session_id.to_string(),
            thread_id.to_string(),
            turn_id,
        );
    } else {
        super::registry::register_codex_turn(
            session_id.to_string(),
            thread_id.to_string(),
            String::new(),
        );
    }

    let _ = app.emit_all(
        "chat:sending",
        &serde_json::json!({
            "session_id": session_id,
            "worktree_id": worktree_id,
            "user_message": "",
        }),
    );

    let (_turn_start_tx, turn_start_rx) =
        std::sync::mpsc::channel::<Result<serde_json::Value, String>>();
    super::increment_tailer_count();
    let response = super::codex::process_turn_events(
        app,
        session_id,
        worktree_id,
        thread_id,
        &output_file,
        execution_mode == Some("plan"),
        execution_mode == Some("build"),
        &turn_start_rx,
        event_rx,
        None,
        None,
        None,
        true,
        Some(initial_event),
    );
    super::decrement_tailer_count();

    *active_turn_id.lock().map_err(|e| e.to_string())? = None;
    super::registry::unregister_codex_turn(session_id);

    let assistant_message_id = Uuid::new_v4().to_string();
    if response.error_emitted {
        writer.crash()?;
    } else if response.cancelled {
        writer.cancel(Some(&assistant_message_id), None)?;
    } else {
        writer.complete(&assistant_message_id, None, response.usage)?;
    }

    super::commands::emit_sessions_cache_invalidation(app);
    Ok(())
}

fn turn_id_from_started_event(event: &ServerEvent) -> Option<String> {
    let ServerEvent::Notification { params, .. } = event else {
        return None;
    };
    params
        .get("turn")
        .and_then(|turn| turn.get("id"))
        .and_then(|id| id.as_str())
        .map(ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    static TEST_REGISTRY_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    fn registry_test_guard() -> std::sync::MutexGuard<'static, ()> {
        TEST_REGISTRY_LOCK.lock().unwrap()
    }

    fn clear_registry() {
        lock_monitors().clear();
    }

    #[test]
    fn registry_prevents_duplicate_monitors() {
        let _guard = registry_test_guard();
        clear_registry();
        let monitor_key = key("session-1", "thread-1");
        let handle = MonitorHandle {
            stop: Arc::new(AtomicBool::new(false)),
            active_turn_id: Arc::new(Mutex::new(None)),
        };
        {
            let mut monitors = lock_monitors();
            monitors.insert(monitor_key.clone(), handle.clone());
            monitors.entry(monitor_key).or_insert(handle);
            assert_eq!(monitors.len(), 1);
        }
        clear_registry();
    }

    #[test]
    fn remove_monitor_if_current_respects_stale_handles() {
        let _guard = registry_test_guard();
        clear_registry();
        let old_stop = Arc::new(AtomicBool::new(false));
        let new_stop = Arc::new(AtomicBool::new(false));
        let monitor_key = key("session-1", "thread-1");
        lock_monitors().insert(
            monitor_key,
            MonitorHandle {
                stop: new_stop.clone(),
                active_turn_id: Arc::new(Mutex::new(None)),
            },
        );

        remove_monitor_if_current("session-1", "thread-1", &old_stop);
        assert!(is_monitoring("session-1", "thread-1"));

        remove_monitor_if_current("session-1", "thread-1", &new_stop);
        assert!(!is_monitoring("session-1", "thread-1"));
        clear_registry();
    }

    #[test]
    fn active_autonomous_turn_tracks_only_monitored_turns() {
        let _guard = registry_test_guard();
        clear_registry();
        let active_turn_id = Arc::new(Mutex::new(Some("turn-1".to_string())));
        {
            lock_monitors().insert(
                key("session-1", "thread-1"),
                MonitorHandle {
                    stop: Arc::new(AtomicBool::new(false)),
                    active_turn_id,
                },
            );
        }

        assert!(is_autonomous_turn_active("session-1"));
        assert!(!is_autonomous_turn_active("session-2"));
        clear_registry();
    }

    #[test]
    fn metadata_active_goal_requires_codex_goal_and_thread() {
        let mut metadata = SessionMetadata::new(
            "session-1".to_string(),
            "worktree-1".to_string(),
            "Session 1".to_string(),
            0,
        );
        metadata.backend = Backend::Codex;
        metadata.codex_goal = Some("Ship it".to_string());
        assert!(!metadata_has_active_goal(&metadata));

        metadata.codex_thread_id = Some("thread-1".to_string());
        assert!(metadata_has_active_goal(&metadata));

        metadata.codex_goal = None;
        assert!(!metadata_has_active_goal(&metadata));
    }

    #[test]
    fn metadata_running_run_detects_running_or_resumable() {
        let mut metadata = SessionMetadata::new(
            "session-1".to_string(),
            "worktree-1".to_string(),
            "Session 1".to_string(),
            0,
        );
        assert!(!metadata_has_running_run(&metadata));

        metadata.runs.push(super::super::types::RunEntry {
            run_id: "run-1".to_string(),
            user_message_id: "msg-1".to_string(),
            user_message: "hello".to_string(),
            model: None,
            backend: None,
            execution_mode: None,
            thinking_level: None,
            effort_level: None,
            started_at: 1,
            ended_at: None,
            status: RunStatus::Resumable,
            assistant_message_id: None,
            cancelled: false,
            recovered: false,
            claude_session_id: None,
            pid: None,
            usage: None,
        });
        assert!(metadata_has_running_run(&metadata));
    }

    #[test]
    fn started_event_extracts_turn_id() {
        let event = ServerEvent::Notification {
            method: "turn/started".to_string(),
            params: serde_json::json!({ "turn": { "id": "turn-1" } }),
        };
        assert_eq!(
            turn_id_from_started_event(&event).as_deref(),
            Some("turn-1")
        );
    }
}
