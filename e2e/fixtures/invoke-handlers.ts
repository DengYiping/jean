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
  get_merge_conflicts: {
    has_conflicts: false,
    conflicts: [],
    conflict_diff: '',
  },
  fetch_and_merge_base: {
    has_conflicts: false,
    conflicts: [],
    conflict_diff: '',
  },
  merge_worktree_to_base: {
    success: true,
    commit_hash: 'abc1234',
    conflicts: null,
    conflict_diff: null,
  },
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
  fork_session_to_worktree: {
    worktree: createWorktree(project.id, {
      name: 'fork-fuzzy-tiger',
      branch: 'fork-fuzzy-tiger',
      base_branch: 'fuzzy-tiger',
      order: 2,
    }),
    session: {
      id: 'forked-session-1',
      name: 'Fork of Session',
      order: 0,
      created_at: 0,
      updated_at: 0,
      messages: [],
      backend: 'claude',
    },
  },
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
  get_codex_sub_agents: {
    sessionId: 'unknown',
    parentThreadId: null,
    agents: [],
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
  codex_goal_set: null,
  codex_goal_get: null,
  codex_goal_clear: null,

  // Preferences
  load_preferences: mockPreferences,
  save_preferences: null,
  patch_preferences: null,
  set_window_vibrancy: null,
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
  uninstall_claude_cli: null,
  check_codex_cli_installed: { installed: true, version: '1.0.0' },
  check_codex_cli_auth: { authenticated: true },
  uninstall_codex_cli: null,
  check_coderabbit_cli_installed: {
    installed: true,
    version: '1.0.0',
    path: '/usr/local/bin/coderabbit',
  },
  detect_coderabbit_in_path: {
    found: true,
    path: '/usr/local/bin/coderabbit',
    version: '1.0.0',
    package_manager: null,
  },
  check_coderabbit_cli_auth: { authenticated: true, error: null },
  install_coderabbit_cli: null,
  uninstall_coderabbit_cli: null,
  update_coderabbit_cli: null,
  check_opinionated_plugin_status: { installed: false, version: null },
  install_opinionated_plugin: 'Plugin installed successfully',
  uninstall_opinionated_plugin: 'Plugin uninstalled successfully',
  check_opencode_cli_installed: { installed: true, version: '1.0.0' },
  check_opencode_cli_auth: { authenticated: true },
  uninstall_opencode_cli: null,
  resolve_claude_update_command: null,
  resolve_codex_update_command: null,
  run_cli_path_update: {
    success: true,
    stdout: '',
    stderr: '',
    exit_code: 0,
  },
  check_gh_cli_installed: {
    installed: true,
    version: '2.74.0',
    path: '/opt/homebrew/bin/gh',
  },
  check_gh_cli_auth: { authenticated: true },
  uninstall_gh_cli: null,
  get_available_cli_versions: [],
  get_available_gh_versions: [],

  // Terminal
  get_run_scripts: [],
  get_package_scripts: [],
  get_build_script: null,
  get_ports: [],
  prepare_backend_terminal_context: { commandArgs: [] },
  list_native_cli_sessions: [],
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
  hard_reset_worktree: null,
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
  switch_worktree_base_branch: {
    worktree: null,
    rebase_output: null,
  },
  mark_pr_ready_for_review: null,
  run_review_with_ai: {
    summary: 'Review completed with no findings.',
    findings: [],
    approval_status: 'approved',
  },
  cancel_review_with_ai: false,
  start_review_job: {
    job: {
      id: 'review-job-1',
      reviewRunId: 'review-run-1',
      worktreeId: worktree1.id,
      worktreePath: worktree1.path,
      sessionId: 'review-session-1',
      source: 'ai',
      status: 'running',
      findingCount: null,
      error: null,
      createdAt: 0,
      updatedAt: 0,
    },
  },
  get_review_job: null,
  list_review_jobs: [],
  cancel_review_job: false,
  run_coderabbit_review: {
    summary: 'CodeRabbit review completed with no findings.',
    findings: [],
    approval_status: 'approved',
  },
  trigger_coderabbit_pr_review: {
    pr_number: 123,
    pr_url: 'https://github.com/test/repo/pull/123',
    comment_body: '@coderabbitai review',
  },

  // MCP
  get_mcp_servers: [],
  check_mcp_health: { healthy: true, servers: [] },
  get_jean_mcp_config_snippet: {
    enabled: true,
    serverRunning: true,
    mode: 'dev',
    serverName: 'jean-dev',
    url: null,
    token: null,
    claude: '{"mcpServers":{"jean-dev":{"type":"stdio","command":"jean"}}}',
    cursor: '{"mcp":{"jean-dev":{"type":"stdio","command":"jean"}}}',
    codexToml: '[mcp_servers.jean-dev]\\ncommand = "jean"',
    opencodeJson: '{"mcp":{"jean-dev":{"type":"local","command":["jean"]}}}',
  },
  install_jean_mcp_config: [],
  start_background_investigation: {
    sessionId: 'session-1',
    worktreeId: 'wt-1',
    status: 'started',
  },
  get_worktree_changes: { files: [], truncated: false },
  get_worktree_diff: { diff: '', truncated: false },
  list_sessions_summary: [],
  get_session_status: { status: 'idle' },

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
  search_github_issues: [],
  get_github_issue_by_number: null,
  list_github_prs: [],
  search_github_prs: [],
  get_github_pr_by_number: null,
  list_github_releases: [
    {
      tagName: 'v1.0.0',
      name: 'v1.0.0',
      publishedAt: '2026-01-01T00:00:00Z',
      isLatest: true,
      isDraft: false,
      isPrerelease: false,
    },
  ],
  generate_release_notes: {
    title: 'v1.0.0',
    body: 'Test release notes',
  },
  generate_release_post: {
    post: 'Jean v1.0.0 is out. https://github.com/test/repo/releases/tag/v1.0.0',
    release_url: 'https://github.com/test/repo/releases/tag/v1.0.0',
  },
  list_dependabot_alerts: [],
  get_dependabot_alert: null,
  list_repository_advisories: [],
  get_repository_advisory: null,
  list_loaded_issue_contexts: [],
  list_loaded_pr_contexts: [],
  list_loaded_security_contexts: [],
  list_loaded_advisory_contexts: [],
  list_loaded_linear_issue_contexts: [],
  get_sentry_issue_context_contents: [],
  load_issue_context: null,
  load_pr_context: null,
  load_security_alert_context: null,
  load_advisory_context: null,
  load_linear_issue_context: null,
  remove_issue_context: null,
  remove_pr_context: null,
  remove_security_alert_context: null,
  remove_advisory_context: null,
  remove_linear_issue_context: null,
  list_linear_issues: { issues: [] },
  search_linear_issues: [],
  get_linear_issue_by_number: null,
  test_sentry_auth_token: [],
  list_sentry_projects: [],
  list_sentry_issues: [],
  get_sentry_issue: null,
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
  cleanup_old_archives: {
    deleted_worktrees: 0,
    deleted_sessions: 0,
    deleted_contexts: 0,
    deleted_orphan_indexes: 0,
  },

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
  claim_supervisor_action_trigger: null,
  add_global_command_permission_rule: null,
  answer_codex_mcp_elicitation: null,
  broadcast_session_setting: null,
  rename_session: null,
  send_chat_message: null,
  cancel_chat_message: false,
  create_commit_with_ai: { message: 'test commit', commit_hash: 'abc123' },
  process_message_queue: null,
  enqueue_message: [],
  dequeue_message: null,
  remove_queued_message: null,
  update_queued_message: true,
  reorder_queued_messages: [],
  clear_message_queue: null,
  list_automations: [],
  create_automation: null,
  update_automation: null,
  delete_automation: true,
  cleanup_automation_threads: {
    archived_sessions: 0,
    affected_worktrees: 0,
    skipped_archived_sessions: 0,
  },
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
