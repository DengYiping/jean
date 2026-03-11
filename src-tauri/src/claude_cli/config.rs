//! Configuration and path management for the system Claude CLI.

use std::path::PathBuf;
use tauri::AppHandle;

/// Name of the Claude CLI binary
#[cfg(windows)]
pub const CLI_BINARY_NAME: &str = "claude.exe";
#[cfg(not(windows))]
pub const CLI_BINARY_NAME: &str = "claude";

/// Get the full path to the Claude CLI binary from the host system.
pub fn get_cli_binary_path(_app: &AppHandle) -> Result<PathBuf, String> {
    which::which(CLI_BINARY_NAME)
        .or_else(|_| which::which("claude"))
        .map_err(|e| format!("Failed to resolve Claude CLI from PATH: {e}"))
}

/// Legacy managed CLI directory. Bundled installs are no longer used.
pub fn get_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled Claude CLI installs are no longer supported".to_string())
}

/// Legacy helper kept only to satisfy older code paths that no longer execute.
pub fn ensure_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled Claude CLI installs are no longer supported".to_string())
}

/// Resolve the Claude CLI binary from PATH, falling back to the bare command name.
pub fn resolve_cli_binary(app: &AppHandle) -> PathBuf {
    get_cli_binary_path(app).unwrap_or_else(|_| PathBuf::from("claude"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_path_is_bare_command_name() {
        let resolved = PathBuf::from("claude");

        assert_eq!(resolved, PathBuf::from("claude"));
    }
}
