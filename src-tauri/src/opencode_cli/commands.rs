//! Tauri commands for OpenCode CLI management

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::config::resolve_cli_binary;
use crate::http_server::EmitExt;
use crate::platform::silent_command;

/// GitHub owner/repo for OpenCode releases.
const GITHUB_REPO: &str = "anomalyco/opencode";

/// Status of the OpenCode CLI installation
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenCodeCliStatus {
    pub installed: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

/// Auth status of the OpenCode CLI
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenCodeAuthStatus {
    pub authenticated: bool,
    pub error: Option<String>,
}

/// Information about an OpenCode CLI release
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenCodeReleaseInfo {
    pub version: String,
    pub tag_name: String,
    pub published_at: String,
    pub prerelease: bool,
}

/// Progress event for CLI installation
#[derive(Debug, Clone, Serialize)]
pub struct OpenCodeInstallProgress {
    pub stage: String,
    pub message: String,
    pub percent: u8,
}

/// GitHub release response (subset of fields we need)
#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    published_at: Option<String>,
    prerelease: bool,
}

/// Platform-specific asset info for download.
struct PlatformAsset {
    /// e.g. `opencode-darwin-arm64.zip` or `opencode-linux-arm64.tar.gz`
    asset_name: String,
    /// Archive format: `zip` or `tar.gz`
    format: ArchiveFormat,
}

#[allow(dead_code)] // Variants are platform-gated via #[cfg]
enum ArchiveFormat {
    Zip,
    TarGz,
}

/// List available OpenCode models by refreshing from the OpenCode CLI cache source.
#[tauri::command]
pub async fn list_opencode_models(app: AppHandle) -> Result<Vec<String>, String> {
    let binary_path = resolve_cli_binary(&app);
    if !binary_path.exists() {
        return Err(format!(
            "OpenCode CLI not found at {}. Install it in Settings > General.",
            binary_path.display()
        ));
    }

    let output = silent_command(&binary_path)
        .args(["models", "--refresh", "--verbose"])
        .output()
        .map_err(|e| format!("Failed to execute OpenCode CLI models command: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "OpenCode models command failed".to_string()
        } else {
            format!("OpenCode models command failed: {stderr}")
        });
    }

    let stdout_raw = String::from_utf8_lossy(&output.stdout).to_string();
    let stdout = strip_ansi(&stdout_raw);

    let mut models = Vec::new();
    for line in stdout.lines() {
        let candidate = line.trim();
        if is_model_identifier(candidate) {
            models.push(candidate.to_string());
        }
    }

    models.sort();
    models.dedup();
    Ok(models)
}

fn emit_progress(app: &AppHandle, stage: &str, message: &str, percent: u8) {
    let _ = app.emit_all(
        "opencode-cli:install-progress",
        &OpenCodeInstallProgress {
            stage: stage.to_string(),
            message: message.to_string(),
            percent,
        },
    );
}

/// Check if OpenCode CLI is installed and get its status.
#[tauri::command]
pub async fn check_opencode_cli_installed(app: AppHandle) -> Result<OpenCodeCliStatus, String> {
    log::trace!("Checking OpenCode CLI installation status");

    let binary_path = resolve_cli_binary(&app);

    if !binary_path.exists() {
        return Ok(OpenCodeCliStatus {
            installed: false,
            version: None,
            path: None,
        });
    }

    let version = match silent_command(&binary_path).arg("--version").output() {
        Ok(output) if output.status.success() => {
            let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let cleaned = version_str
                .split_whitespace()
                .last()
                .unwrap_or(&version_str)
                .trim_start_matches('v')
                .to_string();
            if cleaned.is_empty() {
                None
            } else {
                Some(cleaned)
            }
        }
        _ => None,
    };

    Ok(OpenCodeCliStatus {
        installed: true,
        version,
        path: Some(binary_path.to_string_lossy().to_string()),
    })
}

fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek().is_some_and(|c| *c == '[') {
                let _ = chars.next();
                while let Some(c) = chars.next() {
                    if ('@'..='~').contains(&c) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

fn auth_list_has_credentials(stdout: &str) -> bool {
    let normalized = strip_ansi(stdout).to_lowercase();
    normalized.contains("credential") && !normalized.contains("0 credentials")
}

fn model_list_has_entries(stdout: &str) -> bool {
    strip_ansi(stdout).lines().any(|line| {
        let candidate = line.trim();
        !candidate.is_empty()
            && !candidate.starts_with('{')
            && !candidate.starts_with('"')
            && !candidate.starts_with("Models cache refreshed")
            && candidate.contains('/')
    })
}

fn check_opencode_has_available_models(binary_path: &std::path::Path) -> Result<bool, String> {
    let output = silent_command(binary_path)
        .arg("models")
        .output()
        .map_err(|e| format!("Failed to execute OpenCode CLI models command: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() {
            "OpenCode models command failed".to_string()
        } else {
            stderr
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(model_list_has_entries(&stdout))
}

/// Validates model identifiers in the format: `provider/model` or `openrouter/provider/model`.
/// Both support an optional `:qualifier` suffix on the model (e.g. `:free`, `:exacto`).
fn is_model_identifier(value: &str) -> bool {
    if value.is_empty() || !value.contains('/') {
        return false;
    }

    fn allowed_segment(s: &str) -> bool {
        !s.is_empty()
            && s.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    }

    fn allowed_last_segment(s: &str) -> bool {
        // Allow optional :qualifier suffix (e.g. ":free", ":exacto")
        let base = s.split_once(':').map_or(s, |(b, _)| b);
        allowed_segment(base)
    }

    let parts: Vec<&str> = value.split('/').collect();
    let n = parts.len();
    parts[..n - 1].iter().all(|s| allowed_segment(s)) && allowed_last_segment(parts[n - 1])
}

/// Check if OpenCode CLI has any configured credentials.
#[tauri::command]
pub async fn check_opencode_cli_auth(app: AppHandle) -> Result<OpenCodeAuthStatus, String> {
    log::trace!("Checking OpenCode CLI authentication status");

    let binary_path = resolve_cli_binary(&app);

    if !binary_path.exists() {
        return Ok(OpenCodeAuthStatus {
            authenticated: false,
            error: Some("OpenCode CLI not installed".to_string()),
        });
    }

    let output = silent_command(&binary_path)
        .args(["auth", "list"])
        .output()
        .map_err(|e| format!("Failed to execute OpenCode CLI: {e}"))?;

    let auth_list_error = if output.status.success() {
        None
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        Some(if stderr.is_empty() {
            "Not authenticated".to_string()
        } else {
            stderr
        })
    };

    let auth_list_stdout = String::from_utf8_lossy(&output.stdout);
    if auth_list_has_credentials(&auth_list_stdout) {
        return Ok(OpenCodeAuthStatus {
            authenticated: true,
            error: None,
        });
    }

    match check_opencode_has_available_models(&binary_path) {
        Ok(true) => Ok(OpenCodeAuthStatus {
            authenticated: true,
            error: None,
        }),
        Ok(false) => Ok(OpenCodeAuthStatus {
            authenticated: false,
            error: Some(auth_list_error.unwrap_or_else(|| {
                "No OpenCode credentials or configured providers detected.".to_string()
            })),
        }),
        Err(models_error) => Ok(OpenCodeAuthStatus {
            authenticated: false,
            error: Some(auth_list_error.unwrap_or(models_error)),
        }),
    }
}

/// Get the platform-specific asset info for GitHub release downloads.
///
/// Asset naming from anomalyco/opencode releases:
/// - macOS:   `opencode-darwin-arm64.zip`, `opencode-darwin-x64.zip`
/// - Linux:   `opencode-linux-arm64.tar.gz`, `opencode-linux-x64.tar.gz`
/// - Windows: `opencode-windows-x64.zip`
fn get_platform_asset() -> Result<PlatformAsset, String> {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    {
        return Ok(PlatformAsset {
            asset_name: "opencode-darwin-arm64.zip".to_string(),
            format: ArchiveFormat::Zip,
        });
    }
    #[cfg(all(target_os = "macos", target_arch = "x86_64"))]
    {
        return Ok(PlatformAsset {
            asset_name: "opencode-darwin-x64.zip".to_string(),
            format: ArchiveFormat::Zip,
        });
    }
    #[cfg(all(target_os = "linux", target_arch = "aarch64"))]
    {
        return Ok(PlatformAsset {
            asset_name: "opencode-linux-arm64.tar.gz".to_string(),
            format: ArchiveFormat::TarGz,
        });
    }
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    {
        return Ok(PlatformAsset {
            asset_name: "opencode-linux-x64.tar.gz".to_string(),
            format: ArchiveFormat::TarGz,
        });
    }
    #[cfg(all(target_os = "windows", target_arch = "x86_64"))]
    {
        return Ok(PlatformAsset {
            asset_name: "opencode-windows-x64.zip".to_string(),
            format: ArchiveFormat::Zip,
        });
    }

    #[allow(unreachable_code)]
    Err("Unsupported platform".to_string())
}

/// Get available OpenCode versions from GitHub releases.
#[tauri::command]
pub async fn get_available_opencode_versions() -> Result<Vec<OpenCodeReleaseInfo>, String> {
    let url = format!("https://api.github.com/repos/{GITHUB_REPO}/releases");
    log::debug!("Fetching available OpenCode versions from {url}");

    let client = reqwest::Client::new();
    let response = client
        .get(&url)
        .header("User-Agent", "jean-desktop")
        .query(&[("per_page", "20")])
        .send()
        .await
        .map_err(|e| {
            log::error!("OpenCode versions fetch failed: {e}");
            format!("Failed to fetch GitHub releases: {e}")
        })?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        log::error!("OpenCode versions API returned {status}: {body}");
        return Err(format!("GitHub API returned status: {status}"));
    }

    let body = response.text().await.map_err(|e| {
        log::error!("OpenCode versions: failed to read response body: {e}");
        format!("Failed to read response: {e}")
    })?;

    let releases: Vec<GitHubRelease> = serde_json::from_str(&body).map_err(|e| {
        log::error!(
            "OpenCode versions: failed to parse JSON: {e}, body: {}",
            &body[..body.len().min(500)]
        );
        format!("Failed to parse GitHub releases: {e}")
    })?;

    log::debug!("OpenCode versions: got {} releases", releases.len());

    let result: Vec<OpenCodeReleaseInfo> = releases
        .into_iter()
        .map(|r| {
            let version = r.tag_name.trim_start_matches('v').to_string();
            OpenCodeReleaseInfo {
                version,
                tag_name: r.tag_name,
                published_at: r.published_at.unwrap_or_default(),
                prerelease: r.prerelease,
            }
        })
        .collect();

    log::debug!("OpenCode versions: returning {} versions", result.len());
    Ok(result)
}

/// Install OpenCode CLI by downloading the binary from GitHub releases.
#[tauri::command]
pub async fn install_opencode_cli(_app: AppHandle, _version: Option<String>) -> Result<(), String> {
    Err(
        "Jean now uses the OpenCode CLI from your host system. Install `opencode` on your machine and restart or refresh Jean."
            .to_string(),
    )
}

/// Extract a named binary from a tar.gz archive.
fn extract_binary_from_tar_gz(archive_bytes: &[u8], binary_name: &str) -> Result<Vec<u8>, String> {
    use flate2::read::GzDecoder;
    use std::io::Read;
    use tar::Archive;

    let decoder = GzDecoder::new(archive_bytes);
    let mut archive = Archive::new(decoder);

    let entries = archive
        .entries()
        .map_err(|e| format!("Failed to read tar entries: {e}"))?;

    for entry in entries {
        let mut entry = entry.map_err(|e| format!("Failed to read tar entry: {e}"))?;
        let path = entry
            .path()
            .map_err(|e| format!("Failed to read entry path: {e}"))?;

        if let Some(name) = path.file_name() {
            if name == binary_name {
                let mut data = Vec::new();
                entry
                    .read_to_end(&mut data)
                    .map_err(|e| format!("Failed to read binary from archive: {e}"))?;
                return Ok(data);
            }
        }
    }

    Err(format!(
        "Could not find '{binary_name}' binary in the tar.gz archive"
    ))
}

/// Extract a named binary from a zip archive.
fn extract_binary_from_zip(archive_bytes: &[u8], binary_name: &str) -> Result<Vec<u8>, String> {
    use std::io::Read;

    let cursor = std::io::Cursor::new(archive_bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read zip archive: {e}"))?;

    for i in 0..archive.len() {
        let mut file = archive
            .by_index(i)
            .map_err(|e| format!("Failed to read zip entry: {e}"))?;

        let path = std::path::Path::new(file.name());
        if let Some(name) = path.file_name() {
            if name == binary_name {
                let mut data = Vec::new();
                file.read_to_end(&mut data)
                    .map_err(|e| format!("Failed to read binary from zip: {e}"))?;
                return Ok(data);
            }
        }
    }

    Err(format!(
        "Could not find '{binary_name}' binary in the zip archive"
    ))
}

/// Fetch the latest release version from GitHub.
async fn fetch_latest_version() -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!(
            "https://api.github.com/repos/{GITHUB_REPO}/releases/latest"
        ))
        .header("User-Agent", "jean-desktop")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch latest version: {e}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "Failed to fetch latest version: HTTP {}",
            response.status()
        ));
    }

    let release: GitHubRelease = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse latest release: {e}"))?;

    Ok(release.tag_name.trim_start_matches('v').to_string())
}

#[cfg(test)]
mod tests {
    use super::{auth_list_has_credentials, is_model_identifier, model_list_has_entries};

    #[test]
    fn accepts_valid_model_identifiers() {
        assert!(is_model_identifier("opencode/gpt-5"));
        assert!(is_model_identifier("anthropic/claude-sonnet-4-5-20250929"));
        assert!(is_model_identifier("moonshotai/kimi-k2.5"));
    }

    #[test]
    fn rejects_non_model_lines_from_verbose_output() {
        assert!(!is_model_identifier("Models cache refreshed"));
        assert!(!is_model_identifier("{"));
        assert!(!is_model_identifier("\"id\": \"gpt-5\","));
        assert!(!is_model_identifier(
            "\"url\": \"https://opencode.ai/zen/v1\","
        ));
        assert!(!is_model_identifier("https://opencode.ai/zen/v1"));
    }

    #[test]
    fn detects_credentials_in_auth_list_output() {
        assert!(auth_list_has_credentials(
            "\u{1b}[0m\n┌  Credentials ~/.local/share/opencode/auth.json\n│\n├  openai\n└  1 credential\n"
        ));
        assert!(!auth_list_has_credentials(
            "\u{1b}[0m\n┌  Credentials ~/.local/share/opencode/auth.json\n│\n└  0 credentials\n"
        ));
    }

    #[test]
    fn detects_models_in_plain_model_list_output() {
        assert!(model_list_has_entries(
            "anthropic_locked/claude-sonnet-4-6\nopenai_locked/gpt-5.4\n"
        ));
        assert!(!model_list_has_entries(""));
        assert!(!model_list_has_entries("Models cache refreshed\n"));
    }

    #[test]
    fn get_platform_asset_returns_valid_name() {
        let asset = super::get_platform_asset();
        assert!(asset.is_ok(), "get_platform_asset() should succeed");
        let a = asset.unwrap();
        assert!(
            a.asset_name.starts_with("opencode-"),
            "unexpected asset name: {}",
            a.asset_name
        );
    }
}
