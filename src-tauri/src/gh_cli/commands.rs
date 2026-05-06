//! Tauri commands for GitHub CLI management

use crate::platform::silent_command;
use crate::projects::storage::{find_project_for_repo_path, load_projects_data};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::process::Command;
use std::sync::RwLock;
use tauri::AppHandle;

use super::config::{find_gh_in_path, get_gh_cli_dir, resolve_gh_binary};

/// Emergency fallback version when API fails AND no cache exists.
/// The download URL pattern is stable for any valid version, so staleness is acceptable.
const FALLBACK_GH_VERSION: &str = "2.74.0";

/// Cache file name for storing fetched versions
const GH_VERSIONS_CACHE_FILE: &str = "gh-versions-cache.json";

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

    let Some(binary_path) = find_gh_in_path(&app) else {
        log::trace!("GitHub CLI not found in PATH");
        return Ok(GhCliStatus {
            installed: false,
            version: None,
            path: None,
        });
    };

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

/// Get available GitHub CLI versions from GitHub releases API.
///
/// Falls back to disk cache or a hardcoded version if the API is unreachable
/// (e.g., rate-limited on unauthenticated requests during first-time onboarding).
#[tauri::command]
pub async fn get_available_gh_versions(app: AppHandle) -> Result<Vec<GhReleaseInfo>, String> {
    log::trace!("Fetching available GitHub CLI versions from GitHub API");

    match fetch_gh_versions_from_api(&app).await {
        Ok(versions) if !versions.is_empty() => {
            save_gh_versions_cache(&app, &versions);
            Ok(versions)
        }
        Ok(_empty) => {
            log::warn!("GitHub API returned empty releases, falling back to cache");
            Ok(load_gh_versions_cache(&app).unwrap_or_else(fallback_gh_versions))
        }
        Err(e) => {
            log::warn!("GitHub API request failed ({e}), falling back to cache");
            Ok(load_gh_versions_cache(&app).unwrap_or_else(fallback_gh_versions))
        }
    }
}

/// Fetch versions directly from the GitHub API (no fallback).
async fn fetch_gh_versions_from_api(app: &AppHandle) -> Result<Vec<GhReleaseInfo>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Jean-App/1.0")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {e}"))?;

    let token = resolve_github_api_token(app);
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

    let versions: Vec<GhReleaseInfo> = releases
        .into_iter()
        .filter(|r| !r.assets.is_empty())
        .take(5)
        .map(|r| {
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

    log::trace!("Found {} GitHub CLI versions from API", versions.len());
    Ok(versions)
}

/// Resolve a GitHub API token from environment or gh auth.
///
/// Priority:
/// 1) GH_TOKEN / GITHUB_TOKEN env vars
/// 2) `gh auth token` from the host-system gh binary
pub fn resolve_github_api_token(app: &AppHandle) -> Option<String> {
    for key in ["GH_TOKEN", "GITHUB_TOKEN"] {
        if let Ok(value) = std::env::var(key) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }

    let gh = resolve_gh_binary(app);

    let output = match silent_command(&gh).args(["auth", "token"]).output() {
        Ok(output) => output,
        Err(_) => return None,
    };
    if !output.status.success() {
        return None;
    }
    let token = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if !token.is_empty() {
        return Some(token);
    }

    None
}

/// Cached versions structure for disk persistence
#[derive(Debug, Serialize, Deserialize)]
struct CachedGhVersions {
    versions: Vec<GhReleaseInfo>,
    fetched_at: String,
}

/// Save fetched versions to disk cache
fn save_gh_versions_cache(app: &AppHandle, versions: &[GhReleaseInfo]) {
    let cache_path = match super::config::ensure_gh_cli_dir(app) {
        Ok(dir) => dir.join(GH_VERSIONS_CACHE_FILE),
        Err(e) => {
            log::warn!("Cannot resolve gh CLI dir for cache: {e}");
            return;
        }
    };

    let fetched_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();

    let cached = CachedGhVersions {
        versions: versions.to_vec(),
        fetched_at,
    };

    match serde_json::to_string(&cached) {
        Ok(json) => {
            if let Err(e) = std::fs::write(&cache_path, json) {
                log::warn!("Failed to write gh versions cache: {e}");
            } else {
                log::trace!("Saved {} gh versions to cache", versions.len());
            }
        }
        Err(e) => log::warn!("Failed to serialize gh versions cache: {e}"),
    }
}

/// Load cached versions from disk
fn load_gh_versions_cache(app: &AppHandle) -> Option<Vec<GhReleaseInfo>> {
    let cache_path = super::config::get_gh_cli_dir(app)
        .ok()?
        .join(GH_VERSIONS_CACHE_FILE);
    let contents = std::fs::read_to_string(&cache_path).ok()?;
    let cached: CachedGhVersions = serde_json::from_str(&contents).ok()?;
    if cached.versions.is_empty() {
        return None;
    }
    log::trace!(
        "Loaded {} cached gh versions (fetched at {})",
        cached.versions.len(),
        cached.fetched_at
    );
    Some(cached.versions)
}

/// Build a single-entry fallback version list from the hardcoded constant
fn fallback_gh_versions() -> Vec<GhReleaseInfo> {
    vec![GhReleaseInfo {
        version: FALLBACK_GH_VERSION.to_string(),
        tag_name: format!("v{FALLBACK_GH_VERSION}"),
        published_at: String::new(),
        prerelease: false,
    }]
}

/// GitHub CLI must be installed on the host system.
#[tauri::command]
pub async fn install_gh_cli(_app: AppHandle, _version: Option<String>) -> Result<(), String> {
    Err("Jean no longer installs GitHub CLI. Install `gh` on your PATH and refresh.".to_string())
}

/// Remove the legacy Jean-managed GitHub CLI directory, if present.
#[tauri::command]
pub async fn uninstall_gh_cli(app: AppHandle) -> Result<(), String> {
    let cli_dir = get_gh_cli_dir(&app)?;
    if cli_dir.exists() {
        std::fs::remove_dir_all(&cli_dir)
            .map_err(|e| format!("Failed to remove GitHub CLI directory: {e}"))?;
        log::info!("Removed legacy Jean-managed GitHub CLI at {:?}", cli_dir);
    }
    Ok(())
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

    let binary_path = resolve_gh_binary(&app);

    if !binary_path.exists() {
        return Ok(GhAuthStatus {
            authenticated: false,
            error: Some("GitHub CLI not installed".to_string()),
        });
    }

    // Run gh auth status to check authentication
    log::trace!("Running auth check: {:?} auth status --active", binary_path);

    let output = silent_command(&binary_path)
        .args(["auth", "status", "--active"])
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

/// Result of detecting GitHub CLI in system PATH
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GhPathDetection {
    pub found: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    pub package_manager: Option<String>,
}

/// Detect GitHub CLI in system PATH (excluding Jean-managed binary)
#[tauri::command]
pub async fn detect_gh_in_path(app: AppHandle) -> Result<GhPathDetection, String> {
    log::trace!("Detecting GitHub CLI in system PATH");

    let Some(found_path) = find_gh_in_path(&app) else {
        log::trace!("GitHub CLI not found in PATH");
        return Ok(GhPathDetection {
            found: false,
            path: None,
            version: None,
            package_manager: None,
        });
    };

    // gh --version returns "gh version 2.40.0 (2024-01-15)"
    let version = match silent_command(&found_path).arg("--version").output() {
        Ok(ver_output) if ver_output.status.success() => {
            let ver_str = String::from_utf8_lossy(&ver_output.stdout)
                .trim()
                .to_string();
            ver_str.split_whitespace().nth(2).map(|s| s.to_string())
        }
        _ => None,
    };

    let package_manager = crate::platform::detect_package_manager(&found_path);

    log::trace!(
        "Found GitHub CLI in PATH: {} (version: {version:?}, pkg_mgr: {package_manager:?})",
        found_path.display()
    );

    Ok(GhPathDetection {
        found: true,
        path: Some(found_path.to_string_lossy().to_string()),
        version,
        package_manager,
    })
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
