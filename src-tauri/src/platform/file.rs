//! Cross-platform durable file persistence helpers.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use uuid::Uuid;

fn temporary_path(path: &Path) -> PathBuf {
    let filename = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_else(|| std::borrow::Cow::Borrowed("file"));
    path.with_file_name(format!("{filename}.tmp-{}", Uuid::new_v4()))
}

fn sync_parent_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::File::open(parent)?.sync_all()
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(windows)]
fn replace_file_atomically(temp_path: &Path, path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, ReplaceFileW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        REPLACEFILE_WRITE_THROUGH,
    };

    let target_exists = path.exists();
    let temp_path: Vec<u16> = temp_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let path: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    if target_exists {
        let replaced = unsafe {
            ReplaceFileW(
                path.as_ptr(),
                temp_path.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
        if replaced != 0 {
            return Ok(());
        }
    }
    let moved = unsafe {
        MoveFileExW(
            temp_path.as_ptr(),
            path.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if moved == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn replace_file_atomically(temp_path: &Path, path: &Path) -> io::Result<()> {
    fs::rename(temp_path, path)
}

/// Writes through a unique sibling temp file, syncs it, then atomically replaces `path`.
pub fn write_file_atomically(path: &Path, contents: &[u8]) -> Result<(), String> {
    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to create parent directory: {error}"))?;
    }
    let temp_path = temporary_path(path);
    let mut temp_created = false;
    let result = (|| {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)?;
        temp_created = true;
        temp_file.write_all(contents)?;
        #[cfg(unix)]
        if let Ok(metadata) = fs::metadata(path) {
            temp_file.set_permissions(metadata.permissions())?;
        }
        temp_file.sync_all()?;
        drop(temp_file);
        replace_file_atomically(&temp_path, path)?;
        sync_parent_directory(path)
    })();
    if temp_created && result.is_err() {
        let _ = fs::remove_file(&temp_path);
    }
    result.map_err(|error| format!("Failed to atomically replace {}: {error}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replaces_existing_file_without_leaving_a_temp_file() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("state.json");
        write_file_atomically(&path, br#"{\"version\":1}"#).expect("first write");
        write_file_atomically(&path, br#"{\"version\":2}"#).expect("second write");
        assert_eq!(fs::read(&path).expect("read result"), br#"{\"version\":2}"#);
        assert!(!fs::read_dir(directory.path())
            .expect("directory")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("state.json.tmp-")));
    }
}
