/**
 * Default invoke command responses for E2E tests.
 * All values must be JSON-serializable (no closures, no functions).
 */

import {
  createProject,
  createWorktree,
  mockPreferences,
  mockUIState,
} from './mock-data'

// Shared state across handlers within a test
const project = createProject()
const worktree1 = createWorktree(project.id, {
  name: 'fuzzy-tiger',
  branch: 'fuzzy-tiger',
  order: 0,
})
const worktree2 = createWorktree(project.id, {
  name: 'calm-dolphin',
  branch: 'calm-dolphin',
  order: 1,
  path: '/tmp/e2e-test-project/.worktrees/calm-dolphin',
})

// UI state with project expanded
const uiState = {
  ...mockUIState,
  active_project_id: project.id,
  expanded_project_ids: [project.id],
}

/**
 * Static response map: command name → JSON-serializable response.
 * For commands that need args-dependent behavior, tests should
 * use invokeOverrides in the fixture.
 */
export const defaultResponses: Record<string, unknown> = {
  // Projects
  list_projects: [project],
  list_worktrees: [worktree1, worktree2],
  list_worktree_slots: [],
  reset_worktree_slot: null,
  reset_idle_worktree_slots: null,
  add_project: project,
  create_worktree: createWorktree(project.id, {
    name: 'new-worktree',
    branch: 'new-worktree',
    order: 2,
  }),
  fork_worktree: createWorktree(project.id, {
    name: 'fuzzy-tiger-fork',
    branch: 'fuzzy-tiger-fork',
    base_branch: 'fuzzy-tiger',
    order: 2,
  }),
  consume_pending_cli_yolo_requests: [],
  prepare_cli_yolo_from_pending_request: null,

  // Sessions
  get_sessions: { sessions: [], active_session_id: null },
  get_session: {
    id: 'unknown',
    name: 'Session',
    order: 0,
    created_at: 0,
    updated_at: 0,
    messages: [],
    session_derived_state: {
      status: 'idle',
      effective_execution_mode: null,
      is_waiting: false,
      waiting_type: null,
      has_question: false,
      has_exit_plan: false,
      pending_plan_message_id: null,
      plan_file_path: null,
      plan_content: null,
      permission_denial_count: 0,
      has_recap: false,
      latest_activity_at: 0,
      is_unread: false,
    },
  },
  list_all_sessions: { entries: [] },
  list_unread_sessions: { entries: [] },
  get_unread_count: 0,
  create_session: {
    id: 'session-new',
    name: 'New Session',
    order: 0,
    created_at: Date.now() / 1000,
    updated_at: Date.now() / 1000,
    messages: [],
    session_derived_state: {
      status: 'idle',
      effective_execution_mode: null,
      is_waiting: false,
      waiting_type: null,
      has_question: false,
      has_exit_plan: false,
      pending_plan_message_id: null,
      plan_file_path: null,
      plan_content: null,
      permission_denial_count: 0,
      has_recap: false,
      latest_activity_at: Date.now() / 1000,
      is_unread: false,
    },
  },

  // Preferences
  load_preferences: mockPreferences,
  save_preferences: null,
  patch_preferences: null,
  list_available_editors: [],

  // UI State
  load_ui_state: uiState,
  save_ui_state: null,

  // Agent board
  list_agent_board_items: [],
  create_agent_board_item: null,
  update_agent_board_item: null,
  delete_agent_board_item: null,
  move_agent_board_item: null,
  refresh_agent_board_items: [],
  get_agent_board_item_for_session: null,

  // CLI checks
  check_claude_cli_installed: { installed: true, version: '1.0.0' },
  check_claude_cli_auth: { authenticated: true },
  check_codex_cli_installed: { installed: true, version: '1.0.0' },
  check_codex_cli_auth: { authenticated: true },
  check_opencode_cli_installed: { installed: true, version: '1.0.0' },
  check_opencode_cli_auth: { authenticated: true },
  resolve_claude_update_command: null,
  resolve_codex_update_command: null,
  check_gh_cli_installed: {
    installed: true,
    version: '2.74.0',
    path: '/opt/homebrew/bin/gh',
  },
  check_gh_cli_auth: { authenticated: true },
  get_available_cli_versions: [],
  get_available_gh_versions: [],

  // Terminal
  kill_all_terminals: 0,
  has_active_terminal: false,

  // Sessions lifecycle
  check_resumable_sessions: [],
  list_archived_sessions: [],
  close_session: null,
  archive_session: null,

  // Git
  set_active_worktree_for_polling: null,
  set_all_worktrees_for_polling: null,
  set_pr_worktrees_for_polling: null,
  set_git_poll_interval: null,
  set_remote_poll_interval: null,
  get_git_poll_interval: 5,
  get_remote_poll_interval: 60,
  trigger_immediate_git_poll: null,
  trigger_immediate_remote_poll: null,
  fetch_worktrees_status: null,
  git_pull_upstream: 'Already up to date.',
  get_git_diff: {
    diff_type: 'uncommitted',
    base_ref: 'HEAD',
    target_ref: 'working directory',
    total_additions: 0,
    total_deletions: 0,
    files: [],
    raw_patch: '',
  },
  read_git_file_content: '',
  open_file_in_default_app: null,
  create_pr_with_ai_content: {
    pr_number: 123,
    pr_url: 'https://github.com/test/repo/pull/123',
    title: 'Test PR',
    is_draft: false,
    existing: false,
  },
  save_worktree_pr: null,
  update_worktree_cached_status: null,
  mark_pr_ready_for_review: null,

  // MCP
  get_mcp_servers: [],
  check_mcp_health: { healthy: true, servers: [] },

  // Skills
  list_claude_skills: [],
  list_codex_skills: [],
  set_codex_skill_enabled: { effective_enabled: true },
  list_claude_commands: [],
  resolve_claude_command: { content: '', allowed_tools: [] },

  // Files
  list_worktree_files: [],
  read_file_content: '',

  // GitHub
  list_github_issues: { issues: [], has_next_page: false },
  list_github_prs: [],
  search_github_prs: [],
  get_github_pr_by_number: null,
  get_pull_request_review_data: {
    pullRequest: null,
    headCommitSha: '',
    diff: '',
    viewerApproved: false,
    otherReviewerApproved: false,
    threads: [],
  },
  get_pull_request_review_summary: {
    pullRequest: null,
    headCommitSha: '',
    viewerApproved: false,
    otherReviewerApproved: false,
    threads: [],
  },
  get_pull_request_review_diff: { diff: '' },
  get_pull_request_review_file_contents: {
    oldContents: '',
    newContents: '',
  },
  create_pull_request_inline_comment: null,
  reply_to_pull_request_review_comment: null,
  submit_pull_request_review: null,

  // Recovery
  cleanup_old_recovery_files: 0,
  cleanup_old_archives: { removed: 0 },

  // App
  get_app_data_dir: `${process.env.HOME}/Library/Application Support/com.jean.desktop.test`,
  set_app_focus_state: null,

  // Archives
  list_archived_worktrees: [],
  list_all_archived_sessions: [],

  // Branches
  get_project_branches: [],

  // Session settings
  set_active_session: null,
  set_session_model: null,
  set_session_thinking_level: null,
  set_session_effort_level: null,
  set_session_backend: null,
  set_session_provider: null,
  update_session_state: null,
  add_global_command_permission_rule: null,
  answer_codex_mcp_elicitation: null,
  broadcast_session_setting: null,
  rename_session: null,
  send_chat_message: null,
  cancel_chat_message: false,
  list_automations: [],
  create_automation: null,
  update_automation: null,
  delete_automation: true,
  run_automation_now: null,
  pause_automation: null,
  resume_automation: null,

  // Misc
  save_emergency_data: null,
  load_emergency_data: null,
  open_worktree_in_editor: null,
  open_worktree_in_terminal: null,
  open_worktree_in_finder: null,
}

export { project, worktree1, worktree2 }
