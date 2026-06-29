//! Configuration and path management for the GitHub CLI

use crate::platform::silent_command;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

/// Legacy directory name that may contain an older Jean-managed GitHub CLI.
pub const GH_CLI_DIR_NAME: &str = "gh-cli";

/// Name of the GitHub CLI binary
#[cfg(not(target_os = "windows"))]
pub const GH_CLI_BINARY_NAME: &str = "gh";

#[cfg(target_os = "windows")]
pub const GH_CLI_BINARY_NAME: &str = "gh.exe";

/// Get the legacy Jean-managed GitHub CLI directory.
///
/// Returns: `~/Library/Application Support/jean/gh-cli/` (macOS)
///          `~/.local/share/jean/gh-cli/` (Linux)
///          `%APPDATA%/jean/gh-cli/` (Windows)
pub fn get_gh_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    Ok(app_data_dir.join(GH_CLI_DIR_NAME))
}

/// Get the legacy Jean-managed GitHub CLI binary path.
///
/// Returns: `~/Library/Application Support/jean/gh-cli/gh` (macOS/Linux)
///          `%APPDATA%/jean/gh-cli/gh.exe` (Windows)
pub fn get_gh_cli_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_gh_cli_dir(app)?.join(GH_CLI_BINARY_NAME))
}

fn select_host_gh_path(output: &str, jean_managed_path: Option<&Path>) -> Option<PathBuf> {
    let existing_output = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .map(|path| path.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("\n");

    crate::platform::select_cli_candidate(
        &existing_output,
        cfg!(target_os = "windows"),
        jean_managed_path,
    )
}

/// Find a host-system GitHub CLI in PATH, ignoring Jean-managed binaries.
pub fn find_gh_in_path(app: &AppHandle) -> Option<PathBuf> {
    let jean_managed_path = get_gh_cli_binary_path(app).ok();

    #[cfg(target_os = "windows")]
    let output = silent_command("where").arg("gh").output();

    #[cfg(not(target_os = "windows"))]
    let output = silent_command("which").args(["-a", "gh"]).output();

    match output {
        Ok(output) if output.status.success() => select_host_gh_path(
            &String::from_utf8_lossy(&output.stdout),
            jean_managed_path.as_deref(),
        ),
        _ => None,
    }
}

/// Resolve the GitHub CLI binary from PATH, falling back to the bare command name.
pub fn resolve_gh_binary(app: &AppHandle) -> PathBuf {
    find_gh_in_path(app).unwrap_or_else(|| PathBuf::from("gh"))
}

/// Ensure the legacy CLI cache directory exists, creating it if necessary.
pub fn ensure_gh_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let cli_dir = get_gh_cli_dir(app)?;
    std::fs::create_dir_all(&cli_dir)
        .map_err(|e| format!("Failed to create GitHub CLI directory: {e}"))?;
    Ok(cli_dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn selects_first_existing_host_gh_path() {
        let temp = tempfile::tempdir().unwrap();
        let first = temp.path().join("bin").join(GH_CLI_BINARY_NAME);
        let second = temp.path().join("other").join(GH_CLI_BINARY_NAME);
        fs::create_dir_all(first.parent().unwrap()).unwrap();
        fs::create_dir_all(second.parent().unwrap()).unwrap();
        fs::write(&first, "").unwrap();
        fs::write(&second, "").unwrap();

        let output = format!("/missing/gh\n{}\n{}\n", first.display(), second.display());

        assert_eq!(select_host_gh_path(&output, None), Some(first));
    }

    #[test]
    fn skips_jean_managed_gh_path() {
        let temp = tempfile::tempdir().unwrap();
        let managed = temp.path().join(GH_CLI_DIR_NAME).join(GH_CLI_BINARY_NAME);
        let host = temp.path().join("host").join(GH_CLI_BINARY_NAME);
        fs::create_dir_all(managed.parent().unwrap()).unwrap();
        fs::create_dir_all(host.parent().unwrap()).unwrap();
        fs::write(&managed, "").unwrap();
        fs::write(&host, "").unwrap();

        let output = format!("{}\n{}\n", managed.display(), host.display());

        assert_eq!(select_host_gh_path(&output, Some(&managed)), Some(host));
    }

    #[test]
    fn returns_none_when_only_jean_managed_path_is_found() {
        let temp = tempfile::tempdir().unwrap();
        let managed = temp.path().join(GH_CLI_DIR_NAME).join(GH_CLI_BINARY_NAME);
        fs::create_dir_all(managed.parent().unwrap()).unwrap();
        fs::write(&managed, "").unwrap();

        assert_eq!(
            select_host_gh_path(&managed.display().to_string(), Some(&managed)),
            None
        );
    }

    #[test]
    fn fallback_path_is_bare_command_name() {
        let resolved = PathBuf::from("gh");

        assert_eq!(resolved, PathBuf::from("gh"));
    }
}
