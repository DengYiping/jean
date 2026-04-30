import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentBoardQueryKeys,
  setCachedAgentBoardSessionRunStatus,
  useDeleteAgentBoardItem,
  useMoveAgentBoardItem,
} from '@/services/agent-board'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import type { AgentBoardItem } from '@/types/agent-board'
import type {
  Session,
  UnreadSessionsResponse,
  WorktreeSessions,
} from '@/types/chat'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  Wrapper.displayName = 'TestQueryClientWrapper'
  return Wrapper
}

function todoItem(): AgentBoardItem {
  return {
    id: 'item-1',
    title: 'Plan work',
    prompt: 'Plan work',
    project_id: 'project-1',
    backend: 'codex',
    effort_level: 'high',
    lane: 'todo',
    created_at: 1,
    updated_at: 1,
  }
}

describe('agent board service', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = createTestQueryClient()
    vi.clearAllMocks()
    useChatStore.setState({
      waitingForInputSessionIds: {},
      executionModes: {},
    })
  })

  it('optimistically moves a card while the backend lane side effects are pending', async () => {
    const { invoke } = await import('@/lib/transport')
    const item = todoItem()
    queryClient.setQueryData(agentBoardQueryKeys.all, [item])

    let resolveMove!: (item: AgentBoardItem) => void
    vi.mocked(invoke).mockReturnValue(
      new Promise<AgentBoardItem>(resolve => {
        resolveMove = resolve
      })
    )

    const { result } = renderHook(() => useMoveAgentBoardItem(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ itemId: item.id, lane: 'planning' })
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<AgentBoardItem[]>(agentBoardQueryKeys.all)?.[0]
          ?.lane
      ).toBe('planning')
    })

    resolveMove({ ...item, lane: 'planning' })
  })

  it('merges backend-created planning session ids after moving to planning', async () => {
    const { invoke } = await import('@/lib/transport')
    const item = todoItem()
    queryClient.setQueryData(agentBoardQueryKeys.all, [item])

    vi.mocked(invoke).mockResolvedValue({
      ...item,
      lane: 'planning',
      worktree_id: 'worktree-1',
      planning_session_id: 'session-1',
      updated_at: 2,
    })

    const { result } = renderHook(() => useMoveAgentBoardItem(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ itemId: item.id, lane: 'planning' })
    })

    await waitFor(() => {
      const updatedItem = queryClient.getQueryData<AgentBoardItem[]>(
        agentBoardQueryKeys.all
      )?.[0]
      expect(updatedItem?.lane).toBe('planning')
      expect(updatedItem?.worktree_id).toBe('worktree-1')
      expect(updatedItem?.planning_session_id).toBe('session-1')
    })
  })

  it('updates cached board run status for matching sessions', () => {
    const item = {
      ...todoItem(),
      lane: 'implementing' as const,
      implementation_session_id: 'session-1',
      active_run_status: 'running' as const,
    }
    queryClient.setQueryData(agentBoardQueryKeys.all, [item])

    setCachedAgentBoardSessionRunStatus(queryClient, 'session-1', 'cancelled')

    expect(
      queryClient.getQueryData<AgentBoardItem[]>(agentBoardQueryKeys.all)?.[0]
        ?.active_run_status
    ).toBe('cancelled')
  })

  it('removes a deleted archived board item from cache', async () => {
    const { invoke } = await import('@/lib/transport')
    const item = {
      ...todoItem(),
      lane: 'archived' as const,
      archived_at: 2,
    }
    queryClient.setQueryData(agentBoardQueryKeys.all, [item])
    vi.mocked(invoke).mockResolvedValue(null)

    const { result } = renderHook(() => useDeleteAgentBoardItem(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate('item-1')
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<AgentBoardItem[]>(agentBoardQueryKeys.all)
      ).toEqual([])
    })
  })

  it('clears the planned session attention state when moving to implementing', async () => {
    const { invoke } = await import('@/lib/transport')
    const session: Session = {
      id: 'session-1',
      name: 'Session 1',
      order: 0,
      created_at: 1,
      updated_at: 10,
      messages: [
        {
          id: 'plan-msg-1',
          session_id: 'session-1',
          role: 'assistant',
          content: 'Plan',
          timestamp: 10,
          tool_calls: [],
          plan_approved: false,
        },
      ],
      approved_plan_message_ids: [],
      waiting_for_input: true,
      waiting_for_input_type: 'plan',
      pending_plan_message_id: 'plan-msg-1',
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
        latest_activity_at: 10,
        is_unread: true,
      },
    }
    const item: AgentBoardItem = {
      ...todoItem(),
      lane: 'planned',
      planning_session_id: session.id,
    }
    queryClient.setQueryData(agentBoardQueryKeys.all, [item])
    queryClient.setQueryData<WorktreeSessions>(chatQueryKeys.sessions('wt-1'), {
      worktree_id: 'wt-1',
      sessions: [session],
      active_session_id: session.id,
      version: 1,
    })
    queryClient.setQueryData<UnreadSessionsResponse>(
      chatQueryKeys.unreadSessions(),
      {
        entries: [
          {
            session,
            project_id: 'project-1',
            project_name: 'Project',
            worktree_id: 'wt-1',
            worktree_name: 'Worktree',
            worktree_path: '/tmp/worktree',
          },
        ],
      }
    )
    queryClient.setQueryData(chatQueryKeys.unreadCount(), 1)
    useChatStore.getState().setWaitingForInput(session.id, true)

    vi.mocked(invoke).mockReturnValue(
      new Promise<AgentBoardItem>(() => undefined)
    )

    const { result } = renderHook(() => useMoveAgentBoardItem(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ itemId: item.id, lane: 'implementing' })
    })

    await waitFor(() => {
      const updatedSession = queryClient.getQueryData<WorktreeSessions>(
        chatQueryKeys.sessions('wt-1')
      )?.sessions[0]
      expect(updatedSession?.waiting_for_input).toBe(false)
      expect(updatedSession?.approved_plan_message_ids).toEqual(['plan-msg-1'])
      expect(updatedSession?.messages[0]?.plan_approved).toBe(true)
      expect(updatedSession?.session_derived_state?.is_waiting).toBe(false)
      expect(updatedSession?.session_derived_state?.is_unread).toBe(false)
      expect(
        useChatStore.getState().waitingForInputSessionIds
      ).not.toHaveProperty(session.id)
      expect(
        queryClient.getQueryData<UnreadSessionsResponse>(
          chatQueryKeys.unreadSessions()
        )?.entries
      ).toEqual([])
      expect(queryClient.getQueryData(chatQueryKeys.unreadCount())).toBe(0)
    })
  })

  it('marks associated sessions read when moving between lanes', async () => {
    const { invoke } = await import('@/lib/transport')
    const session: Session = {
      id: 'session-1',
      name: 'Session 1',
      order: 0,
      created_at: 1,
      updated_at: 10,
      messages: [],
      session_derived_state: {
        status: 'completed',
        effective_execution_mode: 'build',
        is_waiting: false,
        waiting_type: null,
        has_question: false,
        has_exit_plan: false,
        pending_plan_message_id: null,
        plan_file_path: null,
        plan_content: null,
        permission_denial_count: 0,
        has_recap: false,
        latest_activity_at: 10,
        is_unread: true,
      },
    }
    const item: AgentBoardItem = {
      ...todoItem(),
      lane: 'implemented',
      implementation_session_id: session.id,
    }
    queryClient.setQueryData(agentBoardQueryKeys.all, [item])
    queryClient.setQueryData<WorktreeSessions>(chatQueryKeys.sessions('wt-1'), {
      worktree_id: 'wt-1',
      sessions: [session],
      active_session_id: session.id,
      version: 1,
    })
    queryClient.setQueryData<UnreadSessionsResponse>(
      chatQueryKeys.unreadSessions(),
      {
        entries: [
          {
            session,
            project_id: 'project-1',
            project_name: 'Project',
            worktree_id: 'wt-1',
            worktree_name: 'Worktree',
            worktree_path: '/tmp/worktree',
          },
        ],
      }
    )
    queryClient.setQueryData(chatQueryKeys.unreadCount(), 1)

    vi.mocked(invoke).mockReturnValue(
      new Promise<AgentBoardItem>(() => undefined)
    )

    const { result } = renderHook(() => useMoveAgentBoardItem(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ itemId: item.id, lane: 'pr_opened' })
    })

    await waitFor(() => {
      const updatedSession = queryClient.getQueryData<WorktreeSessions>(
        chatQueryKeys.sessions('wt-1')
      )?.sessions[0]
      expect(updatedSession?.last_opened_at).toBeDefined()
      expect(updatedSession?.session_derived_state?.is_unread).toBe(false)
      expect(
        queryClient.getQueryData<UnreadSessionsResponse>(
          chatQueryKeys.unreadSessions()
        )?.entries
      ).toEqual([])
      expect(queryClient.getQueryData(chatQueryKeys.unreadCount())).toBe(0)
    })
  })
})
