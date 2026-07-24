//! Shared Jean MCP tool registry/dispatch plus local stdio proxy helpers.
//!
//! Transport-specific frontends (HTTP and stdio) should keep protocol framing
//! only. Business logic lives here and routes to existing Jean commands.

use std::collections::{HashMap, VecDeque};
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::http_server::dispatch::dispatch_command;

pub const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
pub const JEAN_MCP_STDIO_ARG: &str = "--jean-mcp-stdio";
pub const JEAN_MCP_SOCKET_ENV: &str = "JEAN_MCP_SOCKET";
pub const JEAN_MCP_TOKEN_ENV: &str = "JEAN_MCP_TOKEN";
pub const JEAN_MCP_SESSION_ENV: &str = "JEAN_MCP_SESSION";
pub const JEAN_MCP_DEPTH_ENV: &str = "JEAN_MCP_DEPTH";

const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(60);
const RATE_LIMITED_TOOLS: &[&str] = &[
    "add_project",
    "archive_worktree",
    "cancel_session_run",
    "clone_project",
    "create_commit",
    "create_pull_request",
    "create_session",
    "create_worktree",
    "create_worktree_from_existing_branch",
    "delete_worktree",
    "detect_open_pr",
    "import_worktree",
    "init_project",
    "link_pr_to_worktree",
    "merge_pull_request",
    "permanently_delete_worktree",
    "push_worktree",
    "run_review",
    "send_chat_message",
    "unarchive_worktree",
];
const DEFAULT_MCP_DIFF_MAX_BYTES: usize = 60_000;
const MAX_MCP_DIFF_BYTES: usize = 200_000;

static RATE_BUCKETS: Lazy<std::sync::Mutex<HashMap<String, VecDeque<Instant>>>> =
    Lazy::new(|| std::sync::Mutex::new(HashMap::new()));

#[derive(Debug)]
pub struct ToolError {
    pub code: i32,
    pub message: String,
}

impl ToolError {
    pub fn invalid_params(msg: impl Into<String>) -> Self {
        Self {
            code: -32602,
            message: msg.into(),
        }
    }
    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            code: -32000,
            message: msg.into(),
        }
    }
}

pub fn current_depth() -> u32 {
    std::env::var(JEAN_MCP_DEPTH_ENV)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

pub fn next_depth() -> u32 {
    current_depth().saturating_add(1)
}

pub fn initialize_result() -> Value {
    json!({
        "protocolVersion": MCP_PROTOCOL_VERSION,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "jean", "version": env!("CARGO_PKG_VERSION") },
    })
}

pub fn tools_list_result() -> Value {
    json!({ "tools": tool_registry() })
}

#[derive(Debug)]
pub struct ToolCallRequest {
    pub name: String,
    pub arguments: Value,
}

pub fn extract_tool_call(params: Value) -> Result<ToolCallRequest, ToolError> {
    let name = params
        .get("name")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned)
        .ok_or_else(|| ToolError::invalid_params("missing 'name'"))?;
    let arguments = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    Ok(ToolCallRequest { name, arguments })
}

pub fn handle_protocol_message(
    body: Value,
    call_tool: impl FnMut(ToolCallRequest) -> Result<Value, String>,
) -> Option<Value> {
    let id = body.get("id").cloned();
    let method = body.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let params = body.get("params").cloned().unwrap_or(Value::Null);

    match method {
        "initialize" => Some(jsonrpc_ok(id, initialize_result())),
        "notifications/initialized" => None,
        "tools/list" => Some(jsonrpc_ok(id, tools_list_result())),
        "tools/call" => Some(
            match extract_tool_call(params)
                .map_err(|e| e.message)
                .and_then(call_tool)
            {
                Ok(result) => jsonrpc_ok(id, result),
                Err(e) => jsonrpc_error(id, -32000, &e),
            },
        ),
        "ping" => Some(jsonrpc_ok(id, json!({}))),
        _ => Some(jsonrpc_error(
            id,
            -32601,
            &format!("Method not found: {method}"),
        )),
    }
}

pub fn tool_registry() -> Value {
    let mut tools = tool_registry_core().as_array().cloned().unwrap_or_default();
    if let Some(shipping_tools) = tool_registry_shipping().as_array() {
        tools.extend(shipping_tools.iter().cloned());
    }
    Value::Array(tools)
}

fn tool_registry_core() -> Value {
    json!([
        {"name":"list_projects","description":"List all Jean projects (id, name, path, default_branch).","inputSchema":{"type":"object","properties":{},"additionalProperties":false}},
        {"name":"add_project","description":"Add an existing local git repository as a Jean project.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"parentId":{"type":"string"}},"required":["path"],"additionalProperties":false}},
        {"name":"clone_project","description":"Clone a remote git repository to a local path and add it as a Jean project.","inputSchema":{"type":"object","properties":{"url":{"type":"string"},"path":{"type":"string"},"parentId":{"type":"string"}},"required":["url","path"],"additionalProperties":false}},
        {"name":"init_project","description":"Create a new git repository at path and add it as a Jean project.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"parentId":{"type":"string"}},"required":["path"],"additionalProperties":false}},
        {"name":"list_worktrees","description":"List all worktrees for a project.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"}},"required":["projectId"],"additionalProperties":false}},
        {"name":"get_worktree","description":"Get a single worktree by id (path, branch, status, etc.).","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"link_pr_to_worktree","description":"Detect the GitHub pull request for a worktree's current branch and link it in Jean. Pass worktreeId; Jean resolves the stored worktree path and runs gh pr view.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"get_project_context","description":"Get project-level context needed by orchestration agents: project settings, linked projects, default branch/backend, and worktree counts. Does not read arbitrary repo files.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"}},"required":["projectId"],"additionalProperties":false}},
        {"name":"list_github_issues","description":"List GitHub issues for a project. Pass projectId; the server resolves the repo path.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"state":{"type":"string","enum":["open","closed","all"],"default":"open"}},"required":["projectId"],"additionalProperties":false}},
        {"name":"list_github_prs","description":"List GitHub pull requests for a project. Pass projectId; the server resolves the repo path.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"state":{"type":"string","enum":["open","closed","merged","all"],"default":"open"}},"required":["projectId"],"additionalProperties":false}},
        {"name":"list_security_issues","description":"List Dependabot security alerts for a project using the same backend command as the UI. Pass projectId; the server resolves the repo path.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"state":{"type":"string","enum":["open","dismissed","fixed","auto_dismissed","all"],"default":"open"}},"required":["projectId"],"additionalProperties":false}},
        {"name":"list_security_advisories","description":"List repository security advisories for a project using the same backend command as the UI. Pass projectId; the server resolves the repo path.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"state":{"type":"string","enum":["draft","published","triage","closed","all"],"default":"all"}},"required":["projectId"],"additionalProperties":false}},
        {"name":"list_linear_issues","description":"List Linear issues for a project using the same backend command as the UI. Pass projectId; Linear API config is resolved from project/global settings.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"}},"required":["projectId"],"additionalProperties":false}},
        {"name":"create_worktree","description":"Create a new worktree for a project. Provide issueNumber, prNumber, linearIssueIdentifier, or ghsaId for a repository security advisory; these are mutually exclusive. Jean fetches the chosen context and attaches it to the worktree. Pass action=\"start_autoinvestigating\" to create a session and start investigating it. This never switches/opens Jean's UI unless the user opens the worktree separately.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"baseBranch":{"type":"string"},"customName":{"type":"string"},"issueNumber":{"type":"integer","minimum":1},"prNumber":{"type":"integer","minimum":1},"linearIssueIdentifier":{"type":"string"},"ghsaId":{"type":"string","description":"Repository security advisory identifier like GHSA-xxxx-xxxx-xxxx."},"action":{"type":"string","enum":["start_autoinvestigating"]}},"required":["projectId"],"additionalProperties":false}},
        {"name":"create_worktree_from_existing_branch","description":"Create a Jean worktree from an existing local or remote-tracking branch. Does not open Jean's UI.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"branchName":{"type":"string"}},"required":["projectId","branchName"],"additionalProperties":false}},
        {"name":"import_worktree","description":"Import an existing git worktree/directory on disk into a Jean project.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"},"path":{"type":"string"}},"required":["projectId","path"],"additionalProperties":false}},
        {"name":"rename_worktree","description":"Rename a worktree's display name in Jean.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"newName":{"type":"string"}},"required":["worktreeId","newName"],"additionalProperties":false}},
        {"name":"archive_worktree","description":"Archive a worktree. Prefer this over delete when work may still be needed.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"unarchive_worktree","description":"Restore an archived worktree to the active project canvas.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"list_archived_worktrees","description":"List archived worktrees. Optionally filter by projectId.","inputSchema":{"type":"object","properties":{"projectId":{"type":"string"}},"additionalProperties":false}},
        {"name":"delete_worktree","description":"Start permanently deleting an active worktree in the background. Returns started=true when cleanup is accepted.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"permanently_delete_worktree","description":"Start permanently deleting an already-archived worktree in the background. Returns started=true when cleanup is accepted.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"list_sessions","description":"List chat sessions in a worktree without loading full message history. Use before creating a session to avoid duplicates.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"includeArchived":{"type":"boolean","default":false}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"create_session","description":"Create a new chat session in an existing worktree. Returns the session id needed for send_chat_message.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"name":{"type":"string"},"backend":{"type":"string","enum":["claude","codex","opencode"]}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"send_chat_message","description":"Send a message to an existing session. Fire-and-forget: returns immediately as the session begins processing. Use this to kick off investigations.","inputSchema":{"type":"object","properties":{"sessionId":{"type":"string"},"message":{"type":"string"},"model":{"type":"string"},"executionMode":{"type":"string","enum":["plan","build","yolo"]}},"required":["sessionId","message"],"additionalProperties":false}},
        {"name":"get_session_status","description":"Get whether a Jean session is idle/running/resumable/cancelled/error plus latest run metadata. Use after send_chat_message to poll fire-and-forget work.","inputSchema":{"type":"object","properties":{"sessionId":{"type":"string"}},"required":["sessionId"],"additionalProperties":false}},
        {"name":"cancel_session_run","description":"Cancel the currently running request for a session. Returns whether Jean found an active process/turn/flag to cancel.","inputSchema":{"type":"object","properties":{"sessionId":{"type":"string"}},"required":["sessionId"],"additionalProperties":false}},
        {"name":"read_session_messages","description":"Read recent messages from a session (most recent first). Use limit to cap returned messages.","inputSchema":{"type":"object","properties":{"sessionId":{"type":"string"},"limit":{"type":"integer","minimum":1,"maximum":200,"default":50}},"required":["sessionId"],"additionalProperties":false}},
        {"name":"get_worktree_changes","description":"Get a bounded summary of a worktree's git changes: porcelain status, ahead/behind counts, diff stats, and changed files. Does not return full diffs.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"maxFiles":{"type":"integer","minimum":1,"maximum":500,"default":100}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"get_worktree_diff","description":"Get a bounded unified git diff for a worktree. diffType is uncommitted (HEAD vs working tree) or branch (origin/base...HEAD). Optional path limits to one pathspec; maxBytes is capped.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"diffType":{"type":"string","enum":["uncommitted","branch"],"default":"uncommitted"},"path":{"type":"string"},"maxBytes":{"type":"integer","minimum":1,"maximum":200000,"default":60000}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"get_current_context","description":"Return the calling session's context: sessionId, worktreeId, projectId, projectPath, projectName. Use this so the agent knows what 'this project' refers to without guessing.","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}
    ])
}

fn tool_registry_shipping() -> Value {
    json!([
        {"name":"create_commit","description":"Stage changes and create a git commit with an AI-generated message. Optional push after commit. Use specificFiles to stage only selected paths; omit to stage all.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"push":{"type":"boolean","default":false},"remote":{"type":"string"},"prNumber":{"type":"integer","minimum":1},"specificFiles":{"type":"array","items":{"type":"string"}},"customPrompt":{"type":"string"},"model":{"type":"string"},"reasoningEffort":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"push_worktree","description":"Push the current branch for a worktree. Optionally pass prNumber for PR-aware push.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"remote":{"type":"string"},"prNumber":{"type":"integer","minimum":1}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"detect_open_pr","description":"Detect and link the GitHub pull request for a worktree's current branch in Jean. Returns the PR or an error when none exists.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"create_pull_request","description":"Create a GitHub PR for the worktree with AI-generated title and body. Stages and commits uncommitted changes when needed, then pushes the branch.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"sessionId":{"type":"string"},"customPrompt":{"type":"string"},"model":{"type":"string"},"reasoningEffort":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"merge_pull_request","description":"Merge the open GitHub PR for the worktree's current branch using the repository's allowed merge method.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}},
        {"name":"run_review","description":"Run Jean's AI code review on the worktree branch. Does not commit or open a PR.","inputSchema":{"type":"object","properties":{"worktreeId":{"type":"string"},"customPrompt":{"type":"string"},"model":{"type":"string"},"reasoningEffort":{"type":"string"}},"required":["worktreeId"],"additionalProperties":false}}
    ])
}

pub async fn call_tool(
    app: &AppHandle,
    name: &str,
    arguments: Value,
    source: &str,
    depth: u32,
) -> Result<Value, ToolError> {
    let prefs = crate::load_preferences(app.clone())
        .await
        .map_err(ToolError::internal)?;
    if !prefs.jean_mcp_enabled {
        return Err(ToolError::internal(
            "Jean MCP is disabled. Enable it in Preferences > MCP Servers.",
        ));
    }

    if RATE_LIMITED_TOOLS.contains(&name) {
        if depth > prefs.jean_mcp_max_depth {
            return Err(ToolError::internal(format!(
                "Jean MCP recursion depth {depth} exceeds limit {}",
                prefs.jean_mcp_max_depth
            )));
        }
        if !rate_check(source, name, prefs.jean_mcp_rate_limit_per_minute) {
            return Err(ToolError::internal(format!(
                "Jean MCP rate limit exceeded ({} calls/min for source {source}, tool {name})",
                prefs.jean_mcp_rate_limit_per_minute
            )));
        }
    }

    let result_json = run_tool(app, name, arguments, source).await?;
    Ok(json!({
        "content": [{
            "type": "text",
            "text": serde_json::to_string_pretty(&result_json).unwrap_or_else(|_| "null".to_string()),
        }],
        "isError": false,
    }))
}

async fn run_tool(
    app: &AppHandle,
    name: &str,
    args: Value,
    source: &str,
) -> Result<Value, ToolError> {
    match name {
        "list_projects" => dispatch_command(app, "list_projects", json!({}))
            .await
            .map_err(ToolError::internal),
        "add_project" => {
            let path = require_nonempty_str(&args, "path")?;
            let mut payload = serde_json::Map::new();
            payload.insert("path".to_string(), Value::String(path));
            if let Some(parent_id) =
                optional_str(&args, "parentId").or_else(|| optional_str(&args, "parent_id"))
            {
                payload.insert("parentId".to_string(), Value::String(parent_id));
            }
            dispatch_command(app, "add_project", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }
        "clone_project" => {
            let url = require_nonempty_str(&args, "url")?;
            let path = require_nonempty_str(&args, "path")?;
            let mut payload = serde_json::Map::new();
            payload.insert("url".to_string(), Value::String(url));
            payload.insert("path".to_string(), Value::String(path));
            if let Some(parent_id) =
                optional_str(&args, "parentId").or_else(|| optional_str(&args, "parent_id"))
            {
                payload.insert("parentId".to_string(), Value::String(parent_id));
            }
            dispatch_command(app, "clone_project", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }
        "init_project" => {
            let path = require_nonempty_str(&args, "path")?;
            let mut payload = serde_json::Map::new();
            payload.insert("path".to_string(), Value::String(path));
            if let Some(parent_id) =
                optional_str(&args, "parentId").or_else(|| optional_str(&args, "parent_id"))
            {
                payload.insert("parentId".to_string(), Value::String(parent_id));
            }
            dispatch_command(app, "init_project", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }
        "list_worktrees" => {
            let project_id = require_str(&args, "projectId")?;
            dispatch_command(app, "list_worktrees", json!({ "projectId": project_id }))
                .await
                .map_err(ToolError::internal)
        }
        "get_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            dispatch_command(app, "get_worktree", json!({ "worktreeId": worktree_id }))
                .await
                .map_err(ToolError::internal)
        }
        "link_pr_to_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            let result = dispatch_command(
                app,
                "detect_and_link_pr",
                json!({
                    "worktreeId": worktree_id,
                    "worktreePath": worktree_path,
                }),
            )
            .await
            .map_err(|error| {
                ToolError::internal(format!(
                    "Failed to detect a pull request for worktree {worktree_id}: {error}"
                ))
            })?;

            if result.is_null() {
                return Err(ToolError::internal(format!(
                    "No pull request could be detected for worktree {worktree_id}. Ensure the branch is pushed, a pull request exists for it, and gh is authenticated, then retry."
                )));
            }

            Ok(result)
        }
        "create_commit" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            let push = args
                .get("push")
                .and_then(|value| value.as_bool())
                .unwrap_or(false);
            let remote = optional_str(&args, "remote");
            let pr_number = args
                .get("prNumber")
                .or_else(|| args.get("pr_number"))
                .and_then(|value| value.as_u64())
                .map(|number| number as u32);
            let specific_files = args
                .get("specificFiles")
                .or_else(|| args.get("specific_files"))
                .and_then(|value| value.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str().map(str::to_string))
                        .collect::<Vec<_>>()
                })
                .filter(|files| !files.is_empty());
            let custom_prompt = optional_str(&args, "customPrompt")
                .or_else(|| optional_str(&args, "custom_prompt"));
            let model = optional_str(&args, "model");
            let reasoning_effort = optional_str(&args, "reasoningEffort")
                .or_else(|| optional_str(&args, "reasoning_effort"));
            let mut payload = serde_json::Map::new();
            payload.insert("worktreePath".to_string(), Value::String(worktree_path));
            payload.insert("push".to_string(), Value::Bool(push));
            if let Some(remote) = remote {
                payload.insert("remote".to_string(), Value::String(remote));
            }
            if let Some(pr_number) = pr_number {
                payload.insert("prNumber".to_string(), json!(pr_number));
            }
            if let Some(files) = specific_files {
                payload.insert("specificFiles".to_string(), json!(files));
            }
            if let Some(prompt) = custom_prompt {
                payload.insert("customPrompt".to_string(), Value::String(prompt));
            }
            if let Some(model) = model {
                payload.insert("model".to_string(), Value::String(model));
            }
            if let Some(effort) = reasoning_effort {
                payload.insert("reasoningEffort".to_string(), Value::String(effort));
            }
            dispatch_command(app, "create_commit_with_ai", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }
        "push_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            let remote = optional_str(&args, "remote");
            let pr_number = args
                .get("prNumber")
                .or_else(|| args.get("pr_number"))
                .and_then(|value| value.as_u64())
                .map(|number| number as u32);
            let mut payload = serde_json::Map::new();
            payload.insert("worktreePath".to_string(), Value::String(worktree_path));
            if let Some(remote) = remote {
                payload.insert("remote".to_string(), Value::String(remote));
            }
            if let Some(pr_number) = pr_number {
                payload.insert("prNumber".to_string(), json!(pr_number));
            }
            dispatch_command(app, "git_push", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }
        "detect_open_pr" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            dispatch_command(
                app,
                "detect_and_link_pr",
                json!({ "worktreeId": worktree_id, "worktreePath": worktree_path }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "create_pull_request" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            let session_id =
                optional_str(&args, "sessionId").or_else(|| optional_str(&args, "session_id"));
            let custom_prompt = optional_str(&args, "customPrompt")
                .or_else(|| optional_str(&args, "custom_prompt"));
            let model = optional_str(&args, "model");
            let reasoning_effort = optional_str(&args, "reasoningEffort")
                .or_else(|| optional_str(&args, "reasoning_effort"));
            let mut payload = serde_json::Map::new();
            payload.insert("worktreePath".to_string(), Value::String(worktree_path));
            if let Some(session_id) = session_id {
                payload.insert("sessionId".to_string(), Value::String(session_id));
            }
            if let Some(prompt) = custom_prompt {
                payload.insert("customPrompt".to_string(), Value::String(prompt));
            }
            if let Some(model) = model {
                payload.insert("model".to_string(), Value::String(model));
            }
            if let Some(effort) = reasoning_effort {
                payload.insert("reasoningEffort".to_string(), Value::String(effort));
            }
            dispatch_command(app, "create_pr_with_ai_content", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }
        "merge_pull_request" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            dispatch_command(
                app,
                "merge_github_pr",
                json!({ "worktreePath": worktree_path }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "run_review" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            let custom_prompt = optional_str(&args, "customPrompt")
                .or_else(|| optional_str(&args, "custom_prompt"));
            let model = optional_str(&args, "model");
            let reasoning_effort = optional_str(&args, "reasoningEffort")
                .or_else(|| optional_str(&args, "reasoning_effort"));
            let mut payload = serde_json::Map::new();
            payload.insert("worktreePath".to_string(), Value::String(worktree_path));
            if let Some(prompt) = custom_prompt {
                payload.insert("magicPrompt".to_string(), Value::String(prompt));
            }
            if let Some(model) = model {
                payload.insert("model".to_string(), Value::String(model));
            }
            if let Some(effort) = reasoning_effort {
                payload.insert("reasoningEffort".to_string(), Value::String(effort));
            }
            dispatch_command(app, "run_review_with_ai", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }
        "get_project_context" => {
            let project_id = require_str(&args, "projectId")?;
            get_project_context(app, &project_id)
        }
        "list_github_issues" => {
            let project_id = require_str(&args, "projectId")?;
            let state = args.get("state").and_then(|v| v.as_str()).unwrap_or("open");
            let project_path = resolve_project_path(app, &project_id)?;
            dispatch_command(
                app,
                "list_github_issues",
                json!({ "projectPath": project_path, "state": state }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "list_github_prs" => {
            let project_id = require_str(&args, "projectId")?;
            let state = args.get("state").and_then(|v| v.as_str()).unwrap_or("open");
            let project_path = resolve_project_path(app, &project_id)?;
            dispatch_command(
                app,
                "list_github_prs",
                json!({ "projectPath": project_path, "state": state }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "list_security_issues" => {
            let project_id = require_str(&args, "projectId")?;
            let state = args.get("state").and_then(|v| v.as_str()).unwrap_or("open");
            let state = if state == "all" {
                "open,dismissed,fixed,auto_dismissed"
            } else {
                state
            };
            let project_path = resolve_project_path(app, &project_id)?;
            dispatch_command(
                app,
                "list_dependabot_alerts",
                json!({ "projectPath": project_path, "state": state }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "list_security_advisories" => {
            let project_id = require_str(&args, "projectId")?;
            let state = args.get("state").and_then(|v| v.as_str()).unwrap_or("all");
            let state = if state == "all" {
                Value::Null
            } else {
                Value::String(state.to_string())
            };
            let project_path = resolve_project_path(app, &project_id)?;
            dispatch_command(
                app,
                "list_repository_advisories",
                json!({ "projectPath": project_path, "state": state }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "list_linear_issues" => {
            let project_id = require_str(&args, "projectId")?;
            dispatch_command(
                app,
                "list_linear_issues",
                json!({ "projectId": project_id }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "create_worktree" => {
            let project_id = require_str(&args, "projectId")?;
            let action = args.get("action").and_then(|v| v.as_str());
            if let Some(action) = action {
                if action != "start_autoinvestigating" {
                    return Err(ToolError::invalid_params(format!(
                        "Unsupported create_worktree action: {action}"
                    )));
                }
            }

            let issue_number = args.get("issueNumber").and_then(|v| v.as_u64());
            let pr_number = args.get("prNumber").and_then(|v| v.as_u64());
            let linear_identifier = args
                .get("linearIssueIdentifier")
                .or_else(|| args.get("linear_issue_identifier"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            let ghsa_id = args
                .get("ghsaId")
                .or_else(|| args.get("ghsa_id"))
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            validate_create_worktree_inputs(
                issue_number.is_some(),
                pr_number.is_some(),
                linear_identifier.is_some(),
                ghsa_id.is_some(),
                action,
            )?;

            let mut payload = serde_json::Map::new();
            payload.insert("projectId".to_string(), Value::String(project_id.clone()));
            if let Some(base) = args.get("baseBranch").and_then(|v| v.as_str()) {
                payload.insert("baseBranch".to_string(), Value::String(base.to_string()));
            }
            let has_custom_name = args.get("customName").and_then(|v| v.as_str()).is_some();
            if let Some(name) = args.get("customName").and_then(|v| v.as_str()) {
                let resolved = resolve_non_conflicting_worktree_name(app, &project_id, name)?;
                payload.insert("customName".to_string(), Value::String(resolved.clone()));
            }
            // Jean MCP must never auto-open/switch the Jean UI. Opening the worktree
            // causes the normal UI path to create its default session in addition to
            // the autoinvestigation session, so keep MCP-created worktrees background-only.
            payload.insert("autoOpenInJean".to_string(), Value::Bool(false));
            let project_path = if issue_number.is_some() || pr_number.is_some() || ghsa_id.is_some()
            {
                Some(resolve_project_path(app, &project_id)?)
            } else {
                None
            };
            if let Some(issue_number) = issue_number {
                let project_path = project_path
                    .clone()
                    .ok_or_else(|| ToolError::internal("missing project_path for issue fetch"))?;
                let detail = dispatch_command(
                    app,
                    "get_github_issue",
                    json!({ "projectPath": project_path, "issueNumber": issue_number }),
                )
                .await
                .map_err(ToolError::internal)?;
                if !has_custom_name {
                    let title = detail.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let issue_branch = crate::projects::generate_branch_name_from_issue(
                        issue_number as u32,
                        title,
                    );
                    let resolved =
                        resolve_non_conflicting_worktree_name(app, &project_id, &issue_branch)?;
                    if resolved != issue_branch {
                        payload.insert("customName".to_string(), Value::String(resolved.clone()));
                    }
                }
                payload.insert(
                    "issueContext".to_string(),
                    json!({
                        "number": detail.get("number").cloned().unwrap_or(json!(issue_number)),
                        "title": detail.get("title").cloned().unwrap_or(Value::Null),
                        "body": detail.get("body").cloned().unwrap_or(Value::Null),
                        "comments": detail.get("comments").cloned().unwrap_or(json!([])),
                    }),
                );
            }
            if let Some(pr_number) = pr_number {
                let project_path = project_path
                    .clone()
                    .ok_or_else(|| ToolError::internal("missing project_path for PR fetch"))?;
                let detail = dispatch_command(
                    app,
                    "get_github_pr",
                    json!({ "projectPath": project_path, "prNumber": pr_number }),
                )
                .await
                .map_err(ToolError::internal)?;
                payload.insert(
                    "prContext".to_string(),
                    json!({
                        "number": detail.get("number").cloned().unwrap_or(json!(pr_number)),
                        "title": detail.get("title").cloned().unwrap_or(Value::Null),
                        "body": detail.get("body").cloned().unwrap_or(Value::Null),
                        "headRefName": detail.get("headRefName").cloned().unwrap_or(Value::Null),
                        "baseRefName": detail.get("baseRefName").cloned().unwrap_or(Value::Null),
                        "comments": detail.get("comments").cloned().unwrap_or(json!([])),
                        "reviews": detail.get("reviews").cloned().unwrap_or(json!([])),
                        "diff": Value::Null,
                    }),
                );
            }
            if let Some(ref ghsa_id) = ghsa_id {
                let project_path = project_path.clone().ok_or_else(|| {
                    ToolError::internal("missing project_path for advisory fetch")
                })?;
                let detail = dispatch_command(
                    app,
                    "get_repository_advisory",
                    json!({ "projectPath": project_path, "ghsaId": ghsa_id }),
                )
                .await
                .map_err(ToolError::internal)?;
                payload.insert(
                    "advisoryContext".to_string(),
                    json!({
                        "ghsaId": detail.get("ghsaId").cloned().unwrap_or(json!(ghsa_id)),
                        "severity": detail.get("severity").cloned().unwrap_or(json!("unknown")),
                        "summary": detail.get("summary").cloned().unwrap_or(Value::Null),
                        "description": detail.get("description").cloned().unwrap_or(json!("")),
                        "cveId": detail.get("cveId").cloned().unwrap_or(Value::Null),
                        "vulnerabilities": detail.get("vulnerabilities").cloned().unwrap_or(json!([])),
                        "htmlUrl": detail.get("htmlUrl").cloned().unwrap_or(Value::Null),
                    }),
                );
            }
            if let Some(ref identifier) = linear_identifier {
                let number = parse_linear_issue_number(identifier).ok_or_else(|| {
                    ToolError::invalid_params(format!(
                        "Invalid Linear issue identifier: {identifier}"
                    ))
                })?;
                let resolved = dispatch_command(
                    app,
                    "get_linear_issue_by_number",
                    json!({ "projectId": project_id.as_str(), "issueNumber": number }),
                )
                .await
                .map_err(ToolError::internal)?;
                if resolved.is_null() {
                    return Err(ToolError::internal(format!(
                        "Linear issue {identifier} not found"
                    )));
                }
                let resolved_identifier = resolved
                    .get("identifier")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                if !resolved_identifier.eq_ignore_ascii_case(identifier) {
                    return Err(ToolError::invalid_params(format!(
                        "Linear issue {identifier} not found (resolved to {resolved_identifier})"
                    )));
                }
                let issue_id = resolved
                    .get("id")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| ToolError::internal("Linear issue missing id"))?
                    .to_string();
                let detail = dispatch_command(
                    app,
                    "get_linear_issue",
                    json!({ "projectId": project_id.as_str(), "issueId": issue_id.as_str() }),
                )
                .await
                .map_err(ToolError::internal)?;
                if !has_custom_name {
                    let title = detail.get("title").and_then(|v| v.as_str()).unwrap_or("");
                    let linear_branch = crate::projects::generate_branch_name_from_linear_issue(
                        resolved_identifier,
                        title,
                    );
                    let resolved_name =
                        resolve_non_conflicting_worktree_name(app, &project_id, &linear_branch)?;
                    if resolved_name != linear_branch {
                        payload.insert("customName".to_string(), Value::String(resolved_name));
                    }
                }
                payload.insert(
                    "linearContext".to_string(),
                    json!({
                        "id": detail.get("id").cloned().unwrap_or(Value::Null),
                        "identifier": detail
                            .get("identifier")
                            .cloned()
                            .unwrap_or(json!(resolved_identifier)),
                        "title": detail.get("title").cloned().unwrap_or(Value::Null),
                        "description": detail.get("description").cloned().unwrap_or(Value::Null),
                        "comments": detail.get("comments").cloned().unwrap_or(json!([])),
                    }),
                );
            }
            let worktree = dispatch_command(app, "create_worktree", Value::Object(payload))
                .await
                .map_err(ToolError::internal)?;
            if action == Some("start_autoinvestigating") {
                let kind = if issue_number.is_some() {
                    InvestigationKind::Issue
                } else if linear_identifier.is_some() {
                    InvestigationKind::Linear
                } else if ghsa_id.is_some() {
                    InvestigationKind::Advisory
                } else {
                    InvestigationKind::Pr
                };
                start_autoinvestigating(app, &worktree, kind, source).await
            } else {
                Ok(worktree)
            }
        }
        "create_worktree_from_existing_branch" => {
            let project_id = require_str(&args, "projectId")?;
            let branch_name = require_nonempty_str(&args, "branchName")
                .or_else(|_| require_nonempty_str(&args, "branch_name"))?;
            dispatch_command(
                app,
                "create_worktree_from_existing_branch",
                json!({ "projectId": project_id, "branchName": branch_name, "autoOpenInJean": false }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "import_worktree" => {
            let project_id = require_str(&args, "projectId")?;
            let path = require_nonempty_str(&args, "path")?;
            dispatch_command(
                app,
                "import_worktree",
                json!({ "projectId": project_id, "path": path }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "rename_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let new_name = require_nonempty_str(&args, "newName")
                .or_else(|_| require_nonempty_str(&args, "new_name"))?;
            dispatch_command(
                app,
                "rename_worktree",
                json!({ "worktreeId": worktree_id, "newName": new_name }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "archive_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            dispatch_command(
                app,
                "archive_worktree",
                json!({ "worktreeId": worktree_id }),
            )
            .await
            .map_err(ToolError::internal)?;
            Ok(json!({ "worktreeId": worktree_id, "action": "archive", "ok": true }))
        }
        "unarchive_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            dispatch_command(
                app,
                "unarchive_worktree",
                json!({ "worktreeId": worktree_id }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "list_archived_worktrees" => {
            let project_id =
                optional_str(&args, "projectId").or_else(|| optional_str(&args, "project_id"));
            let result = dispatch_command(app, "list_archived_worktrees", json!({}))
                .await
                .map_err(ToolError::internal)?;
            if let Some(project_id) = project_id {
                Ok(Value::Array(
                    result
                        .as_array()
                        .map(|items| {
                            items
                                .iter()
                                .filter(|item| {
                                    item.get("project_id")
                                        .or_else(|| item.get("projectId"))
                                        .and_then(|value| value.as_str())
                                        == Some(project_id.as_str())
                                })
                                .cloned()
                                .collect()
                        })
                        .unwrap_or_default(),
                ))
            } else {
                Ok(result)
            }
        }
        "delete_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            dispatch_command(app, "delete_worktree", json!({ "worktreeId": worktree_id }))
                .await
                .map_err(ToolError::internal)?;
            Ok(deletion_started_result(&worktree_id, "delete"))
        }
        "permanently_delete_worktree" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            dispatch_command(
                app,
                "permanently_delete_worktree",
                json!({ "worktreeId": worktree_id }),
            )
            .await
            .map_err(ToolError::internal)?;
            Ok(deletion_started_result(&worktree_id, "permanently_delete"))
        }
        "list_sessions" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            let include_archived = args
                .get("includeArchived")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            dispatch_command(
                app,
                "list_sessions_summary",
                json!({
                    "worktreeId": worktree_id,
                    "worktreePath": worktree_path,
                    "includeArchived": include_archived
                }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "create_session" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let worktree_path = resolve_worktree_path(app, &worktree_id)?;
            let mut payload = serde_json::Map::new();
            payload.insert("worktreeId".to_string(), Value::String(worktree_id));
            payload.insert("worktreePath".to_string(), Value::String(worktree_path));
            if let Some(n) = args.get("name").and_then(|v| v.as_str()) {
                payload.insert("name".to_string(), Value::String(n.to_string()));
            }
            if let Some(b) = args.get("backend").and_then(|v| v.as_str()) {
                payload.insert("backend".to_string(), Value::String(b.to_string()));
            }
            dispatch_command(app, "create_session", Value::Object(payload))
                .await
                .map_err(ToolError::internal)
        }
        "send_chat_message" => {
            let session_id = require_str(&args, "sessionId")?;
            let message = require_str(&args, "message")?;
            let (worktree_id, worktree_path) = resolve_session_worktree(app, &session_id)?;
            let mut payload = serde_json::Map::new();
            payload.insert("sessionId".to_string(), Value::String(session_id.clone()));
            payload.insert("worktreeId".to_string(), Value::String(worktree_id));
            payload.insert("worktreePath".to_string(), Value::String(worktree_path));
            payload.insert("message".to_string(), Value::String(message));
            if let Some(m) = args.get("model").and_then(|v| v.as_str()) {
                payload.insert("model".to_string(), Value::String(m.to_string()));
            }
            if let Some(em) = args.get("executionMode").and_then(|v| v.as_str()) {
                payload.insert("executionMode".to_string(), Value::String(em.to_string()));
            }
            let app_clone = app.clone();
            let payload_clone = Value::Object(payload);
            let source_clone = source.to_string();
            tauri::async_runtime::spawn(async move {
                if let Err(e) =
                    dispatch_command(&app_clone, "send_chat_message", payload_clone).await
                {
                    log::warn!("Jean MCP send_chat_message (source={source_clone}) failed: {e}");
                }
            });
            Ok(json!({ "sessionId": session_id, "status": "started" }))
        }
        "get_session_status" => {
            let session_id = require_str(&args, "sessionId")?;
            dispatch_command(
                app,
                "get_session_status",
                json!({ "sessionId": session_id }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "cancel_session_run" => {
            let session_id = require_str(&args, "sessionId")?;
            let (worktree_id, _) = resolve_session_worktree(app, &session_id)?;
            let cancelled = crate::chat::cancel_chat_message(
                app.clone(),
                session_id.clone(),
                worktree_id.clone(),
            )
            .await
            .map_err(ToolError::internal)?;
            Ok(json!({
                "sessionId": session_id,
                "worktreeId": worktree_id,
                "cancelled": cancelled,
            }))
        }
        "read_session_messages" => {
            let session_id = require_str(&args, "sessionId")?;
            let limit = args
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(50)
                .min(200) as usize;
            let (worktree_id, worktree_path) = resolve_session_worktree(app, &session_id)?;
            dispatch_command(app, "get_session", json!({ "sessionId": session_id, "worktreeId": worktree_id, "worktreePath": worktree_path, "limit": limit })).await.map_err(ToolError::internal)
        }
        "get_worktree_changes" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let max_files = args
                .get("maxFiles")
                .and_then(|v| v.as_u64())
                .unwrap_or(100)
                .clamp(1, 500) as usize;
            dispatch_command(
                app,
                "get_worktree_changes",
                json!({ "worktreeId": worktree_id, "maxFiles": max_files }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "get_worktree_diff" => {
            let worktree_id = require_str(&args, "worktreeId")?;
            let diff_type = args
                .get("diffType")
                .and_then(|v| v.as_str())
                .unwrap_or("uncommitted");
            let path = args.get("path").and_then(|v| v.as_str());
            let max_bytes = args
                .get("maxBytes")
                .and_then(|v| v.as_u64())
                .unwrap_or(DEFAULT_MCP_DIFF_MAX_BYTES as u64)
                .clamp(1, MAX_MCP_DIFF_BYTES as u64) as usize;
            dispatch_command(
                app,
                "get_worktree_diff",
                json!({
                    "worktreeId": worktree_id,
                    "diffType": diff_type,
                    "path": path,
                    "maxBytes": max_bytes
                }),
            )
            .await
            .map_err(ToolError::internal)
        }
        "get_current_context" => {
            if source == "anon" {
                return Err(no_current_context_error(source));
            }
            let (worktree_id, worktree_path) = resolve_session_worktree(app, source)
                .map_err(|_| no_current_context_error(source))?;
            let (project_id, project_name, project_path) =
                resolve_worktree_project(app, &worktree_id)?;
            Ok(
                json!({ "sessionId": source, "worktreeId": worktree_id, "worktreePath": worktree_path, "projectId": project_id, "projectName": project_name, "projectPath": project_path }),
            )
        }
        other => Err(ToolError::invalid_params(format!("Unknown tool: {other}"))),
    }
}

fn get_project_context(app: &AppHandle, project_id: &str) -> Result<Value, ToolError> {
    let data = crate::projects::storage::load_projects_data(app)
        .map_err(|e| ToolError::internal(format!("load_projects_data: {e}")))?;
    let project = data
        .find_project(project_id)
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown projectId: {project_id}")))?;
    let worktrees = data.worktrees_for_project(project_id);
    let linked_projects: Vec<Value> = project
        .linked_project_ids
        .iter()
        .filter_map(|id| data.find_project(id))
        .map(|p| {
            json!({
                "id": p.id,
                "name": p.name,
                "path": p.path,
                "defaultBranch": p.default_branch,
                "defaultBackend": p.default_backend,
            })
        })
        .collect();

    Ok(json!({
        "id": project.id,
        "name": project.name,
        "path": project.path,
        "defaultBranch": project.default_branch,
        "defaultBackend": project.default_backend,
        "defaultProvider": project.default_provider,
        "enabledMcpServers": project.enabled_mcp_servers,
        "customSystemPromptPresent": project.custom_system_prompt.as_ref().is_some_and(|p| !p.trim().is_empty()),
        "worktreesDir": project.worktrees_dir,
        "linkedProjects": linked_projects,
        "counts": {
            "worktrees": worktrees.len(),
            "activeWorktrees": worktrees.iter().filter(|w| w.archived_at.is_none()).count(),
            "archivedWorktrees": worktrees.iter().filter(|w| w.archived_at.is_some()).count(),
        },
    }))
}

fn require_str(args: &Value, key: &str) -> Result<String, ToolError> {
    args.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ToolError::invalid_params(format!("missing or non-string '{key}'")))
}

fn require_nonempty_str(args: &Value, key: &str) -> Result<String, ToolError> {
    let value = require_str(args, key)?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ToolError::invalid_params(format!(
            "'{key}' must be a non-empty string"
        )));
    }
    Ok(trimmed.to_string())
}

fn optional_str(args: &Value, key: &str) -> Option<String> {
    args.get(key)
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn deletion_started_result(worktree_id: &str, action: &str) -> Value {
    json!({
        "worktreeId": worktree_id,
        "action": action,
        "started": true,
    })
}

fn no_current_context_error(source: &str) -> ToolError {
    ToolError::internal(format!(
        "No Jean session context present for source '{source}'. \
get_current_context only works for MCP calls made from Jean-spawned chat sessions, where \
JEAN_MCP_SESSION is a real Jean session id. For manual/global MCP clients, use explicit-id tools \
instead: list_projects -> list_worktrees(projectId) -> list_sessions(worktreeId), then \
get_session_status(sessionId), get_worktree_changes(worktreeId), or get_worktree_diff(worktreeId)."
    ))
}

fn resolve_non_conflicting_worktree_name(
    app: &AppHandle,
    project_id: &str,
    requested_name: &str,
) -> Result<String, ToolError> {
    let data = crate::projects::storage::load_projects_data(app)
        .map_err(|e| ToolError::internal(format!("load_projects_data: {e}")))?;
    let project = data
        .find_project(project_id)
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown projectId: {project_id}")))?;
    let worktrees_dir = crate::projects::storage::get_project_worktrees_dir(
        app,
        &project.name,
        project.worktrees_dir.as_deref(),
    )
    .map_err(ToolError::internal)?;
    let folder_name = crate::projects::sanitize_folder_name(requested_name);
    let path_exists = worktrees_dir.join(folder_name).exists();
    let name_exists = data.worktree_name_exists(project_id, requested_name);
    let branch_exists = crate::projects::git::branch_exists(&project.path, requested_name);

    if path_exists || name_exists || branch_exists {
        let resolved = crate::projects::generate_unique_suffix_name(
            requested_name,
            &project.path,
            project_id,
            Some(&data),
        );
        log::info!(
            "Jean MCP resolved worktree name conflict: requested={requested_name}, resolved={resolved}, path_exists={path_exists}, name_exists={name_exists}, branch_exists={branch_exists}"
        );
        Ok(resolved)
    } else {
        Ok(requested_name.to_string())
    }
}

fn validate_create_worktree_inputs(
    has_issue: bool,
    has_pr: bool,
    has_linear: bool,
    has_advisory: bool,
    action: Option<&str>,
) -> Result<(), ToolError> {
    if has_issue && has_pr {
        return Err(ToolError::invalid_params(
            "Pass either issueNumber or prNumber, not both",
        ));
    }
    if has_linear && (has_issue || has_pr) {
        return Err(ToolError::invalid_params(
            "Pass a GitHub issueNumber/prNumber or a linearIssueIdentifier, not both",
        ));
    }
    if has_advisory && (has_issue || has_pr || has_linear) {
        return Err(ToolError::invalid_params(
            "Pass a GitHub issueNumber/prNumber, linearIssueIdentifier, or ghsaId, not both",
        ));
    }
    if action == Some("start_autoinvestigating")
        && !has_issue
        && !has_pr
        && !has_linear
        && !has_advisory
    {
        return Err(ToolError::invalid_params(
            "action=start_autoinvestigating requires issueNumber, prNumber, linearIssueIdentifier, or ghsaId",
        ));
    }
    Ok(())
}

fn parse_linear_issue_number(identifier: &str) -> Option<i64> {
    let digits = identifier.trim().rsplit('-').next()?.trim();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<i64>().ok().filter(|n| *n > 0)
}

#[derive(Clone, Copy, Debug)]
enum InvestigationKind {
    Issue,
    Pr,
    Linear,
    Advisory,
}

#[derive(Debug)]
struct InvestigationSelection {
    backend: String,
    model: String,
    provider: Option<String>,
    effort: Option<String>,
}

async fn start_autoinvestigating(
    app: &AppHandle,
    pending_worktree: &Value,
    kind: InvestigationKind,
    source: &str,
) -> Result<Value, ToolError> {
    let worktree_id = require_value_str(pending_worktree, "id")?;
    let ready_worktree = wait_for_worktree_ready(app, &worktree_id).await?;
    let worktree_path = require_value_str(&ready_worktree, "path")?;

    let prefs = crate::load_preferences(app.clone())
        .await
        .map_err(ToolError::internal)?;
    let selection = resolve_investigation_selection(app, &prefs, &ready_worktree, kind);
    let prompt = build_investigation_prompt(&prefs, &ready_worktree, kind);
    let parallel_execution_prompt = if prefs.parallel_execution_prompt_enabled {
        Some(
            prefs
                .magic_prompts
                .parallel_execution
                .clone()
                .filter(|p| !p.trim().is_empty())
                .unwrap_or_else(crate::default_parallel_execution_prompt),
        )
    } else {
        None
    };
    let custom_profile_name = selection
        .provider
        .clone()
        .filter(|p| p != "__anthropic__" && selection.backend == "claude");

    let result = start_background_investigation_impl(
        app,
        worktree_id.clone(),
        worktree_path.clone(),
        prompt,
        selection.model.clone(),
        selection.backend.clone(),
        selection.provider.clone(),
        selection.effort.clone(),
        custom_profile_name,
        Some(prefs.chrome_enabled),
        Some(prefs.ai_language.clone()),
        parallel_execution_prompt,
        Some(source.to_string()),
    )
    .await
    .map_err(ToolError::internal)?;
    let session_id = result.session_id;

    Ok(json!({
        "worktree": ready_worktree,
        "sessionId": session_id,
        "backend": selection.backend,
        "model": selection.model,
        "status": "investigation_started",
    }))
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundInvestigationResult {
    pub session_id: String,
    pub worktree_id: String,
    pub status: String,
}

#[allow(clippy::too_many_arguments)]
fn build_background_investigation_queue_message(
    message: String,
    model: String,
    backend: String,
    provider: Option<String>,
    effort_level: Option<String>,
    custom_profile_name: Option<String>,
    chrome_enabled: Option<bool>,
    ai_language: Option<String>,
    parallel_execution_prompt: Option<String>,
) -> Value {
    json!({
        "id": uuid::Uuid::new_v4().to_string(),
        "message": message,
        "pendingImages": [],
        "pendingFiles": [],
        "pendingSkills": [],
        "pendingTextFiles": [],
        "model": model,
        "provider": provider,
        "executionMode": "plan",
        "thinkingLevel": "think",
        "effortLevel": effort_level,
        "backend": backend,
        "allowAllTools": true,
        "customProfileName": custom_profile_name,
        "chromeEnabled": chrome_enabled,
        "aiLanguage": ai_language,
        "parallelExecutionPrompt": parallel_execution_prompt,
        "queuedAt": std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn start_background_investigation_impl(
    app: &AppHandle,
    worktree_id: String,
    worktree_path: String,
    message: String,
    model: String,
    backend: String,
    provider: Option<String>,
    effort_level: Option<String>,
    custom_profile_name: Option<String>,
    chrome_enabled: Option<bool>,
    ai_language: Option<String>,
    parallel_execution_prompt: Option<String>,
    source: Option<String>,
) -> Result<BackgroundInvestigationResult, String> {
    let sessions = crate::chat::get_sessions(
        app.clone(),
        worktree_id.clone(),
        worktree_path.clone(),
        None,
        Some(false),
    )
    .await?;
    let session_id = match sessions
        .active_session_id
        .clone()
        .or_else(|| sessions.sessions.first().map(|session| session.id.clone()))
    {
        Some(id) => id,
        None => crate::chat::create_session(
            app.clone(),
            worktree_id.clone(),
            worktree_path.clone(),
            None,
            Some(backend.clone()),
            None,
            None,
            None,
            None,
        )
        .await
        .map_err(|error| {
            format!(
                "Background investigation: failed to create session for worktree {worktree_id}: {error}"
            )
        })?
        .id,
    };

    crate::chat::set_session_model(
        app.clone(),
        worktree_id.clone(),
        worktree_path.clone(),
        session_id.clone(),
        model.clone(),
    )
    .await?;
    crate::chat::set_session_backend(
        app.clone(),
        worktree_id.clone(),
        worktree_path.clone(),
        session_id.clone(),
        backend.clone(),
    )
    .await?;
    crate::chat::set_session_provider(
        app.clone(),
        worktree_id.clone(),
        worktree_path.clone(),
        session_id.clone(),
        provider.clone(),
    )
    .await?;

    let source = source.unwrap_or_else(|| "ui".to_string());
    let queued_message = build_background_investigation_queue_message(
        message,
        model,
        backend,
        provider,
        effort_level,
        custom_profile_name,
        chrome_enabled,
        ai_language,
        parallel_execution_prompt,
    );

    // Persist before returning so a transient send race or app reload cannot
    // leave the newly-created session without its investigation prompt. The
    // backend queue drain starts immediately and requeues lost send races.
    // The set_session_* calls materialize metadata for newly-created sessions,
    // allowing enqueue_message to persist the prompt immediately.
    crate::chat::enqueue_message(
        app.clone(),
        worktree_id.clone(),
        worktree_path,
        session_id.clone(),
        queued_message,
    )
    .await?;
    log::info!("Background investigation prompt queued (source={source}) session={session_id}");

    Ok(BackgroundInvestigationResult {
        session_id,
        worktree_id,
        status: "investigation_started".to_string(),
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn start_background_investigation(
    app: AppHandle,
    worktree_id: String,
    worktree_path: String,
    message: String,
    model: String,
    backend: String,
    provider: Option<String>,
    effort_level: Option<String>,
    custom_profile_name: Option<String>,
    chrome_enabled: Option<bool>,
    ai_language: Option<String>,
    parallel_execution_prompt: Option<String>,
) -> Result<BackgroundInvestigationResult, String> {
    start_background_investigation_impl(
        &app,
        worktree_id,
        worktree_path,
        message,
        model,
        backend,
        provider,
        effort_level,
        custom_profile_name,
        chrome_enabled,
        ai_language,
        parallel_execution_prompt,
        Some("ui".to_string()),
    )
    .await
}

async fn wait_for_worktree_ready(app: &AppHandle, worktree_id: &str) -> Result<Value, ToolError> {
    let started = Instant::now();
    loop {
        match dispatch_command(app, "get_worktree", json!({ "worktreeId": worktree_id })).await {
            Ok(worktree) => return Ok(worktree),
            Err(err) if started.elapsed() < Duration::from_secs(15) => {
                if started.elapsed().as_millis() % 1000 < 500 {
                    log::debug!("Jean MCP waiting for worktree {worktree_id}: {err}");
                }
                tokio::time::sleep(Duration::from_millis(500)).await;
            }
            Err(err) => {
                return Err(ToolError::internal(format!(
                    "Timed out waiting for worktree {worktree_id} to be ready after 15s. Creation likely failed before persistence; check worktree:path_exists/worktree:branch_exists events or use a different customName. Last error: {err}"
                )));
            }
        }
    }
}

fn resolve_investigation_selection(
    app: &AppHandle,
    prefs: &crate::AppPreferences,
    worktree: &Value,
    kind: InvestigationKind,
) -> InvestigationSelection {
    let model = match kind {
        InvestigationKind::Issue => prefs.magic_prompt_models.investigate_issue_model.clone(),
        InvestigationKind::Pr => prefs.magic_prompt_models.investigate_pr_model.clone(),
        InvestigationKind::Linear => prefs
            .magic_prompt_models
            .investigate_linear_issue_model
            .clone(),
        InvestigationKind::Advisory => prefs.magic_prompt_models.investigate_advisory_model.clone(),
    };
    let magic_backend = match kind {
        InvestigationKind::Issue => prefs
            .magic_prompt_backends
            .investigate_issue_backend
            .as_deref(),
        InvestigationKind::Pr => prefs
            .magic_prompt_backends
            .investigate_pr_backend
            .as_deref(),
        InvestigationKind::Linear => prefs
            .magic_prompt_backends
            .investigate_linear_issue_backend
            .as_deref(),
        InvestigationKind::Advisory => prefs
            .magic_prompt_backends
            .investigate_advisory_backend
            .as_deref(),
    };
    let provider = match kind {
        InvestigationKind::Issue => prefs
            .magic_prompt_providers
            .investigate_issue_provider
            .clone()
            .or_else(|| prefs.default_provider.clone()),
        InvestigationKind::Pr => prefs
            .magic_prompt_providers
            .investigate_pr_provider
            .clone()
            .or_else(|| prefs.default_provider.clone()),
        InvestigationKind::Linear => prefs
            .magic_prompt_providers
            .investigate_linear_issue_provider
            .clone()
            .or_else(|| prefs.default_provider.clone()),
        InvestigationKind::Advisory => prefs
            .magic_prompt_providers
            .investigate_advisory_provider
            .clone()
            .or_else(|| prefs.default_provider.clone()),
    };
    let effort = match kind {
        InvestigationKind::Issue => prefs.magic_prompt_efforts.investigate_issue_effort.clone(),
        InvestigationKind::Pr => prefs.magic_prompt_efforts.investigate_pr_effort.clone(),
        InvestigationKind::Linear => prefs
            .magic_prompt_efforts
            .investigate_linear_issue_effort
            .clone(),
        InvestigationKind::Advisory => prefs
            .magic_prompt_efforts
            .investigate_advisory_effort
            .clone(),
    }
    .or_else(|| Some(prefs.default_codex_reasoning_effort.clone()));

    let worktree_id = worktree.get("id").and_then(|v| v.as_str());
    let default_backend = project_default_backend(app, worktree_id).unwrap_or_else(|| {
        if !prefs.default_backend.trim().is_empty() {
            prefs.default_backend.clone()
        } else {
            infer_backend_from_model(&model).to_string()
        }
    });
    let backend = magic_backend
        .filter(|b| !b.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or(default_backend);

    InvestigationSelection {
        backend,
        model,
        provider,
        effort,
    }
}

fn build_investigation_prompt(
    prefs: &crate::AppPreferences,
    worktree: &Value,
    kind: InvestigationKind,
) -> String {
    match kind {
        InvestigationKind::Issue => {
            let number = worktree
                .get("issue_number")
                .or_else(|| worktree.get("issueNumber"))
                .and_then(|v| v.as_u64())
                .map(|n| format!("#{n}"))
                .unwrap_or_else(|| "the loaded issue".to_string());
            let template = prefs
                .magic_prompts
                .investigate_issue
                .clone()
                .filter(|p| !p.trim().is_empty())
                .unwrap_or_else(crate::default_investigate_issue_prompt);
            template
                .replace("{issueWord}", "issue")
                .replace("{issueRefs}", &number)
        }
        InvestigationKind::Pr => {
            let number = worktree
                .get("pr_number")
                .or_else(|| worktree.get("prNumber"))
                .and_then(|v| v.as_u64())
                .map(|n| format!("#{n}"))
                .unwrap_or_else(|| "the loaded PR".to_string());
            let template = prefs
                .magic_prompts
                .investigate_pr
                .clone()
                .filter(|p| !p.trim().is_empty())
                .unwrap_or_else(crate::default_investigate_pr_prompt);
            template
                .replace("{prWord}", "PR")
                .replace("{prRefs}", &number)
        }
        InvestigationKind::Linear => {
            let identifier = worktree
                .get("linear_issue_identifier")
                .or_else(|| worktree.get("linearIssueIdentifier"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .unwrap_or_else(|| "the loaded Linear issue".to_string());
            let template = prefs
                .magic_prompts
                .investigate_linear_issue
                .clone()
                .filter(|p| !p.trim().is_empty())
                .unwrap_or_else(crate::default_investigate_linear_issue_prompt);
            template
                .replace("{linearWord}", "issue")
                .replace("{linearRefs}", &identifier)
                .replace("{linearContext}", "")
        }
        InvestigationKind::Advisory => {
            let ghsa_id = worktree
                .get("advisory_ghsa_id")
                .or_else(|| worktree.get("advisoryGhsaId"))
                .and_then(|v| v.as_str())
                .unwrap_or("the loaded security advisory");
            let template = prefs
                .magic_prompts
                .investigate_advisory
                .clone()
                .filter(|p| !p.trim().is_empty())
                .unwrap_or_else(crate::default_investigate_advisory_prompt);
            template
                .replace("{advisoryWord}", "advisory")
                .replace("{advisoryRefs}", ghsa_id)
        }
    }
}

fn project_default_backend(app: &AppHandle, worktree_id: Option<&str>) -> Option<String> {
    let worktree_id = worktree_id?;
    let data = crate::projects::storage::load_projects_data(app).ok()?;
    let worktree = data.find_worktree(worktree_id)?;
    let project = data.find_project(&worktree.project_id)?;
    project.default_backend.clone()
}

fn infer_backend_from_model(model: &str) -> &'static str {
    if crate::is_opencode_model(model) {
        "opencode"
    } else if crate::is_codex_model(model) {
        "codex"
    } else {
        "claude"
    }
}

fn require_value_str(value: &Value, key: &str) -> Result<String, ToolError> {
    value
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| ToolError::internal(format!("missing string field '{key}' in result")))
}

fn resolve_project_path(app: &AppHandle, project_id: &str) -> Result<String, ToolError> {
    let data = crate::projects::storage::load_projects_data(app)
        .map_err(|e| ToolError::internal(format!("load_projects_data: {e}")))?;
    data.find_project(project_id)
        .map(|p| p.path.clone())
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown projectId: {project_id}")))
}

fn resolve_worktree_path(app: &AppHandle, worktree_id: &str) -> Result<String, ToolError> {
    let data = crate::projects::storage::load_projects_data(app)
        .map_err(|e| ToolError::internal(format!("load_projects_data: {e}")))?;
    data.find_worktree(worktree_id)
        .map(|w| w.path.clone())
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown worktreeId: {worktree_id}")))
}

fn resolve_worktree_project(
    app: &AppHandle,
    worktree_id: &str,
) -> Result<(String, String, String), ToolError> {
    let data = crate::projects::storage::load_projects_data(app)
        .map_err(|e| ToolError::internal(format!("load_projects_data: {e}")))?;
    let wt = data
        .find_worktree(worktree_id)
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown worktreeId: {worktree_id}")))?;
    let project = data.find_project(&wt.project_id).ok_or_else(|| {
        ToolError::internal(format!("Worktree {worktree_id} has no parent project"))
    })?;
    Ok((
        project.id.clone(),
        project.name.clone(),
        project.path.clone(),
    ))
}

fn resolve_session_worktree(
    app: &AppHandle,
    session_id: &str,
) -> Result<(String, String), ToolError> {
    let metadata = crate::chat::storage::load_metadata(app, session_id)
        .map_err(|e| ToolError::internal(format!("load_metadata: {e}")))?
        .ok_or_else(|| ToolError::invalid_params(format!("Unknown sessionId: {session_id}")))?;
    let worktree_path = resolve_worktree_path(app, &metadata.worktree_id)?;
    Ok((metadata.worktree_id, worktree_path))
}

fn rate_check(source: &str, tool: &str, limit_per_minute: u32) -> bool {
    if limit_per_minute == 0 {
        return true;
    }
    let now = Instant::now();
    let mut buckets = match RATE_BUCKETS.lock() {
        Ok(b) => b,
        Err(p) => p.into_inner(),
    };
    let bucket = buckets.entry(format!("{source}::{tool}")).or_default();
    while let Some(t) = bucket.front() {
        if now.duration_since(*t) > RATE_LIMIT_WINDOW {
            bucket.pop_front();
        } else {
            break;
        }
    }
    if bucket.len() as u32 >= limit_per_minute {
        return false;
    }
    bucket.push_back(now);
    true
}

pub fn jsonrpc_ok(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "result": result })
}

pub fn jsonrpc_error(id: Option<Value>, code: i32, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "error": { "code": code, "message": message } })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_tool(tools: &Value, name: &str) -> Value {
        tools
            .as_array()
            .and_then(|items| {
                items.iter().find(|item| {
                    item.get("name").and_then(|tool_name| tool_name.as_str()) == Some(name)
                })
            })
            .cloned()
            .unwrap_or_else(|| panic!("{name} tool exists"))
    }

    #[test]
    fn create_worktree_schema_documents_no_open_default() {
        let tools = tool_registry();
        let create_worktree = find_tool(&tools, "create_worktree");

        assert!(
            create_worktree["inputSchema"]["properties"]
                .get("openInJean")
                .is_none(),
            "Jean MCP create_worktree must not expose an auto-open option"
        );
        assert!(
            !create_worktree["description"]
                .as_str()
                .unwrap_or_default()
                .contains("openInJean"),
            "Jean MCP create_worktree docs must not mention openInJean"
        );
        assert_eq!(
            create_worktree["inputSchema"]["properties"]["action"]["enum"][0],
            "start_autoinvestigating"
        );
        assert_eq!(
            create_worktree["inputSchema"]["properties"]["prNumber"]["type"],
            "integer"
        );
        assert_eq!(
            create_worktree["inputSchema"]["properties"]["linearIssueIdentifier"]["type"],
            "string"
        );
        assert_eq!(
            create_worktree["inputSchema"]["properties"]["ghsaId"]["type"],
            "string"
        );
    }

    #[test]
    fn validate_create_worktree_inputs_rejects_mixed_context_sources() {
        assert!(validate_create_worktree_inputs(true, true, false, false, None).is_err());
        assert!(validate_create_worktree_inputs(true, false, true, false, None).is_err());
        assert!(validate_create_worktree_inputs(true, false, false, true, None).is_err());
        assert!(validate_create_worktree_inputs(
            false,
            false,
            false,
            false,
            Some("start_autoinvestigating")
        )
        .is_err());
        assert!(validate_create_worktree_inputs(
            false,
            false,
            true,
            false,
            Some("start_autoinvestigating")
        )
        .is_ok());
        assert!(validate_create_worktree_inputs(
            false,
            false,
            false,
            true,
            Some("start_autoinvestigating")
        )
        .is_ok());
    }

    #[test]
    fn parse_linear_issue_number_extracts_positive_suffix() {
        assert_eq!(parse_linear_issue_number("PLA-215"), Some(215));
        assert_eq!(parse_linear_issue_number(" pla-42 "), Some(42));
        assert_eq!(parse_linear_issue_number("PLA-0"), None);
        assert_eq!(parse_linear_issue_number("PLA"), None);
        assert_eq!(parse_linear_issue_number("PLA-"), None);
    }

    #[test]
    fn tool_registry_includes_pr_listing() {
        let tools = tool_registry();
        let has_pr_list = tools.as_array().is_some_and(|items| {
            items.iter().any(|item| {
                item.get("name").and_then(|name| name.as_str()) == Some("list_github_prs")
            })
        });

        assert!(has_pr_list);
    }

    #[test]
    fn tool_registry_includes_project_lifecycle_tools() {
        let tools = tool_registry();
        let add_project = find_tool(&tools, "add_project");
        let clone_project = find_tool(&tools, "clone_project");
        let init_project = find_tool(&tools, "init_project");

        assert_eq!(add_project["inputSchema"]["required"], json!(["path"]));
        assert!(add_project["inputSchema"]["properties"]
            .get("parentId")
            .is_some());
        assert_eq!(
            clone_project["inputSchema"]["required"],
            json!(["url", "path"])
        );
        assert_eq!(init_project["inputSchema"]["required"], json!(["path"]));
        assert!(RATE_LIMITED_TOOLS.contains(&"add_project"));
        assert!(RATE_LIMITED_TOOLS.contains(&"clone_project"));
        assert!(RATE_LIMITED_TOOLS.contains(&"init_project"));
    }

    #[test]
    fn tool_registry_includes_worktree_lifecycle_tools() {
        let tools = tool_registry();
        let names: std::collections::HashSet<&str> = tools
            .as_array()
            .expect("tools array")
            .iter()
            .filter_map(|item| item.get("name").and_then(|name| name.as_str()))
            .collect();

        for expected in [
            "create_worktree_from_existing_branch",
            "import_worktree",
            "rename_worktree",
            "archive_worktree",
            "unarchive_worktree",
            "list_archived_worktrees",
            "delete_worktree",
            "permanently_delete_worktree",
        ] {
            assert!(names.contains(expected), "missing MCP tool {expected}");
        }

        let create_from_branch = find_tool(&tools, "create_worktree_from_existing_branch");
        assert_eq!(
            create_from_branch["inputSchema"]["required"],
            json!(["projectId", "branchName"])
        );
        assert!(create_from_branch["inputSchema"]["properties"]
            .get("autoOpenInJean")
            .is_none());

        let list_archived = find_tool(&tools, "list_archived_worktrees");
        assert!(list_archived["inputSchema"]["properties"]
            .get("projectId")
            .is_some());
    }

    #[test]
    fn tool_registry_includes_worktree_shipping_tools() {
        let tools = tool_registry();
        let names: std::collections::HashSet<&str> = tools
            .as_array()
            .expect("tools array")
            .iter()
            .filter_map(|item| item.get("name").and_then(|name| name.as_str()))
            .collect();

        for expected in [
            "create_commit",
            "push_worktree",
            "detect_open_pr",
            "create_pull_request",
            "merge_pull_request",
            "run_review",
        ] {
            assert!(names.contains(expected), "missing MCP tool {expected}");
        }

        let create_commit = find_tool(&tools, "create_commit");
        assert_eq!(
            create_commit["inputSchema"]["required"],
            json!(["worktreeId"])
        );
        assert_eq!(
            create_commit["inputSchema"]["properties"]["push"]["type"],
            "boolean"
        );

        let create_pr = find_tool(&tools, "create_pull_request");
        assert!(create_pr["inputSchema"]["properties"]
            .get("sessionId")
            .is_some());

        for limited in [
            "create_commit",
            "create_pull_request",
            "detect_open_pr",
            "merge_pull_request",
            "push_worktree",
            "run_review",
        ] {
            assert!(
                RATE_LIMITED_TOOLS.contains(&limited),
                "shipping tool {limited} must be rate-limited"
            );
        }
    }

    #[test]
    fn link_pr_to_worktree_schema_requires_only_worktree_id() {
        let tools = tool_registry();
        let link_pr = find_tool(&tools, "link_pr_to_worktree");

        assert_eq!(link_pr["inputSchema"]["required"], json!(["worktreeId"]));
        assert_eq!(
            link_pr["inputSchema"]["properties"],
            json!({ "worktreeId": { "type": "string" } })
        );
        assert_eq!(link_pr["inputSchema"]["additionalProperties"], false);
    }

    #[test]
    fn tool_registry_includes_first_release_observability_tools() {
        let tools = tool_registry();
        let names: std::collections::HashSet<&str> = tools
            .as_array()
            .expect("tools array")
            .iter()
            .filter_map(|item| item.get("name").and_then(|name| name.as_str()))
            .collect();

        for expected in [
            "get_project_context",
            "list_sessions",
            "get_session_status",
            "cancel_session_run",
            "get_worktree_changes",
            "get_worktree_diff",
        ] {
            assert!(names.contains(expected), "missing MCP tool {expected}");
        }
    }

    #[test]
    fn worktree_diff_schema_is_bounded() {
        let tools = tool_registry();
        let get_worktree_diff = find_tool(&tools, "get_worktree_diff");

        assert_eq!(
            get_worktree_diff["inputSchema"]["properties"]["maxBytes"]["maximum"],
            MAX_MCP_DIFF_BYTES
        );
        assert_eq!(
            get_worktree_diff["inputSchema"]["properties"]["diffType"]["enum"][0],
            "uncommitted"
        );
    }

    #[test]
    fn no_current_context_error_explains_manual_sources() {
        let error = no_current_context_error("manual-dev");

        assert!(error.message.contains("manual-dev"));
        assert!(error.message.contains("Jean-spawned chat sessions"));
        assert!(error.message.contains("list_projects -> list_worktrees"));
        assert!(error.message.contains("get_session_status(sessionId)"));
    }

    #[test]
    fn tool_registry_includes_security_and_linear_issue_tools() {
        let tools = tool_registry();
        let names: std::collections::HashSet<&str> = tools
            .as_array()
            .expect("tools array")
            .iter()
            .filter_map(|item| item.get("name").and_then(|name| name.as_str()))
            .collect();

        for expected in [
            "list_security_issues",
            "list_security_advisories",
            "list_linear_issues",
        ] {
            assert!(names.contains(expected), "missing MCP tool {expected}");
        }
    }

    #[test]
    fn security_issue_schema_matches_ui_backed_dependabot_states() {
        let tools = tool_registry();
        let list_security_issues = find_tool(&tools, "list_security_issues");
        let state = &list_security_issues["inputSchema"]["properties"]["state"];

        assert_eq!(state["default"], "open");
        assert_eq!(
            state["enum"],
            json!(["open", "dismissed", "fixed", "auto_dismissed", "all"])
        );
        assert_eq!(
            list_security_issues["inputSchema"]["required"],
            json!(["projectId"])
        );
    }

    #[test]
    fn security_advisory_and_linear_schemas_require_project_id() {
        let tools = tool_registry();
        let list_security_advisories = find_tool(&tools, "list_security_advisories");
        let list_linear_issues = find_tool(&tools, "list_linear_issues");

        assert_eq!(
            list_security_advisories["inputSchema"]["properties"]["state"]["default"],
            "all"
        );
        assert_eq!(
            list_security_advisories["inputSchema"]["required"],
            json!(["projectId"])
        );
        assert_eq!(
            list_linear_issues["inputSchema"]["required"],
            json!(["projectId"])
        );
        assert!(list_linear_issues["inputSchema"]["properties"]
            .get("projectId")
            .is_some());
    }

    #[test]
    fn background_investigation_prompt_is_queued_with_send_settings() {
        let queued = build_background_investigation_queue_message(
            "Investigate issue #42".to_string(),
            "gpt-5.6-sol".to_string(),
            "codex".to_string(),
            Some("profile-a".to_string()),
            Some("high".to_string()),
            None,
            None,
            None,
            None,
        );

        assert_eq!(queued["message"], "Investigate issue #42");
        assert_eq!(queued["model"], "gpt-5.6-sol");
        assert_eq!(queued["backend"], "codex");
        assert_eq!(queued["provider"], "profile-a");
        assert_eq!(queued["effortLevel"], "high");
        assert_eq!(queued["executionMode"], "plan");
        assert_eq!(queued["thinkingLevel"], "think");
        assert_eq!(queued["allowAllTools"], true);
        assert!(queued["id"].as_str().is_some_and(|id| !id.is_empty()));
        assert!(queued["queuedAt"].as_u64().is_some());
    }
}
