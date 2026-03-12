//! Tauri commands for GitHub CLI management

use crate::platform::silent_command;
use crate::projects::storage::{find_project_for_repo_path, load_projects_data};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::RwLock;
use tauri::AppHandle;

use super::config::{ensure_gh_cli_dir, get_gh_cli_binary_path, resolve_gh_binary};
use crate::http_server::EmitExt;

/// GitHub API URL for releases
const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/cli/cli/releases";
const GITHUB_API_ACCEPT: &str = "application/vnd.github+json";
const GITHUB_API_VERSION: &str = "2022-11-28";

/// Status of the GitHub CLI installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhCliStatus {
    /// Whether GitHub CLI is installed
    pub installed: bool,
    /// Installed version (if any)
    pub version: Option<String>,
    /// Path to the CLI binary (if installed)
    pub path: Option<String>,
}

/// Information about a GitHub CLI release
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhReleaseInfo {
    /// Version string (e.g., "2.40.0")
    pub version: String,
    /// Git tag name (e.g., "v2.40.0")
    pub tag_name: String,
    /// Publication date in ISO format
    pub published_at: String,
    /// Whether this is a prerelease
    pub prerelease: bool,
}

/// Progress event for CLI installation
#[derive(Debug, Clone, Serialize)]
pub struct GhInstallProgress {
    /// Current stage of installation
    pub stage: String,
    /// Progress message
    pub message: String,
    /// Percentage complete (0-100)
    pub percent: u8,
}

/// A GitHub CLI account discovered from `gh auth status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhCliAccount {
    /// Host for this account (for example github.com or git.hubteam.com)
    pub host: String,
    /// Login/user name for the account
    pub user: String,
    /// Whether this is the currently active account for the host
    pub active: bool,
    /// Git operations protocol reported by gh
    pub git_protocol: Option<String>,
    /// Where gh stores the credentials (for example keyring or hosts.yml path)
    pub credential_source: Option<String>,
    /// Token scopes reported by gh auth status
    pub token_scopes: Vec<String>,
}

#[derive(Debug, Clone)]
struct ParsedGhCliAccount {
    account: GhCliAccount,
    token: Option<String>,
}

#[derive(Debug, Clone)]
struct GhAccountSelection {
    host: String,
    user: String,
}

static GH_ACCOUNT_TOKENS: Lazy<RwLock<HashMap<(String, String), String>>> =
    Lazy::new(|| RwLock::new(HashMap::new()));

/// GitHub API release response structure
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    published_at: String,
    prerelease: bool,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

fn parse_gh_auth_status_output(output: &str) -> Vec<ParsedGhCliAccount> {
    let mut accounts = Vec::new();
    let mut current_host: Option<String> = None;
    let mut current_account: Option<ParsedGhCliAccount> = None;

    for raw_line in output.lines() {
        let line = raw_line.trim_end();
        let trimmed = line.trim();

        if trimmed.is_empty() {
            if let Some(account) = current_account.take() {
                accounts.push(account);
            }
            continue;
        }

        if !line.starts_with(' ') && !line.starts_with('\t') {
            if let Some(account) = current_account.take() {
                accounts.push(account);
            }
            current_host = Some(trimmed.to_string());
            continue;
        }

        if let Some(rest) = trimmed.strip_prefix("✓ Logged in to ") {
            if let Some(account) = current_account.take() {
                accounts.push(account);
            }

            let (prefix, credential_source) = match rest.rsplit_once(" (") {
                Some((prefix, suffix)) if suffix.ends_with(')') => {
                    (prefix, Some(suffix.trim_end_matches(')').to_string()))
                }
                _ => (rest, None),
            };

            let user = prefix
                .split_once(" account ")
                .map(|(_, user)| user.trim().to_string())
                .unwrap_or_default();
            let host = current_host.clone().unwrap_or_default();

            current_account = Some(ParsedGhCliAccount {
                account: GhCliAccount {
                    host,
                    user,
                    active: false,
                    git_protocol: None,
                    credential_source,
                    token_scopes: Vec::new(),
                },
                token: None,
            });
            continue;
        }

        let Some(account) = current_account.as_mut() else {
            continue;
        };

        if let Some(value) = trimmed.strip_prefix("- Active account: ") {
            account.account.active = value.trim().eq_ignore_ascii_case("true");
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("- Git operations protocol: ") {
            let value = value.trim();
            account.account.git_protocol = if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            };
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("- Token: ") {
            let value = value.trim();
            account.token = if value.is_empty() {
                None
            } else {
                Some(value.to_string())
            };
            continue;
        }

        if let Some(value) = trimmed.strip_prefix("- Token scopes: ") {
            account.account.token_scopes = value
                .split(',')
                .map(|scope| scope.trim().trim_matches('\''))
                .filter(|scope| !scope.is_empty())
                .map(ToString::to_string)
                .collect();
        }
    }

    if let Some(account) = current_account.take() {
        accounts.push(account);
    }

    accounts
}

fn refresh_gh_account_cache(app: &AppHandle) -> Result<Vec<GhCliAccount>, String> {
    let gh = resolve_gh_binary(app);
    let output = silent_command(&gh)
        .args(["auth", "status", "--show-token"])
        .output()
        .map_err(|e| format!("Failed to run gh auth status: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined_output = if stdout.trim().is_empty() {
        stderr.to_string()
    } else if stderr.trim().is_empty() {
        stdout.to_string()
    } else {
        format!("{stdout}\n{stderr}")
    };

    let parsed = parse_gh_auth_status_output(&combined_output);

    if parsed.is_empty() {
        if output.status.success() {
            return Ok(Vec::new());
        }
        return Err(stderr.trim().to_string());
    }

    {
        let mut cache = GH_ACCOUNT_TOKENS
            .write()
            .expect("gh account token cache lock poisoned");
        cache.clear();
        for account in &parsed {
            if let Some(token) = &account.token {
                cache.insert(
                    (account.account.host.clone(), account.account.user.clone()),
                    token.clone(),
                );
            }
        }
    }

    let accounts = parsed.into_iter().map(|account| account.account).collect();
    Ok(accounts)
}

fn resolve_repo_gh_account(app: &AppHandle, repo_path: &str) -> Option<GhAccountSelection> {
    let data = load_projects_data(app).ok()?;
    let project = find_project_for_repo_path(&data, repo_path)?;
    let host = project.github_account_host.clone()?;
    let user = project.github_account_user.clone()?;
    if host.trim().is_empty() || user.trim().is_empty() {
        return None;
    }

    Some(GhAccountSelection { host, user })
}

fn cached_gh_account_token(host: &str, user: &str) -> Option<String> {
    GH_ACCOUNT_TOKENS
        .read()
        .expect("gh account token cache lock poisoned")
        .get(&(host.to_string(), user.to_string()))
        .cloned()
}

fn is_public_github_host(host: &str) -> bool {
    host.eq_ignore_ascii_case("github.com") || host.ends_with(".ghe.com")
}

pub fn apply_gh_account_env(app: &AppHandle, repo_path: Option<&str>, cmd: &mut Command) {
    let Some(repo_path) = repo_path else {
        return;
    };
    let Some(account) = resolve_repo_gh_account(app, repo_path) else {
        return;
    };

    cmd.env("GH_HOST", &account.host);
    cmd.env("GH_USER", &account.user);
    cmd.env("JEAN_GH_HOST", &account.host);
    cmd.env("JEAN_GH_USER", &account.user);

    let token = cached_gh_account_token(&account.host, &account.user).or_else(|| {
        refresh_gh_account_cache(app)
            .ok()
            .and_then(|_| cached_gh_account_token(&account.host, &account.user))
    });

    if let Some(token) = token {
        if is_public_github_host(&account.host) {
            cmd.env("GH_TOKEN", token);
        } else {
            cmd.env("GH_ENTERPRISE_TOKEN", token);
        }
    }
}

pub fn build_gh_command(app: &AppHandle, repo_path: Option<&str>) -> Command {
    let gh = resolve_gh_binary(app);
    let mut cmd = silent_command(&gh);
    apply_gh_account_env(app, repo_path, &mut cmd);
    cmd
}

/// List all locally authenticated GitHub CLI accounts.
#[tauri::command]
pub async fn list_gh_cli_accounts(app: AppHandle) -> Result<Vec<GhCliAccount>, String> {
    refresh_gh_account_cache(&app)
}

/// Check if GitHub CLI is installed and get its status
#[tauri::command]
pub async fn check_gh_cli_installed(app: AppHandle) -> Result<GhCliStatus, String> {
    log::trace!("Checking GitHub CLI installation status");

    let binary_path = get_gh_cli_binary_path(&app)?;

    if !binary_path.exists() {
        log::trace!("GitHub CLI not found at {:?}", binary_path);
        return Ok(GhCliStatus {
            installed: false,
            version: None,
            path: None,
        });
    }

    // Try to get the version by running gh --version
    // Use the binary directly - shell wrapper causes PowerShell parsing issues on Windows
    let version = match silent_command(&binary_path).arg("--version").output() {
        Ok(output) => {
            if output.status.success() {
                let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
                // gh --version returns "gh version 2.40.0 (2024-01-15)"
                // Extract just the version number
                let version = version_str
                    .split_whitespace()
                    .nth(2)
                    .map(|s| s.to_string())
                    .unwrap_or(version_str);
                log::trace!("GitHub CLI version: {}", version);
                Some(version)
            } else {
                log::warn!("Failed to get GitHub CLI version");
                None
            }
        }
        Err(e) => {
            log::warn!("Failed to execute GitHub CLI: {}", e);
            None
        }
    };

    Ok(GhCliStatus {
        installed: true,
        version,
        path: Some(binary_path.to_string_lossy().to_string()),
    })
}

/// Get available GitHub CLI versions from GitHub releases API
#[tauri::command]
pub async fn get_available_gh_versions(app: AppHandle) -> Result<Vec<GhReleaseInfo>, String> {
    log::trace!("Fetching available GitHub CLI versions from GitHub API");

    let client = reqwest::Client::builder()
        .user_agent("Jean-App/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let token = resolve_github_api_token(&app);
    let mut request = client
        .get(GITHUB_RELEASES_API)
        .header("Accept", GITHUB_API_ACCEPT)
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION);
    if let Some(ref token) = token {
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Failed to fetch releases: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("GitHub API returned status: {}", response.status()));
    }

    let releases: Vec<GitHubRelease> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub API response: {e}"))?;

    // Convert to our format, filtering to releases with assets for our platform
    let versions: Vec<GhReleaseInfo> = releases
        .into_iter()
        .filter(|r| !r.assets.is_empty())
        .take(5) // Only take 5 most recent
        .map(|r| {
            // Remove 'v' prefix from tag_name for version
            let version = r
                .tag_name
                .strip_prefix('v')
                .unwrap_or(&r.tag_name)
                .to_string();
            GhReleaseInfo {
                version,
                tag_name: r.tag_name,
                published_at: r.published_at,
                prerelease: r.prerelease,
            }
        })
        .collect();

    log::trace!("Found {} GitHub CLI versions", versions.len());
    Ok(versions)
}

/// Resolve a GitHub API token from environment or gh auth.
///
/// Priority:
/// 1) GH_TOKEN / GITHUB_TOKEN env vars
/// 2) `gh auth token` from Jean-managed gh binary
/// 3) `gh auth token` from PATH
pub fn resolve_github_api_token(app: &AppHandle) -> Option<String> {
    for key in ["GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    let mut candidates: Vec<PathBuf> = Vec::new();
    let managed_gh = resolve_gh_binary(app);
    if managed_gh.exists() {
        candidates.push(managed_gh);
    } else if let Ok(path) = get_gh_cli_binary_path(app) {
        if path.exists() {
            candidates.push(path);
        }
    }
    candidates.push(PathBuf::from("gh"));

    for program in candidates {
        let output = match silent_command(&program).args(["auth", "token"]).output() {
            Ok(output) => output,
            Err(_) => continue,
        };
        if !output.status.success() {
            continue;
        }
        let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !token.is_empty() {
            return Some(token);
        }
    }

    None
}

/// Get the platform string for the current system (for gh releases)
fn get_gh_platform() -> Result<(&'static str, &'static str), String> {
    // Returns (platform_string, archive_extension)
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok(("macOS_arm64", "zip"));
    }

    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok(("macOS_amd64", "zip"));
    }

    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok(("linux_amd64", "tar.gz"));
    }

    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Ok(("linux_arm64", "tar.gz"));
    }

    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Ok(("windows_amd64", "zip"));
    }

    #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
    {
        return Ok(("windows_arm64", "zip"));
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

/// Install GitHub CLI by downloading from GitHub releases
#[tauri::command]
pub async fn install_gh_cli(app: AppHandle, version: Option<String>) -> Result<(), String> {
    log::trace!("Installing GitHub CLI, version: {:?}", version);

    // Check if any Claude processes are running - Claude may use gh for GitHub operations
    let running_sessions = crate::chat::registry::get_running_sessions();
    if !running_sessions.is_empty() {
        let count = running_sessions.len();
        return Err(format!(
            "Cannot install GitHub CLI while {} Claude {} running. Please stop all active sessions first.",
            count,
            if count == 1 { "session is" } else { "sessions are" }
        ));
    }

    let cli_dir = ensure_gh_cli_dir(&app)?;
    let binary_path = get_gh_cli_binary_path(&app)?;

    // Emit progress: starting
    emit_progress(&app, "starting", "Preparing installation...", 0);

    // Determine version (use provided or fetch latest)
    let version = match version {
        Some(v) => v,
        None => fetch_latest_gh_version().await?,
    };

    // Detect platform
    let (platform, archive_ext) = get_gh_platform()?;
    log::trace!("Installing version {version} for platform {platform}");

    // Build download URL
    // Format: https://github.com/cli/cli/releases/download/v{version}/gh_{version}_{platform}.{ext}
    let archive_name = format!("gh_{version}_{platform}.{archive_ext}");
    let download_url =
        format!("https://github.com/cli/cli/releases/download/v{version}/{archive_name}");
    log::trace!("Downloading from: {download_url}");

    // Emit progress: downloading
    emit_progress(&app, "downloading", "Downloading GitHub CLI...", 20);

    // Download the archive
    let client = reqwest::Client::builder()
        .user_agent("Jean-App/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Failed to download GitHub CLI: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to download GitHub CLI: HTTP {}",
            response.status()
        ));
    }

    let archive_content = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read archive content: {e}"))?;

    log::trace!("Downloaded {} bytes", archive_content.len());

    // Emit progress: extracting
    emit_progress(&app, "extracting", "Extracting archive...", 40);

    // Create temp directory for extraction
    let temp_dir = cli_dir.join("temp");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {e}"))?;

    // Extract the archive
    let extracted_binary_path = if archive_ext == "zip" {
        extract_zip(&archive_content, &temp_dir, &version, platform)?
    } else {
        extract_tar_gz(&archive_content, &temp_dir, &version, platform)?
    };

    // Emit progress: installing
    emit_progress(&app, "installing", "Installing GitHub CLI...", 60);

    // Move binary to final location
    // Use write_binary_file to handle Windows file-locking (OS error 32)
    let binary_content = std::fs::read(&extracted_binary_path)
        .map_err(|e| format!("Failed to read extracted binary: {e}"))?;
    crate::platform::write_binary_file(&binary_path, &binary_content)
        .map_err(|e| format!("Failed to copy binary: {e}"))?;

    // Clean up temp directory
    let _ = std::fs::remove_dir_all(&temp_dir);

    // Emit progress: verifying
    emit_progress(&app, "verifying", "Verifying installation...", 80);

    // Make sure the binary is executable
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&binary_path)
            .map_err(|e| format!("Failed to get binary metadata: {e}"))?
            .permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&binary_path, perms)
            .map_err(|e| format!("Failed to set binary permissions: {e}"))?;
    }

    // Verify the binary works
    // Use the binary directly - shell wrapper causes PowerShell parsing issues on Windows
    log::trace!("Verifying binary at {:?}", binary_path);
    let version_output = silent_command(&binary_path)
        .arg("--version")
        .output()
        .map_err(|e| format!("Failed to verify GitHub CLI: {e}"))?;

    if !version_output.status.success() {
        let stderr = String::from_utf8_lossy(&version_output.stderr);
        let stdout = String::from_utf8_lossy(&version_output.stdout);
        log::error!(
            "GitHub CLI verification failed - exit code: {:?}, stdout: {}, stderr: {}",
            version_output.status.code(),
            stdout,
            stderr
        );
        return Err(format!(
            "GitHub CLI binary verification failed: {}",
            if !stderr.is_empty() {
                stderr.to_string()
            } else {
                "Unknown error".to_string()
            }
        ));
    }

    let installed_version = String::from_utf8_lossy(&version_output.stdout)
        .trim()
        .to_string();
    log::trace!("Verified GitHub CLI version: {installed_version}");

    // Emit progress: complete
    emit_progress(&app, "complete", "Installation complete!", 100);

    log::trace!("GitHub CLI installed successfully at {:?}", binary_path);
    Ok(())
}

/// Fetch the latest GitHub CLI version from GitHub API
async fn fetch_latest_gh_version() -> Result<String, String> {
    log::trace!("Fetching latest GitHub CLI version");

    let client = reqwest::Client::builder()
        .user_agent("Jean-App/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let response = client
        .get(format!("{GITHUB_RELEASES_API}/latest"))
        .send()
        .await
        .map_err(|e| format!("Failed to fetch latest release: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch latest release: HTTP {}",
            response.status()
        ));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse release info: {e}"))?;

    let version = release
        .tag_name
        .strip_prefix('v')
        .unwrap_or(&release.tag_name)
        .to_string();
    log::trace!("Latest GitHub CLI version: {version}");
    Ok(version)
}

/// Extract gh binary from a zip archive (macOS, Windows)
fn extract_zip(
    archive_content: &[u8],
    temp_dir: &std::path::Path,
    version: &str,
    platform: &str,
) -> Result<std::path::PathBuf, String> {
    use std::io::Cursor;

    let cursor = Cursor::new(archive_content);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to open zip archive: {e}"))?;

    // Extract all files
    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {e}"))?;

        let outpath = match file.enclosed_name() {
            Some(path) => temp_dir.join(path),
            None => continue,
        };

        if file.is_dir() {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {e}"))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    std::fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {e}"))?;
                }
            }
            let mut outfile = std::fs::File::create(&outpath)
                .map_err(|e| format!("Failed to create file: {e}"))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to extract file: {e}"))?;
        }
    }

    // The binary is at gh_{version}_{platform}/bin/gh (or gh.exe on Windows)
    // Some archives (e.g., Windows) don't have the version-platform prefix directory
    #[cfg(not(target_os = "windows"))]
    let binary_name = "gh";
    #[cfg(target_os = "windows")]
    let binary_name = "gh.exe";

    // Try with version-platform prefix directory first (Linux/macOS archives)
    let binary_path = temp_dir
        .join(format!("gh_{version}_{platform}"))
        .join("bin")
        .join(binary_name);

    if binary_path.exists() {
        return Ok(binary_path);
    }

    // Try without prefix directory (Windows archives)
    let binary_path_no_prefix = temp_dir.join("bin").join(binary_name);

    if binary_path_no_prefix.exists() {
        return Ok(binary_path_no_prefix);
    }

    Err(format!(
        "Binary not found in archive at {:?} or {:?}",
        binary_path, binary_path_no_prefix
    ))
}

/// Extract gh binary from a tar.gz archive (Linux)
fn extract_tar_gz(
    archive_content: &[u8],
    temp_dir: &std::path::Path,
    version: &str,
    platform: &str,
) -> Result<std::path::PathBuf, String> {
    use flate2::read::GzDecoder;
    use std::io::Cursor;
    use tar::Archive;

    let cursor = Cursor::new(archive_content);
    let decoder = GzDecoder::new(cursor);
    let mut archive = Archive::new(decoder);

    archive
        .unpack(temp_dir)
        .map_err(|e| format!("Failed to extract tar.gz archive: {e}"))?;

    // The binary is at gh_{version}_{platform}/bin/gh
    let binary_path = temp_dir
        .join(format!("gh_{version}_{platform}"))
        .join("bin")
        .join("gh");

    if !binary_path.exists() {
        return Err(format!("Binary not found in archive at {:?}", binary_path));
    }

    Ok(binary_path)
}

/// Result of checking GitHub CLI authentication status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhAuthStatus {
    /// Whether the CLI is authenticated
    pub authenticated: bool,
    /// Error message if authentication check failed
    pub error: Option<String>,
}

/// Check if GitHub CLI is authenticated by running `gh auth status`
#[tauri::command]
pub async fn check_gh_cli_auth(app: AppHandle) -> Result<GhAuthStatus, String> {
    log::trace!("Checking GitHub CLI authentication status");

    let binary_path = get_gh_cli_binary_path(&app)?;

    if !binary_path.exists() {
        return Ok(GhAuthStatus {
            authenticated: false,
            error: Some("GitHub CLI not installed".to_string()),
        });
    }

    // Run gh auth status to check authentication
    log::trace!("Running auth check: {:?} auth status", binary_path);

    let output = silent_command(&binary_path)
        .args(["auth", "status"])
        .output()
        .map_err(|e| format!("Failed to execute GitHub CLI: {e}"))?;

    // gh auth status returns exit code 0 if authenticated, non-zero otherwise
    if output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        log::trace!("GitHub CLI auth check successful: {}", stdout);
        Ok(GhAuthStatus {
            authenticated: true,
            error: None,
        })
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        log::warn!("GitHub CLI auth check failed: {}", stderr);
        Ok(GhAuthStatus {
            authenticated: false,
            error: Some(stderr),
        })
    }
}

/// Helper function to emit installation progress events
fn emit_progress(app: &AppHandle, stage: &str, message: &str, percent: u8) {
    let progress = GhInstallProgress {
        stage: stage.to_string(),
        message: message.to_string(),
        percent,
    };

    if let Err(e) = app.emit_all("gh-cli:install-progress", &progress) {
        log::warn!("Failed to emit install progress: {}", e);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_multiple_gh_accounts_from_auth_status() {
        let output = r#"github.com
  ✓ Logged in to github.com account DengYiping (/Users/test/.config/gh/hosts.yml)
  - Active account: true
  - Git operations protocol: ssh
  - Token: gho_one
  - Token scopes: 'gist', 'repo'

  ✓ Logged in to github.com account ydeng_hubspot (keyring)
  - Active account: false
  - Git operations protocol: ssh
  - Token: gho_two
  - Token scopes: 'gist', 'project', 'repo'

git.hubteam.com
  ✓ Logged in to git.hubteam.com account ydeng (/Users/test/.config/gh/hosts.yml)
  - Active account: true
  - Git operations protocol: ssh
  - Token: ghe_three
  - Token scopes: 'read:org', 'repo'
"#;

        let parsed = parse_gh_auth_status_output(output);
        assert_eq!(parsed.len(), 3);

        assert_eq!(parsed[0].account.host, "github.com");
        assert_eq!(parsed[0].account.user, "DengYiping");
        assert!(parsed[0].account.active);
        assert_eq!(parsed[0].account.git_protocol.as_deref(), Some("ssh"));
        assert_eq!(
            parsed[0].account.credential_source.as_deref(),
            Some("/Users/test/.config/gh/hosts.yml")
        );
        assert_eq!(parsed[0].token.as_deref(), Some("gho_one"));
        assert_eq!(parsed[0].account.token_scopes, vec!["gist", "repo"]);

        assert_eq!(parsed[1].account.user, "ydeng_hubspot");
        assert!(!parsed[1].account.active);
        assert_eq!(
            parsed[1].account.credential_source.as_deref(),
            Some("keyring")
        );
        assert_eq!(
            parsed[1].account.token_scopes,
            vec!["gist", "project", "repo"]
        );

        assert_eq!(parsed[2].account.host, "git.hubteam.com");
        assert_eq!(parsed[2].account.user, "ydeng");
        assert_eq!(parsed[2].token.as_deref(), Some("ghe_three"));
    }
}
