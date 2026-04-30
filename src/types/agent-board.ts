import type { Backend, EffortLevel, RunStatus } from '@/types/chat'

export type AgentBoardLane =
  | 'todo'
  | 'planning'
  | 'planned'
  | 'implementing'
  | 'implemented'
  | 'pr_opened'
  | 'yoloing'
  | 'yoloed'
  | 'archived'

export interface AgentBoardItem {
  id: string
  title: string
  prompt: string
  project_id: string
  backend: Backend
  effort_level?: EffortLevel
  lane: AgentBoardLane
  worktree_id?: string
  planning_session_id?: string
  implementation_session_id?: string
  yolo_worktree_id?: string
  yolo_session_id?: string
  pr_url?: string
  created_at: number
  updated_at: number
  archived_at?: number
  last_error?: string
  active_run_status?: RunStatus
}

export interface CreateAgentBoardItemRequest {
  title?: string
  prompt: string
  project_id: string
  backend?: Backend
  effort_level?: EffortLevel
}

export interface UpdateAgentBoardItemRequest {
  title?: string
  prompt?: string
  project_id?: string
  backend?: Backend
  effort_level?: EffortLevel | null
  pr_url?: string | null
}

export interface SessionAgentBoardAssociation {
  item: AgentBoardItem
  session_role: string
}

export const AGENT_BOARD_LANES: AgentBoardLane[] = [
  'todo',
  'planning',
  'planned',
  'implementing',
  'implemented',
  'pr_opened',
  'yoloing',
  'yoloed',
  'archived',
]

export const AGENT_BOARD_LANE_LABELS: Record<AgentBoardLane, string> = {
  todo: 'Todo',
  planning: 'Planning',
  planned: 'Planned',
  implementing: 'Implementing',
  implemented: 'Implemented',
  pr_opened: 'PR opened',
  yoloing: 'Yoloing',
  yoloed: 'Yoloed',
  archived: 'Archived',
}

export function canMoveAgentBoardItem(
  from: AgentBoardLane,
  to: AgentBoardLane
) {
  if (from === to) return true
  if (from === 'pr_opened') return to === 'archived'
  if (to === 'archived') return true
  if (from === 'archived') return false

  const allowed: Record<AgentBoardLane, AgentBoardLane[]> = {
    todo: ['planning', 'implementing', 'yoloing'],
    planning: ['planned', 'implementing', 'yoloing'],
    planned: ['implementing', 'yoloing'],
    implementing: ['implemented', 'planning', 'yoloing'],
    implemented: ['implementing', 'pr_opened', 'yoloing'],
    pr_opened: ['archived'],
    yoloing: ['yoloed', 'implementing'],
    yoloed: ['yoloing', 'implementing', 'pr_opened'],
    archived: [],
  }

  return allowed[from].includes(to)
}
