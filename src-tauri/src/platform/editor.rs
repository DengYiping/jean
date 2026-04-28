use std::process::Command;

const SUPPORTED_EDITORS: [&str; 5] = ["zed", "vscode", "cursor", "xcode", "intellij"];

pub fn list_available_editors() -> Vec<String> {
    SUPPORTED_EDITORS
        .into_iter()
        .filter(|editor| is_editor_available(editor))
        .map(ToString::to_string)
        .collect()
}

pub fn open_project_path_in_editor(path: &str, editor: &str) -> Result<(), String> {
    let args = build_project_open_args(editor, path);

    #[cfg(target_os = "macos")]
    {
        let result = match editor {
            "zed" => spawn_or_open_app("zed", "Zed", &args),
            "cursor" => spawn_or_open_app("cursor", "Cursor", &args),
            "xcode" => spawn_or_open_app("xed", "Xcode", &args),
            "intellij" => spawn_or_open_app("idea", "IntelliJ IDEA", &args),
            _ => spawn_or_open_app("code", "Visual Studio Code", &args),
        };

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(editor, &error));
    }

    #[cfg(target_os = "windows")]
    {
        return open_project_path_in_editor_windows(path, editor);
    }

    #[cfg(target_os = "linux")]
    {
        let result = match editor {
            "zed" => Command::new("zed").args(&args).spawn(),
            "cursor" => Command::new("cursor").args(&args).spawn(),
            "intellij" => Command::new("idea").args(&args).spawn(),
            "xcode" => return Err("Xcode is only available on macOS".to_string()),
            _ => Command::new("code").args(&args).spawn(),
        };

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(editor, &error));
    }

    #[allow(unreachable_code)]
    Err("Editor launching is not supported on this platform".to_string())
}

pub fn open_file_path_in_editor(
    path: &str,
    editor: &str,
    line_number: Option<u32>,
) -> Result<(), String> {
    let args = build_file_open_args(editor, path, line_number);

    #[cfg(target_os = "macos")]
    {
        let result = match editor {
            "zed" => spawn_or_open_app("zed", "Zed", &args),
            "cursor" => spawn_or_open_app("cursor", "Cursor", &args),
            "xcode" => {
                let mut command = Command::new("xed");
                command.args(&args).spawn()
            }
            "intellij" => {
                let mut command = Command::new("idea");

                match command.args(&args).spawn() {
                    Ok(child) => Ok(child),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        open_app_fallback("IntelliJ IDEA", &args)
                    }
                    Err(error) => Err(error),
                }
            }
            _ => spawn_or_open_app("code", "Visual Studio Code", &args),
        };

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(editor, &error));
    }

    #[cfg(target_os = "windows")]
    {
        return open_file_path_in_editor_windows(path, editor, line_number);
    }

    #[cfg(target_os = "linux")]
    {
        let result = match editor {
            "zed" => Command::new("zed").args(&args).spawn(),
            "cursor" => Command::new("cursor").args(&args).spawn(),
            "intellij" => Command::new("idea").args(&args).spawn(),
            "xcode" => return Err("Xcode is only available on macOS".to_string()),
            _ => Command::new("code").args(&args).spawn(),
        };

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(editor, &error));
    }

    #[allow(unreachable_code)]
    Err("Editor launching is not supported on this platform".to_string())
}

fn build_project_open_args(editor: &str, path: &str) -> Vec<String> {
    match editor {
        "cursor" | "vscode" => vec!["--disable-workspace-trust".to_string(), path.to_string()],
        "intellij" => vec!["--trust".to_string(), path.to_string()],
        _ => vec![path.to_string()],
    }
}

fn build_file_open_args(editor: &str, path: &str, line_number: Option<u32>) -> Vec<String> {
    let line_target = line_number
        .map(|line| format!("{path}:{line}"))
        .unwrap_or_else(|| path.to_string());

    match editor {
        "zed" => vec![line_target],
        "cursor" | "vscode" => {
            let mut args = vec!["--disable-workspace-trust".to_string()];
            if line_number.is_some() {
                args.push("-g".to_string());
                args.push(line_target);
            } else {
                args.push(path.to_string());
            }
            args
        }
        "xcode" => {
            let mut args = Vec::new();
            if let Some(line) = line_number {
                args.push("--line".to_string());
                args.push(line.to_string());
            }
            args.push(path.to_string());
            args
        }
        "intellij" => {
            let mut args = vec!["--trust".to_string()];
            if let Some(line) = line_number {
                args.push("--line".to_string());
                args.push(line.to_string());
            }
            args.push(path.to_string());
            args
        }
        _ => {
            let mut args = vec!["--disable-workspace-trust".to_string()];
            if line_number.is_some() {
                args.push("-g".to_string());
                args.push(line_target);
            } else {
                args.push(path.to_string());
            }
            args
        }
    }
}

fn format_open_error(editor: &str, error: &std::io::Error) -> String {
    let display_name = match editor {
        "vscode" => "VS Code ('code')",
        "cursor" => "Cursor ('cursor')",
        "zed" => "Zed ('zed')",
        "xcode" => "Xcode ('xed')",
        "intellij" => "IntelliJ IDEA ('idea')",
        other => other,
    };

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
fn open_project_path_in_editor_windows(path: &str, editor: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let args = build_project_open_args(editor, path);

    let result = match editor {
        "zed" => Command::new("zed").args(&args).spawn(),
        "cursor" => Command::new("cmd")
            .args(["/c", "cursor"])
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
        "intellij" => Command::new("cmd")
            .args(["/c", "idea"])
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
        "xcode" => return Err("Xcode is only available on macOS".to_string()),
        _ => Command::new("cmd")
            .args(["/c", "code"])
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
    };

    result
        .map(|_| ())
        .map_err(|error| format_open_error(editor, &error))
}

#[cfg(target_os = "windows")]
fn open_file_path_in_editor_windows(
    path: &str,
    editor: &str,
    line_number: Option<u32>,
) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let args = build_file_open_args(editor, path, line_number);

    let result = match editor {
        "zed" => Command::new("zed").args(&args).spawn(),
        "cursor" => Command::new("cmd")
            .args(["/c", "cursor"])
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
        "intellij" => Command::new("cmd")
            .args(["/c", "idea"])
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
        "xcode" => return Err("Xcode is only available on macOS".to_string()),
        _ => Command::new("cmd")
            .args(["/c", "code"])
            .args(&args)
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
    };

    result
        .map(|_| ())
        .map_err(|error| format_open_error(editor, &error))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(args: Vec<String>) -> Vec<String> {
        args
    }

    #[test]
    fn vscode_project_open_disables_workspace_trust() {
        assert_eq!(
            strings(build_project_open_args("vscode", "/tmp/demo")),
            ["--disable-workspace-trust", "/tmp/demo"]
        );
    }

    #[test]
    fn cursor_project_open_disables_workspace_trust() {
        assert_eq!(
            strings(build_project_open_args("cursor", "/tmp/demo")),
            ["--disable-workspace-trust", "/tmp/demo"]
        );
    }

    #[test]
    fn vscode_file_open_preserves_goto_with_workspace_trust_disabled() {
        assert_eq!(
            strings(build_file_open_args(
                "vscode",
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
                "cursor",
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
    fn intellij_project_open_marks_project_trusted() {
        assert_eq!(
            strings(build_project_open_args("intellij", "/tmp/demo")),
            ["--trust", "/tmp/demo"]
        );
    }

    #[test]
    fn intellij_file_open_marks_project_trusted_and_preserves_line() {
        assert_eq!(
            strings(build_file_open_args(
                "intellij",
                "/tmp/demo/src/main.java",
                Some(42)
            )),
            ["--trust", "--line", "42", "/tmp/demo/src/main.java"]
        );
    }

    #[test]
    fn zed_and_xcode_args_are_unchanged() {
        assert_eq!(
            strings(build_project_open_args("zed", "/tmp/demo")),
            ["/tmp/demo"]
        );
        assert_eq!(
            strings(build_file_open_args(
                "zed",
                "/tmp/demo/src/main.ts",
                Some(42)
            )),
            ["/tmp/demo/src/main.ts:42"]
        );
        assert_eq!(
            strings(build_project_open_args("xcode", "/tmp/demo")),
            ["/tmp/demo"]
        );
        assert_eq!(
            strings(build_file_open_args(
                "xcode",
                "/tmp/demo/src/main.swift",
                Some(42)
            )),
            ["--line", "42", "/tmp/demo/src/main.swift"]
        );
    }
}
