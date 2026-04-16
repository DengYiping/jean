import type {
  Backend,
  EffortLevel,
  ExecutionMode,
  ThinkingLevel,
} from '@/types/chat'

export type AutomationStatus = 'enabled' | 'paused'

export type AutomationLastRunStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'

export type AutomationTargetMode = 'existing_worktrees' | 'fresh_worktree'

export interface Automation {
  id: string
  project_id: string
  name: string
  prompt: string
  target_mode: AutomationTargetMode
  target_worktree_ids: string[]
  backend?: Backend | null
  model?: string | null
  provider?: string | null
  execution_mode?: ExecutionMode | null
  thinking_level?: ThinkingLevel | null
  effort_level?: EffortLevel | null
  schedule_rrule: string
  run_window_start_hour?: number | null
  run_window_end_hour?: number | null
  status: AutomationStatus
  last_run_at?: number | null
  next_run_at?: number | null
  last_run_status?: AutomationLastRunStatus | null
  last_error?: string | null
  session_ids_by_worktree_id: Record<string, string>
  created_at: number
  updated_at: number
}

export interface AutomationUpsertInput {
  name: string
  prompt: string
  target_mode: AutomationTargetMode
  target_worktree_ids: string[]
  backend?: Backend | null
  model?: string | null
  provider?: string | null
  execution_mode?: ExecutionMode | null
  thinking_level?: ThinkingLevel | null
  effort_level?: EffortLevel | null
  schedule_rrule: string
  run_window_start_hour?: number | null
  run_window_end_hour?: number | null
  status?: AutomationStatus
}
