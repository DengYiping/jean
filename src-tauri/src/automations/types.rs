use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum AutomationStatus {
    #[default]
    Enabled,
    Paused,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AutomationLastRunStatus {
    Running,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Automation {
    pub id: String,
    pub project_id: String,
    pub name: String,
    pub prompt: String,
    #[serde(default)]
    pub target_worktree_ids: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub execution_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thinking_level: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<String>,
    pub schedule_rrule: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_window_start_hour: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_window_end_hour: Option<u32>,
    #[serde(default)]
    pub status: AutomationStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_run_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_run_status: Option<AutomationLastRunStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub session_ids_by_worktree_id: HashMap<String, String>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Automation {
    pub fn new(
        project_id: String,
        name: String,
        prompt: String,
        target_worktree_ids: Vec<String>,
        schedule_rrule: String,
    ) -> Self {
        let now = crate::automations::scheduler::now_secs();
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            project_id,
            name,
            prompt,
            target_worktree_ids,
            backend: None,
            model: None,
            provider: None,
            execution_mode: None,
            thinking_level: None,
            effort_level: None,
            schedule_rrule,
            run_window_start_hour: None,
            run_window_end_hour: None,
            status: AutomationStatus::Enabled,
            last_run_at: None,
            next_run_at: None,
            last_run_status: None,
            last_error: None,
            session_ids_by_worktree_id: HashMap::new(),
            created_at: now,
            updated_at: now,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AutomationStore {
    #[serde(default)]
    pub automations: Vec<Automation>,
    #[serde(default = "default_version")]
    pub version: u32,
}

fn default_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize)]
pub struct AutomationRunEvent {
    pub automation_id: String,
}
