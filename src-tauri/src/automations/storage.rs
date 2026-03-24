use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Write};
use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use tauri::{AppHandle, Manager};

use super::types::{Automation, AutomationStore};

static AUTOMATIONS_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

pub fn get_automations_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {e}"))?;
    let dir = app_data_dir.join("automations");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create automations directory: {e}"))?;
    Ok(dir)
}

pub fn get_automations_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(get_automations_dir(app)?.join("automations.json"))
}

pub fn get_automation_dir(app: &AppHandle, automation_id: &str) -> Result<PathBuf, String> {
    let dir = get_automations_dir(app)?.join(automation_id);
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create automation directory: {e}"))?;
    Ok(dir)
}

pub fn get_memory_path(app: &AppHandle, automation_id: &str) -> Result<PathBuf, String> {
    Ok(get_automation_dir(app, automation_id)?.join("memory.md"))
}

pub fn ensure_memory_file(app: &AppHandle, automation_id: &str) -> Result<PathBuf, String> {
    let path = get_memory_path(app, automation_id)?;
    if !path.exists() {
        let mut file =
            File::create(&path).map_err(|e| format!("Failed to create automation memory: {e}"))?;
        file.write_all(b"")
            .map_err(|e| format!("Failed to initialize automation memory: {e}"))?;
    }
    Ok(path)
}

fn load_store_internal(app: &AppHandle) -> Result<AutomationStore, String> {
    let path = get_automations_path(app)?;
    if !path.exists() {
        return Ok(AutomationStore::default());
    }

    let file = File::open(&path).map_err(|e| format!("Failed to open automations store: {e}"))?;
    let reader = BufReader::new(file);
    serde_json::from_reader(reader).map_err(|e| format!("Failed to parse automations store: {e}"))
}

fn save_store_internal(app: &AppHandle, store: &AutomationStore) -> Result<(), String> {
    let path = get_automations_path(app)?;
    let temp_path = path.with_extension("tmp");
    let file = File::create(&temp_path)
        .map_err(|e| format!("Failed to create automations temp file: {e}"))?;
    let writer = BufWriter::new(file);
    serde_json::to_writer_pretty(writer, store)
        .map_err(|e| format!("Failed to serialize automations store: {e}"))?;
    fs::rename(&temp_path, &path)
        .map_err(|e| format!("Failed to finalize automations store: {e}"))?;
    Ok(())
}

pub fn load_automations(app: &AppHandle) -> Result<Vec<Automation>, String> {
    let _guard = AUTOMATIONS_LOCK.lock().unwrap();
    Ok(load_store_internal(app)?.automations)
}

pub fn with_automations_mut<F, T>(app: &AppHandle, f: F) -> Result<T, String>
where
    F: FnOnce(&mut Vec<Automation>) -> Result<T, String>,
{
    let _guard = AUTOMATIONS_LOCK.lock().unwrap();
    let mut store = load_store_internal(app)?;
    let result = f(&mut store.automations)?;
    save_store_internal(app, &store)?;
    Ok(result)
}
