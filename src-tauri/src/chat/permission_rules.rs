use serde_json::Value;
use std::fs;
use std::path::Path;

pub fn add_global_command_permission_rule(command: String) -> Result<(), String> {
    let home = dirs::home_dir().ok_or_else(|| "No home directory found".to_string())?;
    let codex_rules_path = home.join(".codex").join("rules").join("default.rules");
    let claude_settings_path = home.join(".claude").join("settings.json");
    add_command_permission_rule_to_paths(&command, &codex_rules_path, &claude_settings_path)
}

fn add_command_permission_rule_to_paths(
    command: &str,
    codex_rules_path: &Path,
    claude_settings_path: &Path,
) -> Result<(), String> {
    let command = command.trim();
    if command.is_empty() {
        return Err("Command cannot be empty".to_string());
    }

    let words = shlex::split(command)
        .filter(|items| !items.is_empty())
        .ok_or_else(|| "Could not parse command for Codex default.rules".to_string())?;

    append_codex_rule(codex_rules_path, &words)?;
    append_claude_permission(claude_settings_path, command)?;
    Ok(())
}

fn append_codex_rule(path: &Path, words: &[String]) -> Result<(), String> {
    let pattern = serde_json::to_string(words)
        .map_err(|error| format!("Failed to serialize Codex rule pattern: {error}"))?;
    let rule = format!("prefix_rule(pattern={pattern}, decision=\"allow\")");
    append_unique_line(path, &rule)
}

fn append_unique_line(path: &Path, line: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create permission rules directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let existing = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(format!(
                "Failed to read permission rules file {}: {error}",
                path.display()
            ))
        }
    };

    if existing
        .lines()
        .any(|existing_line| existing_line.trim() == line)
    {
        return Ok(());
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push_str(line);
    next.push('\n');

    fs::write(path, next).map_err(|error| {
        format!(
            "Failed to write permission rules file {}: {error}",
            path.display()
        )
    })
}

fn append_claude_permission(path: &Path, command: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create Claude settings directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let mut settings = match fs::read_to_string(path) {
        Ok(content) if content.trim().is_empty() => Value::Object(Default::default()),
        Ok(content) => serde_json::from_str::<Value>(&content).map_err(|error| {
            format!(
                "Failed to parse Claude settings file {}: {error}",
                path.display()
            )
        })?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Value::Object(Default::default())
        }
        Err(error) => {
            return Err(format!(
                "Failed to read Claude settings file {}: {error}",
                path.display()
            ))
        }
    };

    let permission = format!("Bash({command})");
    let root = settings
        .as_object_mut()
        .ok_or_else(|| "Claude settings must be a JSON object".to_string())?;
    let permissions = root
        .entry("permissions")
        .or_insert_with(|| Value::Object(Default::default()))
        .as_object_mut()
        .ok_or_else(|| "Claude settings permissions must be a JSON object".to_string())?;
    let allow = permissions
        .entry("allow")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| "Claude settings permissions.allow must be an array".to_string())?;

    if !allow
        .iter()
        .any(|value| value.as_str() == Some(permission.as_str()))
    {
        allow.push(Value::String(permission));
    }

    let content = serde_json::to_string_pretty(&settings)
        .map_err(|error| format!("Failed to serialize Claude settings: {error}"))?;
    fs::write(path, format!("{content}\n")).map_err(|error| {
        format!(
            "Failed to write Claude settings file {}: {error}",
            path.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_paths(dir: &Path) -> (PathBuf, PathBuf) {
        (
            dir.join(".codex").join("rules").join("default.rules"),
            dir.join(".claude").join("settings.json"),
        )
    }

    #[test]
    fn writes_codex_and_claude_global_command_rules() {
        let temp = tempfile::tempdir().expect("tempdir");
        let (codex_path, claude_path) = test_paths(temp.path());

        add_command_permission_rule_to_paths("bun run check:all", &codex_path, &claude_path)
            .expect("rule write succeeds");

        let codex = fs::read_to_string(codex_path).expect("codex rules");
        assert!(codex
            .contains("prefix_rule(pattern=[\"bun\",\"run\",\"check:all\"], decision=\"allow\")"));

        let claude: Value =
            serde_json::from_str(&fs::read_to_string(claude_path).expect("claude settings"))
                .expect("valid json");
        assert_eq!(
            claude["permissions"]["allow"],
            serde_json::json!(["Bash(bun run check:all)"])
        );
    }

    #[test]
    fn deduplicates_existing_rules_and_preserves_claude_settings() {
        let temp = tempfile::tempdir().expect("tempdir");
        let (codex_path, claude_path) = test_paths(temp.path());
        fs::create_dir_all(codex_path.parent().expect("codex parent")).expect("codex dir");
        fs::write(
            &codex_path,
            "prefix_rule(pattern=[\"bun\",\"run\",\"check:all\"], decision=\"allow\")\n",
        )
        .expect("seed codex");
        fs::create_dir_all(claude_path.parent().expect("claude parent")).expect("claude dir");
        fs::write(
            &claude_path,
            serde_json::json!({
                "model": "sonnet",
                "permissions": {
                    "allow": ["Bash(bun run check:all)"]
                }
            })
            .to_string(),
        )
        .expect("seed claude");

        add_command_permission_rule_to_paths("bun run check:all", &codex_path, &claude_path)
            .expect("rule write succeeds");

        let codex = fs::read_to_string(codex_path).expect("codex rules");
        assert_eq!(codex.lines().count(), 1);

        let claude: Value =
            serde_json::from_str(&fs::read_to_string(claude_path).expect("claude settings"))
                .expect("valid json");
        assert_eq!(claude["model"], "sonnet");
        assert_eq!(claude["permissions"]["allow"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn rejects_empty_or_unparseable_commands() {
        let temp = tempfile::tempdir().expect("tempdir");
        let (codex_path, claude_path) = test_paths(temp.path());

        assert!(add_command_permission_rule_to_paths("  ", &codex_path, &claude_path).is_err());
        assert!(add_command_permission_rule_to_paths(
            "echo 'unterminated",
            &codex_path,
            &claude_path
        )
        .is_err());
    }
}
