//! Configuration and path management for the system Claude CLI.

use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedClaudeCommand {
    pub command: String,
    pub command_args: Vec<String>,
    pub display: String,
}

/// Name of the Claude CLI binary
#[cfg(windows)]
pub const CLI_BINARY_NAME: &str = "claude.exe";
#[cfg(not(windows))]
pub const CLI_BINARY_NAME: &str = "claude";

fn expand_home_path(path: &str) -> PathBuf {
    if path == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from(path));
    }

    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }

    PathBuf::from(path)
}

fn parse_custom_command(raw: &str) -> Result<(String, Vec<String>), String> {
    let parts =
        shlex::split(raw).ok_or_else(|| "Claude update command has invalid quoting".to_string())?;
    let Some((program, args)) = parts.split_first() else {
        return Err("Claude update command cannot be empty".to_string());
    };
    Ok((program.clone(), args.to_vec()))
}

fn resolve_program_path(program: &str) -> Result<PathBuf, String> {
    let expanded = expand_home_path(program);
    if expanded != Path::new(program) || expanded.components().count() > 1 {
        if expanded.exists() {
            return Ok(expanded);
        }
        return Err(format!(
            "Failed to resolve Claude update command program '{program}'"
        ));
    }

    which::which(program)
        .map_err(|e| format!("Failed to resolve Claude update command program '{program}': {e}"))
}

/// Get the full path to the Claude CLI binary from the host system.
pub fn get_cli_binary_path(_app: &AppHandle) -> Result<PathBuf, String> {
    which::which(CLI_BINARY_NAME)
        .or_else(|_| which::which("claude"))
        .map_err(|e| format!("Failed to resolve Claude CLI from PATH: {e}"))
}

/// Legacy managed CLI directory. Bundled installs are no longer used.
#[allow(dead_code)] // Older code paths still reference this legacy helper symbol.
pub fn get_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled Claude CLI installs are no longer supported".to_string())
}

/// Legacy helper kept only to satisfy older code paths that no longer execute.
#[allow(dead_code)] // Older code paths still reference this legacy helper symbol.
pub fn ensure_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled Claude CLI installs are no longer supported".to_string())
}

/// Resolve the Claude CLI binary from PATH, falling back to the bare command name.
pub fn resolve_cli_binary(app: &AppHandle) -> PathBuf {
    get_cli_binary_path(app).unwrap_or_else(|_| PathBuf::from("claude"))
}

pub fn resolve_update_command(app: &AppHandle) -> Result<Option<ResolvedClaudeCommand>, String> {
    let custom_command = crate::load_preferences_sync(app)
        .ok()
        .and_then(|prefs| prefs.claude_update_command);

    let Some(raw) = custom_command else {
        return Ok(None);
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let (program, args) = parse_custom_command(trimmed)?;
    let resolved_program = resolve_program_path(&program)?;
    Ok(Some(ResolvedClaudeCommand {
        command: resolved_program.to_string_lossy().to_string(),
        command_args: args,
        display: trimmed.to_string(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_path_is_bare_command_name() {
        let resolved = PathBuf::from("claude");

        assert_eq!(resolved, PathBuf::from("claude"));
    }

    #[test]
    fn parse_custom_command_splits_wrapper_args() {
        let (program, args) = parse_custom_command("pnpm install -g @anthropic-ai/claude-code")
            .expect("should parse install command");

        assert_eq!(program, "pnpm");
        assert_eq!(args, vec!["install", "-g", "@anthropic-ai/claude-code"]);
    }

    #[test]
    fn parse_custom_command_rejects_invalid_quotes() {
        let err =
            parse_custom_command("\"unterminated").expect_err("should reject invalid quoting");
        assert!(err.contains("invalid quoting"));
    }
}
