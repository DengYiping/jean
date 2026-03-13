//! Codex CLI execution engine
//!
//! Uses `codex app-server` (a persistent JSON-RPC 2.0 server over stdio) for
//! all chat interactions. Threads and turns are managed via JSON-RPC requests;
//! streamed responses arrive as notifications and are mapped to Tauri events.
//!
//! One-shot operations (commit messages, PR content, etc.) still use `codex exec`
//! directly since they don't need streaming.

use super::types::{ContentBlock, PermissionDenial, PermissionDeniedEvent, ToolCall, UsageData};
use crate::http_server::EmitExt;

use std::collections::{HashMap, HashSet};

// =============================================================================
// Response type (same shape as ClaudeResponse)
// =============================================================================

/// Response from Codex CLI execution
pub struct CodexResponse {
    /// The text response content
    pub content: String,
    /// The thread ID (for resuming conversations)
    pub thread_id: String,
    /// Tool calls made during this response
    pub tool_calls: Vec<ToolCall>,
    /// Ordered content blocks preserving tool position in response
    pub content_blocks: Vec<ContentBlock>,
    /// Whether the response was cancelled by the user
    pub cancelled: bool,
    /// Whether a chat:error event was emitted during execution
    pub error_emitted: bool,
    /// Token usage for this response
    pub usage: Option<UsageData>,
}

// =============================================================================
// Event structs (reuse same Tauri event names as Claude for frontend compat)
// =============================================================================

#[derive(serde::Serialize, Clone)]
struct ChunkEvent {
    session_id: String,
    worktree_id: String,
    content: String,
}

#[derive(serde::Serialize, Clone)]
struct ToolUseEvent {
    session_id: String,
    worktree_id: String,
    id: String,
    name: String,
    input: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent_tool_use_id: Option<String>,
}

#[derive(serde::Serialize, Clone)]
struct ToolResultEvent {
    session_id: String,
    worktree_id: String,
    tool_use_id: String,
    output: String,
}

#[derive(serde::Serialize, Clone)]
struct ToolBlockEvent {
    session_id: String,
    worktree_id: String,
    tool_call_id: String,
}

#[derive(serde::Serialize, Clone)]
struct ThinkingEvent {
    session_id: String,
    worktree_id: String,
    content: String,
}

#[derive(serde::Serialize, Clone)]
struct DoneEvent {
    session_id: String,
    worktree_id: String,
    /// True when a plan-mode run completed with content (Codex/Opencode only)
    waiting_for_plan: bool,
}

#[derive(serde::Serialize, Clone)]
struct ErrorEvent {
    session_id: String,
    worktree_id: String,
    error: String,
}

// =============================================================================
// App-server param builders
// =============================================================================

/// Build JSON-RPC params for `thread/start`.
#[allow(clippy::too_many_arguments)]
pub fn build_thread_start_params(
    working_dir: &std::path::Path,
    model: Option<&str>,
    execution_mode: Option<&str>,
    search_enabled: bool,
    instructions_file: Option<&std::path::Path>,
    multi_agent_enabled: bool,
    max_agent_threads: Option<u32>,
) -> serde_json::Value {
    let mut params = serde_json::json!({
        "cwd": working_dir.to_string_lossy(),
        "experimentalRawEvents": false,
        "persistExtendedHistory": true,
    });

    // Model (gpt-5.4-fast → model=gpt-5.4 + serviceTier=fast)
    if let Some(m) = model {
        let (actual_model, is_fast) = match m {
            "gpt-5.4-fast" => ("gpt-5.4", true),
            other => (other.strip_suffix("-fast").unwrap_or(other), false),
        };
        params["model"] = serde_json::json!(actual_model);
        if is_fast {
            params["serviceTier"] = serde_json::json!("fast");
        }
    }

    // Permission mode mapping
    match execution_mode.unwrap_or("plan") {
        "build" => {
            params["approvalPolicy"] = serde_json::json!("untrusted");
            params["sandbox"] = serde_json::json!("workspace-write");
        }
        "yolo" => {
            params["approvalPolicy"] = serde_json::json!("never");
            params["sandbox"] = serde_json::json!("danger-full-access");
        }
        // "plan" or default: read-only sandbox
        _ => {
            params["sandbox"] = serde_json::json!("read-only");
        }
    }

    // Config overrides
    let mut config = serde_json::Map::new();

    // Web search
    config.insert(
        "web_search".to_string(),
        serde_json::json!(if search_enabled { "live" } else { "disabled" }),
    );

    // Custom instructions file
    if let Some(path) = instructions_file {
        config.insert(
            "experimental_instructions_file".to_string(),
            serde_json::json!(path.to_string_lossy()),
        );
    }

    // Multi-agent
    if multi_agent_enabled {
        let mut features = serde_json::Map::new();
        features.insert("multi_agent".to_string(), serde_json::json!(true));
        config.insert("features".to_string(), serde_json::Value::Object(features));
        if let Some(threads) = max_agent_threads {
            let mut agents = serde_json::Map::new();
            agents.insert("max_threads".to_string(), serde_json::json!(threads));
            config.insert("agents".to_string(), serde_json::Value::Object(agents));
        }
    }

    if !config.is_empty() {
        params["config"] = serde_json::Value::Object(config);
    }

    params
}

/// Build JSON-RPC params for `turn/start`.
pub fn build_turn_start_params(
    thread_id: &str,
    prompt: &str,
    working_dir: &std::path::Path,
    model: Option<&str>,
    execution_mode: Option<&str>,
    reasoning_effort: Option<&str>,
    add_dirs: &[String],
) -> serde_json::Value {
    let mut params = serde_json::json!({
        "threadId": thread_id,
        "input": [{
            "type": "text",
            "text": prompt,
            "text_elements": [],
        }],
    });

    // Reasoning effort (per-turn override)
    if let Some(effort) = reasoning_effort {
        params["effort"] = serde_json::json!(effort);
    }

    let collaboration_model = model.unwrap_or("gpt-5.4");
    let mut settings = serde_json::json!({
        "model": collaboration_model,
    });
    if let Some(effort) = reasoning_effort {
        settings["reasoningEffort"] = serde_json::json!(effort);
    }
    params["collaborationMode"] = serde_json::json!({
        "mode": if execution_mode.unwrap_or("plan") == "plan" {
            "plan"
        } else {
            "default"
        },
        "settings": settings,
    });

    // Sandbox policy with writable roots (for build/yolo modes with add_dirs)
    let mode = execution_mode.unwrap_or("plan");
    if mode == "build" && !add_dirs.is_empty() {
        let mut writable_roots: Vec<serde_json::Value> =
            vec![serde_json::json!(working_dir.to_string_lossy())];
        for dir in add_dirs {
            writable_roots.push(serde_json::json!(dir));
        }
        params["sandboxPolicy"] = serde_json::json!({
            "type": "workspaceWrite",
            "writableRoots": writable_roots,
            "readOnlyAccess": { "type": "fullAccess" },
            "networkAccess": false,
            "excludeTmpdirEnvVar": false,
            "excludeSlashTmp": false,
        });
    }

    // Override cwd per turn
    params["cwd"] = serde_json::json!(working_dir.to_string_lossy());

    params
}

// =============================================================================
// Execution via app-server
// =============================================================================

/// Execute a Codex chat message via the persistent app-server.
///
/// Handles thread creation/resume, turn execution, event mapping, and approvals.
/// Returns the same CodexResponse as the old exec path for compatibility.
#[allow(clippy::too_many_arguments)]
pub fn execute_codex_via_server(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    output_file: &std::path::Path,
    working_dir: &std::path::Path,
    existing_thread_id: Option<&str>,
    model: Option<&str>,
    execution_mode: Option<&str>,
    reasoning_effort: Option<&str>,
    search_enabled: bool,
    add_dirs: &[String],
    prompt: &str,
    instructions_file: Option<&std::path::Path>,
    multi_agent_enabled: bool,
    max_agent_threads: Option<u32>,
) -> Result<CodexResponse, String> {
    use super::codex_server;

    let is_plan_mode = execution_mode.unwrap_or("plan") == "plan";
    let is_build_mode = execution_mode.unwrap_or("plan") == "build";

    // Ensure the app-server is running
    codex_server::ensure_running(app)?;

    // Start or resume thread
    // Wrapped in a closure so we can decrement USAGE_COUNT on failure
    // (ensure_running incremented it, but no session is registered yet)
    let thread_result = if let Some(tid) = existing_thread_id {
        // Resume existing thread
        let resume_params = build_thread_start_params(
            working_dir,
            model,
            execution_mode,
            search_enabled,
            instructions_file,
            multi_agent_enabled,
            max_agent_threads,
        );
        let mut full_params =
            serde_json::json!({ "threadId": tid, "persistExtendedHistory": true });
        // Copy overridable fields
        for key in &[
            "model",
            "cwd",
            "approvalPolicy",
            "sandbox",
            "config",
            "serviceTier",
        ] {
            if let Some(v) = resume_params.get(key) {
                full_params[key] = v.clone();
            }
        }
        match codex_server::send_request("thread/resume", full_params) {
            Ok(_) => Ok(tid.to_string()),
            Err(e) => {
                log::warn!("Failed to resume thread {tid}: {e}, starting new thread");
                start_new_thread(
                    working_dir,
                    model,
                    execution_mode,
                    search_enabled,
                    instructions_file,
                    multi_agent_enabled,
                    max_agent_threads,
                )
            }
        }
    } else {
        start_new_thread(
            working_dir,
            model,
            execution_mode,
            search_enabled,
            instructions_file,
            multi_agent_enabled,
            max_agent_threads,
        )
    };

    let thread_id = match thread_result {
        Ok(tid) => tid,
        Err(e) => {
            // ensure_running incremented USAGE_COUNT but no session was registered
            codex_server::decrement_usage_count();
            return Err(e);
        }
    };

    // Build turn params
    let turn_params = build_turn_start_params(
        &thread_id,
        prompt,
        working_dir,
        model,
        execution_mode,
        reasoning_effort,
        add_dirs,
    );

    // Set up event channel for this session
    let (event_tx, event_rx) = std::sync::mpsc::channel();
    let ctx = codex_server::SessionContext {
        registration_id: 0,
        session_id: session_id.to_string(),
        worktree_id: worktree_id.to_string(),
        event_tx,
    };
    let registration_id = codex_server::register_session(&thread_id, ctx);

    // Register turn for cancellation
    // We don't have the turn_id yet — register with empty, update after turn/started
    super::registry::register_codex_turn(session_id.to_string(), thread_id.clone(), String::new());

    // Start the turn in the background so we can immediately begin draining
    // server requests like approvals. The app-server is documented to return
    // `turn/start` promptly, but approval callbacks can arrive in the same
    // window and must not be blocked on the response round-trip.
    let (turn_start_tx, turn_start_rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = codex_server::send_request("turn/start", turn_params);
        let _ = turn_start_tx.send(result);
    });

    // Process events until turn completes
    super::increment_tailer_count();
    let response = process_turn_events(
        app,
        session_id,
        worktree_id,
        &thread_id,
        output_file,
        is_plan_mode,
        is_build_mode,
        &turn_start_rx,
        &event_rx,
    );
    super::decrement_tailer_count();

    // Cleanup
    codex_server::unregister_session(&thread_id, registration_id);
    super::registry::unregister_codex_turn(session_id);

    // Set the thread_id on the response
    let mut resp = response;
    if resp.thread_id.is_empty() {
        resp.thread_id = thread_id;
    }

    Ok(resp)
}

/// Start a new Codex thread via app-server.
fn start_new_thread(
    working_dir: &std::path::Path,
    model: Option<&str>,
    execution_mode: Option<&str>,
    search_enabled: bool,
    instructions_file: Option<&std::path::Path>,
    multi_agent_enabled: bool,
    max_agent_threads: Option<u32>,
) -> Result<String, String> {
    use super::codex_server;

    let params = build_thread_start_params(
        working_dir,
        model,
        execution_mode,
        search_enabled,
        instructions_file,
        multi_agent_enabled,
        max_agent_threads,
    );

    let result = codex_server::send_request("thread/start", params)?;
    let thread_id = result
        .get("thread")
        .and_then(|t| t.get("id"))
        .and_then(|v| v.as_str())
        .ok_or("thread/start response missing thread.id")?
        .to_string();

    log::info!("Started new Codex thread: {thread_id}");
    Ok(thread_id)
}

/// Process turn events from the app-server, emitting Tauri events.
#[allow(clippy::too_many_arguments)]
fn process_turn_events(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    thread_id: &str,
    output_file: &std::path::Path,
    is_plan_mode: bool,
    is_build_mode: bool,
    turn_start_rx: &std::sync::mpsc::Receiver<Result<serde_json::Value, String>>,
    event_rx: &std::sync::mpsc::Receiver<super::codex_server::ServerEvent>,
) -> CodexResponse {
    use super::codex_server::ServerEvent;
    use std::io::Write;
    use std::time::{Duration, Instant};

    let mut full_content = String::new();
    let mut response_thread_id = thread_id.to_string();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut content_blocks: Vec<ContentBlock> = Vec::new();
    let mut pending_tool_ids: HashMap<String, String> = HashMap::new();
    let mut pending_plan_texts: HashMap<String, String> = HashMap::new();
    let mut seen_plan_ids_for_history: HashSet<String> = HashSet::new();
    let mut completed = false;
    let mut cancelled = false;
    let mut error_emitted = false;
    let mut usage: Option<UsageData> = None;
    let mut turn_start_resolved = false;
    let mut last_activity = Instant::now();

    // Open output file for history
    let mut output_writer = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(output_file)
        .ok();

    loop {
        match turn_start_rx.try_recv() {
            Ok(Ok(turn_start_result)) if !turn_start_resolved => {
                turn_start_resolved = true;
                if let Some(turn_id) = turn_start_result
                    .get("turn")
                    .and_then(|turn| turn.get("id"))
                    .and_then(|v| v.as_str())
                {
                    super::registry::register_codex_turn(
                        session_id.to_string(),
                        thread_id.to_string(),
                        turn_id.to_string(),
                    );
                }
            }
            Ok(Err(e)) if !turn_start_resolved => {
                let _ = app.emit_all(
                    "chat:error",
                    &ErrorEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        error: format!("Failed to start Codex turn: {e}"),
                    },
                );
                error_emitted = true;
                break;
            }
            Err(std::sync::mpsc::TryRecvError::Disconnected) if !turn_start_resolved => {
                let _ = app.emit_all(
                    "chat:error",
                    &ErrorEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        error: "Failed to start Codex turn".to_string(),
                    },
                );
                error_emitted = true;
                break;
            }
            _ => {}
        }

        let event = match event_rx.recv_timeout(Duration::from_millis(200)) {
            Ok(e) => e,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if last_activity.elapsed() >= Duration::from_secs(300) {
                    log::warn!("Turn event timeout for session {session_id}");
                    let _ = app.emit_all(
                        "chat:error",
                        &ErrorEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            error: "Codex response timed out".to_string(),
                        },
                    );
                    error_emitted = true;
                    break;
                }
                continue;
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                log::warn!("Event channel disconnected for session {session_id}");
                cancelled = true;
                break;
            }
        };
        last_activity = Instant::now();

        match event {
            ServerEvent::Notification { method, params } => {
                // Write to output file for history replay
                if let Some(ref mut writer) = output_writer {
                    // Convert to old-format JSONL for backward-compatible history
                    if let Some(line) = notification_to_history_line(
                        &method,
                        &params,
                        &mut seen_plan_ids_for_history,
                    ) {
                        let _ = writeln!(writer, "{line}");
                    }
                }

                process_server_notification(
                    app,
                    session_id,
                    worktree_id,
                    &method,
                    &params,
                    &mut full_content,
                    &mut response_thread_id,
                    &mut tool_calls,
                    &mut content_blocks,
                    &mut pending_tool_ids,
                    &mut pending_plan_texts,
                    &mut completed,
                    &mut cancelled,
                    &mut usage,
                    &mut error_emitted,
                );

                // Update turn_id for cancellation
                if method == "turn/started" {
                    if let Some(turn_id) = params
                        .get("turn")
                        .and_then(|t| t.get("id"))
                        .and_then(|v| v.as_str())
                    {
                        super::registry::register_codex_turn(
                            session_id.to_string(),
                            thread_id.to_string(),
                            turn_id.to_string(),
                        );
                    }
                }
            }
            ServerEvent::ServerRequest { id, method, params } => {
                // Write to output file
                if let Some(ref mut writer) = output_writer {
                    let line = serde_json::json!({
                        "method": method,
                        "id": id,
                        "params": params,
                    });
                    let _ = writeln!(
                        writer,
                        "{}",
                        serde_json::to_string(&line).unwrap_or_default()
                    );
                }

                handle_approval_request(
                    app,
                    session_id,
                    worktree_id,
                    id,
                    &method,
                    &params,
                    is_build_mode,
                    &mut tool_calls,
                    &mut content_blocks,
                );
            }
            ServerEvent::ServerDied => {
                log::error!("Codex app-server died during turn for session {session_id}");
                if !error_emitted {
                    let _ = app.emit_all(
                        "chat:error",
                        &ErrorEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            error: "Codex server connection lost. Try sending your message again."
                                .to_string(),
                        },
                    );
                    error_emitted = true;
                }
                cancelled = true;
                break;
            }
        }

        if completed {
            break;
        }
    }

    // Write accumulated text to JSONL for cancelled/interrupted runs.
    // Delta events (item/agentMessage/delta) are not saved to JSONL during streaming,
    // so the text would be lost on app reload. Write a synthetic item.completed line
    // with the accumulated content so parse_codex_run_to_message() can reconstruct it.
    if (cancelled || error_emitted) && !full_content.is_empty() {
        if let Some(ref mut writer) = output_writer {
            let synthetic = serde_json::json!({
                "type": "item.completed",
                "item": {
                    "type": "agent_message",
                    "text": full_content,
                }
            });
            let _ = writeln!(
                writer,
                "{}",
                serde_json::to_string(&synthetic).unwrap_or_default()
            );
        }
    }

    // Emit chat:done unless error was emitted
    if !cancelled && !error_emitted {
        // Write result marker for crash-recovery compatibility
        // (jsonl_has_result_line() in run_log.rs checks for this)
        if let Some(ref mut writer) = output_writer {
            let _ = writeln!(writer, r#"{{"type":"result"}}"#);
        }

        let _ = app.emit_all(
            "chat:done",
            &DoneEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                waiting_for_plan: is_plan_mode
                    && tool_calls
                        .iter()
                        .any(|tool_call| tool_call.name == "ExitPlanMode"),
            },
        );
    }

    CodexResponse {
        content: full_content,
        thread_id: response_thread_id,
        tool_calls,
        content_blocks,
        cancelled,
        error_emitted,
        usage,
    }
}

/// Convert a server notification to old-format JSONL line for history compatibility.
fn notification_to_history_line(
    method: &str,
    params: &serde_json::Value,
    seen_plan_ids: &mut HashSet<String>,
) -> Option<String> {
    // Map app-server notification methods to old exec JSONL format
    let event_type = match method {
        "thread/started" => {
            let tid = params
                .get("thread")
                .and_then(|t| t.get("id"))
                .and_then(|v| v.as_str())?;
            let line = serde_json::json!({
                "type": "thread.started",
                "thread_id": tid,
            });
            return serde_json::to_string(&line).ok();
        }
        "turn/started" => "turn.started",
        "turn/completed" => {
            // Map turn completion with usage data
            let turn = params.get("turn")?;
            let status = turn
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("completed");
            if status == "failed" {
                let error = turn
                    .get("error")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let line = serde_json::json!({
                    "type": "turn.failed",
                    "error": error,
                });
                return serde_json::to_string(&line).ok();
            }
            let line = serde_json::json!({ "type": "turn.completed" });
            return serde_json::to_string(&line).ok();
        }
        "item/started" => {
            let item = params.get("item")?;
            let normalized = normalize_item_types(item);
            let line = serde_json::json!({ "type": "item.started", "item": normalized });
            return serde_json::to_string(&line).ok();
        }
        "item/completed" => {
            let item = params.get("item")?;
            let normalized = normalize_item_types(item);
            let line = serde_json::json!({ "type": "item.completed", "item": normalized });
            return serde_json::to_string(&line).ok();
        }
        "item/updated" => {
            let item = params.get("item")?;
            let normalized = normalize_item_types(item);
            let line = serde_json::json!({ "type": "item.updated", "item": normalized });
            return serde_json::to_string(&line).ok();
        }
        "item/agentMessage/delta" => {
            // Delta events don't have a direct old-format equivalent; skip for history
            return None;
        }
        "turn/plan/updated" => {
            let item = synthetic_todo_list_item_from_plan_update(params)?;
            let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let event_type = if seen_plan_ids.insert(item_id.to_string()) {
                "item.started"
            } else {
                "item.updated"
            };
            let line = serde_json::json!({ "type": event_type, "item": item });
            return serde_json::to_string(&line).ok();
        }
        _ => return None,
    };

    let line = serde_json::json!({ "type": event_type });
    serde_json::to_string(&line).ok()
}

/// Process a server notification, emitting Tauri events.
///
/// Maps app-server v2 notification methods to the same Tauri events
/// used by the old exec JSONL path.
#[allow(clippy::too_many_arguments)]
fn process_server_notification(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    method: &str,
    params: &serde_json::Value,
    full_content: &mut String,
    thread_id: &mut String,
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    pending_tool_ids: &mut HashMap<String, String>,
    pending_plan_texts: &mut HashMap<String, String>,
    completed: &mut bool,
    cancelled: &mut bool,
    usage: &mut Option<UsageData>,
    error_emitted: &mut bool,
) {
    log::trace!("[codex-server] Notification: {method} for session {session_id}");

    match method {
        "thread/started" => {
            if let Some(tid) = params
                .get("thread")
                .and_then(|t| t.get("id"))
                .and_then(|v| v.as_str())
            {
                *thread_id = tid.to_string();
                log::trace!("Codex thread started: {tid}");
            }
        }
        "item/agentMessage/delta" => {
            // Streaming text delta — emit immediately
            if let Some(delta) = params.get("delta").and_then(|v| v.as_str()) {
                if !delta.is_empty() {
                    full_content.push_str(delta);
                    let _ = app.emit_all(
                        "chat:chunk",
                        &ChunkEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            content: delta.to_string(),
                        },
                    );
                }
            }
        }
        "item/started" => {
            let item = params.get("item").unwrap_or(&serde_json::Value::Null);
            // Map camelCase item types to our event processing
            // App-server uses camelCase: commandExecution, fileChange, mcpToolCall, etc.
            let event_item = normalize_item_types(item);
            let event_type = "item.started";
            let event_msg = serde_json::json!({ "type": event_type, "item": event_item });
            process_codex_event(
                app,
                session_id,
                worktree_id,
                &event_msg,
                event_type,
                full_content,
                thread_id,
                tool_calls,
                content_blocks,
                pending_tool_ids,
                pending_plan_texts,
                completed,
                usage,
                error_emitted,
            );
        }
        "item/completed" => {
            let item = params.get("item").unwrap_or(&serde_json::Value::Null);
            let event_item = normalize_item_types(item);
            let event_type = "item.completed";
            let event_msg = serde_json::json!({ "type": event_type, "item": event_item });
            process_codex_event(
                app,
                session_id,
                worktree_id,
                &event_msg,
                event_type,
                full_content,
                thread_id,
                tool_calls,
                content_blocks,
                pending_tool_ids,
                pending_plan_texts,
                completed,
                usage,
                error_emitted,
            );
        }
        "item/updated" => {
            let item = params.get("item").unwrap_or(&serde_json::Value::Null);
            let event_item = normalize_item_types(item);
            let event_type = "item.updated";
            let event_msg = serde_json::json!({ "type": event_type, "item": event_item });
            process_codex_event(
                app,
                session_id,
                worktree_id,
                &event_msg,
                event_type,
                full_content,
                thread_id,
                tool_calls,
                content_blocks,
                pending_tool_ids,
                pending_plan_texts,
                completed,
                usage,
                error_emitted,
            );
        }
        "item/plan/delta" => {
            let item_id = params.get("itemId").and_then(|v| v.as_str()).unwrap_or("");
            let delta = params.get("delta").and_then(|v| v.as_str()).unwrap_or("");
            if !delta.is_empty() && !item_id.is_empty() {
                let plan = pending_plan_texts.entry(item_id.to_string()).or_default();
                plan.push_str(delta);
            }
        }
        "turn/plan/updated" => {
            if let Some(item) = synthetic_todo_list_item_from_plan_update(params) {
                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let event_type = if pending_tool_ids.contains_key(item_id) {
                    "item.updated"
                } else {
                    "item.started"
                };
                let event_msg = serde_json::json!({ "type": event_type, "item": item });
                process_codex_event(
                    app,
                    session_id,
                    worktree_id,
                    &event_msg,
                    event_type,
                    full_content,
                    thread_id,
                    tool_calls,
                    content_blocks,
                    pending_tool_ids,
                    pending_plan_texts,
                    completed,
                    usage,
                    error_emitted,
                );
            }
        }
        "item/commandExecution/outputDelta" | "item/fileChange/outputDelta" => {
            // Streaming tool output — we could stream this but for now
            // we let item/completed handle it with the final aggregated output
        }
        "turn/completed" => {
            // Extract usage from the turn object
            if let Some(turn) = params.get("turn") {
                let status = turn
                    .get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("completed");
                if status == "failed" {
                    let error_msg = turn
                        .get("error")
                        .and_then(|e| e.get("message"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("Unknown Codex error");
                    let user_error = format_codex_user_error(error_msg);
                    let _ = app.emit_all(
                        "chat:error",
                        &ErrorEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            error: user_error,
                        },
                    );
                    *error_emitted = true;
                } else if status == "interrupted" {
                    // Turn was interrupted (cancelled by user).
                    // Mark cancelled so chat:done is NOT emitted — the registry
                    // already emitted chat:cancelled for immediate frontend response.
                    log::trace!("Turn interrupted for session {session_id}");
                    *cancelled = true;
                }
            }
            *completed = true;
            log::trace!("Codex turn completed for session: {session_id}");
        }
        "thread/tokenUsage/updated" => {
            if let Some(token_usage) = params.get("tokenUsage") {
                // Parse nested total/last breakdown (Codex app-server v2 protocol)
                let parse_breakdown =
                    |obj: &serde_json::Value| -> super::types::TokenUsageBreakdown {
                        super::types::TokenUsageBreakdown {
                            total_tokens: obj
                                .get("totalTokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            input_tokens: obj
                                .get("inputTokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            cached_input_tokens: obj
                                .get("cachedInputTokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            output_tokens: obj
                                .get("outputTokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                            reasoning_output_tokens: obj
                                .get("reasoningOutputTokens")
                                .and_then(|v| v.as_u64())
                                .unwrap_or(0),
                        }
                    };

                let total_breakdown = token_usage
                    .get("total")
                    .map(parse_breakdown)
                    .unwrap_or_default();
                let last_breakdown = token_usage
                    .get("last")
                    .map(parse_breakdown)
                    .unwrap_or_default();
                let model_context_window = token_usage
                    .get("modelContextWindow")
                    .and_then(|v| v.as_i64());

                // Populate per-message UsageData from the last-turn breakdown
                *usage = Some(UsageData {
                    input_tokens: last_breakdown.input_tokens,
                    output_tokens: last_breakdown.output_tokens,
                    cache_read_input_tokens: last_breakdown.cached_input_tokens,
                    cache_creation_input_tokens: 0,
                });

                // Emit thread-level token usage for context meter UI
                let thread_usage = super::types::ThreadTokenUsage {
                    total: total_breakdown,
                    last: last_breakdown,
                    model_context_window,
                };
                let _ = app.emit_all(
                    "chat:thread_token_usage",
                    &super::types::ThreadTokenUsageEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        thread_token_usage: thread_usage,
                    },
                );
            }
        }
        "item/reasoning/textDelta" | "item/reasoning/summaryTextDelta" => {
            // Streaming reasoning/thinking text
            if let Some(delta) = params.get("delta").and_then(|v| v.as_str()) {
                if !delta.is_empty() {
                    let _ = app.emit_all(
                        "chat:thinking",
                        &ThinkingEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            content: delta.to_string(),
                        },
                    );
                }
            }
        }
        "error" => {
            let error_msg = params
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown Codex error");
            let user_error = format_codex_user_error(error_msg);
            let _ = app.emit_all(
                "chat:error",
                &ErrorEvent {
                    session_id: session_id.to_string(),
                    worktree_id: worktree_id.to_string(),
                    error: user_error,
                },
            );
            *error_emitted = true;
            let will_retry = params
                .get("willRetry")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !will_retry {
                *completed = true;
            }
        }
        _ => {
            log::trace!("Unhandled app-server notification: {method}");
        }
    }
}

fn synthetic_todo_list_item_from_plan_update(
    params: &serde_json::Value,
) -> Option<serde_json::Value> {
    let plan = params.get("plan").unwrap_or(params);
    let item_id = plan
        .get("id")
        .or_else(|| params.get("planId"))
        .or_else(|| params.get("id"))
        .and_then(|v| v.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or("__codex_plan__");

    let items = if let Some(items) = plan.get("items").and_then(|v| v.as_array()) {
        items
    } else if let Some(steps) = plan.get("steps").and_then(|v| v.as_array()) {
        steps
    } else if let Some(items) = params.get("items").and_then(|v| v.as_array()) {
        items
    } else if let Some(steps) = params.get("steps").and_then(|v| v.as_array()) {
        steps
    } else if let Some(plan_array) = plan.as_array() {
        plan_array
    } else if let Some(params_array) = params.as_array() {
        params_array
    } else {
        return None;
    };

    let normalized_items: Vec<serde_json::Value> = items
        .iter()
        .filter_map(normalize_plan_step_to_todo_item)
        .collect();

    Some(serde_json::json!({
        "id": item_id,
        "type": "todo_list",
        "items": normalized_items,
    }))
}

fn normalize_plan_step_to_todo_item(step: &serde_json::Value) -> Option<serde_json::Value> {
    let text = step
        .get("text")
        .or_else(|| step.get("content"))
        .or_else(|| step.get("step"))
        .or_else(|| step.get("title"))
        .and_then(|v| v.as_str())?
        .trim()
        .to_string();

    if text.is_empty() {
        return None;
    }

    let status = match step
        .get("status")
        .or_else(|| step.get("state"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
    {
        "completed" => "completed",
        "in_progress" | "inProgress" | "active" => "in_progress",
        "cancelled" | "canceled" => "cancelled",
        _ if step
            .get("completed")
            .and_then(|v| v.as_bool())
            .unwrap_or(false) =>
        {
            "completed"
        }
        _ => "pending",
    };

    let completed = status == "completed";
    let active_form = step
        .get("activeForm")
        .or_else(|| step.get("active_form"))
        .and_then(|v| v.as_str())
        .filter(|value| !value.is_empty())
        .unwrap_or(&text);

    Some(serde_json::json!({
        "text": text,
        "status": status,
        "activeForm": active_form,
        "completed": completed,
    }))
}

/// Normalize app-server camelCase item types to snake_case for backward compatibility
/// with the existing process_codex_event function.
fn normalize_item_types(item: &serde_json::Value) -> serde_json::Value {
    let mut item = item.clone();
    if let Some(obj) = item.as_object_mut() {
        if let Some(item_type) = obj.get("type").and_then(|v| v.as_str()) {
            let normalized = match item_type {
                "commandExecution" => "command_execution",
                "fileChange" => "file_change",
                "mcpToolCall" => "mcp_tool_call",
                "agentMessage" => "agent_message",
                "collabAgentToolCall" => "collab_tool_call",
                "todoList" => "todo_list",
                "webSearch" => "web_search",
                "imageGeneration" => "image_generation",
                "imageView" => "image_view",
                "contextCompaction" => "context_compaction",
                other => other,
            };
            obj.insert("type".to_string(), serde_json::json!(normalized));
        }
        // Also normalize nested field names for command_execution
        if let Some(output) = obj.remove("aggregatedOutput") {
            obj.insert("aggregated_output".to_string(), output);
        }
        if let Some(sender_thread_id) = obj.remove("senderThreadId") {
            obj.insert("sender_thread_id".to_string(), sender_thread_id);
        }
        if let Some(receiver_thread_ids) = obj.remove("receiverThreadIds") {
            obj.insert("receiver_thread_ids".to_string(), receiver_thread_ids);
        }
        if let Some(states) = obj.remove("agentsStates") {
            obj.insert("agents_states".to_string(), states);
        }
    }
    item
}

fn collab_tool_display_name(collab_tool: &str) -> &str {
    match collab_tool {
        "spawn_agent" | "spawnAgent" => "SpawnAgent",
        "send_input" | "sendInput" => "SendInput",
        "wait" => "WaitForAgents",
        "close_agent" | "closeAgent" => "CloseAgent",
        "resume_agent" | "resumeAgent" => "ResumeAgent",
        _ => collab_tool,
    }
}

fn normalize_history_request_questions(questions: &[serde_json::Value]) -> serde_json::Value {
    serde_json::Value::Array(
        questions
            .iter()
            .map(|question| {
                let mut question = question.clone();
                if let Some(obj) = question.as_object_mut() {
                    obj.entry("multiSelect".to_string())
                        .or_insert(serde_json::Value::Bool(false));
                    if !obj.contains_key("options") || obj["options"].is_null() {
                        obj.insert("options".to_string(), serde_json::Value::Array(Vec::new()));
                    }
                }
                question
            })
            .collect(),
    )
}

fn upsert_history_tool_call(
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    pending_tool_ids: &mut HashMap<String, String>,
    item_id: &str,
    tool_name: &str,
    input: serde_json::Value,
) {
    let tool_id = if let Some(existing) = pending_tool_ids.get(item_id) {
        existing.clone()
    } else if item_id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        item_id.to_string()
    };

    if let Some(existing_tool) = tool_calls.iter_mut().find(|tool| tool.id == tool_id) {
        existing_tool.name = tool_name.to_string();
        existing_tool.input = input;
    } else {
        tool_calls.push(ToolCall {
            id: tool_id.clone(),
            name: tool_name.to_string(),
            input,
            output: None,
            parent_tool_use_id: None,
        });
        content_blocks.push(ContentBlock::ToolUse {
            tool_call_id: tool_id.clone(),
        });
        if !item_id.is_empty() {
            pending_tool_ids.insert(item_id.to_string(), tool_id);
        }
    }
}

/// Handle an approval request from the app-server.
#[allow(clippy::too_many_arguments)]
fn handle_approval_request(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    rpc_id: u64,
    method: &str,
    params: &serde_json::Value,
    is_build_mode: bool,
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
) {
    match method {
        "item/fileChange/requestApproval" => {
            // Auto-accept file changes in build mode
            if is_build_mode {
                log::trace!("Auto-accepting file change (rpc_id={rpc_id})");
                if let Err(e) = super::codex_server::send_response(
                    rpc_id,
                    serde_json::json!({"decision": "accept"}),
                ) {
                    log::error!("Failed to auto-accept file change: {e}");
                }
            } else {
                // In non-build modes, also auto-accept (read-only sandbox prevents actual changes)
                let _ = super::codex_server::send_response(
                    rpc_id,
                    serde_json::json!({"decision": "accept"}),
                );
            }
        }
        "item/commandExecution/requestApproval" => {
            // Emit permission denied event for the frontend
            let command = params
                .get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let item_id = params
                .get("itemId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            log::trace!("Command approval requested (rpc_id={rpc_id}): {command}");

            let denial = PermissionDenial {
                tool_name: "Bash".to_string(),
                tool_use_id: item_id,
                tool_input: serde_json::json!({ "command": command }),
                rpc_id: Some(rpc_id),
            };
            let _ = app.emit_all(
                "chat:permission_denied",
                &PermissionDeniedEvent {
                    session_id: session_id.to_string(),
                    worktree_id: worktree_id.to_string(),
                    denials: vec![denial],
                },
            );
            // Response will come from approve_codex_command Tauri command
        }
        "item/tool/requestUserInput" => {
            let item_id = params
                .get("itemId")
                .and_then(|v| v.as_str())
                .filter(|value| !value.is_empty())
                .map(ToString::to_string)
                .unwrap_or_else(|| format!("codex-request-user-input-{rpc_id}"));
            let mut input = serde_json::json!({
                "questions": params
                    .get("questions")
                    .cloned()
                    .unwrap_or(serde_json::Value::Array(Vec::new())),
                "rpcId": rpc_id,
            });
            if let Some(questions) = input.get_mut("questions").and_then(|v| v.as_array_mut()) {
                for question in questions {
                    if let Some(obj) = question.as_object_mut() {
                        obj.entry("multiSelect".to_string())
                            .or_insert(serde_json::Value::Bool(false));
                        if !obj.contains_key("options") || obj["options"].is_null() {
                            obj.insert("options".to_string(), serde_json::Value::Array(Vec::new()));
                        }
                    }
                }
            }

            if let Some(existing_tool) = tool_calls.iter_mut().find(|tool| tool.id == item_id) {
                existing_tool.name = "AskUserQuestion".to_string();
                existing_tool.input = input.clone();
            } else {
                tool_calls.push(ToolCall {
                    id: item_id.clone(),
                    name: "AskUserQuestion".to_string(),
                    input: input.clone(),
                    output: None,
                    parent_tool_use_id: None,
                });
                content_blocks.push(ContentBlock::ToolUse {
                    tool_call_id: item_id.clone(),
                });
                let _ = app.emit_all(
                    "chat:tool_block",
                    &ToolBlockEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        tool_call_id: item_id.clone(),
                    },
                );
            }

            let _ = app.emit_all(
                "chat:tool_use",
                &ToolUseEvent {
                    session_id: session_id.to_string(),
                    worktree_id: worktree_id.to_string(),
                    id: item_id,
                    name: "AskUserQuestion".to_string(),
                    input,
                    parent_tool_use_id: None,
                },
            );
        }
        _ => {
            log::debug!("Unknown approval request method: {method}");
            // Auto-accept unknown approvals to avoid blocking
            let _ = super::codex_server::send_response(
                rpc_id,
                serde_json::json!({"decision": "accept"}),
            );
        }
    }
}

/// Extract an error message from a Codex JSON value, handling both formats:
/// - String format: `{"error": "message"}`
/// - Object format: `{"error": {"message": "..."}}`
fn extract_codex_error_message(msg: &serde_json::Value) -> Option<String> {
    let error = msg.get("error")?;
    // Try string format first
    if let Some(s) = error.as_str() {
        return Some(s.to_string());
    }
    // Try object format: {"error": {"message": "..."}}
    if let Some(s) = error.get("message").and_then(|v| v.as_str()) {
        return Some(s.to_string());
    }
    // Error field exists but in unknown format — stringify it
    Some(error.to_string())
}

/// Format a raw Codex error message into a user-friendly string.
/// Handles auth/session errors with specific guidance.
fn format_codex_user_error(error_msg: &str) -> String {
    if error_msg.contains("refresh_token_invalidated")
        || error_msg.contains("refresh token has been invalidated")
    {
        "Your Codex login session has expired. Please sign in again in Settings > General."
            .to_string()
    } else if error_msg.contains("401 Unauthorized")
        || error_msg.contains("invalidated oauth token")
    {
        "Codex authentication failed. Please sign in again in Settings > General.".to_string()
    } else {
        format!("Codex error: {error_msg}")
    }
}

#[allow(clippy::too_many_arguments)]
fn upsert_codex_plan_tool(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    item_id: &str,
    plan_text: String,
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    pending_tool_ids: &mut HashMap<String, String>,
) {
    let tool_id = if let Some(existing) = pending_tool_ids.get(item_id) {
        existing.clone()
    } else if item_id.is_empty() {
        uuid::Uuid::new_v4().to_string()
    } else {
        item_id.to_string()
    };
    let tool_input = serde_json::json!({ "plan": plan_text });

    if let Some(existing_tool) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
        existing_tool.name = "ExitPlanMode".to_string();
        existing_tool.input = tool_input.clone();
    } else {
        tool_calls.push(ToolCall {
            id: tool_id.clone(),
            name: "ExitPlanMode".to_string(),
            input: tool_input.clone(),
            output: None,
            parent_tool_use_id: None,
        });
        content_blocks.push(ContentBlock::ToolUse {
            tool_call_id: tool_id.clone(),
        });
        if !item_id.is_empty() {
            pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
        }
        let _ = app.emit_all(
            "chat:tool_block",
            &ToolBlockEvent {
                session_id: session_id.to_string(),
                worktree_id: worktree_id.to_string(),
                tool_call_id: tool_id.clone(),
            },
        );
    }

    let _ = app.emit_all(
        "chat:tool_use",
        &ToolUseEvent {
            session_id: session_id.to_string(),
            worktree_id: worktree_id.to_string(),
            id: tool_id,
            name: "ExitPlanMode".to_string(),
            input: tool_input,
            parent_tool_use_id: None,
        },
    );
}

/// Process a single Codex JSONL event. Shared between attached and detached tailers.
#[allow(clippy::too_many_arguments)]
fn process_codex_event(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    msg: &serde_json::Value,
    event_type: &str,
    full_content: &mut String,
    thread_id: &mut String,
    tool_calls: &mut Vec<ToolCall>,
    content_blocks: &mut Vec<ContentBlock>,
    pending_tool_ids: &mut HashMap<String, String>,
    pending_plan_texts: &mut HashMap<String, String>,
    completed: &mut bool,
    usage: &mut Option<UsageData>,
    error_emitted: &mut bool,
) {
    match event_type {
        "thread.started" => {
            if let Some(tid) = msg.get("thread_id").and_then(|v| v.as_str()) {
                *thread_id = tid.to_string();
                log::trace!("Codex thread started: {tid}");
            }
        }
        "item.started" => {
            let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
            let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

            match item_type {
                "command_execution" => {
                    let command = item.get("command").and_then(|v| v.as_str()).unwrap_or("");
                    let tool_id = if item_id.is_empty() {
                        uuid::Uuid::new_v4().to_string()
                    } else {
                        item_id.to_string()
                    };
                    tool_calls.push(ToolCall {
                        id: tool_id.clone(),
                        name: "Bash".to_string(),
                        input: serde_json::json!({ "command": command }),
                        output: None,
                        parent_tool_use_id: None,
                    });
                    content_blocks.push(ContentBlock::ToolUse {
                        tool_call_id: tool_id.clone(),
                    });
                    if !item_id.is_empty() {
                        pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
                    }
                    let _ = app.emit_all(
                        "chat:tool_use",
                        &ToolUseEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            id: tool_id.clone(),
                            name: "Bash".to_string(),
                            input: serde_json::json!({ "command": command }),
                            parent_tool_use_id: None,
                        },
                    );
                    let _ = app.emit_all(
                        "chat:tool_block",
                        &ToolBlockEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            tool_call_id: tool_id,
                        },
                    );
                }
                "file_change" => {
                    let tool_id = if item_id.is_empty() {
                        uuid::Uuid::new_v4().to_string()
                    } else {
                        item_id.to_string()
                    };
                    let changes = item
                        .get("changes")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    tool_calls.push(ToolCall {
                        id: tool_id.clone(),
                        name: "FileChange".to_string(),
                        input: changes.clone(),
                        output: None,
                        parent_tool_use_id: None,
                    });
                    content_blocks.push(ContentBlock::ToolUse {
                        tool_call_id: tool_id.clone(),
                    });
                    if !item_id.is_empty() {
                        pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
                    }
                    let _ = app.emit_all(
                        "chat:tool_use",
                        &ToolUseEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            id: tool_id.clone(),
                            name: "FileChange".to_string(),
                            input: changes,
                            parent_tool_use_id: None,
                        },
                    );
                    let _ = app.emit_all(
                        "chat:tool_block",
                        &ToolBlockEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            tool_call_id: tool_id,
                        },
                    );
                }
                "plan" => {
                    let initial_plan = item
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    if !item_id.is_empty() && !initial_plan.is_empty() {
                        pending_plan_texts.insert(item_id.to_string(), initial_plan.clone());
                    }
                    if !initial_plan.is_empty() {
                        upsert_codex_plan_tool(
                            app,
                            session_id,
                            worktree_id,
                            item_id,
                            initial_plan,
                            tool_calls,
                            content_blocks,
                            pending_tool_ids,
                        );
                    }
                }
                "mcp_tool_call" => {
                    let server = item
                        .get("server")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let tool = item
                        .get("tool")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let arguments = item
                        .get("arguments")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                    let tool_id = if item_id.is_empty() {
                        uuid::Uuid::new_v4().to_string()
                    } else {
                        item_id.to_string()
                    };
                    let name = format!("mcp:{server}:{tool}");
                    tool_calls.push(ToolCall {
                        id: tool_id.clone(),
                        name: name.clone(),
                        input: arguments.clone(),
                        output: None,
                        parent_tool_use_id: None,
                    });
                    content_blocks.push(ContentBlock::ToolUse {
                        tool_call_id: tool_id.clone(),
                    });
                    if !item_id.is_empty() {
                        pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
                    }
                    let _ = app.emit_all(
                        "chat:tool_use",
                        &ToolUseEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            id: tool_id.clone(),
                            name,
                            input: arguments,
                            parent_tool_use_id: None,
                        },
                    );
                    let _ = app.emit_all(
                        "chat:tool_block",
                        &ToolBlockEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            tool_call_id: tool_id,
                        },
                    );
                }
                "collab_tool_call" => {
                    let collab_tool = item
                        .get("tool")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown");
                    let tool_name = collab_tool_display_name(collab_tool);
                    let tool_id = if item_id.is_empty() {
                        uuid::Uuid::new_v4().to_string()
                    } else {
                        item_id.to_string()
                    };
                    let input = item.clone();
                    tool_calls.push(ToolCall {
                        id: tool_id.clone(),
                        name: tool_name.to_string(),
                        input: input.clone(),
                        output: None,
                        parent_tool_use_id: None,
                    });
                    content_blocks.push(ContentBlock::ToolUse {
                        tool_call_id: tool_id.clone(),
                    });
                    if !item_id.is_empty() {
                        pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
                    }
                    let _ = app.emit_all(
                        "chat:tool_use",
                        &ToolUseEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            id: tool_id.clone(),
                            name: tool_name.to_string(),
                            input,
                            parent_tool_use_id: None,
                        },
                    );
                    let _ = app.emit_all(
                        "chat:tool_block",
                        &ToolBlockEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            tool_call_id: tool_id,
                        },
                    );
                }
                "todo_list" => {
                    let tool_id = if item_id.is_empty() {
                        uuid::Uuid::new_v4().to_string()
                    } else {
                        item_id.to_string()
                    };
                    let input = item.clone();
                    tool_calls.push(ToolCall {
                        id: tool_id.clone(),
                        name: "CodexTodoList".to_string(),
                        input: input.clone(),
                        output: None,
                        parent_tool_use_id: None,
                    });
                    content_blocks.push(ContentBlock::ToolUse {
                        tool_call_id: tool_id.clone(),
                    });
                    if !item_id.is_empty() {
                        pending_tool_ids.insert(item_id.to_string(), tool_id.clone());
                    }
                    let _ = app.emit_all(
                        "chat:tool_use",
                        &ToolUseEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            id: tool_id.clone(),
                            name: "CodexTodoList".to_string(),
                            input,
                            parent_tool_use_id: None,
                        },
                    );
                    let _ = app.emit_all(
                        "chat:tool_block",
                        &ToolBlockEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            tool_call_id: tool_id,
                        },
                    );
                }
                other => {
                    log::debug!("Unknown Codex item.started type: {other}");
                }
            }
        }
        "item.completed" => {
            let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
            let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

            match item_type {
                "agent_message" => {
                    // Streaming deltas (item/agentMessage/delta) already emitted
                    // chat:chunk events and accumulated text in full_content.
                    // Only push the content block here for the final CodexResponse.
                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                        if !text.is_empty() {
                            content_blocks.push(ContentBlock::Text {
                                text: text.to_string(),
                            });
                            // If no deltas were received (edge case), full_content
                            // would be missing this text — emit chunk as fallback.
                            if !full_content.contains(text) {
                                full_content.push_str(text);
                                let _ = app.emit_all(
                                    "chat:chunk",
                                    &ChunkEvent {
                                        session_id: session_id.to_string(),
                                        worktree_id: worktree_id.to_string(),
                                        content: text.to_string(),
                                    },
                                );
                            }
                        }
                    }
                }
                "command_execution" => {
                    let output = item
                        .get("aggregated_output")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                    if !tool_id.is_empty() {
                        if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                            tc.output = Some(output.clone());
                        }
                        let _ = app.emit_all(
                            "chat:tool_result",
                            &ToolResultEvent {
                                session_id: session_id.to_string(),
                                worktree_id: worktree_id.to_string(),
                                tool_use_id: tool_id,
                                output,
                            },
                        );
                    }
                }
                "file_change" => {
                    let changes = item
                        .get("changes")
                        .map(|v| serde_json::to_string(v).unwrap_or_default())
                        .unwrap_or_default();
                    let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                    if !tool_id.is_empty() {
                        if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                            tc.output = Some(changes.clone());
                        }
                        let _ = app.emit_all(
                            "chat:tool_result",
                            &ToolResultEvent {
                                session_id: session_id.to_string(),
                                worktree_id: worktree_id.to_string(),
                                tool_use_id: tool_id,
                                output: changes,
                            },
                        );
                    }
                }
                "reasoning" => {
                    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                        content_blocks.push(ContentBlock::Thinking {
                            thinking: text.to_string(),
                        });
                        let _ = app.emit_all(
                            "chat:thinking",
                            &ThinkingEvent {
                                session_id: session_id.to_string(),
                                worktree_id: worktree_id.to_string(),
                                content: text.to_string(),
                            },
                        );
                    }
                }
                "plan" => {
                    let item_text = item
                        .get("text")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let final_plan = if item_text.is_empty() && !item_id.is_empty() {
                        pending_plan_texts.remove(item_id).unwrap_or_default()
                    } else {
                        if !item_id.is_empty() {
                            pending_plan_texts.remove(item_id);
                        }
                        item_text
                    };
                    if !final_plan.is_empty() {
                        upsert_codex_plan_tool(
                            app,
                            session_id,
                            worktree_id,
                            item_id,
                            final_plan,
                            tool_calls,
                            content_blocks,
                            pending_tool_ids,
                        );
                    }
                }
                "mcp_tool_call" => {
                    let output = item
                        .get("output")
                        .map(|v| {
                            if let Some(s) = v.as_str() {
                                s.to_string()
                            } else {
                                serde_json::to_string(v).unwrap_or_default()
                            }
                        })
                        .unwrap_or_default();
                    let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                    if !tool_id.is_empty() {
                        if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                            tc.output = Some(output.clone());
                        }
                        let _ = app.emit_all(
                            "chat:tool_result",
                            &ToolResultEvent {
                                session_id: session_id.to_string(),
                                worktree_id: worktree_id.to_string(),
                                tool_use_id: tool_id,
                                output,
                            },
                        );
                    }
                }
                "collab_tool_call" => {
                    let output = if let Some(states) = item.get("agents_states") {
                        if let Some(obj) = states.as_object() {
                            let parts: Vec<String> = obj
                                .iter()
                                .map(|(tid, state)| {
                                    let status = state
                                        .get("status")
                                        .and_then(|v| v.as_str())
                                        .unwrap_or("unknown");
                                    let msg =
                                        state.get("message").and_then(|v| v.as_str()).unwrap_or("");
                                    if msg.is_empty() {
                                        format!("{tid}: {status}")
                                    } else {
                                        format!("{tid}: {status} — {msg}")
                                    }
                                })
                                .collect();
                            if parts.is_empty() {
                                item.get("status")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("completed")
                                    .to_string()
                            } else {
                                parts.join("\n")
                            }
                        } else {
                            "completed".to_string()
                        }
                    } else {
                        item.get("status")
                            .and_then(|v| v.as_str())
                            .unwrap_or("completed")
                            .to_string()
                    };
                    let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                    if !tool_id.is_empty() {
                        let tool_name = item
                            .get("tool")
                            .and_then(|v| v.as_str())
                            .map(collab_tool_display_name)
                            .unwrap_or("SpawnAgent");
                        if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                            tc.output = Some(output.clone());
                            tc.input = item.clone();
                        }
                        let _ = app.emit_all(
                            "chat:tool_use",
                            &ToolUseEvent {
                                session_id: session_id.to_string(),
                                worktree_id: worktree_id.to_string(),
                                id: tool_id.clone(),
                                name: tool_name.to_string(),
                                input: item.clone(),
                                parent_tool_use_id: None,
                            },
                        );
                        let _ = app.emit_all(
                            "chat:tool_result",
                            &ToolResultEvent {
                                session_id: session_id.to_string(),
                                worktree_id: worktree_id.to_string(),
                                tool_use_id: tool_id,
                                output,
                            },
                        );
                    }
                }
                other => {
                    log::debug!("Unknown Codex item.completed type: {other}");
                }
            }
        }
        // item.updated refreshes tool inputs in-place for todo/plan state and
        // evolving collab state without waiting for the final message.
        "item.updated" => {
            let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
            let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
            let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

            if let Some(tool_id) = pending_tool_ids.get(item_id) {
                let tool_name = match item_type {
                    "plan" => Some("ExitPlanMode".to_string()),
                    "todo_list" => Some("CodexTodoList".to_string()),
                    "collab_tool_call" => item
                        .get("tool")
                        .and_then(|v| v.as_str())
                        .map(collab_tool_display_name)
                        .map(ToString::to_string),
                    _ => None,
                };

                if let Some(tool_name) = tool_name {
                    let updated_input = item.clone();
                    if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == *tool_id) {
                        tc.input = updated_input.clone();
                    }
                    let _ = app.emit_all(
                        "chat:tool_use",
                        &ToolUseEvent {
                            session_id: session_id.to_string(),
                            worktree_id: worktree_id.to_string(),
                            id: tool_id.clone(),
                            name: tool_name,
                            input: updated_input,
                            parent_tool_use_id: None,
                        },
                    );
                }
            }
        }
        "turn.completed" => {
            if let Some(usage_obj) = msg.get("usage") {
                *usage = Some(UsageData {
                    input_tokens: usage_obj
                        .get("input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    output_tokens: usage_obj
                        .get("output_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    cache_read_input_tokens: usage_obj
                        .get("cached_input_tokens")
                        .and_then(|v| v.as_u64())
                        .unwrap_or(0),
                    cache_creation_input_tokens: 0,
                });
            }
            *completed = true;
            log::trace!("Codex turn completed for session: {session_id}");
        }
        "turn.failed" => {
            let error_msg = extract_codex_error_message(msg)
                .unwrap_or_else(|| "Unknown Codex error".to_string());
            let user_error = format_codex_user_error(&error_msg);
            let _ = app.emit_all(
                "chat:error",
                &ErrorEvent {
                    session_id: session_id.to_string(),
                    worktree_id: worktree_id.to_string(),
                    error: user_error,
                },
            );
            *completed = true;
            *error_emitted = true;
            log::error!("Codex turn failed for session {session_id}: {error_msg}");
        }
        _ => {
            // Check for unrecognized JSON with error fields (e.g., API error responses)
            if let Some(error_msg) = extract_codex_error_message(msg) {
                let user_error = format_codex_user_error(&error_msg);
                log::error!(
                    "Codex error (unrecognized event) for session {session_id}: {error_msg}"
                );
                let _ = app.emit_all(
                    "chat:error",
                    &ErrorEvent {
                        session_id: session_id.to_string(),
                        worktree_id: worktree_id.to_string(),
                        error: user_error,
                    },
                );
                *completed = true;
                *error_emitted = true;
            } else {
                log::trace!("Unknown Codex event type: {event_type}");
            }
        }
    }
}

// =============================================================================
// JSONL history parser (for loading saved sessions)
// =============================================================================

/// Parse stored Codex JSONL into a ChatMessage (for loading history).
///
/// Maps Codex events to the same ChatMessage format used by Claude sessions.
pub fn parse_codex_run_to_message(
    lines: &[String],
    run: &super::types::RunEntry,
) -> Result<super::types::ChatMessage, String> {
    use super::types::{ChatMessage, MessageRole};
    use uuid::Uuid;

    let mut content = String::new();
    let mut tool_calls: Vec<ToolCall> = Vec::new();
    let mut content_blocks: Vec<ContentBlock> = Vec::new();
    let mut pending_tool_ids: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let mut pending_plan_texts: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for line in lines {
        if line.trim().is_empty() {
            continue;
        }

        let msg: serde_json::Value = match serde_json::from_str(line) {
            Ok(m) => m,
            Err(_) => continue,
        };

        if msg
            .get("_run_meta")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            continue;
        }

        if let Some(method) = msg.get("method").and_then(|v| v.as_str()) {
            if method == "item/tool/requestUserInput" {
                let params = msg.get("params").unwrap_or(&serde_json::Value::Null);
                let item_id = params
                    .get("itemId")
                    .and_then(|v| v.as_str())
                    .filter(|value| !value.is_empty())
                    .unwrap_or("");
                let rpc_id = msg.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
                let questions = params
                    .get("questions")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();
                let input = serde_json::json!({
                    "questions": normalize_history_request_questions(&questions),
                    "rpcId": rpc_id,
                });
                upsert_history_tool_call(
                    &mut tool_calls,
                    &mut content_blocks,
                    &mut pending_tool_ids,
                    item_id,
                    "AskUserQuestion",
                    input,
                );
                continue;
            }
        }

        let event_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

        match event_type {
            "item.started" => {
                let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

                match item_type {
                    "command_execution" => {
                        let command = item.get("command").and_then(|v| v.as_str()).unwrap_or("");
                        let tool_id = if item_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            item_id.to_string()
                        };

                        tool_calls.push(ToolCall {
                            id: tool_id.clone(),
                            name: "Bash".to_string(),
                            input: serde_json::json!({ "command": command }),
                            output: None,
                            parent_tool_use_id: None,
                        });
                        content_blocks.push(ContentBlock::ToolUse {
                            tool_call_id: tool_id.clone(),
                        });
                        if !item_id.is_empty() {
                            pending_tool_ids.insert(item_id.to_string(), tool_id);
                        }
                    }
                    "file_change" => {
                        let changes = item
                            .get("changes")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let tool_id = if item_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            item_id.to_string()
                        };

                        tool_calls.push(ToolCall {
                            id: tool_id.clone(),
                            name: "FileChange".to_string(),
                            input: changes,
                            output: None,
                            parent_tool_use_id: None,
                        });
                        content_blocks.push(ContentBlock::ToolUse {
                            tool_call_id: tool_id.clone(),
                        });
                        if !item_id.is_empty() {
                            pending_tool_ids.insert(item_id.to_string(), tool_id);
                        }
                    }
                    "plan" => {
                        let plan_text = item
                            .get("text")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        if !item_id.is_empty() && !plan_text.is_empty() {
                            pending_plan_texts.insert(item_id.to_string(), plan_text.clone());
                        }
                        if !plan_text.is_empty() {
                            upsert_history_tool_call(
                                &mut tool_calls,
                                &mut content_blocks,
                                &mut pending_tool_ids,
                                item_id,
                                "ExitPlanMode",
                                serde_json::json!({ "plan": plan_text }),
                            );
                        }
                    }
                    "mcp_tool_call" => {
                        let server = item
                            .get("server")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let tool = item
                            .get("tool")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let arguments = item
                            .get("arguments")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        let tool_id = if item_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            item_id.to_string()
                        };

                        tool_calls.push(ToolCall {
                            id: tool_id.clone(),
                            name: format!("mcp:{server}:{tool}"),
                            input: arguments,
                            output: None,
                            parent_tool_use_id: None,
                        });
                        content_blocks.push(ContentBlock::ToolUse {
                            tool_call_id: tool_id.clone(),
                        });
                        if !item_id.is_empty() {
                            pending_tool_ids.insert(item_id.to_string(), tool_id);
                        }
                    }
                    // Multi-agent collab tools (history)
                    "collab_tool_call" => {
                        let collab_tool = item
                            .get("tool")
                            .and_then(|v| v.as_str())
                            .unwrap_or("unknown");
                        let tool_name = collab_tool_display_name(collab_tool);
                        let tool_id = if item_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            item_id.to_string()
                        };
                        tool_calls.push(ToolCall {
                            id: tool_id.clone(),
                            name: tool_name.to_string(),
                            input: item.clone(),
                            output: None,
                            parent_tool_use_id: None,
                        });
                        content_blocks.push(ContentBlock::ToolUse {
                            tool_call_id: tool_id.clone(),
                        });
                        if !item_id.is_empty() {
                            pending_tool_ids.insert(item_id.to_string(), tool_id);
                        }
                    }
                    // Codex todo/plan list (history)
                    "todo_list" => {
                        let tool_id = if item_id.is_empty() {
                            Uuid::new_v4().to_string()
                        } else {
                            item_id.to_string()
                        };
                        tool_calls.push(ToolCall {
                            id: tool_id.clone(),
                            name: "CodexTodoList".to_string(),
                            input: item.clone(),
                            output: None,
                            parent_tool_use_id: None,
                        });
                        content_blocks.push(ContentBlock::ToolUse {
                            tool_call_id: tool_id.clone(),
                        });
                        if !item_id.is_empty() {
                            pending_tool_ids.insert(item_id.to_string(), tool_id);
                        }
                    }
                    _ => {}
                }
            }
            "item.completed" => {
                let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

                match item_type {
                    "agent_message" => {
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            content.push_str(text);
                            content_blocks.push(ContentBlock::Text {
                                text: text.to_string(),
                            });
                        }
                    }
                    "command_execution" => {
                        let output = item
                            .get("aggregated_output")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                        if !tool_id.is_empty() {
                            if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                tc.output = Some(output);
                            }
                        }
                    }
                    "file_change" => {
                        let changes = item
                            .get("changes")
                            .map(|v| serde_json::to_string(v).unwrap_or_default())
                            .unwrap_or_default();
                        let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                        if !tool_id.is_empty() {
                            if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                tc.output = Some(changes);
                            }
                        }
                    }
                    "reasoning" => {
                        if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                            content_blocks.push(ContentBlock::Thinking {
                                thinking: text.to_string(),
                            });
                        }
                    }
                    "plan" => {
                        let item_text = item
                            .get("text")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .to_string();
                        let plan_text = if item_text.is_empty() && !item_id.is_empty() {
                            pending_plan_texts.remove(item_id).unwrap_or_default()
                        } else {
                            if !item_id.is_empty() {
                                pending_plan_texts.remove(item_id);
                            }
                            item_text
                        };
                        if !plan_text.is_empty() {
                            upsert_history_tool_call(
                                &mut tool_calls,
                                &mut content_blocks,
                                &mut pending_tool_ids,
                                item_id,
                                "ExitPlanMode",
                                serde_json::json!({ "plan": plan_text }),
                            );
                        }
                    }
                    "mcp_tool_call" => {
                        let output = item
                            .get("output")
                            .map(|v| {
                                if let Some(s) = v.as_str() {
                                    s.to_string()
                                } else {
                                    serde_json::to_string(v).unwrap_or_default()
                                }
                            })
                            .unwrap_or_default();
                        let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                        if !tool_id.is_empty() {
                            if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                tc.output = Some(output);
                            }
                        }
                    }
                    // Multi-agent collab tool completions (history)
                    "collab_tool_call" => {
                        let output = if let Some(states) = item.get("agents_states") {
                            if let Some(obj) = states.as_object() {
                                let parts: Vec<String> = obj
                                    .iter()
                                    .map(|(tid, state)| {
                                        let status = state
                                            .get("status")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown");
                                        let msg = state
                                            .get("message")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("");
                                        if msg.is_empty() {
                                            format!("{tid}: {status}")
                                        } else {
                                            format!("{tid}: {status} — {msg}")
                                        }
                                    })
                                    .collect();
                                if parts.is_empty() {
                                    "completed".to_string()
                                } else {
                                    parts.join("\n")
                                }
                            } else {
                                "completed".to_string()
                            }
                        } else {
                            "completed".to_string()
                        };
                        let tool_id = pending_tool_ids.remove(item_id).unwrap_or_default();
                        if !tool_id.is_empty() {
                            if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == tool_id) {
                                tc.output = Some(output);
                                tc.input = item.clone();
                            }
                        }
                    }
                    _ => {}
                }
            }
            // item.updated refreshes todo/collab inputs in-place for history
            // replay too.
            "item.updated" => {
                let item = msg.get("item").unwrap_or(&serde_json::Value::Null);
                let item_type = item.get("type").and_then(|v| v.as_str()).unwrap_or("");
                let item_id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");

                if item_type == "plan" {
                    if let Some(plan_text) = item.get("text").and_then(|v| v.as_str()) {
                        upsert_history_tool_call(
                            &mut tool_calls,
                            &mut content_blocks,
                            &mut pending_tool_ids,
                            item_id,
                            "ExitPlanMode",
                            serde_json::json!({ "plan": plan_text }),
                        );
                    }
                } else if item_type == "todo_list" || item_type == "collab_tool_call" {
                    if let Some(tool_id) = pending_tool_ids.get(item_id) {
                        if let Some(tc) = tool_calls.iter_mut().find(|t| t.id == *tool_id) {
                            tc.input = item.clone();
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(ChatMessage {
        id: run
            .assistant_message_id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        session_id: String::new(), // Set by caller
        role: MessageRole::Assistant,
        content,
        timestamp: run.started_at,
        tool_calls,
        content_blocks,
        cancelled: run.cancelled,
        plan_approved: false,
        model: None,
        execution_mode: None,
        thinking_level: None,
        effort_level: None,
        recovered: run.recovered,
        usage: run.usage.clone(),
    })
}

// =============================================================================
// One-shot Codex execution (for magic prompts with --output-schema)
// =============================================================================

/// Execute a one-shot Codex CLI call with `--output-schema` for structured JSON output.
///
/// Equivalent to Claude's `--json-schema` pattern but for Codex:
///   `codex exec --json --model <model> --full-auto --output-schema <schema> -`
///
/// Returns the raw JSON string of the structured output.
pub fn execute_one_shot_codex(
    app: &tauri::AppHandle,
    prompt: &str,
    model: &str,
    output_schema: &str,
    working_dir: Option<&std::path::Path>,
    reasoning_effort: Option<&str>,
) -> Result<String, String> {
    let cli_path = crate::codex_cli::resolve_cli_binary(app);

    if !cli_path.exists() {
        return Err("Codex CLI not installed".to_string());
    }

    log::info!(
        "Executing one-shot Codex CLI: model={model}, working_dir={:?}, reasoning_effort={:?}",
        working_dir,
        reasoning_effort
    );

    // Write schema to a temp file since --output-schema expects a file path
    let schema_file =
        std::env::temp_dir().join(format!("jean-codex-schema-{}.json", std::process::id()));
    std::fs::write(&schema_file, output_schema)
        .map_err(|e| format!("Failed to write schema file: {e}"))?;

    let mut cmd = crate::platform::silent_command(&cli_path);
    cmd.args([
        "exec",
        "--json",
        "--model",
        model,
        "--full-auto",
        "--output-schema",
    ]);
    cmd.arg(&schema_file);
    if let Some(dir) = working_dir {
        cmd.arg("--cd");
        cmd.arg(dir);
    } else {
        // One-shot calls that don't know a repository path should still run.
        cmd.arg("--skip-git-repo-check");
    }
    cmd.arg("-"); // Read prompt from stdin
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    if let Some(dir) = working_dir {
        cmd.current_dir(dir);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Failed to spawn Codex CLI: {e}"))?;

    // Write prompt to stdin
    if let Some(mut stdin) = child.stdin.take() {
        use std::io::Write;
        let _ = stdin.write_all(prompt.as_bytes());
        // stdin is dropped here, closing the pipe
    }

    log::debug!("Codex CLI one-shot spawned, waiting for output (timeout: 120s)...");

    // Wait with timeout to avoid hanging indefinitely (e.g. MCP server connection issues)
    let timeout = std::time::Duration::from_secs(120);
    let start = std::time::Instant::now();
    let output = loop {
        match child.try_wait() {
            Ok(Some(_status)) => {
                // Process exited — collect output
                break child
                    .wait_with_output()
                    .map_err(|e| format!("Failed to collect Codex CLI output: {e}"))?;
            }
            Ok(None) => {
                // Still running
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err(
                        "Codex CLI timed out after 120s. This often happens when an MCP server \
                         is stuck connecting. Check your Codex MCP server configuration."
                            .to_string(),
                    );
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => {
                return Err(format!("Failed to check Codex CLI status: {e}"));
            }
        }
    };

    log::debug!(
        "Codex CLI one-shot completed in {:.1}s, exit: {}",
        start.elapsed().as_secs_f64(),
        output.status
    );

    // Clean up temp schema file
    let _ = std::fs::remove_file(&schema_file);

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);

        // Full details for developer logs
        log::warn!(
            "Codex CLI one-shot failed (exit {}): stderr={}, stdout={}",
            output.status,
            stderr.trim(),
            stdout.trim()
        );

        // User-facing error: detect common patterns and provide actionable hints
        let user_msg = if stderr.contains("AuthRequired") || stderr.contains("invalid_token") {
            "Codex CLI failed: an MCP server requires authentication. \
                 Check your Codex MCP server configuration."
                .to_string()
        } else {
            let trimmed = stderr.trim();
            if trimmed.len() > 200 {
                let end = trimmed
                    .char_indices()
                    .nth(200)
                    .map(|(i, _)| i)
                    .unwrap_or(trimmed.len());
                format!(
                    "Codex CLI failed (exit {}): {}…",
                    output.status,
                    &trimmed[..end]
                )
            } else if trimmed.is_empty() {
                format!("Codex CLI failed (exit {})", output.status)
            } else {
                format!("Codex CLI failed (exit {}): {trimmed}", output.status)
            }
        };

        return Err(user_msg);
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    log::trace!("Codex one-shot stdout length: {} bytes", stdout.len());

    extract_codex_structured_output(&stdout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gpt_5_4_fast_enables_fast_service_tier() {
        let params = build_thread_start_params(
            std::path::Path::new("/tmp"),
            Some("gpt-5.4-fast"),
            Some("plan"),
            false,
            None,
            false,
            None,
        );
        assert_eq!(params["model"], "gpt-5.4");
        assert_eq!(params["serviceTier"], "fast");
    }

    #[test]
    fn deprecated_fast_models_do_not_enable_fast_service_tier() {
        let params = build_thread_start_params(
            std::path::Path::new("/tmp"),
            Some("gpt-5.3-fast"),
            Some("plan"),
            false,
            None,
            false,
            None,
        );
        assert_eq!(params["model"], "gpt-5.3");
        assert!(params.get("serviceTier").is_none());
    }

    #[test]
    fn plan_turns_set_collaboration_mode() {
        let params = build_turn_start_params(
            "thread-1",
            "Plan this",
            std::path::Path::new("/tmp"),
            Some("gpt-5.4-fast"),
            Some("plan"),
            Some("medium"),
            &[],
        );

        assert_eq!(params["collaborationMode"]["mode"], "plan");
        assert_eq!(
            params["collaborationMode"]["settings"]["model"],
            "gpt-5.4-fast"
        );
        assert_eq!(
            params["collaborationMode"]["settings"]["reasoningEffort"],
            "medium"
        );
    }

    #[test]
    fn non_plan_turns_reset_to_default_collaboration_mode() {
        let params = build_turn_start_params(
            "thread-1",
            "Build this",
            std::path::Path::new("/tmp"),
            Some("gpt-5.4"),
            Some("build"),
            Some("medium"),
            &[],
        );

        assert_eq!(params["collaborationMode"]["mode"], "default");
        assert_eq!(params["collaborationMode"]["settings"]["model"], "gpt-5.4");
        assert_eq!(
            params["collaborationMode"]["settings"]["reasoningEffort"],
            "medium"
        );
    }

    #[test]
    fn turn_plan_updated_is_persisted_as_started_then_updated() {
        let params = serde_json::json!({
            "plan": {
                "id": "plan-1",
                "steps": [
                    { "step": "Inspect bridge", "status": "completed" },
                    {
                        "step": "Patch widget",
                        "status": "in_progress",
                        "activeForm": "Patching widget"
                    }
                ]
            }
        });
        let mut seen_plan_ids = HashSet::new();

        let first = notification_to_history_line("turn/plan/updated", &params, &mut seen_plan_ids)
            .expect("first plan update should persist");
        let second = notification_to_history_line("turn/plan/updated", &params, &mut seen_plan_ids)
            .expect("second plan update should persist");

        let first: serde_json::Value = serde_json::from_str(&first).unwrap();
        let second: serde_json::Value = serde_json::from_str(&second).unwrap();

        assert_eq!(first["type"], "item.started");
        assert_eq!(second["type"], "item.updated");
        assert_eq!(first["item"]["type"], "todo_list");
        assert_eq!(first["item"]["items"][0]["text"], "Inspect bridge");
        assert_eq!(first["item"]["items"][0]["completed"], true);
        assert_eq!(first["item"]["items"][1]["status"], "in_progress");
        assert_eq!(first["item"]["items"][1]["activeForm"], "Patching widget");
    }

    #[test]
    fn plan_updates_without_ids_fall_back_to_stable_synthetic_id() {
        let params = serde_json::json!({
            "steps": [{ "text": "Run tests", "completed": false }]
        });

        let item = synthetic_todo_list_item_from_plan_update(&params)
            .expect("plan update should normalize");

        assert_eq!(item["id"], "__codex_plan__");
        assert_eq!(item["type"], "todo_list");
        assert_eq!(item["items"][0]["text"], "Run tests");
        assert_eq!(item["items"][0]["status"], "pending");
    }

    #[test]
    fn parse_codex_run_restores_plan_tools_from_history() {
        let run = crate::chat::types::RunEntry {
            run_id: "run-1".to_string(),
            started_at: 1,
            ended_at: Some(2),
            status: crate::chat::types::RunStatus::Completed,
            user_message_id: "user-1".to_string(),
            assistant_message_id: Some("assistant-1".to_string()),
            user_message: "Plan this".to_string(),
            model: None,
            execution_mode: Some("plan".to_string()),
            thinking_level: None,
            effort_level: None,
            claude_session_id: None,
            pid: None,
            cancelled: false,
            recovered: false,
            usage: None,
        };

        let lines = vec![
            serde_json::json!({
                "type": "item.started",
                "item": { "type": "plan", "id": "plan-1", "text": "" }
            })
            .to_string(),
            serde_json::json!({
                "type": "item.completed",
                "item": { "type": "plan", "id": "plan-1", "text": "# Plan\n- one\n" }
            })
            .to_string(),
        ];

        let message = parse_codex_run_to_message(&lines, &run).expect("message should parse");
        let plan_tool = message
            .tool_calls
            .iter()
            .find(|tool| tool.name == "ExitPlanMode")
            .expect("plan tool should be restored");

        assert_eq!(plan_tool.input["plan"], "# Plan\n- one\n");
    }

    #[test]
    fn parse_codex_run_restores_request_user_input_tools_from_history() {
        let run = crate::chat::types::RunEntry {
            run_id: "run-2".to_string(),
            started_at: 1,
            ended_at: Some(2),
            status: crate::chat::types::RunStatus::Completed,
            user_message_id: "user-2".to_string(),
            assistant_message_id: Some("assistant-2".to_string()),
            user_message: "Question".to_string(),
            model: None,
            execution_mode: Some("plan".to_string()),
            thinking_level: None,
            effort_level: None,
            claude_session_id: None,
            pid: None,
            cancelled: false,
            recovered: false,
            usage: None,
        };

        let lines = vec![serde_json::json!({
            "jsonrpc": "2.0",
            "method": "item/tool/requestUserInput",
            "id": 42,
            "params": {
                "threadId": "thread-1",
                "turnId": "turn-1",
                "itemId": "question-1",
                "questions": [{
                    "id": "q1",
                    "header": "Scope",
                    "question": "Choose one",
                    "isOther": false,
                    "isSecret": false,
                    "options": [{ "label": "A", "description": "opt A" }]
                }]
            }
        })
        .to_string()];

        let message = parse_codex_run_to_message(&lines, &run).expect("message should parse");
        let question_tool = message
            .tool_calls
            .iter()
            .find(|tool| tool.name == "AskUserQuestion")
            .expect("question tool should be restored");

        assert_eq!(question_tool.id, "question-1");
        assert_eq!(question_tool.input["rpcId"], 42);
        assert_eq!(question_tool.input["questions"][0]["id"], "q1");
    }
}

/// Parse Codex NDJSON output to extract structured JSON from --output-schema response.
///
/// Codex emits newline-delimited JSON events. We look for the structured output
/// in several possible locations:
/// - `item.completed` with type `agent_message` containing JSON text
/// - `turn.completed` with an `output` field
fn extract_codex_structured_output(output: &str) -> Result<String, String> {
    let mut last_agent_message = None;

    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parsed: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event_type = parsed.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            "item.completed" => {
                // Check for agent_message with text content
                if let Some(item) = parsed.get("item") {
                    let item_type = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
                    if item_type == "agent_message" {
                        if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                            last_agent_message = Some(text.to_string());
                        }
                        // Also check content array
                        if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                            for block in content {
                                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                        last_agent_message = Some(text.to_string());
                                    }
                                }
                                // Check for output_text type (structured output)
                                if block.get("type").and_then(|t| t.as_str()) == Some("output_text")
                                {
                                    if let Some(text) = block.get("text").and_then(|t| t.as_str()) {
                                        // Try to parse as JSON — if it works, it's our structured output
                                        if serde_json::from_str::<serde_json::Value>(text).is_ok() {
                                            return Ok(text.to_string());
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
            "turn.completed" => {
                // Check for output field directly
                if let Some(output_val) = parsed.get("output") {
                    if !output_val.is_null() {
                        return Ok(output_val.to_string());
                    }
                }
            }
            _ => {}
        }
    }

    // Fall back to last agent message if it parses as JSON
    if let Some(msg) = last_agent_message {
        if serde_json::from_str::<serde_json::Value>(&msg).is_ok() {
            return Ok(msg);
        }
    }

    Err("No structured output found in Codex response".to_string())
}
