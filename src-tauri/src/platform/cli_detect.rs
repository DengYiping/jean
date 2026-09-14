use std::path::{Path, PathBuf};

use super::silent_command;

#[cfg(unix)]
fn find_cli_in_unix_login_shell(
    tool: &str,
    shell: &Path,
    jean_managed: Option<&Path>,
) -> Option<PathBuf> {
    let output = silent_command(shell)
        .args([
            "-l",
            "-i",
            "-c",
            "command -v \"$1\"",
            "jean-cli-lookup",
            tool,
        ])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let path = String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)?;
    (path.is_file() && !is_jean_managed_candidate(&path, jean_managed)).then_some(path)
}

pub fn find_cli_in_host_path(tool: &str, jean_managed: Option<&Path>) -> Option<PathBuf> {
    #[cfg(unix)]
    {
        let inherited = silent_command("which")
            .arg(tool)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| {
                select_cli_candidate(
                    &String::from_utf8_lossy(&output.stdout),
                    false,
                    jean_managed,
                )
            })
            .filter(|path| path.exists());
        inherited.or_else(|| {
            let shell = super::get_default_shell();
            find_cli_in_unix_login_shell(tool, Path::new(&shell), jean_managed)
        })
    }

    #[cfg(windows)]
    {
        let which_cmd = if cfg!(target_os = "windows") {
            "where"
        } else {
            "which"
        };

        let output = silent_command(which_cmd).arg(tool).output().ok()?;
        if !output.status.success() {
            return None;
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        select_cli_candidate(&stdout, cfg!(target_os = "windows"), jean_managed)
            .filter(|path| path.exists())
    }
}

pub fn select_cli_candidate(
    output: &str,
    prefer_windows_executable: bool,
    jean_managed: Option<&Path>,
) -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .filter(|path| !is_jean_managed_candidate(path, jean_managed))
        .collect();

    if prefer_windows_executable {
        candidates.sort_by_key(|path| windows_cli_candidate_rank(path));
    }

    candidates.into_iter().next()
}

fn is_jean_managed_candidate(path: &Path, jean_managed: Option<&Path>) -> bool {
    let Some(jean_path) = jean_managed else {
        return false;
    };

    if path == jean_path {
        return true;
    }

    std::fs::canonicalize(path).is_ok_and(|canonical_found| canonical_found == jean_path)
}

fn windows_cli_candidate_rank(path: &Path) -> u8 {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("exe") => 0,
        Some("cmd") => 1,
        Some("bat") => 2,
        None | Some("") => 3,
        Some("ps1") => 4,
        _ => 5,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::select_cli_candidate;

    #[cfg(unix)]
    #[test]
    fn unix_login_shell_detection_finds_cli_missing_from_process_path() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempfile::tempdir().expect("tempdir");
        let codex = dir.path().join("codex");
        std::fs::write(&codex, b"#!/bin/sh\n").expect("write codex");
        std::fs::set_permissions(&codex, std::fs::Permissions::from_mode(0o755))
            .expect("make codex executable");
        let shell = dir.path().join("login-shell");
        std::fs::write(
            &shell,
            format!("#!/bin/sh\nprintf 'notice\\n{}\\n'\n", codex.display()),
        )
        .expect("write shell");
        std::fs::set_permissions(&shell, std::fs::Permissions::from_mode(0o755))
            .expect("make shell executable");

        assert_eq!(
            super::find_cli_in_unix_login_shell("codex", &shell, None),
            Some(codex)
        );
    }

    #[test]
    fn windows_path_detection_prefers_cmd_shim_over_extensionless_npm_shim() {
        let output = r"C:\Users\u\AppData\Roaming\npm\opencode
C:\Users\u\AppData\Roaming\npm\opencode.cmd
C:\Users\u\AppData\Roaming\npm\opencode.ps1";

        assert_eq!(
            select_cli_candidate(output, true, None),
            Some(PathBuf::from(
                r"C:\Users\u\AppData\Roaming\npm\opencode.cmd"
            ))
        );
    }

    #[test]
    fn windows_path_detection_prefers_exe_over_cmd() {
        let output = r"C:\tools\opencode.cmd
C:\tools\opencode.exe";

        assert_eq!(
            select_cli_candidate(output, true, None),
            Some(PathBuf::from(r"C:\tools\opencode.exe"))
        );
    }

    #[test]
    fn windows_path_detection_prefers_batch_over_extensionless_and_ps1() {
        let output = r"C:\Users\u\AppData\Roaming\npm\codex
C:\Users\u\AppData\Roaming\npm\codex.ps1
C:\Users\u\AppData\Roaming\npm\codex.bat";

        assert_eq!(
            select_cli_candidate(output, true, None),
            Some(PathBuf::from(r"C:\Users\u\AppData\Roaming\npm\codex.bat"))
        );
    }

    #[test]
    fn unix_path_detection_keeps_first_candidate() {
        let output = "/usr/local/bin/opencode\n/opt/bin/opencode";

        assert_eq!(
            select_cli_candidate(output, false, None),
            Some(PathBuf::from("/usr/local/bin/opencode"))
        );
    }
}
