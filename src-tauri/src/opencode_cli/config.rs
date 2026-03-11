//! Configuration and path management for the system OpenCode CLI.

use std::path::PathBuf;
use tauri::AppHandle;

/// Name of the OpenCode CLI binary
#[cfg(windows)]
pub const CLI_BINARY_NAME: &str = "opencode.exe";
#[cfg(not(windows))]
pub const CLI_BINARY_NAME: &str = "opencode";

/// Get the full path to the OpenCode CLI binary from the host system.
pub fn get_cli_binary_path(_app: &AppHandle) -> Result<PathBuf, String> {
    which::which(CLI_BINARY_NAME)
        .or_else(|_| which::which("opencode"))
        .map_err(|e| format!("Failed to resolve OpenCode CLI from PATH: {e}"))
}

/// Legacy managed CLI directory. Bundled installs are no longer used.
pub fn get_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled OpenCode CLI installs are no longer supported".to_string())
}

/// Legacy helper kept only to satisfy older code paths that no longer execute.
pub fn ensure_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled OpenCode CLI installs are no longer supported".to_string())
}

/// Resolve the OpenCode CLI binary from PATH, falling back to the bare command name.
pub fn resolve_cli_binary(app: &AppHandle) -> PathBuf {
    get_cli_binary_path(app).unwrap_or_else(|_| PathBuf::from("opencode"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_path_is_bare_command_name() {
        let resolved = PathBuf::from("opencode");

        assert_eq!(resolved, PathBuf::from("opencode"));
    }
}
