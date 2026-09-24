use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::Read;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::AppHandle;

use crate::http_server::EmitExt;

use super::registry::{register_terminal, unregister_terminal};
use super::types::{
    TerminalOutputEvent, TerminalSession, TerminalStartedEvent, TerminalStoppedEvent,
};

/// Detect user's default shell (cross-platform)
fn get_user_shell() -> String {
    crate::platform::get_default_shell()
}

#[cfg(unix)]
fn shell_run_args(run_command: &str) -> [&str; 2] {
    ["-c", run_command]
}

fn decode_terminal_output_chunk(
    bytes: &[u8],
    carry: &mut [u8; 3],
    carry_len: &mut usize,
) -> Option<String> {
    match std::str::from_utf8(bytes) {
        Ok(_) => {
            *carry_len = 0;
            // SAFETY: validated above.
            Some(unsafe { String::from_utf8_unchecked(bytes.to_vec()) })
        }
        Err(first_err) => {
            let total = bytes.len();
            let mut out = String::with_capacity(total);
            let mut cursor = 0usize;
            let mut err = first_err;

            loop {
                let valid_up_to = err.valid_up_to();
                // SAFETY: from_utf8 verified this segment.
                out.push_str(unsafe {
                    std::str::from_utf8_unchecked(&bytes[cursor..cursor + valid_up_to])
                });

                match err.error_len() {
                    None => {
                        let tail_start = cursor + valid_up_to;
                        let tail_len = total - tail_start;
                        debug_assert!(tail_len <= 3);
                        carry[..tail_len].copy_from_slice(&bytes[tail_start..total]);
                        *carry_len = tail_len;
                        break;
                    }
                    Some(bad_len) => {
                        out.push('\u{FFFD}');
                        cursor += valid_up_to + bad_len;
                        if cursor >= total {
                            *carry_len = 0;
                            break;
                        }
                        match std::str::from_utf8(&bytes[cursor..]) {
                            Ok(s) => {
                                out.push_str(s);
                                *carry_len = 0;
                                break;
                            }
                            Err(next_err) => err = next_err,
                        }
                    }
                }
            }

            if out.is_empty() {
                None
            } else {
                Some(out)
            }
        }
    }
}

fn flush_terminal_output_carry(carry_len: &mut usize) -> Option<String> {
    if *carry_len == 0 {
        return None;
    }

    let len = *carry_len;
    *carry_len = 0;

    let mut out = String::with_capacity(len * 3);
    for _ in 0..len {
        out.push('\u{FFFD}');
    }
    Some(out)
}

/// Spawn a terminal, optionally running a command
///
/// When `command_args` is provided alongside `command`, the binary at `command`
/// is invoked directly with the given args (no shell wrapper). This avoids
/// argument-parsing issues on Windows where PowerShell mangles quoted paths.
pub fn spawn_terminal(
    app: &AppHandle,
    terminal_id: String,
    worktree_path: String,
    cols: u16,
    rows: u16,
    command: Option<String>,
    command_args: Option<Vec<String>>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    crate::platform::ensure_macos_path();

    log::info!(
        "spawn_terminal {terminal_id}: cols={cols}, rows={rows}, cwd={worktree_path}, command={:?}, args={:?}",
        command, command_args
    );

    let pty_system = native_pty_system();

    // Guard against degenerate dimensions that crash portable_pty
    let cols = if cols == 0 { 80 } else { cols };
    let rows = if rows == 0 { 24 } else { rows };
    log::info!("spawn_terminal {terminal_id}: effective size={cols}x{rows}");

    // Create PTY pair
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("Failed to open PTY: {e}"))?;

    // Get user's shell
    let shell = get_user_shell();
    log::trace!("Using shell: {shell}");

    // Build command - either run a specific command or start interactive shell
    let mut cmd = if let Some(ref run_command) = command {
        if run_command.is_empty() {
            return Err("Command is empty".to_string());
        }
        if let Some(ref args) = command_args {
            // Validate absolute paths exist upfront for a clear error message.
            if run_command.starts_with('/') && !std::path::Path::new(run_command).exists() {
                return Err(format!("Binary not found: {run_command}"));
            }

            // Direct binary invocation — CommandBuilder uses execvp which handles
            // spaces in paths natively. No shell wrapper needed.
            let mut c = CommandBuilder::new(run_command);
            for arg in args {
                c.arg(arg);
            }
            c
        } else {
            // Run the command wrapped in a shell
            let mut c = CommandBuilder::new(&shell);
            #[cfg(windows)]
            {
                c.arg("-Command");
                c.arg(run_command.to_string());
            }
            #[cfg(not(windows))]
            {
                // `shell -c` expects the raw command string. Wrapping the whole
                // script in shell quotes makes shells like zsh treat it as a
                // single executable name (for example `bun run tauri:dev`).
                c.args(shell_run_args(run_command));
            }
            c
        }
    } else {
        CommandBuilder::new(&shell)
    };
    // Use the requested working directory if it exists, otherwise fall back to
    // the system temp directory. This is critical on Windows where `/tmp` doesn't
    // exist — CLI login terminals pass `/tmp` as a placeholder path.
    let cwd = if std::path::Path::new(&worktree_path).is_dir() {
        worktree_path.clone()
    } else {
        let fallback = std::env::temp_dir().to_string_lossy().to_string();
        log::warn!(
            "Worktree path '{}' does not exist, falling back to '{}'",
            worktree_path,
            fallback
        );
        fallback
    };
    log::debug!(
        "Terminal {terminal_id}: cwd={cwd}, command={:?}, args={:?}",
        command,
        command_args
    );
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("JEAN_WORKTREE_PATH", &worktree_path);

    // Spawn the shell
    let child = pair.slave.spawn_command(cmd).map_err(|e| {
        log::error!(
            "Failed to spawn terminal {terminal_id}: {e} (cwd={cwd}, command={:?}, args={:?})",
            command,
            command_args
        );
        format!("Failed to spawn shell: {e}")
    })?;

    log::trace!("Spawned terminal process");

    // Get reader from master
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {e}"))?;

    // Get writer from master (must be taken once and stored)
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {e}"))?;

    // Register the session
    let session = TerminalSession {
        terminal_id: terminal_id.clone(),
        master: pair.master,
        writer: Mutex::new(writer),
        child,
        cols,
        rows,
        worktree_path,
        command,
        command_args,
    };
    register_terminal(session);

    // Emit started event
    let started_event = TerminalStartedEvent {
        terminal_id: terminal_id.clone(),
        cols,
        rows,
    };
    if let Err(e) = app.emit_all("terminal:started", &started_event) {
        log::error!("Failed to emit terminal:started event: {e}");
    }

    // Spawn reader thread.
    //
    // Streaming UTF-8 decode: a `read()` can split a multi-byte codepoint at
    // the buffer boundary. `from_utf8_lossy` would emit `U+FFFD` for the split
    // bytes even though the stream is valid. Carry incomplete trailing bytes
    // into the next read and keep lossy decoding semantics for genuinely
    // invalid sequences.
    let app_clone = app.clone();
    let terminal_id_clone = terminal_id.clone();
    let (output_tx, output_rx) = mpsc::channel::<String>();
    let emitter_app = app.clone();
    let emitter_terminal_id = terminal_id.clone();
    let emitter = thread::spawn(move || {
        coalesce_terminal_output(&output_rx, |data| {
            let event = TerminalOutputEvent {
                terminal_id: emitter_terminal_id.clone(),
                data,
            };
            if let Err(e) = emitter_app.emit_all("terminal:output", &event) {
                log::error!("Failed to emit terminal:output event: {e}");
            }
        });
    });
    thread::spawn(move || {
        const BUF_SIZE: usize = 4096;
        let mut buf = [0u8; BUF_SIZE];
        let mut carry = [0u8; 3];
        let mut carry_len = 0usize;

        loop {
            buf[..carry_len].copy_from_slice(&carry[..carry_len]);
            let staged_len = carry_len;

            match reader.read(&mut buf[staged_len..]) {
                Ok(0) => {
                    log::trace!("Terminal EOF for: {terminal_id_clone}");
                    if let Some(data) = flush_terminal_output_carry(&mut carry_len) {
                        let _ = output_tx.send(data);
                    }
                    break;
                }
                Ok(n) => {
                    let total = staged_len + n;
                    if let Some(data) =
                        decode_terminal_output_chunk(&buf[..total], &mut carry, &mut carry_len)
                    {
                        let _ = output_tx.send(data);
                    }
                }
                Err(e) => {
                    log::error!("Error reading from terminal: {e}");
                    break;
                }
            }
        }

        // Flush buffered output before reporting exit.
        drop(output_tx);
        let _ = emitter.join();

        // Terminal has exited, get exit code and cleanup
        if let Some(mut session) = unregister_terminal(&terminal_id_clone) {
            let (exit_code, signal) = session
                .child
                .wait()
                .map(|s| {
                    if s.success() {
                        (Some(0), None)
                    } else {
                        // Display format: "Terminated by {signal}" or "Exited with code {code}"
                        let display = format!("{s}");
                        let signal = display
                            .strip_prefix("Terminated by ")
                            .map(|sig| sig.to_string());
                        (Some(s.exit_code() as i32), signal)
                    }
                })
                .unwrap_or((None, None));

            let stopped_event = TerminalStoppedEvent {
                terminal_id: terminal_id_clone,
                exit_code,
                signal,
            };
            if let Err(e) = app_clone.emit_all("terminal:stopped", &stopped_event) {
                log::error!("Failed to emit terminal:stopped event: {e}");
            }
        }
    });

    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn shell_run_args_pass_raw_command_to_shell_c() {
        assert_eq!(
            super::shell_run_args("bun run tauri:dev"),
            ["-c", "bun run tauri:dev"]
        );
    }

    fn decode_chunks(chunks: &[&[u8]]) -> Vec<String> {
        let mut carry = [0u8; 3];
        let mut carry_len = 0usize;
        let mut outputs = Vec::new();

        for chunk in chunks {
            let mut staged = Vec::with_capacity(carry_len + chunk.len());
            staged.extend_from_slice(&carry[..carry_len]);
            staged.extend_from_slice(chunk);

            if let Some(output) =
                super::decode_terminal_output_chunk(&staged, &mut carry, &mut carry_len)
            {
                outputs.push(output);
            }
        }

        if let Some(output) = super::flush_terminal_output_carry(&mut carry_len) {
            outputs.push(output);
        }

        outputs
    }

    #[test]
    fn decode_terminal_output_chunk_preserves_split_multibyte_codepoint() {
        let outputs = decode_chunks(&[&[0xE2, 0x82], &[0xAC]]);

        assert_eq!(outputs, vec!["€".to_string()]);
    }

    #[test]
    fn decode_terminal_output_chunk_emits_valid_prefix_before_split_tail() {
        let outputs = decode_chunks(&[b"ab\xE2\x82", b"\xACcd"]);

        assert_eq!(outputs, vec!["ab".to_string(), "€cd".to_string()]);
    }

    #[test]
    fn decode_terminal_output_chunk_replaces_invalid_sequences() {
        let outputs = decode_chunks(&[b"a\xFFb"]);

        assert_eq!(outputs, vec!["a\u{FFFD}b".to_string()]);
    }

    #[test]
    fn flush_terminal_output_carry_replaces_dangling_trailing_bytes_at_eof() {
        let outputs = decode_chunks(&[&[0xE2, 0x82]]);

        assert_eq!(outputs, vec!["\u{FFFD}\u{FFFD}".to_string()]);
    }
}

/// Write data to a terminal
pub fn write_to_terminal(terminal_id: &str, data: &str) -> Result<(), String> {
    use std::io::Write;

    super::registry::with_terminal(terminal_id, |session| {
        let mut writer = session
            .writer
            .lock()
            .map_err(|e| format!("Failed to lock writer: {e}"))?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write: {e}"))?;
        writer.flush().map_err(|e| format!("Failed to flush: {e}"))
    })
    .ok_or_else(|| "Terminal not found".to_string())?
}

/// Resize a terminal
pub fn resize_terminal(terminal_id: &str, cols: u16, rows: u16) -> Result<(), String> {
    super::registry::with_terminal(terminal_id, |session| {
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize: {e}"))?;
        session.cols = cols;
        session.rows = rows;
        Ok(())
    })
    .ok_or_else(|| "Terminal not found".to_string())?
}

/// Kill a terminal
pub fn kill_terminal(app: &AppHandle, terminal_id: &str) -> Result<bool, String> {
    if let Some(mut session) = unregister_terminal(terminal_id) {
        // Kill the child process - try graceful termination first
        if let Some(pid) = session.child.process_id() {
            if let Err(e) = crate::platform::terminate_process(pid) {
                log::trace!("Graceful termination of pid={pid} failed: {e}");
            }
        }

        // Wait for the process to exit
        let _ = session.child.kill();

        // Emit stopped event
        let stopped_event = TerminalStoppedEvent {
            terminal_id: terminal_id.to_string(),
            exit_code: None,
            signal: None,
        };
        if let Err(e) = app.emit_all("terminal:stopped", &stopped_event) {
            log::error!("Failed to emit terminal:stopped event: {e}");
        }

        Ok(true)
    } else {
        Ok(false)
    }
}

/// Kill all active terminals (used during app shutdown)
pub fn kill_all_terminals() -> usize {
    use super::registry::TERMINAL_SESSIONS;

    eprintln!("[TERMINAL CLEANUP] kill_all_terminals called");

    let mut sessions = TERMINAL_SESSIONS.lock().unwrap();
    let count = sessions.len();

    eprintln!("[TERMINAL CLEANUP] Found {count} active terminal(s)");

    for (terminal_id, mut session) in sessions.drain() {
        eprintln!("[TERMINAL CLEANUP] Killing terminal: {terminal_id}");

        if let Some(pid) = session.child.process_id() {
            eprintln!("[TERMINAL CLEANUP] Sending terminate signal to PID {pid}");
            if let Err(e) = crate::platform::terminate_process(pid) {
                eprintln!("[TERMINAL CLEANUP] Graceful termination failed: {e}");
            }
        }

        let _ = session.child.kill();
        eprintln!("[TERMINAL CLEANUP] Killed terminal: {terminal_id}");
    }

    eprintln!("[TERMINAL CLEANUP] Cleanup complete, killed {count} terminal(s)");

    count
}

/// Window over which PTY reads are merged into one `terminal:output` event.
const OUTPUT_COALESCE_WINDOW: Duration = Duration::from_millis(5);
/// Flush early once this many bytes are buffered.
const OUTPUT_COALESCE_MAX_BYTES: usize = 64 * 1024;

/// PTY reads are often tiny (tens of bytes), so emitting one event per read
/// floods IPC during bulk output. Merge chunks that arrive within a short
/// window, preserving order, until the sender is dropped.
fn coalesce_terminal_output(rx: &Receiver<String>, mut emit: impl FnMut(String)) {
    while let Ok(first) = rx.recv() {
        let mut batch = first;
        let deadline = Instant::now() + OUTPUT_COALESCE_WINDOW;
        let mut disconnected = false;
        while batch.len() < OUTPUT_COALESCE_MAX_BYTES {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match rx.recv_timeout(remaining) {
                Ok(chunk) => batch.push_str(&chunk),
                Err(RecvTimeoutError::Timeout) => break,
                Err(RecvTimeoutError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            }
        }
        emit(batch);
        if disconnected {
            break;
        }
    }
}

#[cfg(test)]
mod pty_read_bench {
    use portable_pty::{native_pty_system, CommandBuilder, PtySize};
    use std::io::Read;

    /// Run with: cargo test --release --lib bench_pty_read_chunks -- --ignored --nocapture
    #[test]
    #[ignore]
    fn bench_pty_read_chunks() {
        let pair = native_pty_system()
            .openpty(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let mut cmd = CommandBuilder::new("sh");
        cmd.args(["-c", "seq 1 200000"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().unwrap();
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let emitter = std::thread::spawn(move || {
            let mut emits = 0usize;
            super::coalesce_terminal_output(&rx, |_| emits += 1);
            emits
        });
        let mut buf = [0u8; 4096];
        let (mut reads, mut bytes) = (0usize, 0usize);
        let start = std::time::Instant::now();
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            reads += 1;
            bytes += n;
            let _ = tx.send(String::from_utf8_lossy(&buf[..n]).into_owned());
        }
        drop(tx);
        let emits = emitter.join().unwrap();
        let _ = child.wait();
        eprintln!(
            "[bench] pty: {reads} reads, {emits} terminal:output events for {bytes} bytes in {:?}",
            start.elapsed(),
        );
    }
}

#[cfg(test)]
mod coalesce_tests {
    use super::coalesce_terminal_output;

    #[test]
    fn merges_burst_chunks_in_order_and_flushes_on_disconnect() {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        for i in 0..1000 {
            tx.send(format!("{i},")).unwrap();
        }
        drop(tx);

        let mut batches = Vec::new();
        coalesce_terminal_output(&rx, |data| batches.push(data));

        let expected: String = (0..1000).map(|i| format!("{i},")).collect();
        assert_eq!(batches.concat(), expected);
        assert_eq!(batches.len(), 1);
    }

    #[test]
    fn emits_isolated_chunk_after_window() {
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let handle = std::thread::spawn(move || {
            let mut batches = Vec::new();
            coalesce_terminal_output(&rx, |data| batches.push(data));
            batches
        });
        tx.send("a".to_string()).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(50));
        tx.send("b".to_string()).unwrap();
        drop(tx);

        assert_eq!(
            handle.join().unwrap(),
            vec!["a".to_string(), "b".to_string()]
        );
    }
}
