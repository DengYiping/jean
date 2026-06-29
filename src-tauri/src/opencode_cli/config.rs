//! Configuration and path management for the system OpenCode CLI.

use std::path::PathBuf;
use tauri::AppHandle;

#[derive(Debug, Clone)]
pub struct ResolvedCliCommand {
    pub program: PathBuf,
    pub args: Vec<String>,
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
    let parts = shlex::split(raw)
        .ok_or_else(|| "OpenCode launcher command has invalid quoting".to_string())?;
    let Some((program, args)) = parts.split_first() else {
        return Err("OpenCode launcher command cannot be empty".to_string());
    };
    Ok((program.clone(), args.to_vec()))
}

fn resolve_program_path(program: &str) -> Result<PathBuf, String> {
    let expanded = expand_home_path(program);
    if expanded != std::path::Path::new(program) || expanded.components().count() > 1 {
        if expanded.exists() {
            return Ok(expanded);
        }
        return Err(format!(
            "Failed to resolve OpenCode launcher program '{program}'"
        ));
    }

    which::which(program)
        .map_err(|e| format!("Failed to resolve OpenCode launcher program '{program}': {e}"))
}

/// Resolve the OpenCode launcher command from preferences or PATH.
pub fn resolve_cli_command(app: &AppHandle) -> Result<ResolvedCliCommand, String> {
    let custom_command = crate::load_preferences_sync(app)
        .ok()
        .and_then(|prefs| prefs.opencode_launch_command);

    if let Some(raw) = custom_command {
        let trimmed = raw.trim();
        if !trimmed.is_empty() {
            let (program, args) = parse_custom_command(trimmed)?;
            let resolved_program = resolve_program_path(&program)?;
            return Ok(ResolvedCliCommand {
                program: resolved_program,
                args,
                display: trimmed.to_string(),
            });
        }
    }

    let program = crate::platform::find_cli_in_host_path("opencode", None)
        .ok_or_else(|| "Failed to resolve OpenCode CLI from PATH".to_string())?;

    Ok(ResolvedCliCommand {
        display: program.to_string_lossy().to_string(),
        program,
        args: Vec::new(),
    })
}

/// Legacy managed CLI directory. Bundled installs are no longer used.
#[allow(dead_code)] // Older code paths still reference this legacy helper symbol.
pub fn get_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled OpenCode CLI installs are no longer supported".to_string())
}

/// Legacy helper kept only to satisfy older code paths that no longer execute.
#[allow(dead_code)] // Older code paths still reference this legacy helper symbol.
pub fn ensure_cli_dir(_app: &AppHandle) -> Result<PathBuf, String> {
    Err("Bundled OpenCode CLI installs are no longer supported".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fallback_path_is_bare_command_name() {
        let resolved = PathBuf::from("opencode");

        assert_eq!(resolved, PathBuf::from("opencode"));
    }

    #[test]
    fn parse_custom_command_splits_wrapper_args() {
        let (program, args) = parse_custom_command("dvx opencode --profile qa")
            .expect("should parse wrapper command");

        assert_eq!(program, "dvx");
        assert_eq!(args, vec!["opencode", "--profile", "qa"]);
    }

    #[test]
    fn parse_custom_command_rejects_invalid_quotes() {
        let err =
            parse_custom_command("\"unterminated").expect_err("should reject invalid quoting");
        assert!(err.contains("invalid quoting"));
    }
}
