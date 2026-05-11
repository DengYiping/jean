import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type { Session, WorktreeSessions } from '@/types/chat'

const { mockUseSessions, mockUseUpdateSessionState, mockMutate } = vi.hoisted(
  () => ({
    mockUseSessions: vi.fn(),
    mockUseUpdateSessionState: vi.fn(),
    mockMutate: vi.fn(),
  })
)

vi.mock('@/services/chat', () => ({
  useSessions: (...args: unknown[]) => mockUseSessions(...args),
  useUpdateSessionState: (...args: unknown[]) =>
    mockUseUpdateSessionState(...args),
}))

import {
  resolveSessionPersistenceContext,
  useSessionStatePersistence,
} from './useSessionStatePersistence'

let currentSessionsData: WorktreeSessions | undefined

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
    ...overrides,
  }
}

function resetStores() {
  useChatStore.setState({
    activeWorktreeId: null,
    activeWorktreePath: null,
    activeSessionIds: {},
    worktreePaths: {},
    answeredQuestions: {},
    submittedAnswers: {},
    fixedFindings: {},
    pendingPermissionDenials: {},
    pendingCodexMcpElicitations: {},
    deniedMessageContext: {},
    reviewingSessions: {},
    waitingForInputSessionIds: {},
    reviewResults: {},
    fixedReviewFindings: {},
    planFilePaths: {},
    pendingPlanMessageIds: {},
    enabledMcpServers: {},
    executionModes: {},
    parallelExecutionPromptEnabledBySession: {},
    tableCheckedRows: {},
  })

  useUIStore.setState({
    sessionChatModalOpen: false,
    sessionChatModalWorktreeId: null,
  })
}

describe('resolveSessionPersistenceContext', () => {
  it('uses modal worktree context when no active worktree is set', () => {
    const result = resolveSessionPersistenceContext({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: { 'worktree-1': 'session-1' },
      modalWorktreeId: 'worktree-1',
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
    })

    expect(result).toEqual({
      activeSessionId: 'session-1',
      effectiveWorktreeId: 'worktree-1',
      effectiveWorktreePath: '/tmp/worktree-1',
    })
  })

  it('prefers the active worktree path when the main chat view is active', () => {
    const result = resolveSessionPersistenceContext({
      activeWorktreeId: 'worktree-1',
      activeWorktreePath: '/active/path',
      activeSessionIds: { 'worktree-1': 'session-1' },
      modalWorktreeId: 'worktree-2',
      worktreePaths: {
        'worktree-1': '/stored/path',
        'worktree-2': '/tmp/worktree-2',
      },
    })

    expect(result).toEqual({
      activeSessionId: 'session-1',
      effectiveWorktreeId: 'worktree-1',
      effectiveWorktreePath: '/active/path',
    })
  })
})

describe('useSessionStatePersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStores()
    currentSessionsData = undefined
    mockUseUpdateSessionState.mockReturnValue({ mutate: mockMutate })
    mockUseSessions.mockImplementation(() => ({ data: currentSessionsData }))
  })

  it('resyncs waiting, review, and pending plan state from backend refetches', async () => {
    currentSessionsData = {
      worktree_id: 'worktree-1',
      active_session_id: 'session-1',
      version: 2,
      sessions: [
        createSession({
          waiting_for_input: true,
          waiting_for_input_type: 'plan',
          pending_plan_message_id: 'plan-msg-1',
          is_reviewing: true,
          last_run_status: 'running',
          session_derived_state: {
            status: 'waiting',
            effective_execution_mode: 'plan',
            is_waiting: true,
            waiting_type: 'plan',
            has_question: false,
            has_exit_plan: true,
            pending_plan_message_id: 'plan-msg-1',
            plan_file_path: null,
            plan_content: null,
            permission_denial_count: 0,
            has_recap: false,
            latest_activity_at: 1,
            is_unread: false,
          },
        }),
      ],
    }

    useChatStore.setState({
      activeWorktreeId: 'worktree-1',
      activeWorktreePath: '/tmp/worktree-1',
      activeSessionIds: { 'worktree-1': 'session-1' },
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
    })

    const { rerender, unmount } = renderHook(() => useSessionStatePersistence())

    await waitFor(() => {
      const state = useChatStore.getState()
      expect(state.waitingForInputSessionIds['session-1']).toBe(true)
      expect(state.reviewingSessions['session-1']).toBe(true)
      expect(state.pendingPlanMessageIds['session-1']).toBe('plan-msg-1')
    })

    act(() => {
      currentSessionsData = {
        worktree_id: 'worktree-1',
        active_session_id: 'session-1',
        version: 2,
        sessions: [
          createSession({
            waiting_for_input: true,
            waiting_for_input_type: 'plan',
            pending_plan_message_id: 'plan-msg-1',
            is_reviewing: false,
            last_run_status: 'completed',
            session_derived_state: {
              status: 'completed',
              effective_execution_mode: 'plan',
              is_waiting: false,
              waiting_type: null,
              has_question: false,
              has_exit_plan: false,
              pending_plan_message_id: null,
              plan_file_path: null,
              plan_content: null,
              permission_denial_count: 0,
              has_recap: false,
              latest_activity_at: 2,
              is_unread: false,
            },
          }),
        ],
      }
      rerender()
    })

    await waitFor(() => {
      const state = useChatStore.getState()
      expect(state.waitingForInputSessionIds['session-1']).toBe(false)
      expect(state.reviewingSessions['session-1']).toBe(false)
      expect(state.pendingPlanMessageIds['session-1']).toBeUndefined()
    })

    unmount()
  })
})
