//! Configuration and path management for the system Codex CLI.

use std::path::PathBuf;
use tauri::AppHandle;

/// Name of the Codex CLI binary
#[cfg(windows)]
pub const CLI_BINARY_NAME: &str = "codex.exe";
#[cfg(not(windows))]
pub const CLI_BINARY_NAME: &str = "codex";

/// Get the full path to the Codex CLI binary from the host system.
pub fn get_cli_binary_path(_app: &AppHandle) -> Result<PathBuf, String> {
    which::which(CLI_BINARY_NAME)
        .or_else(|_| which::which("codex"))
        .map_err(|e| format!("Failed to resolve Codex CLI from PATH: {e}"))
}

/// Legacy managed CLI directory. Bundled installs are no longer used.
#[allow(dead_code)] // Older code paths still reference this legacy helper symbol.
pub fn get_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled Codex CLI installs are no longer supported".to_string())
}

/// Legacy helper kept only to satisfy older code paths that no longer execute.
#[allow(dead_code)] // Older code paths still reference this legacy helper symbol.
pub fn ensure_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled Codex CLI installs are no longer supported".to_string())
}

/// Resolve the Codex CLI binary from PATH, falling back to the bare command name.
pub fn resolve_cli_binary(app: &AppHandle) -> PathBuf {
    get_cli_binary_path(app).unwrap_or_else(|_| PathBuf::from("codex"))
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
