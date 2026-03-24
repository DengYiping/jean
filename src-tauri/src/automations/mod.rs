use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use tauri::AppHandle;

use crate::http_server::EmitExt;

pub mod commands;
pub mod scheduler;
pub mod storage;
pub mod types;

#[derive(Clone)]
pub struct AutomationManager {
    pub(crate) app: AppHandle,
    shutdown: Arc<AtomicBool>,
    tick_in_flight: Arc<AtomicBool>,
    running_ids: Arc<Mutex<HashSet<String>>>,
}

impl AutomationManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            shutdown: Arc::new(AtomicBool::new(false)),
            tick_in_flight: Arc::new(AtomicBool::new(false)),
            running_ids: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    pub fn start(&self) {
        let manager = self.clone();
        manager.run_due_tick();
        thread::spawn(move || loop {
            if manager.shutdown.load(Ordering::Relaxed) {
                break;
            }
            thread::sleep(Duration::from_secs(
                scheduler::AUTOMATION_TICK_INTERVAL_SECS,
            ));
            if manager.shutdown.load(Ordering::Relaxed) {
                break;
            }
            manager.run_due_tick();
        });
    }

    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }

    pub fn run_due_tick(&self) {
        if self.tick_in_flight.swap(true, Ordering::Relaxed) {
            return;
        }
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = scheduler::run_due_automations(&manager).await {
                log::warn!("Automation scheduler tick failed: {error}");
            }
            manager.tick_in_flight.store(false, Ordering::Relaxed);
        });
    }

    pub fn spawn_automation_run(
        &self,
        automation_id: String,
        advance_schedule: bool,
        allow_paused: bool,
    ) {
        let manager = self.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = scheduler::run_automation_by_id(
                &manager,
                &automation_id,
                advance_schedule,
                allow_paused,
            )
            .await
            {
                log::warn!("Automation run failed for {}: {error}", automation_id);
                manager.emit_updated(&automation_id);
            }
        });
    }

    pub fn emit_updated(&self, automation_id: &str) {
        let _ = self.app.emit_all(
            "cache:invalidate",
            &serde_json::json!({ "keys": ["automations", "sessions"] }),
        );
        let _ = self.app.emit_all(
            "automations:updated",
            &crate::automations::types::AutomationRunEvent {
                automation_id: automation_id.to_string(),
            },
        );
    }

    pub(crate) fn try_mark_running(&self, automation_id: &str) -> bool {
        let mut running = self.running_ids.lock().unwrap();
        if running.contains(automation_id) {
            false
        } else {
            running.insert(automation_id.to_string());
            true
        }
    }

    pub(crate) fn clear_running(&self, automation_id: &str) {
        self.running_ids.lock().unwrap().remove(automation_id);
    }
}
