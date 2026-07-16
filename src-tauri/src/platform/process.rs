// Cross-platform process management

use once_cell::sync::Lazy;
use std::ffi::OsStr;
use std::path::PathBuf;
use std::process::Command;
use std::sync::RwLock;

static GIT_BINARY_OVERRIDE: Lazy<RwLock<Option<PathBuf>>> = Lazy::new(|| RwLock::new(None));

fn is_git_program(program: &OsStr) -> bool {
    matches!(program.to_str(), Some("git") | Some("git.exe"))
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

pub fn normalize_macos_path(path: &str, home: Option<&std::path::Path>) -> String {
    let mut entries: Vec<String> = path
        .split(':')
        .filter(|entry| !entry.contains("/Volumes/"))
        .map(str::to_string)
        .collect();

    if let Some(home) = home {
        let pnpm_bin = home.join("Library/pnpm/bin").to_string_lossy().to_string();
        if !entries.iter().any(|entry| entry == &pnpm_bin) {
            entries.push(pnpm_bin);
        }
    }

    entries.join(":")
}

pub fn set_git_binary_override(path: Option<&str>) {
    let override_path = path
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(expand_home_path);
    let mut guard = GIT_BINARY_OVERRIDE
        .write()
        .expect("git binary override lock poisoned");
    *guard = override_path;
}

fn get_git_binary_override() -> Option<PathBuf> {
    GIT_BINARY_OVERRIDE
        .read()
        .expect("git binary override lock poisoned")
        .clone()
}

/// Escape a string for safe use in a shell command.
/// Wraps in single quotes and escapes any embedded single quotes.
#[cfg(unix)]
pub fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Ensures macOS PATH has been fixed from the user's login shell.
/// Uses `std::sync::Once` so the shell is only spawned on the first call.
/// This must NOT call `silent_command()` internally to avoid recursion.
#[cfg(target_os = "macos")]
pub fn ensure_macos_path() {
    use std::sync::Once;
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let start = std::time::Instant::now();
        crate::fix_macos_path();
        log::info!(
            "fix_macos_path() completed in {:?} (lazy, on first CLI invocation)",
            start.elapsed()
        );
    });
}

/// Detect the package manager that installed a binary by resolving symlinks.
///
/// Returns `Some("homebrew")` if the canonical path contains `/homebrew/` or `/Cellar/`,
/// `Some("npm")` if it contains `/node_modules/`, `None` otherwise.
pub fn detect_package_manager(binary_path: &std::path::Path) -> Option<String> {
    let canonical = std::fs::canonicalize(binary_path).ok()?;
    let canonical_str = canonical.to_string_lossy();

    if canonical_str.contains("/homebrew/") || canonical_str.contains("/Cellar/") {
        return Some("homebrew".to_string());
    }

    // Check bun before generic node_modules — bun's global installs also use node_modules/
    // e.g. ~/.bun/install/global/node_modules/@openai/codex/bin/codex.js
    if canonical_str.contains("/.bun/") {
        return Some("bun".to_string());
    }

    if canonical_str.contains("/node_modules/") {
        return Some("npm".to_string());
    }

    None
}

/// Creates a Command that won't open a console window on Windows.
/// Use for all background operations (git, gh, claude CLI, etc.).
/// Do NOT use for commands that intentionally open UI (terminals, editors, file explorers).
pub fn silent_command<S: AsRef<std::ffi::OsStr>>(program: S) -> Command {
    // Ensure macOS GUI app has the user's full PATH before spawning any subprocess.
    // Lazy + cached via Once — only the first call pays the shell-spawn cost (~100-500ms).
    #[cfg(target_os = "macos")]
    ensure_macos_path();

    let program = program.as_ref();
    let resolved_program = if is_git_program(program) {
        get_git_binary_override()
    } else {
        None
    };

    #[allow(unused_mut)]
    let mut cmd = match resolved_program.as_ref() {
        Some(path) => Command::new(path),
        None => Command::new(program),
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Raise the open-file-descriptor soft limit (`RLIMIT_NOFILE`) to the hard limit.
///
/// macOS GUI apps launch with a low default soft limit. Bulk git-status refresh
/// across many worktrees plus child CLI spawns can exhaust the table and break
/// unrelated subprocess work. No-op on Windows.
#[cfg(unix)]
pub fn raise_fd_limit() {
    unsafe {
        let mut rlim = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        if libc::getrlimit(libc::RLIMIT_NOFILE, &mut rlim) != 0 {
            log::warn!(
                "raise_fd_limit: getrlimit failed: {}",
                std::io::Error::last_os_error()
            );
            return;
        }

        let old_cur = rlim.rlim_cur;
        let mut target = rlim.rlim_max;
        #[cfg(target_os = "macos")]
        {
            if let Some(max_per_proc) = macos_maxfilesperproc() {
                target = target.min(max_per_proc);
            }
        }

        if old_cur >= target {
            log::info!("raise_fd_limit: soft fd limit already sufficient ({old_cur})");
            return;
        }

        rlim.rlim_cur = target;
        if libc::setrlimit(libc::RLIMIT_NOFILE, &rlim) != 0 {
            log::warn!(
                "raise_fd_limit: setrlimit to {target} failed: {}",
                std::io::Error::last_os_error()
            );
            return;
        }

        log::info!("raise_fd_limit: raised soft fd limit {old_cur} -> {target}");
    }
}

#[cfg(target_os = "macos")]
fn macos_maxfilesperproc() -> Option<libc::rlim_t> {
    let mut value: libc::c_int = 0;
    let mut size = std::mem::size_of::<libc::c_int>();
    let name = b"kern.maxfilesperproc\0";
    let ret = unsafe {
        libc::sysctlbyname(
            name.as_ptr() as *const libc::c_char,
            &mut value as *mut _ as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if ret == 0 && value > 0 {
        Some(value as libc::rlim_t)
    } else {
        None
    }
}

#[cfg(windows)]
pub fn raise_fd_limit() {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::Mutex;

    static GIT_OVERRIDE_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct GitOverrideTestGuard;

    impl Drop for GitOverrideTestGuard {
        fn drop(&mut self) {
            set_git_binary_override(None);
        }
    }

    fn lock_git_override() -> (std::sync::MutexGuard<'static, ()>, GitOverrideTestGuard) {
        (
            GIT_OVERRIDE_TEST_LOCK
                .lock()
                .expect("git override test lock poisoned"),
            GitOverrideTestGuard,
        )
    }

    #[test]
    fn expands_tilde_for_git_override() {
        let (_lock, _guard) = lock_git_override();
        let home = dirs::home_dir().expect("home directory should exist in tests");
        set_git_binary_override(Some("~/bin/git-wrapper"));

        assert_eq!(
            get_git_binary_override(),
            Some(home.join("bin/git-wrapper"))
        );
    }

    #[test]
    fn clears_git_override_for_blank_values() {
        let (_lock, _guard) = lock_git_override();
        set_git_binary_override(Some("~/bin/git-wrapper"));
        set_git_binary_override(Some("   "));

        assert_eq!(get_git_binary_override(), None);
    }

    #[test]
    fn macos_path_includes_pnpm_global_bin() {
        let path = normalize_macos_path(
            "/opt/homebrew/bin:/Users/test/Library/pnpm",
            Some(Path::new("/Users/test")),
        );

        assert_eq!(
            path,
            "/opt/homebrew/bin:/Users/test/Library/pnpm:/Users/test/Library/pnpm/bin"
        );
    }

    #[test]
    fn macos_path_does_not_duplicate_pnpm_global_bin() {
        let path = normalize_macos_path(
            "/Users/test/Library/pnpm/bin:/opt/homebrew/bin",
            Some(Path::new("/Users/test")),
        );

        assert_eq!(path, "/Users/test/Library/pnpm/bin:/opt/homebrew/bin");
    }

    #[test]
    fn silent_command_uses_git_override_for_git_program() {
        let (_lock, _guard) = lock_git_override();
        set_git_binary_override(Some("~/bin/git-wrapper"));

        let command = silent_command("git");
        let expected = dirs::home_dir()
            .expect("home directory should exist in tests")
            .join("bin/git-wrapper");

        assert_eq!(command.get_program(), expected.as_os_str());
    }

    #[test]
    fn silent_command_leaves_non_git_programs_unchanged() {
        let (_lock, _guard) = lock_git_override();
        set_git_binary_override(Some("~/bin/git-wrapper"));

        let command = silent_command("gh");

        assert_eq!(command.get_program(), OsStr::new("gh"));
    }
}

/// Check if a process is still alive
/// - Unix: Uses kill(pid, 0) to check
/// - Windows: Uses OpenProcess + GetExitCodeProcess
#[cfg(unix)]
pub fn is_process_alive(pid: u32) -> bool {
    // kill with signal 0 checks if process exists without actually sending a signal
    let result = unsafe { libc::kill(pid as i32, 0) };
    if result == 0 {
        return true;
    }
    // If kill returns -1, check errno
    // EPERM means process exists but we don't have permission (still alive)
    // ESRCH means no such process
    let errno = std::io::Error::last_os_error().raw_os_error().unwrap_or(0);
    errno == libc::EPERM
}

#[cfg(windows)]
pub fn is_process_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{
        GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return false;
        }

        let mut exit_code: u32 = 0;
        let result = GetExitCodeProcess(handle, &mut exit_code);
        CloseHandle(handle);

        result != 0 && exit_code == STILL_ACTIVE as u32
    }
}

/// Kill a single process
/// - Unix: Uses SIGKILL
/// - Windows: Uses TerminateProcess
#[cfg(unix)]
pub fn kill_process(pid: u32) -> Result<(), String> {
    let result = unsafe { libc::kill(pid as i32, libc::SIGKILL) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to kill process {}: {}",
            pid,
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
pub fn kill_process(pid: u32) -> Result<(), String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

    unsafe {
        let handle = OpenProcess(PROCESS_TERMINATE, 0, pid);
        if handle.is_null() {
            return Err(format!(
                "Failed to open process {}: {}",
                pid,
                std::io::Error::last_os_error()
            ));
        }

        let result = TerminateProcess(handle, 1);
        CloseHandle(handle);

        if result != 0 {
            Ok(())
        } else {
            Err(format!(
                "Failed to terminate process {}: {}",
                pid,
                std::io::Error::last_os_error()
            ))
        }
    }
}

/// Kill a process and all its children (process tree)
/// - Unix: Uses kill with negative PID to kill process group
/// - Windows: Uses taskkill /T for tree kill
#[cfg(unix)]
pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    // Negative PID kills the entire process group
    let result = unsafe { libc::kill(-(pid as i32), libc::SIGKILL) };
    if result == 0 {
        Ok(())
    } else {
        // If process group kill fails, try killing just the process
        kill_process(pid)
    }
}

#[cfg(windows)]
pub fn kill_process_tree(pid: u32) -> Result<(), String> {
    // Use taskkill with /T flag for tree kill
    let output = silent_command("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .output()
        .map_err(|e| format!("Failed to run taskkill: {}", e))?;

    if output.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        Err(format!("taskkill failed: {}", stderr))
    }
}

/// Write binary data to a file path, handling Windows file-locking.
///
/// On Windows, if the target file is in use by another process (e.g., background version
/// checks), `File::create` fails with OS error 32. This function works around it by:
/// 1. Writing to a `.tmp` file in the same directory
/// 2. Renaming the existing file to `.old` (Windows allows renaming locked files)
/// 3. Renaming the `.tmp` file to the target path
/// 4. Best-effort cleanup of the `.old` file
///
/// On macOS, overwriting a running binary in-place (same inode) causes the kernel's code-signing
/// enforcement to taint the inode, resulting in SIGKILL for all subsequent executions from that
/// path. To avoid this, we always write to a temp file and atomically rename it into place,
/// which allocates a new inode while the old one stays alive for any running process.
pub fn write_binary_file(path: &std::path::Path, content: &[u8]) -> Result<(), String> {
    let temp_path = path.with_extension("tmp");

    // Write new binary to temp file (always a new inode)
    std::fs::write(&temp_path, content).map_err(|e| format!("Failed to write temp file: {e}"))?;

    #[cfg(windows)]
    {
        let old_path = path.with_extension("old");

        // Move existing file out of the way (Windows allows renaming locked files)
        if path.exists() {
            let _ = std::fs::remove_file(&old_path);
            if let Err(e) = std::fs::rename(path, &old_path) {
                let _ = std::fs::remove_file(&temp_path);
                return Err(format!("Failed to replace existing file: {e}"));
            }
        }

        // Move temp file into place
        if let Err(e) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::rename(&old_path, path);
            return Err(format!("Failed to install new file: {e}"));
        }

        // Best-effort cleanup
        let _ = std::fs::remove_file(&old_path);
        Ok(())
    }

    #[cfg(not(windows))]
    {
        // Atomic rename: replaces the directory entry so `path` points to the new inode.
        // The old inode (if any running process has it mapped) stays alive until that process exits.
        if let Err(e) = std::fs::rename(&temp_path, path) {
            let _ = std::fs::remove_file(&temp_path);
            return Err(format!("Failed to install new file: {e}"));
        }
        Ok(())
    }
}

/// Send SIGTERM to gracefully terminate a process (Unix only)
/// On Windows, this falls back to TerminateProcess
#[cfg(unix)]
pub fn terminate_process(pid: u32) -> Result<(), String> {
    let result = unsafe { libc::kill(pid as i32, libc::SIGTERM) };
    if result == 0 {
        Ok(())
    } else {
        Err(format!(
            "Failed to terminate process {}: {}",
            pid,
            std::io::Error::last_os_error()
        ))
    }
}

#[cfg(windows)]
pub fn terminate_process(pid: u32) -> Result<(), String> {
    // Windows doesn't have SIGTERM, use TerminateProcess
    kill_process(pid)
}
