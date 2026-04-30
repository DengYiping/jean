/**
 * Playwright test fixture that injects E2E mock transport.
 * Usage: import { test, expect } from '../fixtures/tauri-mock'
 */

import { test as base, expect, type Page } from '@playwright/test'
import { defaultResponses } from './invoke-handlers'

interface TauriMockFixtures {
  /** Page with Tauri mocks injected. Navigates to '/' automatically. */
  mockPage: Page
  /** Override specific command responses for this test. */
  responseOverrides: Record<string, unknown>
  /** Emit a backend event to the app (simulates Rust → React events). */
  emitEvent: (event: string, payload: unknown) => Promise<void>
}

export const test = base.extend<TauriMockFixtures>({
  // Default: no overrides. Tests can set this via test.use({})
  responseOverrides: [{}, { option: true }],

  mockPage: async ({ page, responseOverrides }, use) => {
    const responses = { ...defaultResponses, ...responseOverrides }

    // Keys explicitly overridden — these take precedence over dynamic handlers
    const overrideKeys = Object.keys(responseOverrides)

    await page.addInitScript(
      ({
        responseMap,
        overrideKeys,
      }: {
        responseMap: Record<string, unknown>
        overrideKeys: string[]
      }) => {
        const overrideSet = new Set(overrideKeys)
        const eventEmitter = new EventTarget()

        // In-memory session store for stateful handlers
        const sessionStore: Record<
          string,
          {
            sessions: Array<Record<string, unknown>>
            active_session_id: string | null
          }
        > = {}
        const worktreeStore: Array<Record<string, unknown>> = structuredClone(
          (responseMap.list_worktrees as Array<Record<string, unknown>>) ?? []
        )
        const automationStore: Array<Record<string, unknown>> = []
        const agentBoardStore: Array<Record<string, unknown>> = structuredClone(
          (responseMap.list_agent_board_items as
            | Array<Record<string, unknown>>
            | undefined) ?? []
        )

        function getWorktreeStore(worktreeId: string) {
          if (!sessionStore[worktreeId]) {
            sessionStore[worktreeId] = {
              sessions: [],
              active_session_id: null,
            }
          }
          return sessionStore[worktreeId]
        }

        function deriveSessionState(session: Record<string, unknown>) {
          const waitingForInput = Boolean(session.waiting_for_input)
          const waitingType = waitingForInput
            ? ((session.waiting_for_input_type as string | null | undefined) ??
              (session.pending_plan_message_id ? 'plan' : 'question'))
            : null
          const lastRunStatus =
            (session.last_run_status as string | undefined) ?? null
          const effectiveExecutionMode =
            (session.last_run_execution_mode as string | undefined) ??
            (session.selected_execution_mode as string | undefined) ??
            null
          let status = 'idle'
          const permissionCount =
            (Array.isArray(session.pending_permission_denials)
              ? session.pending_permission_denials.length
              : 0) +
            (Array.isArray(session.pending_codex_mcp_elicitations)
              ? session.pending_codex_mcp_elicitations.length
              : 0)

          if (permissionCount > 0) status = 'permission'
          else if (waitingForInput) status = 'waiting'
          else if (session.is_reviewing || session.review_results)
            status = 'review'
          else if (
            lastRunStatus === 'running' ||
            lastRunStatus === 'resumable'
          ) {
            status =
              effectiveExecutionMode === 'build'
                ? 'vibing'
                : effectiveExecutionMode === 'yolo'
                  ? 'yoloing'
                  : 'planning'
          } else if (lastRunStatus === 'completed') status = 'completed'

          const actionableStatus =
            lastRunStatus === 'completed' ||
            lastRunStatus === 'cancelled' ||
            lastRunStatus === 'crashed'
          const isUnread =
            !session.archived_at &&
            (permissionCount > 0 ||
              waitingForInput ||
              Boolean(session.is_reviewing) ||
              actionableStatus) &&
            (((session.last_opened_at as number | undefined) ?? null) ===
              null ||
              (session.last_opened_at as number) <
                ((session.updated_at as number | undefined) ?? 0))

          return {
            status,
            effective_execution_mode: effectiveExecutionMode,
            is_waiting: waitingForInput,
            waiting_type: waitingType,
            has_question: waitingType === 'question',
            has_exit_plan: waitingType === 'plan',
            pending_plan_message_id:
              waitingType === 'plan'
                ? ((session.pending_plan_message_id as string | undefined) ??
                  null)
                : null,
            plan_file_path:
              (session.plan_file_path as string | undefined) ?? null,
            plan_content: null,
            permission_denial_count: permissionCount,
            has_recap: Boolean(session.digest),
            latest_activity_at:
              (session.last_message_at as number | undefined) ??
              (session.updated_at as number | undefined) ??
              (session.created_at as number | undefined) ??
              0,
            is_unread: isUnread,
          }
        }

        function cloneSessionWithDerivedState(
          session: Record<string, unknown>
        ) {
          const cloned = structuredClone(session)
          cloned.session_derived_state = deriveSessionState(cloned)
          return cloned
        }

        function createAgentBoardWorktree(projectId: string, suffix: string) {
          const index = worktreeStore.length + 1
          const name = `agent-${suffix}-${index}`
          const worktree = {
            id: `worktree-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            project_id: projectId,
            name,
            path: `/tmp/e2e-test-project/.worktrees/${name}`,
            stable_slot_id: undefined,
            branch: name,
            base_branch: 'main',
            created_at: Date.now() / 1000,
            order: worktreeStore.length,
            session_type: 'worktree',
            status: 'ready',
          }
          worktreeStore.push(worktree)
          return worktree
        }

        function createAgentBoardSession(
          worktreeId: string,
          item: Record<string, unknown>,
          suffix: string
        ) {
          const store = getWorktreeStore(worktreeId)
          const session = {
            id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: `${String(item.title)} ${suffix}`,
            order: store.sessions.length,
            created_at: Date.now() / 1000,
            updated_at: Date.now() / 1000,
            messages: [],
            backend: (item.backend as string | undefined) ?? 'codex',
            agent_board_item_id: item.id,
          }
          store.sessions.unshift(session)
          store.active_session_id = session.id
          return session
        }

        function syncAgentBoardItem(item: Record<string, unknown>) {
          const planningSessionId = item.planning_session_id as
            | string
            | undefined
          const implementationSessionId = item.implementation_session_id as
            | string
            | undefined
          const yoloSessionId = item.yolo_session_id as string | undefined

          for (const store of Object.values(sessionStore)) {
            for (const session of store.sessions) {
              if (
                planningSessionId &&
                session.id === planningSessionId &&
                session.waiting_for_input &&
                session.waiting_for_input_type === 'plan'
              ) {
                item.lane = 'planned'
              }
              if (
                implementationSessionId &&
                session.id === implementationSessionId
              ) {
                if (
                  item.lane === 'implemented' &&
                  (session.last_run_status === 'running' ||
                    session.last_run_status === 'resumable')
                ) {
                  item.lane = 'implementing'
                } else if (
                  item.lane === 'implementing' &&
                  session.last_run_status === 'completed'
                ) {
                  item.lane = 'implemented'
                }
              }
              if (yoloSessionId && session.id === yoloSessionId) {
                if (
                  item.lane === 'yoloed' &&
                  (session.last_run_status === 'running' ||
                    session.last_run_status === 'resumable')
                ) {
                  item.lane = 'yoloing'
                } else if (
                  item.lane === 'yoloing' &&
                  ['completed', 'cancelled', 'crashed'].includes(
                    String(session.last_run_status)
                  )
                ) {
                  item.lane = 'yoloed'
                }
              }
            }
          }
        }

        // Commands that need dynamic responses based on args
        const dynamicHandlers: Record<
          string,
          (args?: Record<string, unknown>) => unknown
        > = {
          list_agent_board_items: () => {
            agentBoardStore.forEach(syncAgentBoardItem)
            return structuredClone(agentBoardStore)
          },
          refresh_agent_board_items: () => {
            agentBoardStore.forEach(syncAgentBoardItem)
            return structuredClone(agentBoardStore)
          },
          create_agent_board_item: args => {
            const request =
              (args?.request as Record<string, unknown> | undefined) ?? {}
            const prompt = String(request.prompt ?? '')
            const title =
              typeof request.title === 'string' && request.title.trim()
                ? request.title.trim()
                : prompt.split(/\s+/).filter(Boolean).slice(0, 7).join(' ') ||
                  'Untitled task'
            const now = Date.now() / 1000
            const item = {
              id: `agent-board-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              title,
              prompt,
              project_id: request.project_id ?? 'project-1',
              backend: request.backend ?? 'codex',
              effort_level: request.effort_level ?? 'high',
              lane: 'todo',
              created_at: now,
              updated_at: now,
            }
            agentBoardStore.push(item)
            return structuredClone(item)
          },
          update_agent_board_item: args => {
            const item = agentBoardStore.find(
              candidate => candidate.id === args?.itemId
            )
            if (!item) return null
            const patch =
              (args?.patch as Record<string, unknown> | undefined) ?? {}
            Object.assign(item, patch, { updated_at: Date.now() / 1000 })
            return structuredClone(item)
          },
          delete_agent_board_item: args => {
            const index = agentBoardStore.findIndex(
              candidate => candidate.id === args?.itemId
            )
            if (index >= 0) {
              agentBoardStore.splice(index, 1)
            }
            return null
          },
          move_agent_board_item: args => {
            const item = agentBoardStore.find(
              candidate => candidate.id === args?.itemId
            )
            if (!item) return null
            const lane = String(args?.lane)
            item.lane = lane
            item.updated_at = Date.now() / 1000

            if (lane === 'planning') {
              if (!item.worktree_id) {
                item.worktree_id = createAgentBoardWorktree(
                  String(item.project_id),
                  'plan'
                ).id
              }
              if (!item.planning_session_id) {
                item.planning_session_id = createAgentBoardSession(
                  String(item.worktree_id),
                  item,
                  'plan'
                ).id
              }
            } else if (lane === 'implementing') {
              if (!item.worktree_id) {
                item.worktree_id = createAgentBoardWorktree(
                  String(item.project_id),
                  'build'
                ).id
              }
              if (!item.implementation_session_id) {
                item.implementation_session_id =
                  item.planning_session_id ??
                  createAgentBoardSession(
                    String(item.worktree_id),
                    item,
                    'build'
                  ).id
              }
            } else if (lane === 'pr_opened') {
              item.pr_url = 'https://github.com/test/repo/pull/123'
            } else if (lane === 'yoloing') {
              if (!item.yolo_worktree_id) {
                item.yolo_worktree_id = createAgentBoardWorktree(
                  String(item.project_id),
                  'yolo'
                ).id
              }
              if (!item.yolo_session_id) {
                item.yolo_session_id = createAgentBoardSession(
                  String(item.yolo_worktree_id),
                  item,
                  'yolo'
                ).id
              }
            } else if (lane === 'archived') {
              item.archived_at = Date.now() / 1000
            }

            return structuredClone(item)
          },
          get_agent_board_item_for_session: args => {
            const sessionId = args?.sessionId
            for (const item of agentBoardStore) {
              if (item.planning_session_id === sessionId) {
                return { item: structuredClone(item), session_role: 'planning' }
              }
              if (item.implementation_session_id === sessionId) {
                return {
                  item: structuredClone(item),
                  session_role: 'implementation',
                }
              }
              if (item.yolo_session_id === sessionId) {
                return { item: structuredClone(item), session_role: 'yolo' }
              }
            }
            return null
          },
          get_sessions: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            return {
              worktree_id: wid,
              sessions: store.sessions.map(session =>
                cloneSessionWithDerivedState(session)
              ),
              active_session_id: store.active_session_id,
              version: 2,
            }
          },
          list_worktrees: () => structuredClone(worktreeStore),
          list_worktree_slots: () => [],
          reset_worktree_slot: () => null,
          reset_idle_worktree_slots: () => null,
          get_worktree: args => {
            const worktree = worktreeStore.find(w => w.id === args?.worktreeId)
            return worktree ? structuredClone(worktree) : null
          },
          create_worktree: args => {
            const projectId = (args?.projectId as string) ?? 'project-1'
            const index = worktreeStore.length + 1
            const name = `harness-${index}`
            const worktree = {
              id: `worktree-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              project_id: projectId,
              name,
              path: `/tmp/e2e-test-project/.worktrees/${name}`,
              stable_slot_id: undefined,
              branch: name,
              base_branch: (args?.baseBranch as string | undefined) ?? 'main',
              created_at: Date.now() / 1000,
              order: worktreeStore.length,
              session_type: 'worktree',
              status: 'ready',
            }
            worktreeStore.push(worktree)
            window.setTimeout(() => {
              eventEmitter.dispatchEvent(
                new CustomEvent('worktree:created', {
                  detail: { worktree: structuredClone(worktree) },
                })
              )
            }, 0)
            return structuredClone(worktree)
          },
          fork_worktree: args => {
            const sourceWorktreeId = args?.sourceWorktreeId as
              | string
              | undefined
            const source = worktreeStore.find(w => w.id === sourceWorktreeId)
            const projectId =
              (source?.project_id as string | undefined) ?? 'project-1'
            const sourceName =
              (source?.name as string | undefined) ?? 'worktree'
            const sourceBranch =
              (source?.branch as string | undefined) ?? sourceName
            const name = `${sourceName}-fork`
            const worktree = {
              id: `worktree-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              project_id: projectId,
              name,
              path: `/tmp/e2e-test-project/.worktrees/${name}`,
              stable_slot_id: undefined,
              branch: name,
              base_branch: sourceBranch,
              created_at: Date.now() / 1000,
              order: worktreeStore.length,
              session_type: 'worktree',
              status: 'ready',
            }
            worktreeStore.push(worktree)
            window.setTimeout(() => {
              eventEmitter.dispatchEvent(
                new CustomEvent('worktree:created', {
                  detail: { worktree: structuredClone(worktree) },
                })
              )
            }, 0)
            return structuredClone(worktree)
          },
          create_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const name =
              (args?.name as string) || `Session ${store.sessions.length + 1}`
            const session = {
              id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name,
              order: store.sessions.length,
              created_at: Date.now() / 1000,
              updated_at: Date.now() / 1000,
              messages: [],
              backend: (args?.backend as string | undefined) ?? 'claude',
            }
            store.sessions.unshift(session)
            store.active_session_id = session.id
            return cloneSessionWithDerivedState(session)
          },
          rename_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              session.name = args?.newName as string
            }
            return null
          },
          set_active_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            store.active_session_id = (args?.sessionId as string) ?? null
            return null
          },
          set_session_model: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              session.selected_model = args?.model as string
            }
            return null
          },
          set_session_thinking_level: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              session.selected_thinking_level = args?.thinkingLevel as string
            }
            return null
          },
          set_session_effort_level: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              session.selected_effort_level = args?.effortLevel as string
            }
            return null
          },
          set_session_backend: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              session.backend = args?.backend as string
            }
            return null
          },
          set_session_provider: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              session.selected_provider = (args?.provider as string) ?? null
            }
            return null
          },
          update_session_state: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) {
              if (args?.enabledMcpServers !== undefined) {
                session.enabled_mcp_servers = structuredClone(
                  args.enabledMcpServers as unknown
                )
              }
              if (args?.selectedExecutionMode !== undefined) {
                session.selected_execution_mode = args.selectedExecutionMode
              }
              if (args?.pendingCodexMcpElicitations !== undefined) {
                session.pending_codex_mcp_elicitations = structuredClone(
                  args.pendingCodexMcpElicitations as unknown
                )
              }
              if (args?.pendingPermissionDenials !== undefined) {
                session.pending_permission_denials = structuredClone(
                  args.pendingPermissionDenials as unknown
                )
              }
              if (args?.deniedMessageContext !== undefined) {
                session.denied_message_context = structuredClone(
                  args.deniedMessageContext as unknown
                )
              }
              if (args?.waitingForInput !== undefined) {
                session.waiting_for_input = args.waitingForInput
              }
              if (args?.waitingForInputType !== undefined) {
                session.waiting_for_input_type = args.waitingForInputType
              }
              if (args?.isReviewing !== undefined) {
                session.is_reviewing = args.isReviewing
              }
              if (args?.parallelExecutionPromptEnabled !== undefined) {
                session.parallel_execution_prompt_enabled =
                  args.parallelExecutionPromptEnabled
              }
            }
            return null
          },
          get_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            return session
              ? cloneSessionWithDerivedState(session)
              : {
                  id: args?.sessionId ?? 'unknown',
                  name: 'Session',
                  order: 0,
                  created_at: Date.now() / 1000,
                  updated_at: Date.now() / 1000,
                  messages: [],
                  session_derived_state: deriveSessionState({
                    created_at: Date.now() / 1000,
                    updated_at: Date.now() / 1000,
                    messages: [],
                  }),
                }
          },
          list_unread_sessions: () => {
            const entries: Array<Record<string, unknown>> = []
            for (const [worktreeId, store] of Object.entries(sessionStore)) {
              for (const session of store.sessions) {
                const derived = deriveSessionState(session)
                if (!derived.is_unread) continue
                entries.push({
                  project_id: 'project-1',
                  project_name: 'E2E Project',
                  worktree_id: worktreeId,
                  worktree_name: worktreeId,
                  worktree_path: `/tmp/${worktreeId}`,
                  session: {
                    ...structuredClone(session),
                    session_derived_state: derived,
                  },
                })
              }
            }
            return { entries }
          },
          get_unread_count: () => {
            let count = 0
            for (const store of Object.values(sessionStore)) {
              for (const session of store.sessions) {
                if (deriveSessionState(session).is_unread) count += 1
              }
            }
            return count
          },
          send_chat_message: args => {
            // Return a mock assistant ChatMessage
            // Actual streaming is handled via emitEvent
            return {
              id: `msg-${Date.now()}`,
              session_id: args?.sessionId ?? 'unknown',
              role: 'assistant',
              content: 'Mock response',
              content_blocks: [{ type: 'text', text: 'Mock response' }],
              timestamp: Math.floor(Date.now() / 1000),
              cost_usd: 0.001,
              duration_ms: 500,
              model: 'sonnet',
              tool_calls: [],
              cancelled: false,
            }
          },
          list_automations: args => {
            const projectId = (args?.projectId as string) ?? null
            return projectId
              ? automationStore.filter(item => item.project_id === projectId)
              : automationStore
          },
          create_automation: args => {
            const automation = {
              id: `automation-${Date.now()}`,
              project_id: (args?.projectId as string) ?? 'project-1',
              name: args?.name ?? 'Automation',
              prompt: args?.prompt ?? '',
              target_mode:
                (args?.target_mode as string) ??
                (args?.targetMode as string) ??
                'existing_worktrees',
              target_worktree_ids: structuredClone(
                (args?.target_worktree_ids as string[]) ??
                  (args?.targetWorktreeIds as string[]) ??
                  []
              ),
              backend: (args?.backend as string) ?? 'codex',
              model: (args?.model as string) ?? null,
              provider: (args?.provider as string) ?? null,
              execution_mode:
                (args?.execution_mode as string) ??
                (args?.executionMode as string) ??
                'plan',
              thinking_level:
                (args?.thinking_level as string) ??
                (args?.thinkingLevel as string) ??
                null,
              effort_level:
                (args?.effort_level as string) ??
                (args?.effortLevel as string) ??
                null,
              schedule_rrule:
                (args?.schedule_rrule as string) ??
                (args?.scheduleRrule as string) ??
                'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0',
              run_window_start_hour:
                (args?.run_window_start_hour as number) ??
                (args?.runWindowStartHour as number) ??
                null,
              run_window_end_hour:
                (args?.run_window_end_hour as number) ??
                (args?.runWindowEndHour as number) ??
                null,
              status: (args?.status as string) ?? 'enabled',
              last_run_at: null,
              next_run_at: Math.floor(Date.now() / 1000) + 3600,
              last_run_status: null,
              last_error: null,
              session_ids_by_worktree_id: {},
              created_at: Math.floor(Date.now() / 1000),
              updated_at: Math.floor(Date.now() / 1000),
            }
            automationStore.unshift(automation)
            return structuredClone(automation)
          },
          update_automation: args => {
            const automation = automationStore.find(
              item => item.id === args?.id
            )
            if (!automation) return null
            Object.assign(automation, {
              name: args?.name,
              prompt: args?.prompt,
              target_mode:
                args?.target_mode ?? args?.targetMode ?? automation.target_mode,
              target_worktree_ids: structuredClone(
                (args?.target_worktree_ids as string[]) ??
                  (args?.targetWorktreeIds as string[]) ??
                  []
              ),
              backend: args?.backend ?? automation.backend,
              model: args?.model ?? automation.model,
              provider: args?.provider ?? automation.provider,
              execution_mode:
                args?.execution_mode ??
                args?.executionMode ??
                automation.execution_mode,
              thinking_level:
                args?.thinking_level ??
                args?.thinkingLevel ??
                automation.thinking_level,
              effort_level:
                args?.effort_level ??
                args?.effortLevel ??
                automation.effort_level,
              schedule_rrule:
                args?.schedule_rrule ??
                args?.scheduleRrule ??
                automation.schedule_rrule,
              run_window_start_hour:
                args?.run_window_start_hour ??
                args?.runWindowStartHour ??
                automation.run_window_start_hour,
              run_window_end_hour:
                args?.run_window_end_hour ??
                args?.runWindowEndHour ??
                automation.run_window_end_hour,
              status: args?.status ?? automation.status,
              updated_at: Math.floor(Date.now() / 1000),
            })
            return structuredClone(automation)
          },
          delete_automation: args => {
            const idx = automationStore.findIndex(item => item.id === args?.id)
            if (idx >= 0) {
              automationStore.splice(idx, 1)
              return true
            }
            return false
          },
          run_automation_now: args => {
            const automation = automationStore.find(
              item => item.id === args?.id
            )
            if (automation) {
              automation.last_run_status = 'running'
              automation.last_run_at = Math.floor(Date.now() / 1000)
            }
            return null
          },
          pause_automation: args => {
            const automation = automationStore.find(
              item => item.id === args?.id
            )
            if (automation) {
              automation.status = 'paused'
            }
            return structuredClone(automation)
          },
          resume_automation: args => {
            const automation = automationStore.find(
              item => item.id === args?.id
            )
            if (automation) {
              automation.status = 'enabled'
            }
            return structuredClone(automation)
          },
        }

        const handlers: Record<string, (args?: any) => unknown> = {}

        for (const [cmd, data] of Object.entries(responseMap)) {
          // If explicitly overridden, use static response (override wins over dynamic)
          if (overrideSet.has(cmd)) {
            handlers[cmd] = () => structuredClone(data)
          } else if (dynamicHandlers[cmd]) {
            handlers[cmd] = dynamicHandlers[cmd]
          } else {
            handlers[cmd] = () => structuredClone(data)
          }
        }

        // Also add dynamic handlers that aren't in the response map
        for (const [cmd, handler] of Object.entries(dynamicHandlers)) {
          if (!handlers[cmd]) {
            handlers[cmd] = handler
          }
        }

        const invokeCalls: Array<{
          command: string
          args: Record<string, unknown> | undefined
        }> = []
        const loggedHandlers: Record<string, (args?: any) => unknown> = {}
        for (const [cmd, handler] of Object.entries(handlers)) {
          loggedHandlers[cmd] = args => {
            invokeCalls.push({
              command: cmd,
              args: args === undefined ? undefined : structuredClone(args),
            })
            return handler(args)
          }
        }

        ;(window as any).__JEAN_E2E_MOCK__ = {
          invokeHandlers: loggedHandlers,
          invokeCalls,
          eventEmitter,
        }
      },
      { responseMap: responses, overrideKeys }
    )

    await page.goto('/')
    await use(page)
  },

  emitEvent: async ({ mockPage }, use) => {
    const emitFn = async (event: string, payload: unknown) => {
      await mockPage.evaluate(
        ({ event, payload }) => {
          const emitter = (window as any).__JEAN_E2E_MOCK__?.eventEmitter
          if (emitter) {
            emitter.dispatchEvent(new CustomEvent(event, { detail: payload }))
          }
        },
        { event, payload }
      )
    }
    await use(emitFn)
  },
})

export { expect }

/**
 * Helper: open sidebar and click a worktree to activate it.
 * Waits for the chat view to appear.
 */
export async function activateWorktree(
  page: Page,
  worktreeName: string
): Promise<void> {
  // Ensure sidebar is visible
  const projectsHeader = page.getByText('PROJECTS')
  if (!(await projectsHeader.isVisible().catch(() => false))) {
    await page.keyboard.press('Meta+b')
    await page.waitForTimeout(500)
  }
  await expect(projectsHeader).toBeVisible({ timeout: 3000 })

  // Click the worktree
  await page.getByText(worktreeName).click()
  await page.waitForTimeout(1000)

  // Wait for chat view (dashboard empty state should be gone)
  await expect(
    page.getByText('Your imagination is the only limit')
  ).not.toBeVisible({ timeout: 3000 })
}
