use serde::Serialize;
use tauri::Manager;

use crate::projects::github_issues::{
    get_github_contexts_dir, get_session_advisory_refs, get_session_issue_refs,
    get_session_pr_refs, get_session_security_refs,
};
use crate::projects::linear_issues::get_session_linear_refs;
use crate::projects::sentry_issues::get_session_sentry_refs;
use crate::projects::storage::load_projects_data;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalContextBackend {
    Claude,
    Codex,
    Opencode,
}

impl TerminalContextBackend {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "claude" => Some(Self::Claude),
            "codex" => Some(Self::Codex),
            "opencode" => Some(Self::Opencode),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedBackendTerminalContext {
    pub command_args: Vec<String>,
}

fn trimmed_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn backend_system_prompt(
    prefs: &crate::AppPreferences,
    backend: TerminalContextBackend,
) -> Option<String> {
    match backend {
        TerminalContextBackend::Claude => trimmed_non_empty(
            prefs
                .magic_prompts
                .claude_system_prompt
                .as_deref()
                .or_else(|| Some(crate::chat::claude::default_claude_system_prompt())),
        ),
        TerminalContextBackend::Codex => trimmed_non_empty(
            prefs
                .magic_prompts
                .codex_system_prompt
                .as_deref()
                .or_else(|| Some(crate::chat::codex::default_codex_system_prompt())),
        ),
        TerminalContextBackend::Opencode => {
            trimmed_non_empty(prefs.magic_prompts.opencode_system_prompt.as_deref())
        }
    }
}

fn build_system_prompt_parts(
    app: &tauri::AppHandle,
    worktree_id: &str,
    backend: TerminalContextBackend,
) -> Vec<String> {
    let prefs = crate::load_preferences_sync(app).ok();
    let mut parts = Vec::new();

    if let Some(lang) = prefs
        .as_ref()
        .and_then(|prefs| trimmed_non_empty(Some(&prefs.ai_language)))
    {
        parts.push(format!("Respond to the user in {lang}."));
    }

    if let Some(prompt) = prefs
        .as_ref()
        .and_then(|prefs| backend_system_prompt(prefs, backend))
    {
        parts.push(prompt);
    }

    if let Some(parallel_prompt) = prefs.as_ref().and_then(|prefs| {
        prefs
            .parallel_execution_prompt_enabled
            .then(|| trimmed_non_empty(prefs.magic_prompts.parallel_execution.as_deref()))
            .flatten()
    }) {
        parts.push(parallel_prompt);
    }

    if let Ok(data) = load_projects_data(app) {
        if let Some(worktree) = data.find_worktree(worktree_id) {
            if let Some(project) = data.find_project(&worktree.project_id) {
                if let Some(prompt) = trimmed_non_empty(project.custom_system_prompt.as_deref()) {
                    parts.push(prompt);
                }

                let linked_paths: Vec<String> = project
                    .linked_project_ids
                    .iter()
                    .filter_map(|id| data.find_project(id))
                    .filter_map(|project| trimmed_non_empty(Some(&project.path)))
                    .collect();
                if !linked_paths.is_empty() {
                    let dirs_list = linked_paths
                        .iter()
                        .map(|path| format!("- {path}"))
                        .collect::<Vec<_>>()
                        .join("\n");
                    parts.push(format!(
                        "This project is linked to other projects for cross-project context. \
                         Check the following directories for additional instructions and documentation \
                         (e.g., CLAUDE.md, AGENTS.md, docs/):\n{dirs_list}"
                    ));
                }
            }
        }
    }

    let claude_binary = crate::claude_cli::resolve_cli_binary(app);
    if claude_binary.is_absolute() {
        parts.push(format!(
            "When running Claude CLI commands, use the full path to the host system binary: {}\n\
             Do NOT use bare `claude` — always use the full path above.",
            claude_binary.display()
        ));
    }

    let codex_binary = crate::codex_cli::resolve_cli_binary(app);
    if codex_binary.is_absolute() {
        parts.push(format!(
            "When running Codex CLI commands, use the full path to the host system binary: {}\n\
             Do NOT use bare `codex` — always use the full path above.",
            codex_binary.display()
        ));
    }

    crate::chat::push_recap_instruction_if_enabled(
        &mut parts,
        crate::chat::is_recap_prompting_enabled(app),
    );

    parts
}

fn push_unique<T: Eq>(items: &mut Vec<T>, next: T) {
    if !items.contains(&next) {
        items.push(next);
    }
}

fn collect_context_paths(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
) -> Vec<std::path::PathBuf> {
    let Ok(contexts_dir) = get_github_contexts_dir(app) else {
        return Vec::new();
    };
    let mut paths = Vec::new();

    let mut issue_keys = get_session_issue_refs(app, session_id).unwrap_or_default();
    for key in get_session_issue_refs(app, worktree_id).unwrap_or_default() {
        push_unique(&mut issue_keys, key);
    }
    for key in issue_keys {
        if let Some((repo_key, number)) = key.rsplit_once('-') {
            let path = contexts_dir.join(format!("{repo_key}-issue-{number}.md"));
            if path.exists() {
                paths.push(path);
            }
        }
    }

    let mut pr_keys = get_session_pr_refs(app, session_id).unwrap_or_default();
    for key in get_session_pr_refs(app, worktree_id).unwrap_or_default() {
        push_unique(&mut pr_keys, key);
    }
    for key in pr_keys {
        if let Some((repo_key, number)) = key.rsplit_once('-') {
            let path = contexts_dir.join(format!("{repo_key}-pr-{number}.md"));
            if path.exists() {
                paths.push(path);
            }
        }
    }

    let mut security_keys = get_session_security_refs(app, session_id).unwrap_or_default();
    for key in get_session_security_refs(app, worktree_id).unwrap_or_default() {
        push_unique(&mut security_keys, key);
    }
    for key in security_keys {
        if let Some((repo_key, number)) = key.rsplit_once('-') {
            let path = contexts_dir.join(format!("{repo_key}-security-{number}.md"));
            if path.exists() {
                paths.push(path);
            }
        }
    }

    let mut advisory_keys = get_session_advisory_refs(app, session_id).unwrap_or_default();
    for key in get_session_advisory_refs(app, worktree_id).unwrap_or_default() {
        push_unique(&mut advisory_keys, key);
    }
    for key in advisory_keys {
        if let Some((repo_key, ghsa_id)) = key.split_once("::") {
            let path = contexts_dir.join(format!("{repo_key}-advisory-{ghsa_id}.md"));
            if path.exists() {
                paths.push(path);
            }
        }
    }

    let mut linear_keys = get_session_linear_refs(app, session_id).unwrap_or_default();
    for key in get_session_linear_refs(app, worktree_id).unwrap_or_default() {
        push_unique(&mut linear_keys, key);
    }
    for key in linear_keys {
        let parts: Vec<&str> = key.rsplitn(3, '-').collect();
        if parts.len() == 3 {
            let identifier_lower = format!("{}-{}", parts[1].to_lowercase(), parts[0]);
            let path = contexts_dir.join(format!("{}-linear-{identifier_lower}.md", parts[2]));
            if path.exists() {
                paths.push(path);
            }
        }
    }

    let mut sentry_keys = get_session_sentry_refs(app, session_id).unwrap_or_default();
    if let Ok(worktree_keys) = get_session_sentry_refs(app, worktree_id) {
        for key in worktree_keys {
            if !sentry_keys.contains(&key) {
                sentry_keys.push(key);
            }
        }
    }
    if let Ok(contexts_dir) = get_github_contexts_dir(app) {
        for key in sentry_keys {
            if let Some((project_name, issue_id)) = key.split_once("::") {
                let path = contexts_dir.join(format!("{project_name}-sentry-{issue_id}.md"));
                if path.exists() {
                    paths.push(path);
                }
            }
        }
    }

    if let Ok(app_data_dir) = app.path().app_data_dir() {
        let saved_contexts_dir = app_data_dir.join("session-context");
        let prefix = format!("{session_id}-context-");
        if let Ok(entries) = std::fs::read_dir(saved_contexts_dir) {
            let mut context_files: Vec<_> = entries
                .flatten()
                .filter(|entry| {
                    let name = entry.file_name().to_string_lossy().to_string();
                    name.starts_with(&prefix) && name.ends_with(".md")
                })
                .collect();
            context_files.sort_by_key(|entry| entry.file_name());
            paths.extend(context_files.into_iter().map(|entry| entry.path()));
        }
    }

    paths
}

fn format_loaded_context(context_paths: &[std::path::PathBuf]) -> String {
    let mut content = String::new();
    for path in context_paths {
        if let Ok(file_content) = std::fs::read_to_string(path) {
            if content.is_empty() {
                content.push_str("# Loaded Context\n\n");
                content.push_str(
                    "The following context has been loaded. You should be aware of this when working on this task.\n\n---\n\n",
                );
            }
            content.push_str(&file_content);
            content.push_str("\n\n---\n\n");
        }
    }
    content
}

pub fn build_loaded_context_content(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
) -> String {
    format_loaded_context(&collect_context_paths(app, session_id, worktree_id))
}

pub fn build_combined_terminal_context_content(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    backend: TerminalContextBackend,
) -> String {
    let mut content = String::new();
    let system_prompt_parts = build_system_prompt_parts(app, worktree_id, backend);
    if !system_prompt_parts.is_empty() {
        content.push_str("# Instructions\n\n");
        for part in &system_prompt_parts {
            content.push_str(part);
            content.push('\n');
        }
        content.push_str("\n---\n\n");
    }

    let loaded_context = build_loaded_context_content(app, session_id, worktree_id);
    if !loaded_context.is_empty() {
        content.push_str(&loaded_context);
    }

    content
}

fn write_combined_terminal_context_file(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    backend: TerminalContextBackend,
) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let combined_dir = app_data_dir.join("combined-contexts");
    std::fs::create_dir_all(&combined_dir)
        .map_err(|e| format!("Failed to create combined context directory: {e}"))?;

    let file_path = combined_dir.join(format!("{session_id}-terminal-context.md"));
    let content = build_combined_terminal_context_content(app, session_id, worktree_id, backend);
    std::fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write terminal context file: {e}"))?;
    Ok(file_path)
}

fn toml_basic_string(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "\"\"".to_string())
}

pub fn prepare_backend_terminal_context(
    app: &tauri::AppHandle,
    session_id: &str,
    worktree_id: &str,
    backend: TerminalContextBackend,
) -> Result<PreparedBackendTerminalContext, String> {
    let context_file = write_combined_terminal_context_file(app, session_id, worktree_id, backend)?;
    let command_args = match backend {
        TerminalContextBackend::Claude => vec![
            "--append-system-prompt-file".to_string(),
            context_file.to_string_lossy().to_string(),
        ],
        TerminalContextBackend::Codex => {
            let content = std::fs::read_to_string(&context_file)
                .map_err(|e| format!("Failed to read terminal context file: {e}"))?;
            vec![
                "--config".to_string(),
                format!("base_instructions={}", toml_basic_string(&content)),
            ]
        }
        TerminalContextBackend::Opencode => Vec::new(),
    };

    Ok(PreparedBackendTerminalContext { command_args })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_loaded_context_inlines_each_context_file() {
        let dir = tempfile::tempdir().unwrap();
        let issue = dir.path().join("issue.md");
        let saved = dir.path().join("saved.md");
        std::fs::write(&issue, "# Issue\n\nDetails").unwrap();
        std::fs::write(&saved, "# Saved context\n\nPrior work").unwrap();

        let content = format_loaded_context(&[issue, saved]);

        assert!(content.starts_with("# Loaded Context\n\n"));
        assert!(content.contains("Details"));
        assert!(content.contains("Prior work"));
    }

    #[test]
    fn toml_basic_string_escapes_multiline_context() {
        let encoded = toml_basic_string("hello\n\"quoted\"");
        assert_eq!(encoded, "\"hello\\n\\\"quoted\\\"\"");
    }
}
