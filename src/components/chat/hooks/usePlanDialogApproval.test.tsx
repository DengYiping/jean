import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentBoardQueryKeys } from '@/services/agent-board'
import { defaultPreferences } from '@/types/preferences'
import type { AgentBoardItem } from '@/types/agent-board'
import type * as ChatService from '@/services/chat'
import { usePlanDialogApproval } from './usePlanDialogApproval'

const { mockInvoke, mockMarkPlanApproved, mockPersistEnqueue } = vi.hoisted(
  () => ({
    mockInvoke: vi.fn(),
    mockMarkPlanApproved: vi.fn(),
    mockPersistEnqueue: vi.fn(),
  })
)

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: defaultPreferences }),
}))

vi.mock('@/services/chat', async importOriginal => {
  const actual = await importOriginal<typeof ChatService>()
  return {
    ...actual,
    markPlanApproved: (...args: unknown[]) => mockMarkPlanApproved(...args),
    persistEnqueue: (...args: unknown[]) => mockPersistEnqueue(...args),
  }
})

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  Wrapper.displayName = 'UsePlanDialogApprovalTestWrapper'
  return Wrapper
}

function ref<T>(current: T) {
  return { current }
}

describe('usePlanDialogApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkPlanApproved.mockResolvedValue(undefined)
    mockPersistEnqueue.mockResolvedValue(undefined)
  })

  it('refreshes the agent board after approving a plan', async () => {
    const queryClient = createTestQueryClient()
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
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'refresh_agent_board_items') {
        return Promise.resolve(boardItems)
      }
      return Promise.resolve(undefined)
    })

    const { result } = renderHook(
      () =>
        usePlanDialogApproval({
          activeSessionId: 'session-1',
          activeWorktreeId: 'worktree-1',
          activeWorktreePath: '/tmp/worktree-1',
          pendingPlanMessage: {
            id: 'plan-msg-1',
            session_id: 'session-1',
            role: 'assistant',
            content: 'Plan',
            timestamp: 1,
            tool_calls: [],
            plan_approved: false,
          },
          selectedModelRef: ref('gpt-5.5'),
          buildModelRef: ref(null),
          buildBackendRef: ref(null),
          buildThinkingLevelRef: ref(null),
          buildEffortLevelRef: ref(null),
          yoloModelRef: ref(null),
          yoloBackendRef: ref(null),
          yoloThinkingLevelRef: ref(null),
          yoloEffortLevelRef: ref(null),
          selectedProviderRef: ref(null),
          selectedThinkingLevelRef: ref('think'),
          selectedEffortLevelRef: ref('high'),
          useAdaptiveThinkingRef: ref(true),
          isCodexBackendRef: ref(true),
          mcpServersDataRef: ref([]),
          enabledMcpServersRef: ref([]),
          selectedBackendRef: ref('codex'),
          markAtBottom: vi.fn(),
        }),
      { wrapper: createWrapper(queryClient) }
    )

    act(() => {
      result.current.handlePlanDialogApprove('Plan')
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('refresh_agent_board_items')
    })
    expect(queryClient.getQueryData(agentBoardQueryKeys.all)).toEqual(
      boardItems
    )
  })
})
