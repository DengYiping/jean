pub mod auth;
pub mod dispatch;
pub mod server;
pub mod websocket;

use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::broadcast;

/// Global monotonic sequence counter for event replay.
static EVENT_SEQ: AtomicU64 = AtomicU64::new(1);

/// Maximum events buffered per session for replay.
const SESSION_BUFFER_CAP: usize = 2000;

/// Maximum events buffered per terminal for replay on reconnect.
/// Terminals can stream high-volume output; cap protects memory.
const TERMINAL_BUFFER_CAP: usize = 4000;

/// Maximum serialized bytes buffered per terminal for replay on reconnect.
const TERMINAL_BUFFER_MAX_BYTES: usize = 4 * 1024 * 1024;

type SessionReplayBufferMap = HashMap<String, VecDeque<(u64, Arc<str>)>>;
type TerminalReplayBufferMap = HashMap<String, TerminalReplayBuffer>;

#[derive(Default)]
struct TerminalReplayBuffer {
    events: VecDeque<(u64, Arc<str>)>,
    bytes: usize,
}

/// Events that are worth buffering for replay on reconnect.
const REPLAYABLE_EVENTS: &[&str] = &[
    "chat:sending",
    "chat:chunk",
    "chat:tool_use",
    "chat:tool_block",
    "chat:tool_result",
    "chat:thinking",
    "chat:permission_denied",
    "chat:codex_command_approval_request",
    "chat:codex_permission_request",
    "chat:codex_user_input_request",
    "chat:codex_mcp_elicitation_request",
    "chat:codex_dynamic_tool_call_request",
    "chat:done",
    "chat:cancelled",
    "chat:error",
];

/// Terminal events buffered for replay on reconnect.
/// Keyed by `terminal_id` field in payload.
const TERMINAL_REPLAYABLE_EVENTS: &[&str] = &["terminal:output", "terminal:started"];

/// Broadcast channel for sending events to all connected WebSocket clients.
/// Managed as Tauri state so any code with an AppHandle can broadcast.
pub struct WsBroadcaster {
    tx: broadcast::Sender<WsEvent>,
    /// Number of running HTTP servers. When zero, `broadcast` is a no-op so
    /// native-only use skips serialization and replay buffering. A count (not a
    /// flag) keeps a restart safe when the old server finishes shutting down
    /// after the new one started.
    running_servers: AtomicUsize,
    /// Per-session ring buffer for event replay on WebSocket reconnect.
    /// Key: session_id extracted from the event payload.
    session_buffers: Mutex<SessionReplayBufferMap>,
    /// Per-terminal ring buffer for terminal event replay on reconnect.
    /// Key: terminal_id extracted from the event payload.
    terminal_buffers: Mutex<TerminalReplayBufferMap>,
}

/// A pre-serialized WebSocket event.
/// The JSON string is wrapped in `Arc<str>` so cloning across N broadcast
/// receivers is a cheap reference-count increment instead of N allocations.
#[derive(Clone, Debug)]
pub struct WsEvent {
    pub json: Arc<str>,
    /// Monotonic sequence number for replay ordering.
    pub seq: u64,
}

/// Wire-format envelope serialized once in `broadcast()`.
#[derive(Serialize)]
struct WsEnvelope<'a, S: Serialize> {
    #[serde(rename = "type")]
    msg_type: &'static str,
    event: &'a str,
    payload: &'a S,
    /// Monotonic sequence number for replay ordering.
    seq: u64,
}

impl WsBroadcaster {
    pub fn new() -> (Self, broadcast::Sender<WsEvent>) {
        // Buffer 8192 events — generous headroom for burst streaming with
        // multiple clients. Each WsEvent is ~16 bytes (Arc pointer + len).
        let (tx, _) = broadcast::channel(8192);
        let tx_clone = tx.clone();
        (
            Self {
                tx,
                running_servers: AtomicUsize::new(0),
                session_buffers: Mutex::new(HashMap::new()),
                terminal_buffers: Mutex::new(HashMap::new()),
            },
            tx_clone,
        )
    }

    /// Serialize the payload once into the wire-format JSON envelope.
    /// Each broadcast receiver gets an `Arc<str>` clone (cheap ref-count
    /// increment) instead of re-serializing per client.
    pub fn broadcast<S: Serialize>(&self, event: &str, payload: &S) {
        if self.running_servers.load(Ordering::Relaxed) == 0 {
            return;
        }
        let seq = EVENT_SEQ.fetch_add(1, Ordering::Relaxed);
        let envelope = WsEnvelope {
            msg_type: "event",
            event,
            payload,
            seq,
        };
        let json = match serde_json::to_string(&envelope) {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed to serialize WS event '{event}': {e}");
                return;
            }
        };

        let is_session_event = REPLAYABLE_EVENTS.contains(&event);
        let is_terminal_event =
            TERMINAL_REPLAYABLE_EVENTS.contains(&event) || event == "terminal:stopped";
        let ids = if is_session_event || is_terminal_event {
            serde_json::to_value(payload).ok()
        } else {
            None
        };
        let json_arc: Arc<str> = Arc::from(json);
        let id_field = |key: &str| {
            ids.as_ref()
                .and_then(|val| val.get(key))
                .and_then(|v| v.as_str())
                .map(str::to_string)
        };

        if ids.is_some() {
            if let Some(sid) = id_field("session_id").filter(|_| is_session_event) {
                if let Ok(mut buffers) = self.session_buffers.lock() {
                    // Clean up session buffer on chat:done or chat:cancelled
                    if event == "chat:done" || event == "chat:cancelled" {
                        buffers.remove(&sid);
                    } else {
                        let buf = buffers
                            .entry(sid)
                            .or_insert_with(|| VecDeque::with_capacity(SESSION_BUFFER_CAP));
                        if buf.len() >= SESSION_BUFFER_CAP {
                            buf.pop_front();
                        }
                        buf.push_back((seq, json_arc.clone()));
                    }
                }
            }

            if let Some(tid) = id_field("terminal_id").filter(|_| is_terminal_event) {
                if let Ok(mut buffers) = self.terminal_buffers.lock() {
                    // Drop terminal buffer on terminal:stopped — no further output expected
                    if event == "terminal:stopped" {
                        buffers.remove(&tid);
                    } else {
                        let buf = buffers.entry(tid).or_default();
                        buf.bytes += json_arc.len();
                        buf.events.push_back((seq, json_arc.clone()));
                        while buf.events.len() > TERMINAL_BUFFER_CAP
                            || (buf.bytes > TERMINAL_BUFFER_MAX_BYTES && buf.events.len() > 1)
                        {
                            if let Some((_, dropped)) = buf.events.pop_front() {
                                buf.bytes -= dropped.len();
                            }
                        }
                    }
                }
            }
        }

        // Ignore send errors (no active receivers is fine)
        let _ = self.tx.send(WsEvent {
            json: json_arc,
            seq,
        });
    }

    /// Enable broadcasting and replay buffering while the HTTP server runs.
    pub fn server_started(&self) {
        self.running_servers.fetch_add(1, Ordering::Relaxed);
    }

    /// Disable broadcasting and release replay buffers.
    pub fn server_stopped(&self) {
        let previous = self
            .running_servers
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                Some(n.saturating_sub(1))
            })
            .unwrap_or(0);
        if previous > 1 {
            return;
        }
        if let Ok(mut buffers) = self.session_buffers.lock() {
            buffers.clear();
        }
        if let Ok(mut buffers) = self.terminal_buffers.lock() {
            buffers.clear();
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<WsEvent> {
        self.tx.subscribe()
    }

    /// Replay buffered events for a session after the given sequence number.
    /// Returns events in order, each with its sequence number and pre-serialized JSON.
    pub fn replay_events(&self, session_id: &str, after_seq: u64) -> Vec<(u64, Arc<str>)> {
        let buffers = match self.session_buffers.lock() {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        match buffers.get(session_id) {
            Some(buf) => buf
                .iter()
                .filter(|(seq, _)| *seq > after_seq)
                .cloned()
                .collect(),
            None => Vec::new(),
        }
    }

    /// Replay buffered terminal events after the given sequence number.
    pub fn replay_terminal_events(
        &self,
        terminal_id: &str,
        after_seq: u64,
    ) -> Vec<(u64, Arc<str>)> {
        let buffers = match self.terminal_buffers.lock() {
            Ok(b) => b,
            Err(_) => return Vec::new(),
        };
        match buffers.get(terminal_id) {
            Some(buf) => buf
                .events
                .iter()
                .filter(|(seq, _)| *seq > after_seq)
                .cloned()
                .collect(),
            None => Vec::new(),
        }
    }
}

/// Extension trait on AppHandle that sends to both Tauri IPC and WebSocket clients.
/// Use `app.emit_all("event", &payload)` instead of `app.emit("event", &payload)`.
pub trait EmitExt {
    fn emit_all<S: Serialize + Clone>(&self, event: &str, payload: &S) -> Result<(), String>;
}

impl EmitExt for AppHandle {
    fn emit_all<S: Serialize + Clone>(&self, event: &str, payload: &S) -> Result<(), String> {
        // Send to Tauri frontend (native app)
        self.emit(event, payload.clone())
            .map_err(|e| format!("Tauri emit failed: {e}"))?;

        // Broadcast to WebSocket clients (if server is running).
        // Serializes directly from &S → JSON in one pass (no intermediate Value).
        if let Some(ws) = self.try_state::<WsBroadcaster>() {
            ws.broadcast(event, payload);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::WsBroadcaster;
    use serde_json::json;

    fn terminal_chunk(i: usize) -> serde_json::Value {
        json!({
            "terminal_id": "term-1",
            "data": format!("\u{1b}[32mline {i}\u{1b}[0m ").repeat(200),
        })
    }

    /// Run with: cargo test --release --lib bench_broadcast -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_broadcast_terminal_output() {
        for (label, server_running) in [("no server", false), ("server running", true)] {
            let (broadcaster, _) = WsBroadcaster::new();
            if server_running {
                broadcaster.server_started();
            }
            let events: Vec<_> = (0..20_000).map(terminal_chunk).collect();
            let start = std::time::Instant::now();
            for event in &events {
                broadcaster.broadcast("terminal:output", event);
            }
            let per_event = start.elapsed() / events.len() as u32;
            let retained: usize = broadcaster
                .replay_terminal_events("term-1", 0)
                .iter()
                .map(|(_, json)| json.len())
                .sum();
            eprintln!(
                "[bench] broadcast terminal:output ({label}): {per_event:?}/event, retained {:.1} MB",
                retained as f64 / 1_048_576.0
            );
        }
    }

    #[test]
    fn skips_serialization_and_buffering_when_server_not_running() {
        let (broadcaster, _) = WsBroadcaster::new();
        broadcaster.broadcast("terminal:output", &terminal_chunk(0));
        broadcaster.broadcast(
            "chat:chunk",
            &json!({ "session_id": "s-1", "content": "hi" }),
        );

        assert!(broadcaster.replay_terminal_events("term-1", 0).is_empty());
        assert!(broadcaster.replay_events("s-1", 0).is_empty());
    }

    #[test]
    fn keeps_broadcasting_when_old_server_stops_after_restart() {
        let (broadcaster, _) = WsBroadcaster::new();
        broadcaster.server_started(); // old server
        broadcaster.server_started(); // new server started before old one finished
        broadcaster.server_stopped(); // old server shutdown completes

        broadcaster.broadcast("terminal:output", &terminal_chunk(0));
        assert_eq!(broadcaster.replay_terminal_events("term-1", 0).len(), 1);

        broadcaster.server_stopped();
        assert!(broadcaster.replay_terminal_events("term-1", 0).is_empty());
    }

    #[test]
    fn replays_terminal_events_after_sequence() {
        let (broadcaster, _) = WsBroadcaster::new();
        broadcaster.server_started();

        broadcaster.broadcast("terminal:started", &json!({ "terminal_id": "term-1" }));
        broadcaster.broadcast(
            "terminal:output",
            &json!({ "terminal_id": "term-1", "data": "first" }),
        );
        broadcaster.broadcast(
            "terminal:output",
            &json!({ "terminal_id": "term-1", "data": "second" }),
        );

        let replay = broadcaster.replay_terminal_events("term-1", 0);
        assert_eq!(replay.len(), 3);

        let after_started_seq = replay[0].0;
        let missed = broadcaster.replay_terminal_events("term-1", after_started_seq);
        assert_eq!(missed.len(), 2);
        assert!(missed.iter().all(|(seq, _)| *seq > after_started_seq));
        assert!(missed[0].1.contains("\"data\":\"first\""));
        assert!(missed[1].1.contains("\"data\":\"second\""));
    }

    #[test]
    fn clears_terminal_replay_buffer_when_terminal_stops() {
        let (broadcaster, _) = WsBroadcaster::new();
        broadcaster.server_started();

        broadcaster.broadcast("terminal:started", &json!({ "terminal_id": "term-1" }));
        broadcaster.broadcast(
            "terminal:output",
            &json!({ "terminal_id": "term-1", "data": "first" }),
        );
        assert_eq!(broadcaster.replay_terminal_events("term-1", 0).len(), 2);

        broadcaster.broadcast("terminal:stopped", &json!({ "terminal_id": "term-1" }));

        assert!(broadcaster.replay_terminal_events("term-1", 0).is_empty());
    }
}
