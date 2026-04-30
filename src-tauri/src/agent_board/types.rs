use crate::chat::types::{Backend, EffortLevel};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentBoardLane {
    Todo,
    Planning,
    Planned,
    Implementing,
    Implemented,
    PrOpened,
    Yoloing,
    Yoloed,
    Archived,
}

impl AgentBoardLane {
    pub fn can_move_to(self, next: AgentBoardLane) -> bool {
        use AgentBoardLane::*;
        if self == next {
            return true;
        }
        match (self, next) {
            (PrOpened, Archived) => true,
            (PrOpened, _) => false,
            (_, Archived) => true,
            (Todo, Planning | Implementing | Yoloing) => true,
            (Planning, Planned | Implementing) => true,
            (Planned, Implementing | Yoloing) => true,
            (Implementing, Implemented | Planning | Yoloing) => true,
            (Implemented, Implementing | PrOpened | Yoloing) => true,
            (Yoloing, Yoloed | Implementing) => true,
            (Yoloed, Yoloing | Implementing | PrOpened) => true,
            (Archived, _) => false,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentBoardItem {
    pub id: String,
    pub title: String,
    pub prompt: String,
    pub project_id: String,
    pub backend: Backend,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<EffortLevel>,
    pub lane: AgentBoardLane,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub planning_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub implementation_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yolo_worktree_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yolo_session_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentBoardData {
    pub version: u32,
    pub items: Vec<AgentBoardItem>,
}

impl Default for AgentBoardData {
    fn default() -> Self {
        Self {
            version: 1,
            items: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAgentBoardItemRequest {
    pub prompt: String,
    pub project_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<Backend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<EffortLevel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateAgentBoardItemRequest {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backend: Option<Backend>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort_level: Option<Option<EffortLevel>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pr_url: Option<Option<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionAgentBoardAssociation {
    pub item: AgentBoardItem,
    pub session_role: String,
}
