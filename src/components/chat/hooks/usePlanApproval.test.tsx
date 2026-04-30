import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentBoardQueryKeys } from '@/services/agent-board'
import { defaultPreferences } from '@/types/preferences'
import type * as ChatService from '@/services/chat'
import type { AgentBoardItem } from '@/types/agent-board'
import type { Session } from '@/types/chat'
import type { SessionCardData } from '../session-card-utils'
import { usePlanApproval } from './usePlanApproval'

const { mockInvoke, mockMarkPlanApproved, mockSendMessageMutate } = vi.hoisted(
  () => ({
    mockInvoke: vi.fn(),
    mockMarkPlanApproved: vi.fn(),
    mockSendMessageMutate: vi.fn(),
  })
)

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: defaultPreferences }),
}))

vi.mock('@/services/claude-cli', () => ({
  useClaudeCliStatus: () => ({ data: { version: '1.0.0' } }),
}))

vi.mock('@/services/chat', async importOriginal => {
  const actual = await importOriginal<typeof ChatService>()
  return {
    ...actual,
    markPlanApproved: (...args: unknown[]) => mockMarkPlanApproved(...args),
    useSendMessage: () => ({ mutate: mockSendMessageMutate }),
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
  Wrapper.displayName = 'UsePlanApprovalTestWrapper'
  return Wrapper
}

function planCard(): SessionCardData {
  return {
    session: {
      id: 'session-1',
      name: 'Session 1',
      order: 0,
      created_at: 1,
      updated_at: 1,
      backend: 'codex',
      messages: [],
    } as Session,
    status: 'waiting',
    automationName: null,
    isAutomation: false,
    executionMode: 'plan',
    isSending: false,
    isWaiting: true,
    hasExitPlanMode: true,
    hasQuestion: false,
    hasPermissionDenials: false,
    permissionDenialCount: 0,
    planFilePath: null,
    planContent: 'Plan',
    pendingPlanMessageId: 'plan-msg-1',
    hasRecap: false,
    recapDigest: null,
    label: null,
  }
}

describe('usePlanApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMarkPlanApproved.mockResolvedValue(undefined)
    mockInvoke.mockResolvedValue(undefined)
  })

  it('refreshes the agent board after approving a plan in yolo mode', async () => {
    const queryClient = createTestQueryClient()
    const boardItems: AgentBoardItem[] = [
      {
        id: 'item-1',
        title: 'Plan task',
        prompt: 'Plan task',
        project_id: 'project-1',
        backend: 'codex',
        lane: 'yoloing',
        worktree_id: 'worktree-1',
        planning_session_id: 'session-1',
        yolo_worktree_id: 'worktree-1',
        yolo_session_id: 'session-1',
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
        usePlanApproval({
          worktreeId: 'worktree-1',
          worktreePath: '/tmp/worktree-1',
        }),
      { wrapper: createWrapper(queryClient) }
    )

    act(() => {
      result.current.handlePlanApprovalYolo(planCard())
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('refresh_agent_board_items')
    })
    expect(queryClient.getQueryData(agentBoardQueryKeys.all)).toEqual(
      boardItems
    )
  })
})
