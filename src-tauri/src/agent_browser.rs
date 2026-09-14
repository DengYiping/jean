//! Managed Agent Browser installation and MCP configuration.
//!
//! The browser profile and npm installation are owned by Jean so a user can
//! sign in once and all supported local agents reuse the same Chromium state.

use serde::Serialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::platform::{find_cli_in_host_path, silent_command};

pub const MCP_SERVER_NAME: &str = "agent-browser";
const NPM_PACKAGE: &str = "agent-browser";
const CLI_DIR_NAME: &str = "agent-browser-cli";
const PROFILE_ENV: &str = "AGENT_BROWSER_PROFILE";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBrowserStatus {
    pub installed: bool,
    pub binary_path: Option<String>,
    pub version: Option<String>,
    pub profile_path: String,
    pub profile_exists: bool,
    pub managed_dir: String,
    pub managed_install: bool,
    pub claude_snippet: String,
    pub codex_snippet: String,
    pub install_hint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBrowserInstallResult {
    pub backend: String,
    pub status: String,
    pub path: Option<String>,
    pub backup_path: Option<String>,
    pub server_name: String,
    pub message: String,
}

struct McpEntry {
    command: String,
    profile_path: String,
}

impl McpEntry {
    fn env(&self) -> serde_json::Map<String, Value> {
        [(PROFILE_ENV.into(), self.profile_path.clone().into())]
            .into_iter()
            .collect()
    }

    fn claude_config(&self) -> Value {
        json!({
            "type": "stdio",
            "command": self.command,
            "args": ["mcp"],
            "env": self.env(),
        })
    }

    fn opencode_config(&self) -> Value {
        json!({
            "type": "local",
            "command": [self.command, "mcp"],
            "enabled": true,
            "environment": self.env(),
        })
    }

    fn claude_snippet(&self) -> String {
        serde_json::to_string_pretty(&json!({
            "mcpServers": { MCP_SERVER_NAME: self.claude_config() }
        }))
        .unwrap_or_default()
    }

    fn codex_snippet(&self) -> String {
        format!(
            "[mcp_servers.{MCP_SERVER_NAME}]\ncommand = \"{}\"\nargs = [\"mcp\"]\nenv = {{ {PROFILE_ENV} = \"{}\" }}\nenabled = true\n",
            escape_toml_string(&self.command),
            escape_toml_string(&self.profile_path),
        )
    }
}

fn escape_toml_string(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn profile_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(app_data.join("agent-browser").join("profile"))
}

fn managed_cli_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    Ok(app_data.join(CLI_DIR_NAME))
}

fn managed_bin_path(cli_dir: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "agent-browser.cmd"
    } else {
        "agent-browser"
    };
    cli_dir.join("node_modules").join(".bin").join(name)
}

fn resolve_binary(app: &AppHandle) -> Result<(Option<PathBuf>, bool), String> {
    let managed = managed_bin_path(&managed_cli_dir(app)?);
    if managed.is_file() {
        return Ok((Some(managed), true));
    }
    Ok((find_cli_in_host_path("agent-browser", None), false))
}

fn version(binary: &Path) -> Option<String> {
    let output = silent_command(binary).arg("--version").output().ok()?;
    output.status.success().then(|| {
        String::from_utf8_lossy(&output.stdout)
            .trim()
            .trim_start_matches('v')
            .to_string()
    })
}

fn ensure_profile(app: &AppHandle) -> Result<PathBuf, String> {
    let path = profile_path(app)?;
    std::fs::create_dir_all(&path).map_err(|e| {
        format!(
            "Failed to create Agent Browser profile {}: {e}",
            path.display()
        )
    })?;
    Ok(path)
}

fn status(app: &AppHandle) -> Result<AgentBrowserStatus, String> {
    let profile = profile_path(app)?;
    let managed_dir = managed_cli_dir(app)?;
    let (binary, managed_install) = resolve_binary(app)?;
    let entry = McpEntry {
        command: binary
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| "agent-browser".to_string()),
        profile_path: profile.to_string_lossy().to_string(),
    };
    Ok(AgentBrowserStatus {
        installed: binary.is_some(),
        binary_path: binary.as_ref().map(|path| path.to_string_lossy().to_string()),
        version: binary.as_deref().and_then(version),
        profile_path: profile.to_string_lossy().to_string(),
        profile_exists: profile.is_dir(),
        managed_dir: managed_dir.to_string_lossy().to_string(),
        managed_install,
        claude_snippet: entry.claude_snippet(),
        codex_snippet: entry.codex_snippet(),
        install_hint: "Use Install agent-browser in Settings, or: npm install -g agent-browser && agent-browser install".to_string(),
    })
}

pub async fn get_agent_browser_status(app: AppHandle) -> Result<AgentBrowserStatus, String> {
    tokio::task::spawn_blocking(move || status(&app))
        .await
        .map_err(|e| format!("Agent Browser status task failed: {e}"))?
}

pub async fn ensure_agent_browser_profile(app: AppHandle) -> Result<AgentBrowserStatus, String> {
    tokio::task::spawn_blocking(move || {
        ensure_profile(&app)?;
        status(&app)
    })
    .await
    .map_err(|e| format!("Agent Browser profile task failed: {e}"))?
}

pub async fn install_agent_browser(app: AppHandle) -> Result<AgentBrowserStatus, String> {
    tokio::task::spawn_blocking(move || {
        let cli_dir = managed_cli_dir(&app)?;
        std::fs::create_dir_all(&cli_dir)
            .map_err(|e| format!("Failed to create Agent Browser install directory: {e}"))?;
        ensure_profile(&app)?;

        let output = silent_command("npm")
            .args(["install", "--prefix"])
            .arg(&cli_dir)
            .arg(NPM_PACKAGE)
            .output()
            .map_err(|e| {
                format!("Failed to run npm install for agent-browser (is npm on PATH?): {e}")
            })?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("npm install agent-browser failed: {error}"));
        }

        let binary = managed_bin_path(&cli_dir);
        if !binary.is_file() {
            return Err(format!(
                "npm install completed but agent-browser was not found at {}",
                binary.display()
            ));
        }
        let output = silent_command(&binary)
            .arg("install")
            .output()
            .map_err(|e| format!("Failed to download Agent Browser Chromium: {e}"))?;
        if !output.status.success() {
            let error = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(format!("agent-browser install failed: {error}"));
        }
        status(&app)
    })
    .await
    .map_err(|e| format!("Agent Browser install task failed: {e}"))?
}

pub async fn install_agent_browser_mcp(
    app: AppHandle,
    backends: Option<Vec<String>>,
) -> Result<Vec<AgentBrowserInstallResult>, String> {
    tokio::task::spawn_blocking(move || {
        let profile = ensure_profile(&app)?;
        let (binary, _) = resolve_binary(&app)?;
        let command = binary
            .map(|path| path.to_string_lossy().to_string())
            .ok_or_else(|| "agent-browser is not installed. Install it first.".to_string())?;
        let entry = McpEntry {
            command,
            profile_path: profile.to_string_lossy().to_string(),
        };
        let backends = backends.unwrap_or_else(|| {
            vec![
                "claude".to_string(),
                "codex".to_string(),
                "opencode".to_string(),
            ]
        });
        let home = dirs::home_dir().ok_or_else(|| "Home directory unavailable".to_string())?;
        Ok(backends
            .into_iter()
            .map(|backend| {
                let result = match backend.as_str() {
                    "claude" => crate::jean_mcp_config::install_jsonc_mcp_server(
                        home.join(".claude.json"),
                        "mcpServers",
                        MCP_SERVER_NAME,
                        entry.claude_config(),
                    ),
                    "codex" => crate::jean_mcp_config::install_codex_mcp_server(
                        home.join(".codex").join("config.toml"),
                        MCP_SERVER_NAME,
                        &entry.command,
                        &["mcp"],
                        &entry.env(),
                    ),
                    "opencode" => crate::jean_mcp_config::install_jsonc_mcp_server(
                        crate::jean_mcp_config::find_opencode_config_path(&home).unwrap_or_else(
                            || home.join(".config").join("opencode").join("opencode.json"),
                        ),
                        "mcp",
                        MCP_SERVER_NAME,
                        entry.opencode_config(),
                    ),
                    _ => Err(format!("Unsupported Agent Browser backend: {backend}")),
                };
                match result {
                    Ok((path, backup_path)) => AgentBrowserInstallResult {
                        backend,
                        status: "installed".to_string(),
                        path: Some(path.to_string_lossy().to_string()),
                        backup_path: backup_path.map(|path| path.to_string_lossy().to_string()),
                        server_name: MCP_SERVER_NAME.to_string(),
                        message: "Installed agent-browser".to_string(),
                    },
                    Err(message) => AgentBrowserInstallResult {
                        backend,
                        status: "error".to_string(),
                        path: None,
                        backup_path: None,
                        server_name: MCP_SERVER_NAME.to_string(),
                        message,
                    },
                }
            })
            .collect())
    })
    .await
    .map_err(|e| format!("Agent Browser MCP setup task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snippets_use_the_shared_persistent_profile() {
        let entry = McpEntry {
            command: "/managed/agent-browser".to_string(),
            profile_path: "/data/agent-browser/profile".to_string(),
        };

        assert_eq!(
            entry.claude_config()["env"][PROFILE_ENV],
            "/data/agent-browser/profile"
        );
        assert_eq!(
            entry.opencode_config()["environment"][PROFILE_ENV],
            "/data/agent-browser/profile"
        );
        assert!(entry
            .codex_snippet()
            .contains("[mcp_servers.agent-browser]"));
    }
}
