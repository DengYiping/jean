import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import { agentBoardQueryKeys } from '@/services/agent-board'
import { chatQueryKeys } from '@/services/chat'
import type * as ChatService from '@/services/chat'
import type { AgentBoardItem } from '@/types/agent-board'
import type { Session, WorktreeSessions } from '@/types/chat'
import { completePlanApprovalTransition } from './plan-approval-transition'

const { mockInvoke, mockMarkPlanApproved } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockMarkPlanApproved: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('@/services/chat', async importOriginal => {
  const actual = await importOriginal<typeof ChatService>()
  return {
    ...actual,
    markPlanApproved: (...args: unknown[]) => mockMarkPlanApproved(...args),
  }
})

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createSession(): Session {
  return {
    id: 'session-1',
    name: 'Session 1',
    order: 0,
    created_at: 1,
    updated_at: 1,
    waiting_for_input: true,
    waiting_for_input_type: 'plan',
    pending_plan_message_id: 'plan-msg-1',
    is_reviewing: true,
    messages: [
      {
        id: 'plan-msg-1',
        session_id: 'session-1',
        role: 'assistant',
        content: '',
        timestamp: 1,
        tool_calls: [],
        content_blocks: [],
        cancelled: false,
        plan_approved: false,
      },
    ],
  }
}

describe('completePlanApprovalTransition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkPlanApproved.mockResolvedValue(undefined)
    mockInvoke.mockResolvedValue(undefined)
    useChatStore.setState({
      activeToolCalls: {
        'session-1': [{ id: 'tool-1', name: 'ExitPlanMode', input: {} }],
      },
      streamingContentBlocks: {
        'session-1': [{ type: 'tool_use', tool_call_id: 'tool-1' }],
      },
      reviewingSessions: { 'session-1': true },
      waitingForInputSessionIds: { 'session-1': true },
      pendingPlanMessageIds: { 'session-1': 'plan-msg-1' },
      executionModes: { 'session-1': 'plan' },
    })
  })

  it('owns the plan approval ordering and local/cache cleanup', async () => {
    const queryClient = createQueryClient()
    const session = createSession()
    const sessions: WorktreeSessions = {
      worktree_id: 'worktree-1',
      active_session_id: 'session-1',
      version: 1,
      sessions: [session],
    }
    const boardItems: AgentBoardItem[] = [
      {
        id: 'item-1',
        title: 'Plan task',
        prompt: 'Plan task',
        project_id: 'project-1',
        backend: 'codex',
        lane: 'implementing',
        worktree_id: 'worktree-1',
        planning_session_id: 'session-1',
        implementation_session_id: 'session-1',
        created_at: 1,
        updated_at: 2,
      },
    ]
    const calls: string[] = []

    queryClient.setQueryData(chatQueryKeys.session('session-1'), session)
    queryClient.setQueryData(chatQueryKeys.sessions('worktree-1'), sessions)
    mockMarkPlanApproved.mockImplementation(() => {
      calls.push('mark_plan_approved')
      return Promise.resolve()
    })
    mockInvoke.mockImplementation((command: string) => {
      calls.push(command)
      if (command === 'refresh_agent_board_items') {
        return Promise.resolve(boardItems)
      }
      return Promise.resolve(undefined)
    })

    await completePlanApprovalTransition({
      queryClient,
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      messageId: 'plan-msg-1',
      nextExecutionMode: 'build',
      logContext: 'test',
    })

    expect(calls).toEqual([
      'mark_plan_approved',
      'update_session_state',
      'refresh_agent_board_items',
      'broadcast_session_setting',
      'broadcast_session_setting',
    ])
    expect(mockInvoke).toHaveBeenCalledWith('update_session_state', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      waitingForInput: false,
      waitingForInputType: null,
      selectedExecutionMode: 'build',
    })
    expect(queryClient.getQueryData(agentBoardQueryKeys.all)).toEqual(
      boardItems
    )
    expect(
      queryClient.getQueryData<Session>(chatQueryKeys.session('session-1'))
        ?.messages[0]?.plan_approved
    ).toBe(true)

    const store = useChatStore.getState()
    expect(store.activeToolCalls['session-1']).toBeUndefined()
    expect(store.streamingContentBlocks['session-1']).toBeUndefined()
    expect(store.reviewingSessions['session-1']).toBeUndefined()
    expect(store.waitingForInputSessionIds['session-1']).toBeUndefined()
    expect(store.pendingPlanMessageIds['session-1']).toBeUndefined()
    expect(store.executionModes['session-1']).toBe('build')
  })

  it('can clear waiting state without an approved message id', async () => {
    const queryClient = createQueryClient()
    const calls: string[] = []

    mockInvoke.mockImplementation((command: string) => {
      calls.push(command)
      return Promise.resolve([])
    })

    await completePlanApprovalTransition({
      queryClient,
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      messageId: null,
      logContext: 'test',
    })

    expect(mockMarkPlanApproved).not.toHaveBeenCalled()
    expect(calls).toEqual(['update_session_state', 'refresh_agent_board_items'])
    expect(mockInvoke).toHaveBeenCalledWith('update_session_state', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      waitingForInput: false,
      waitingForInputType: null,
    })
  })
})
