use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};

const MAX_NATIVE_HISTORY_FILES: usize = 10_000;
const MAX_NATIVE_HISTORY_CACHE_ROWS: usize = 500;
const MAX_NATIVE_HISTORY_RESULTS: usize = 100;
const DEFAULT_NATIVE_HISTORY_RESULTS: usize = 5;
const NATIVE_HISTORY_CACHE_TTL: Duration = Duration::from_secs(30);

static NATIVE_HISTORY_CACHE: OnceLock<
    Mutex<HashMap<NativeHistoryCacheKey, NativeHistoryCacheEntry>>,
> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCliHistorySession {
    pub backend: String,
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub updated_at: u64,
    pub resume_args: Vec<String>,
    pub source_path: String,
}

#[derive(Debug, Clone, Eq)]
struct NativeHistoryCacheKey {
    backend: String,
    worktree_path: String,
}

impl PartialEq for NativeHistoryCacheKey {
    fn eq(&self, other: &Self) -> bool {
        self.backend == other.backend && self.worktree_path == other.worktree_path
    }
}

impl Hash for NativeHistoryCacheKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.backend.hash(state);
        self.worktree_path.hash(state);
    }
}

#[derive(Debug, Clone)]
struct NativeHistoryCacheEntry {
    expires_at: Instant,
    sessions: Vec<NativeCliHistorySession>,
}

#[tauri::command]
pub async fn list_native_cli_sessions(
    worktree_path: String,
    backend: String,
    search_query: Option<String>,
    result_limit: Option<usize>,
) -> Result<Vec<NativeCliHistorySession>, String> {
    let query = normalize_search_query(search_query.as_deref());
    let limit = result_limit
        .unwrap_or(if query.is_some() {
            MAX_NATIVE_HISTORY_RESULTS
        } else {
            DEFAULT_NATIVE_HISTORY_RESULTS
        })
        .clamp(1, MAX_NATIVE_HISTORY_RESULTS);
    let sessions = get_cached_native_sessions(&worktree_path, &backend)?;
    Ok(filter_cached_native_sessions(
        &sessions,
        query.as_deref(),
        limit,
    ))
}

fn get_cached_native_sessions(
    worktree_path: &str,
    backend: &str,
) -> Result<Vec<NativeCliHistorySession>, String> {
    let key = NativeHistoryCacheKey {
        backend: backend.to_string(),
        worktree_path: canonical_path_key(worktree_path),
    };
    let now = Instant::now();
    let cache = NATIVE_HISTORY_CACHE.get_or_init(|| Mutex::new(HashMap::new()));

    if let Ok(cache_guard) = cache.lock() {
        if let Some(entry) = cache_guard.get(&key) {
            if entry.expires_at > now {
                return Ok(entry.sessions.clone());
            }
        }
    }

    let sessions = load_native_sessions_uncached(worktree_path, backend)?;
    if let Ok(mut cache_guard) = cache.lock() {
        cache_guard.insert(
            key,
            NativeHistoryCacheEntry {
                expires_at: now + NATIVE_HISTORY_CACHE_TTL,
                sessions: sessions.clone(),
            },
        );
    }
    Ok(sessions)
}

fn load_native_sessions_uncached(
    worktree_path: &str,
    backend: &str,
) -> Result<Vec<NativeCliHistorySession>, String> {
    match backend {
        "codex" => list_codex_sessions(worktree_path, None, MAX_NATIVE_HISTORY_CACHE_ROWS),
        "claude" => list_claude_sessions(worktree_path, None, MAX_NATIVE_HISTORY_CACHE_ROWS),
        "opencode" => list_opencode_sessions(worktree_path, None, MAX_NATIVE_HISTORY_CACHE_ROWS),
        other => Err(format!("Unsupported native CLI history backend: {other}")),
    }
}

fn filter_cached_native_sessions(
    sessions: &[NativeCliHistorySession],
    query: Option<&str>,
    limit: usize,
) -> Vec<NativeCliHistorySession> {
    sessions
        .iter()
        .filter(|session| native_session_matches_query(session, query))
        .take(limit)
        .cloned()
        .collect()
}

fn list_codex_sessions(
    worktree_path: &str,
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<NativeCliHistorySession>, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(Vec::new());
    };
    let root = home.join(".codex").join("sessions");
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    for path in collect_jsonl_files(&root, Some("rollout-"))? {
        if let Some(session) = parse_codex_session_file(&path, worktree_path) {
            push_if_matches(&mut results, session, query);
        }
    }
    sort_and_limit(results, limit)
}

fn list_claude_sessions(
    worktree_path: &str,
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<NativeCliHistorySession>, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(Vec::new());
    };
    let projects_root = home.join(".claude").join("projects");
    if !projects_root.exists() {
        return Ok(Vec::new());
    }

    let escaped_dir = projects_root.join(escape_claude_project_dir(worktree_path));
    let search_roots = if escaped_dir.exists() {
        vec![escaped_dir]
    } else {
        vec![projects_root]
    };

    let mut results = Vec::new();
    for root in search_roots {
        for path in collect_jsonl_files(&root, None)? {
            if let Some(session) = parse_claude_session_file(&path, worktree_path) {
                push_if_matches(&mut results, session, query);
            }
        }
    }
    sort_and_limit(results, limit)
}

fn list_opencode_sessions(
    worktree_path: &str,
    query: Option<&str>,
    limit: usize,
) -> Result<Vec<NativeCliHistorySession>, String> {
    let Some(home) = dirs::home_dir() else {
        return Ok(Vec::new());
    };
    let sessions_root = home
        .join(".local")
        .join("share")
        .join("opencode")
        .join("storage")
        .join("session");
    if !sessions_root.exists() {
        return Ok(Vec::new());
    }

    let mut results = Vec::new();
    for path in collect_files_with_extension(&sessions_root, "json")? {
        if let Some(session) = parse_opencode_session_file(&path, worktree_path) {
            push_if_matches(&mut results, session, query);
        }
    }
    sort_and_limit(results, limit)
}

fn collect_jsonl_files(root: &Path, filename_prefix: Option<&str>) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_jsonl_files_inner(root, filename_prefix, &mut files)?;
    Ok(files)
}

fn collect_jsonl_files_inner(
    root: &Path,
    filename_prefix: Option<&str>,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if files.len() >= MAX_NATIVE_HISTORY_FILES {
        return Ok(());
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        if files.len() >= MAX_NATIVE_HISTORY_FILES {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files_inner(&path, filename_prefix, files)?;
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        if let Some(prefix) = filename_prefix {
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !name.starts_with(prefix) {
                continue;
            }
        }
        files.push(path);
    }
    Ok(())
}

fn collect_files_with_extension(root: &Path, extension: &str) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_files_with_extension_inner(root, extension, &mut files)?;
    Ok(files)
}

fn collect_files_with_extension_inner(
    root: &Path,
    extension: &str,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    if files.len() >= MAX_NATIVE_HISTORY_FILES {
        return Ok(());
    }
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };
    for entry in entries.flatten() {
        if files.len() >= MAX_NATIVE_HISTORY_FILES {
            break;
        }
        let path = entry.path();
        if path.is_dir() {
            collect_files_with_extension_inner(&path, extension, files)?;
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) == Some(extension) {
            files.push(path);
        }
    }
    Ok(())
}

fn parse_codex_session_file(path: &Path, worktree_path: &str) -> Option<NativeCliHistorySession> {
    let contents = fs::read_to_string(path).ok()?;
    let mut id = None;
    let mut cwd = None;
    let mut title = None;
    let mut source = None;
    let mut originator = None;

    for line in contents.lines().take(500) {
        let value: Value = serde_json::from_str(line).ok()?;
        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            let payload = value.get("payload")?;
            id = payload
                .get("id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            cwd = payload
                .get("cwd")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            source = payload
                .get("source")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
            originator = payload
                .get("originator")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }

        if title.is_none() {
            title = codex_title_from_line(&value);
        }

        if id.is_some() && cwd.is_some() && title.is_some() {
            break;
        }
    }

    let id = id?;
    let cwd = cwd?;
    if source.as_deref() == Some("exec") || originator.as_deref() == Some("codex_exec") {
        return None;
    }
    if !same_path(&cwd, worktree_path) {
        return None;
    }
    let title = title?;
    Some(NativeCliHistorySession {
        backend: "codex".to_string(),
        id: id.clone(),
        title,
        cwd,
        updated_at: file_updated_at(path),
        resume_args: vec!["resume".to_string(), id],
        source_path: path.to_string_lossy().to_string(),
    })
}

fn codex_title_from_line(value: &Value) -> Option<String> {
    if value.get("type").and_then(Value::as_str) == Some("event_msg") {
        let payload = value.get("payload")?;
        if payload.get("type").and_then(Value::as_str) == Some("user_message") {
            return trim_codex_user_title(payload.get("message")?.as_str()?);
        }
    }

    if value.get("type").and_then(Value::as_str) == Some("response_item") {
        let payload = value.get("payload")?;
        if payload.get("type").and_then(Value::as_str) == Some("message")
            && payload.get("role").and_then(Value::as_str) == Some("user")
        {
            for item in payload.get("content").and_then(Value::as_array)? {
                if item.get("type").and_then(Value::as_str) == Some("input_text") {
                    if let Some(title) = trim_codex_user_title(item.get("text")?.as_str()?) {
                        return Some(title);
                    }
                }
            }
        }
    }
    None
}

fn trim_codex_user_title(value: &str) -> Option<String> {
    if is_native_context_message(value) {
        return None;
    }
    trim_title(value)
}

fn parse_claude_session_file(path: &Path, worktree_path: &str) -> Option<NativeCliHistorySession> {
    let contents = fs::read_to_string(path).ok()?;
    let mut id = path.file_stem()?.to_str()?.to_string();
    let mut cwd = None;
    let mut title = None;
    let mut slug = None;

    for line in contents.lines().take(200) {
        let value: Value = serde_json::from_str(line).ok()?;
        if let Some(session_id) = value.get("sessionId").and_then(Value::as_str) {
            id = session_id.to_string();
        }
        if cwd.is_none() {
            cwd = value
                .get("cwd")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
        if slug.is_none() {
            slug = value.get("slug").and_then(Value::as_str).map(humanize_slug);
        }
        if title.is_none()
            && value.get("type").and_then(Value::as_str) == Some("user")
            && value.get("isSidechain").and_then(Value::as_bool) != Some(true)
        {
            if let Some(content) = value
                .get("message")
                .and_then(|message| message.get("content"))
            {
                title = title_from_claude_content(content);
            }
        }

        if cwd.is_some() && title.is_some() {
            break;
        }
    }

    let cwd = cwd?;
    if !same_path(&cwd, worktree_path) {
        return None;
    }
    Some(NativeCliHistorySession {
        backend: "claude".to_string(),
        id: id.clone(),
        title: title
            .or(slug)
            .unwrap_or_else(|| "Claude session".to_string()),
        cwd,
        updated_at: file_updated_at(path),
        resume_args: vec!["--resume".to_string(), id],
        source_path: path.to_string_lossy().to_string(),
    })
}

fn title_from_claude_content(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return trim_claude_user_title(text);
    }
    for item in content.as_array()? {
        if item.get("type").and_then(Value::as_str) == Some("text") {
            if let Some(title) = trim_claude_user_title(item.get("text")?.as_str()?) {
                return Some(title);
            }
        }
    }
    None
}

fn trim_claude_user_title(value: &str) -> Option<String> {
    if is_native_context_message(value) {
        return None;
    }
    trim_title(value)
}

fn parse_opencode_session_file(
    path: &Path,
    worktree_path: &str,
) -> Option<NativeCliHistorySession> {
    let value: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    let id = value.get("id").and_then(Value::as_str)?.to_string();
    let cwd = value
        .get("directory")
        .or_else(|| value.get("path"))
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| opencode_project_worktree_from_path(path))?;
    if !same_path(&cwd, worktree_path) {
        return None;
    }

    let title = trim_title(value.get("title").and_then(Value::as_str)?)?;
    let updated_at = value
        .get("time")
        .and_then(|time| time.get("updated").or_else(|| time.get("created")))
        .and_then(Value::as_u64)
        .map(|millis| millis / 1000)
        .unwrap_or_else(|| file_updated_at(path));

    Some(NativeCliHistorySession {
        backend: "opencode".to_string(),
        id: id.clone(),
        title,
        cwd,
        updated_at,
        resume_args: vec!["--session".to_string(), id],
        source_path: path.to_string_lossy().to_string(),
    })
}

fn opencode_project_worktree_from_path(path: &Path) -> Option<String> {
    let project_id = path.parent()?.file_name()?.to_str()?;
    let project_path = dirs::home_dir()?
        .join(".local")
        .join("share")
        .join("opencode")
        .join("storage")
        .join("project")
        .join(format!("{project_id}.json"));
    let value: Value = serde_json::from_str(&fs::read_to_string(project_path).ok()?).ok()?;
    value
        .get("worktree")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}

fn file_updated_at(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn trim_title(value: &str) -> Option<String> {
    let one_line = value.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = one_line.trim();
    if trimmed.is_empty() {
        None
    } else if trimmed.chars().count() > 96 {
        Some(trimmed.chars().take(93).collect::<String>() + "...")
    } else {
        Some(trimmed.to_string())
    }
}

fn humanize_slug(slug: &str) -> String {
    slug.split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn escape_claude_project_dir(path: &str) -> String {
    path.replace('/', "-")
}

fn same_path(a: &str, b: &str) -> bool {
    let normalize = |value: &str| {
        Path::new(value)
            .canonicalize()
            .unwrap_or_else(|_| PathBuf::from(value))
    };
    normalize(a) == normalize(b)
}

fn canonical_path_key(path: &str) -> String {
    Path::new(path)
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from(path))
        .to_string_lossy()
        .to_string()
}

fn sort_and_limit(
    mut sessions: Vec<NativeCliHistorySession>,
    limit: usize,
) -> Result<Vec<NativeCliHistorySession>, String> {
    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    sessions.truncate(limit);
    Ok(sessions)
}

fn push_if_matches(
    results: &mut Vec<NativeCliHistorySession>,
    session: NativeCliHistorySession,
    query: Option<&str>,
) {
    if native_session_matches_query(&session, query) {
        results.push(session);
    }
}

fn native_session_matches_query(session: &NativeCliHistorySession, query: Option<&str>) -> bool {
    let Some(query) = query else {
        return true;
    };
    let haystack = [
        session.backend.as_str(),
        session.id.as_str(),
        session.title.as_str(),
        session.cwd.as_str(),
        session.source_path.as_str(),
        &session.resume_args.join(" "),
    ]
    .join(" ")
    .to_lowercase();
    haystack.contains(query)
}

fn normalize_search_query(value: Option<&str>) -> Option<String> {
    value
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())
}

fn is_native_context_message(value: &str) -> bool {
    let trimmed = value.trim_start();
    trimmed.starts_with("# AGENTS.md instructions for ")
        || trimmed.starts_with("# CLAUDE.md instructions for ")
        || trimmed.starts_with("<environment_context>")
        || trimmed.starts_with("<permissions instructions>")
        || trimmed.starts_with("<turn_aborted>")
        || trimmed.starts_with("<user_editable_context>")
        || trimmed.starts_with("<local-command-caveat>")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_session(id: usize, updated_at: u64, title: &str) -> NativeCliHistorySession {
        NativeCliHistorySession {
            backend: "claude".to_string(),
            id: format!("session-{id}"),
            title: title.to_string(),
            cwd: "/tmp/worktree".to_string(),
            updated_at,
            resume_args: vec!["--resume".to_string(), format!("session-{id}")],
            source_path: format!("/tmp/session-{id}.jsonl"),
        }
    }

    #[test]
    fn native_history_default_returns_latest_five_from_cache() {
        let sessions = (0..10)
            .map(|index| test_session(index, index as u64, &format!("task {index}")))
            .collect::<Vec<_>>();

        let results =
            filter_cached_native_sessions(&sessions, None, DEFAULT_NATIVE_HISTORY_RESULTS);

        assert_eq!(results.len(), 5);
        assert_eq!(results[0].title, "task 0");
        assert_eq!(results[4].title, "task 4");
    }
}
