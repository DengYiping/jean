use std::process::Command;

use crate::CustomEditorConfig;

const SUPPORTED_EDITORS: [&str; 5] = ["zed", "vscode", "cursor", "xcode", "intellij"];

#[derive(Debug, Clone)]
struct EditorConfig {
    name: String,
    command: String,
    args: Vec<String>,
    supports_line_number: bool,
    line_number_args: Option<Vec<String>>,
    macos_app_name: Option<&'static str>,
}

pub fn normalize_custom_editors(editors: &mut Vec<CustomEditorConfig>) {
    for editor in editors {
        editor.id = editor.id.trim().to_string();
        editor.name = editor.name.trim().to_string();
        editor.command = editor.command.trim().to_string();
        editor.args = editor
            .args
            .iter()
            .map(|arg| arg.trim().to_string())
            .filter(|arg| !arg.is_empty())
            .collect();
        editor.line_number_args = editor.line_number_args.as_ref().map(|args| {
            args.iter()
                .map(|arg| arg.trim().to_string())
                .filter(|arg| !arg.is_empty())
                .collect::<Vec<_>>()
        });
        if editor
            .line_number_args
            .as_ref()
            .is_some_and(|args| args.is_empty())
        {
            editor.line_number_args = None;
        }
    }
}

pub fn validate_custom_editors(editors: &[CustomEditorConfig]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();

    for editor in editors {
        if editor.id.trim().is_empty() {
            return Err("Custom editor id is required".to_string());
        }
        if !seen.insert(editor.id.as_str()) {
            return Err(format!("Duplicate custom editor id: {}", editor.id));
        }
        if SUPPORTED_EDITORS.contains(&editor.id.as_str()) {
            return Err(format!(
                "Custom editor id '{}' conflicts with a built-in editor",
                editor.id
            ));
        }
        if editor.name.trim().is_empty() {
            return Err("Custom editor name is required".to_string());
        }
        if editor.command.trim().is_empty() {
            return Err(format!("Command is required for {}", editor.name));
        }
        if !args_contain(&editor.args, "{path}") {
            return Err(format!(
                "Arguments for {} must include {{path}}",
                editor.name
            ));
        }
        if editor.supports_line_number {
            let Some(line_args) = editor.line_number_args.as_ref() else {
                return Err(format!(
                    "Line number arguments are required for {}",
                    editor.name
                ));
            };
            if !args_contain(line_args, "{path}") || !args_contain(line_args, "{line}") {
                return Err(format!(
                    "Line number arguments for {} must include {{path}} and {{line}}",
                    editor.name
                ));
            }
        }
    }

    Ok(())
}

pub fn list_available_editors() -> Vec<String> {
    SUPPORTED_EDITORS
        .into_iter()
        .filter(|editor| is_editor_available(editor))
        .map(ToString::to_string)
        .collect()
}

pub fn open_project_path_in_editor(
    path: &str,
    editor: &str,
    custom_editors: &[CustomEditorConfig],
) -> Result<(), String> {
    let config = resolve_editor_config(editor, custom_editors);
    let args = build_project_open_args(&config, path);

    #[cfg(target_os = "macos")]
    {
        let result = if let Some(app_name) = config.macos_app_name {
            spawn_or_open_app(&config.command, app_name, &args)
        } else {
            Command::new(&config.command).args(&args).spawn()
        };

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(&config, &error));
    }

    #[cfg(target_os = "windows")]
    {
        return open_project_path_in_editor_windows(&config, path);
    }

    #[cfg(target_os = "linux")]
    {
        if config.name == "Xcode" {
            return Err("Xcode is only available on macOS".to_string());
        }
        let result = Command::new(&config.command).args(&args).spawn();

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(&config, &error));
    }

    #[allow(unreachable_code)]
    Err("Editor launching is not supported on this platform".to_string())
}

pub fn open_file_path_in_editor(
    path: &str,
    editor: &str,
    line_number: Option<u32>,
    custom_editors: &[CustomEditorConfig],
) -> Result<(), String> {
    let config = resolve_editor_config(editor, custom_editors);
    let args = build_file_open_args(&config, path, line_number);

    #[cfg(target_os = "macos")]
    {
        let result = if let Some(app_name) = config.macos_app_name {
            spawn_or_open_app(&config.command, app_name, &args)
        } else {
            Command::new(&config.command).args(&args).spawn()
        };

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(&config, &error));
    }

    #[cfg(target_os = "windows")]
    {
        return open_file_path_in_editor_windows(&config, path, line_number);
    }

    #[cfg(target_os = "linux")]
    {
        if config.name == "Xcode" {
            return Err("Xcode is only available on macOS".to_string());
        }
        let result = Command::new(&config.command).args(&args).spawn();

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(&config, &error));
    }

    #[allow(unreachable_code)]
    Err("Editor launching is not supported on this platform".to_string())
}

fn build_project_open_args(config: &EditorConfig, path: &str) -> Vec<String> {
    render_editor_args(&config.args, path, None)
}

fn build_file_open_args(
    config: &EditorConfig,
    path: &str,
    line_number: Option<u32>,
) -> Vec<String> {
    let use_line_args = line_number.is_some() && config.supports_line_number;
    let args = if use_line_args {
        config.line_number_args.as_ref().unwrap_or(&config.args)
    } else {
        &config.args
    };
    render_editor_args(args, path, line_number)
}

fn render_editor_args(args: &[String], path: &str, line_number: Option<u32>) -> Vec<String> {
    let line = line_number.map(|line| line.to_string()).unwrap_or_default();
    args.iter()
        .map(|arg| {
            arg.replace("{path}:{line}", &format!("{path}:{line}"))
                .replace("{path}", path)
                .replace("{line}", &line)
        })
        .collect()
}

fn args_contain(args: &[String], placeholder: &str) -> bool {
    args.iter().any(|arg| arg.contains(placeholder))
}

fn resolve_editor_config(editor: &str, custom_editors: &[CustomEditorConfig]) -> EditorConfig {
    if let Some(custom_editor) = custom_editors
        .iter()
        .find(|candidate| candidate.id == editor)
    {
        return EditorConfig {
            name: custom_editor.name.clone(),
            command: custom_editor.command.clone(),
            args: custom_editor.args.clone(),
            supports_line_number: custom_editor.supports_line_number,
            line_number_args: custom_editor.line_number_args.clone(),
            macos_app_name: None,
        };
    }

    builtin_editor_config(editor).unwrap_or_else(|| builtin_editor_config("vscode").unwrap())
}

fn builtin_editor_config(editor: &str) -> Option<EditorConfig> {
    let (name, command, args, line_number_args, macos_app_name) = match editor {
        "zed" => (
            "Zed",
            "zed",
            vec!["{path}"],
            vec!["{path}:{line}"],
            Some("Zed"),
        ),
        "vscode" => (
            "VS Code",
            "code",
            vec!["--disable-workspace-trust", "{path}"],
            vec!["--disable-workspace-trust", "-g", "{path}:{line}"],
            Some("Visual Studio Code"),
        ),
        "cursor" => (
            "Cursor",
            "cursor",
            vec!["--disable-workspace-trust", "{path}"],
            vec!["--disable-workspace-trust", "-g", "{path}:{line}"],
            Some("Cursor"),
        ),
        "xcode" => (
            "Xcode",
            "xed",
            vec!["{path}"],
            vec!["--line", "{line}", "{path}"],
            Some("Xcode"),
        ),
        "intellij" => (
            "IntelliJ IDEA",
            "idea",
            vec!["{path}"],
            vec!["--line", "{line}", "{path}"],
            Some("IntelliJ IDEA"),
        ),
        _ => return None,
    };

    Some(EditorConfig {
        name: name.to_string(),
        command: command.to_string(),
        args: args.into_iter().map(ToString::to_string).collect(),
        supports_line_number: true,
        line_number_args: Some(
            line_number_args
                .into_iter()
                .map(ToString::to_string)
                .collect(),
        ),
        macos_app_name,
    })
}

fn format_open_error(config: &EditorConfig, error: &std::io::Error) -> String {
    let display_name = format!("{} ('{}')", config.name, config.command);

    if error.kind() == std::io::ErrorKind::NotFound {
        format!("{display_name} not found. Make sure it is installed and available in your PATH.")
    } else {
        format!("Failed to open {display_name}: {error}")
    }
}

#[cfg(target_os = "macos")]
fn spawn_or_open_app(
    cli: &str,
    app_name: &str,
    args: &[String],
) -> std::io::Result<std::process::Child> {
    match Command::new(cli).args(args).spawn() {
        Ok(child) => Ok(child),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            open_app_fallback(app_name, args)
        }
        Err(error) => Err(error),
    }
}

#[cfg(target_os = "macos")]
fn open_app_fallback(app_name: &str, args: &[String]) -> std::io::Result<std::process::Child> {
    let mut command = Command::new("open");
    command.args(["-a", app_name]);
    if args.iter().any(|arg| arg.starts_with('-')) {
        command.arg("--args");
    }
    command.args(args).spawn()
}

fn is_editor_available(editor: &str) -> bool {
    #[cfg(target_os = "macos")]
    {
        let (cli, app_name) = editor_metadata(editor);
        return crate::platform::executable_exists(cli) || macos_app_exists(app_name);
    }

    #[cfg(target_os = "windows")]
    {
        return windows_editor_available(editor);
    }

    #[cfg(target_os = "linux")]
    {
        if editor == "xcode" {
            return false;
        }

        let (cli, _) = editor_metadata(editor);
        return crate::platform::executable_exists(cli);
    }

    #[allow(unreachable_code)]
    false
}

fn editor_metadata(editor: &str) -> (&'static str, &'static str) {
    match editor {
        "zed" => ("zed", "Zed"),
        "cursor" => ("cursor", "Cursor"),
        "xcode" => ("xed", "Xcode"),
        "intellij" => ("idea", "IntelliJ IDEA"),
        _ => ("code", "Visual Studio Code"),
    }
}

#[cfg(target_os = "macos")]
fn macos_app_exists(app_name: &str) -> bool {
    Command::new("open")
        .args(["-Ra", app_name])
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn windows_editor_available(editor: &str) -> bool {
    let (cli, _) = editor_metadata(editor);
    crate::platform::executable_exists(cli)
        || windows_known_editor_paths(editor)
            .iter()
            .any(|path| path.exists())
}

#[cfg(target_os = "windows")]
fn windows_known_editor_paths(editor: &str) -> Vec<std::path::PathBuf> {
    let local_app_data = std::env::var("LOCALAPPDATA").ok();
    let program_files = std::env::var("ProgramFiles").ok();
    let program_files_x86 = std::env::var("ProgramFiles(x86)").ok();

    match editor {
        "zed" => local_app_data
            .iter()
            .map(|base| std::path::PathBuf::from(base).join("Programs/Zed/Zed.exe"))
            .collect(),
        "cursor" => local_app_data
            .iter()
            .map(|base| std::path::PathBuf::from(base).join("Programs/Cursor/Cursor.exe"))
            .collect(),
        "vscode" => local_app_data
            .iter()
            .map(|base| {
                vec![
                    std::path::PathBuf::from(base).join("Programs/Microsoft VS Code/Code.exe"),
                    std::path::PathBuf::from(base).join("Programs/VS Code/Code.exe"),
                ]
            })
            .flatten()
            .collect(),
        "intellij" => program_files
            .iter()
            .chain(program_files_x86.iter())
            .map(|base| {
                vec![
                    std::path::PathBuf::from(base).join("JetBrains/IntelliJ IDEA/bin/idea64.exe"),
                    std::path::PathBuf::from(base)
                        .join("JetBrains/IntelliJ IDEA Community Edition/bin/idea64.exe"),
                ]
            })
            .flatten()
            .collect(),
        _ => Vec::new(),
    }
}

#[cfg(target_os = "windows")]
fn open_project_path_in_editor_windows(config: &EditorConfig, path: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let args = build_project_open_args(config, path);

    if config.name == "Xcode" {
        return Err("Xcode is only available on macOS".to_string());
    }

    let result = if config.macos_app_name.is_some() && config.command != "zed" {
        Command::new("cmd")
            .args(["/c", &config.command])
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    } else {
        Command::new(&config.command)
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    };

    result
        .map(|_| ())
        .map_err(|error| format_open_error(config, &error))
}

#[cfg(target_os = "windows")]
fn open_file_path_in_editor_windows(
    config: &EditorConfig,
    path: &str,
    line_number: Option<u32>,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let args = build_file_open_args(config, path, line_number);

    if config.name == "Xcode" {
        return Err("Xcode is only available on macOS".to_string());
    }

    let result = if config.macos_app_name.is_some() && config.command != "zed" {
        Command::new("cmd")
            .args(["/c", &config.command])
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    } else {
        Command::new(&config.command)
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
    };

    result
        .map(|_| ())
        .map_err(|error| format_open_error(config, &error))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: Vec<String>) -> Vec<String> {
        args
    }

    fn builtin(id: &str) -> EditorConfig {
        builtin_editor_config(id).unwrap()
    }

    #[test]
    fn vscode_project_open_disables_workspace_trust() {
        assert_eq!(
            strings(build_project_open_args(&builtin("vscode"), "/tmp/demo")),
            ["--disable-workspace-trust", "/tmp/demo"]
        );
    }

    #[test]
    fn cursor_project_open_disables_workspace_trust() {
        assert_eq!(
            strings(build_project_open_args(&builtin("cursor"), "/tmp/demo")),
            ["--disable-workspace-trust", "/tmp/demo"]
        );
    }

    #[test]
    fn vscode_file_open_preserves_goto_with_workspace_trust_disabled() {
        assert_eq!(
            strings(build_file_open_args(
                &builtin("vscode"),
                "/tmp/demo/src/main.ts",
                Some(42)
            )),
            [
                "--disable-workspace-trust",
                "-g",
                "/tmp/demo/src/main.ts:42"
            ]
        );
    }

    #[test]
    fn cursor_file_open_preserves_goto_with_workspace_trust_disabled() {
        assert_eq!(
            strings(build_file_open_args(
                &builtin("cursor"),
                "/tmp/demo/src/main.ts",
                Some(42)
            )),
            [
                "--disable-workspace-trust",
                "-g",
                "/tmp/demo/src/main.ts:42"
            ]
        );
    }

    #[test]
    fn intellij_project_open_uses_plain_path() {
        assert_eq!(
            strings(build_project_open_args(&builtin("intellij"), "/tmp/demo")),
            ["/tmp/demo"]
        );
    }

    #[test]
    fn intellij_file_open_preserves_line_without_trust_flag() {
        assert_eq!(
            strings(build_file_open_args(
                &builtin("intellij"),
                "/tmp/demo/src/main.java",
                Some(42)
            )),
            ["--line", "42", "/tmp/demo/src/main.java"]
        );
    }

    #[test]
    fn zed_and_xcode_args_are_unchanged() {
        assert_eq!(
            strings(build_project_open_args(&builtin("zed"), "/tmp/demo")),
            ["/tmp/demo"]
        );
        assert_eq!(
            strings(build_file_open_args(
                &builtin("zed"),
                "/tmp/demo/src/main.ts",
                Some(42)
            )),
            ["/tmp/demo/src/main.ts:42"]
        );
        assert_eq!(
            strings(build_project_open_args(&builtin("xcode"), "/tmp/demo")),
            ["/tmp/demo"]
        );
        assert_eq!(
            strings(build_file_open_args(
                &builtin("xcode"),
                "/tmp/demo/src/main.swift",
                Some(42)
            )),
            ["--line", "42", "/tmp/demo/src/main.swift"]
        );
    }

    #[test]
    fn custom_editor_without_line_support_ignores_line_number() {
        let config = EditorConfig {
            name: "Custom Basic".to_string(),
            command: "custom".to_string(),
            args: vec!["--open".to_string(), "{path}".to_string()],
            supports_line_number: false,
            line_number_args: Some(vec!["--line".to_string(), "{line}".to_string()]),
            macos_app_name: None,
        };

        assert_eq!(
            strings(build_file_open_args(
                &config,
                "/tmp/demo/src/main.ts",
                Some(42)
            )),
            ["--open", "/tmp/demo/src/main.ts"]
        );
    }

    #[test]
    fn validates_custom_editor_placeholders() {
        let valid = CustomEditorConfig {
            id: "custom-valid".to_string(),
            name: "Custom Valid".to_string(),
            command: "custom".to_string(),
            args: vec!["{path}".to_string()],
            supports_line_number: true,
            line_number_args: Some(vec!["--goto".to_string(), "{path}:{line}".to_string()]),
        };
        assert!(validate_custom_editors(&[valid]).is_ok());

        let invalid = CustomEditorConfig {
            id: "custom-invalid".to_string(),
            name: "Custom Invalid".to_string(),
            command: "custom".to_string(),
            args: vec!["--open".to_string()],
            supports_line_number: false,
            line_number_args: None,
        };
        assert!(validate_custom_editors(&[invalid]).is_err());
    }
}
