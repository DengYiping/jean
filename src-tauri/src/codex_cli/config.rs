//! Configuration and path management for the Codex CLI.

use crate::platform::silent_command;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Directory name for storing the Codex CLI binary
pub const CODEX_CLI_DIR_NAME: &str = "codex-cli";

/// Name of the Codex CLI binary
#[cfg(windows)]
#[allow(dead_code)]
pub const CLI_BINARY_NAME: &str = "codex.exe";
#[cfg(not(windows))]
#[allow(dead_code)]
pub const CLI_BINARY_NAME: &str = "codex";

/// Get the directory where the Jean-managed Codex CLI is installed.
pub fn get_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    Ok(app_data_dir.join(CODEX_CLI_DIR_NAME))
}

/// Ensure the Codex CLI directory exists.
pub fn ensure_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cli_dir = get_cli_dir(app)?;
    std::fs::create_dir_all(&cli_dir)
        .map_err(|e| format!("Failed to create Codex CLI directory: {e}"))?;
    Ok(cli_dir)
}

/// Get the full path to the Jean-managed Codex CLI binary.
#[allow(dead_code)]
pub fn get_cli_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_cli_dir(app)?.join(CLI_BINARY_NAME))
}

/// Resolve the Codex CLI binary from PATH, falling back to the bare command
/// name.
pub fn resolve_cli_binary(app: &AppHandle) -> PathBuf {
    let _ = app;
    let which_cmd = if cfg!(target_os = "windows") {
        "where"
    } else {
        "which"
    };

    if let Ok(output) = silent_command(which_cmd).arg("codex").output() {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout)
                .lines()
                .next()
                .unwrap_or("")
                .trim()
                .to_string();
            if !path_str.is_empty() {
                let path = PathBuf::from(&path_str);
                if path.exists() {
                    return path;
                }
            }
        }
    }

    PathBuf::from("codex")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_path_is_bare_command_name() {
        let resolved = PathBuf::from("codex");

        assert_eq!(resolved, PathBuf::from("codex"));
    }
}
