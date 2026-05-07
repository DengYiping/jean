use serde::{Deserialize, Serialize};

use crate::platform::silent_command;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CliPathUpdateOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
}

const ALLOWED_CLI_TYPES: &[&str] = &["claude", "codex", "opencode", "gh"];
const ALLOWED_COMMANDS: &[&str] = &["brew", "npm", "bun", "claude", "opencode"];

/// Run a PATH-installed CLI update command without opening a terminal window.
///
/// The command is restricted to a small allowlist of known updater binaries,
/// and updates are blocked while chat sessions are actively running.
#[tauri::command]
pub async fn run_cli_path_update(
    command: String,
    args: Vec<String>,
    cli_type: String,
) -> Result<CliPathUpdateOutput, String> {
    log::trace!("run_cli_path_update: cli_type={cli_type} command={command} args={args:?}");

    if !ALLOWED_CLI_TYPES.contains(&cli_type.as_str()) {
        return Err(format!("Unknown CLI type: {cli_type}"));
    }

    let bare_command = std::path::Path::new(&command)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&command)
        .trim_end_matches(".exe");
    if !ALLOWED_COMMANDS.contains(&bare_command) {
        return Err(format!("Disallowed update command: {command}"));
    }

    let running_sessions = crate::chat::registry::get_running_sessions();
    if !running_sessions.is_empty() {
        let count = running_sessions.len();
        return Err(format!(
            "Cannot update {} CLI while {} {} running. Please stop all active sessions first.",
            cli_type,
            count,
            if count == 1 {
                "session is"
            } else {
                "sessions are"
            }
        ));
    }

    let result = tokio::task::spawn_blocking(move || {
        silent_command(&command)
            .args(&args)
            .output()
            .map_err(|error| format!("Failed to spawn update command '{command}': {error}"))
    })
    .await
    .map_err(|error| format!("Background task join error: {error}"))??;

    let stdout = String::from_utf8_lossy(&result.stdout).to_string();
    let stderr = String::from_utf8_lossy(&result.stderr).to_string();
    let exit_code = result.status.code();
    let success = result.status.success();

    log::trace!(
        "run_cli_path_update finished: success={success} exit={exit_code:?} stderr_len={}",
        stderr.len()
    );

    if success {
        Ok(CliPathUpdateOutput {
            success: true,
            stdout,
            stderr,
            exit_code,
        })
    } else {
        let trimmed_stderr = stderr.trim();
        let detail = if trimmed_stderr.is_empty() {
            stdout.trim().to_string()
        } else {
            trimmed_stderr.to_string()
        };
        let detail = if detail.is_empty() {
            format!("exit code {}", exit_code.unwrap_or(-1))
        } else {
            detail
        };
        Err(format!("Update failed: {detail}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn run_cli_path_update_rejects_unknown_cli_type() {
        let result = tauri::async_runtime::block_on(run_cli_path_update(
            "bun".to_string(),
            vec!["--version".to_string()],
            "cursor".to_string(),
        ));

        assert_eq!(result.unwrap_err(), "Unknown CLI type: cursor");
    }

    #[test]
    fn run_cli_path_update_rejects_disallowed_command() {
        let result = tauri::async_runtime::block_on(run_cli_path_update(
            "rm".to_string(),
            vec!["-rf".to_string(), "/".to_string()],
            "claude".to_string(),
        ));

        assert_eq!(result.unwrap_err(), "Disallowed update command: rm");
    }

    #[test]
    fn run_cli_path_update_blocks_when_sessions_are_running() {
        crate::chat::registry::register_process("test-session".to_string(), 4242);

        let result = tauri::async_runtime::block_on(run_cli_path_update(
            "bun".to_string(),
            vec!["--version".to_string()],
            "codex".to_string(),
        ));

        crate::chat::registry::unregister_process("test-session");

        assert_eq!(
            result.unwrap_err(),
            "Cannot update codex CLI while 1 session is running. Please stop all active sessions first."
        );
    }
}
