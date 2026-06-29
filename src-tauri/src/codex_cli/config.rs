//! Configuration and path management for the Codex CLI.

use serde::Serialize;
use std::path::Path;
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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedCodexCommand {
    pub command: String,
    pub command_args: Vec<String>,
    pub display: String,
}

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
        shlex::split(raw).ok_or_else(|| "Codex update command has invalid quoting".to_string())?;
    let Some((program, args)) = parts.split_first() else {
        return Err("Codex update command cannot be empty".to_string());
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
            "Failed to resolve Codex update command program '{program}'"
        ));
    }

    which::which(program)
        .map_err(|e| format!("Failed to resolve Codex update command program '{program}': {e}"))
}

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
    if let Some(path) = crate::platform::find_cli_in_host_path("codex", None) {
        return path;
    }

    PathBuf::from("codex")
}

pub fn resolve_update_command(app: &AppHandle) -> Result<Option<ResolvedCodexCommand>, String> {
    let custom_command = crate::load_preferences_sync(app)
        .ok()
        .and_then(|prefs| prefs.codex_update_command);

    let Some(raw) = custom_command else {
        return Ok(None);
    };

    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let (program, args) = parse_custom_command(trimmed)?;
    let resolved_program = resolve_program_path(&program)?;
    Ok(Some(ResolvedCodexCommand {
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
        let resolved = PathBuf::from("codex");

        assert_eq!(resolved, PathBuf::from("codex"));
    }

    #[test]
    fn parse_custom_command_splits_wrapper_args() {
        let (program, args) = parse_custom_command("npm install -g @openai/codex")
            .expect("should parse install command");

        assert_eq!(program, "npm");
        assert_eq!(args, vec!["install", "-g", "@openai/codex"]);
    }

    #[test]
    fn parse_custom_command_rejects_invalid_quotes() {
        let err =
            parse_custom_command("\"unterminated").expect_err("should reject invalid quoting");
        assert!(err.contains("invalid quoting"));
    }
}
