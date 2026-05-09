import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { agentBoardQueryKeys } from '@/services/agent-board'
import {
  DEFAULT_PARALLEL_EXECUTION_PROMPT,
  defaultPreferences,
  type AppPreferences,
} from '@/types/preferences'
import { useChatStore } from '@/store/chat-store'
import type * as ChatService from '@/services/chat'
import type { AgentBoardItem } from '@/types/agent-board'
import type { Session } from '@/types/chat'
import type { SessionCardData } from '../session-card-utils'
import { usePlanApproval } from './usePlanApproval'

const {
  mockInvoke,
  mockMarkPlanApproved,
  mockSendMessageMutate,
  mockPreferences,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockMarkPlanApproved: vi.fn(),
  mockSendMessageMutate: vi.fn(),
  mockPreferences: { current: undefined as AppPreferences | undefined },
}))

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: mockPreferences.current }),
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
    mockPreferences.current = defaultPreferences
    useChatStore.setState({
      parallelExecutionPromptEnabledBySession: {},
    })
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

  it('passes the per-session parallel execution prompt when approving a plan', async () => {
    useChatStore.setState({
      parallelExecutionPromptEnabledBySession: {
        'session-1': true,
      },
    })

    const queryClient = createTestQueryClient()
    const { result } = renderHook(
      () =>
        usePlanApproval({
          worktreeId: 'worktree-1',
          worktreePath: '/tmp/worktree-1',
        }),
      { wrapper: createWrapper(queryClient) }
    )

    act(() => {
      result.current.handlePlanApproval(planCard())
    })

    await waitFor(() => {
      expect(mockSendMessageMutate).toHaveBeenCalled()
    })

    expect(mockSendMessageMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        executionMode: 'build',
        parallelExecutionPrompt: DEFAULT_PARALLEL_EXECUTION_PROMPT,
      })
    )
  })

  it('does not apply build overrides configured for a different backend', async () => {
    mockPreferences.current = {
      ...defaultPreferences,
      default_backend: 'codex',
      selected_model: 'sonnet',
      build_backend: 'claude',
      build_model: 'claude-opus-4-7',
      build_thinking_level: 'ultrathink',
      build_effort_level: 'max',
      thinking_level: 'think',
      default_effort_level: 'medium',
    } as AppPreferences

    const queryClient = createTestQueryClient()
    const { result } = renderHook(
      () =>
        usePlanApproval({
          worktreeId: 'worktree-1',
          worktreePath: '/tmp/worktree-1',
        }),
      { wrapper: createWrapper(queryClient) }
    )

    act(() => {
      result.current.handlePlanApproval(planCard())
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'update_session_state',
        expect.objectContaining({
          selectedExecutionMode: 'build',
        })
      )
    })
    await waitFor(() => {
      expect(mockSendMessageMutate).toHaveBeenCalled()
    })

    expect(mockSendMessageMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: 'codex',
        executionMode: 'build',
        model: 'sonnet',
        thinkingLevel: 'think',
        effortLevel: 'medium',
      })
    )
    expect(mockSendMessageMutate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-opus-4-7',
      })
    )
  })
})
