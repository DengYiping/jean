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
    #[cfg(target_os = "macos")]
    {
        let result = match editor {
            "zed" => spawn_or_open_app("zed", "Zed", &[path]),
            "cursor" => spawn_or_open_app("cursor", "Cursor", &[path]),
            "xcode" => spawn_or_open_app("xed", "Xcode", &[path]),
            "intellij" => spawn_or_open_app("idea", "IntelliJ IDEA", &[path]),
            _ => spawn_or_open_app("code", "Visual Studio Code", &[path]),
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
            "zed" => Command::new("zed").arg(path).spawn(),
            "cursor" => Command::new("cursor").arg(path).spawn(),
            "intellij" => Command::new("idea").arg(path).spawn(),
            "xcode" => return Err("Xcode is only available on macOS".to_string()),
            _ => Command::new("code").arg(path).spawn(),
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
    #[cfg(target_os = "macos")]
    {
        let zed_target = line_number
            .map(|line| format!("{path}:{line}"))
            .unwrap_or_else(|| path.to_string());
        let cursor_target = line_number
            .map(|line| format!("{path}:{line}"))
            .unwrap_or_else(|| path.to_string());
        let vscode_target = line_number
            .map(|line| format!("{path}:{line}"))
            .unwrap_or_else(|| path.to_string());

        let result = match editor {
            "zed" => spawn_or_open_app("zed", "Zed", &[zed_target.as_str()]),
            "cursor" => {
                if line_number.is_some() {
                    spawn_or_open_app("cursor", "Cursor", &["-g", cursor_target.as_str()])
                } else {
                    spawn_or_open_app("cursor", "Cursor", &[path])
                }
            }
            "xcode" => {
                let mut command = Command::new("xed");
                if let Some(line) = line_number {
                    command.args(["--line", &line.to_string()]);
                }
                command.arg(path).spawn()
            }
            "intellij" => {
                let mut command = Command::new("idea");
                if let Some(line) = line_number {
                    command.args(["--line", &line.to_string()]);
                }

                match command.arg(path).spawn() {
                    Ok(child) => Ok(child),
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        Command::new("open")
                            .args(["-a", "IntelliJ IDEA", path])
                            .spawn()
                    }
                    Err(error) => Err(error),
                }
            }
            _ => {
                if line_number.is_some() {
                    spawn_or_open_app(
                        "code",
                        "Visual Studio Code",
                        &["-g", vscode_target.as_str()],
                    )
                } else {
                    spawn_or_open_app("code", "Visual Studio Code", &[path])
                }
            }
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
        let zed_target = line_number
            .map(|line| format!("{path}:{line}"))
            .unwrap_or_else(|| path.to_string());
        let cursor_target = line_number
            .map(|line| format!("{path}:{line}"))
            .unwrap_or_else(|| path.to_string());
        let vscode_target = line_number
            .map(|line| format!("{path}:{line}"))
            .unwrap_or_else(|| path.to_string());

        let result = match editor {
            "zed" => Command::new("zed").arg(&zed_target).spawn(),
            "cursor" => {
                let mut command = Command::new("cursor");
                if line_number.is_some() {
                    command.args(["-g", &cursor_target]);
                } else {
                    command.arg(path);
                }
                command.spawn()
            }
            "intellij" => {
                let mut command = Command::new("idea");
                if let Some(line) = line_number {
                    command.args(["--line", &line.to_string()]);
                }
                command.arg(path).spawn()
            }
            "xcode" => return Err("Xcode is only available on macOS".to_string()),
            _ => {
                let mut command = Command::new("code");
                if line_number.is_some() {
                    command.args(["-g", &vscode_target]);
                } else {
                    command.arg(path);
                }
                command.spawn()
            }
        };

        return result
            .map(|_| ())
            .map_err(|error| format_open_error(editor, &error));
    }

    #[allow(unreachable_code)]
    Err("Editor launching is not supported on this platform".to_string())
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
    args: &[&str],
) -> std::io::Result<std::process::Child> {
    match Command::new(cli).args(args).spawn() {
        Ok(child) => Ok(child),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let mut command = Command::new("open");
            command.args(["-a", app_name]);
            for arg in args.iter().filter(|arg| !arg.starts_with('-')) {
                command.arg(arg);
            }
            command.spawn()
        }
        Err(error) => Err(error),
    }
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

    let result = match editor {
        "zed" => Command::new("zed").arg(path).spawn(),
        "cursor" => Command::new("cmd")
            .args(["/c", "cursor", path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
        "intellij" => Command::new("cmd")
            .args(["/c", "idea", path])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn(),
        "xcode" => return Err("Xcode is only available on macOS".to_string()),
        _ => Command::new("cmd")
            .args(["/c", "code", path])
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

    let zed_target = line_number
        .map(|line| format!("{path}:{line}"))
        .unwrap_or_else(|| path.to_string());
    let cursor_target = line_number
        .map(|line| format!("{path}:{line}"))
        .unwrap_or_else(|| path.to_string());
    let vscode_target = line_number
        .map(|line| format!("{path}:{line}"))
        .unwrap_or_else(|| path.to_string());

    let result = match editor {
        "zed" => Command::new("zed").arg(&zed_target).spawn(),
        "cursor" => {
            let mut command = Command::new("cmd");
            if line_number.is_some() {
                command.args(["/c", "cursor", "-g", &cursor_target]);
            } else {
                command.args(["/c", "cursor", path]);
            }
            command.creation_flags(CREATE_NO_WINDOW).spawn()
        }
        "intellij" => {
            let mut command = Command::new("cmd");
            if let Some(line) = line_number {
                command.args(["/c", "idea", "--line", &line.to_string(), path]);
            } else {
                command.args(["/c", "idea", path]);
            }
            command.creation_flags(CREATE_NO_WINDOW).spawn()
        }
        "xcode" => return Err("Xcode is only available on macOS".to_string()),
        _ => {
            let mut command = Command::new("cmd");
            if line_number.is_some() {
                command.args(["/c", "code", "-g", &vscode_target]);
            } else {
                command.args(["/c", "code", path]);
            }
            command.creation_flags(CREATE_NO_WINDOW).spawn()
        }
    };

    result
        .map(|_| ())
        .map_err(|error| format_open_error(editor, &error))
}
