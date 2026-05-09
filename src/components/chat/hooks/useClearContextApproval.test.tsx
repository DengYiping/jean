import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chatQueryKeys } from '@/services/chat'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import { useChatStore } from '@/store/chat-store'
import type * as ChatService from '@/services/chat'
import type { Session, WorktreeSessions } from '@/types/chat'
import type { SessionCardData } from '../session-card-utils'
import { useClearContextApproval } from './useClearContextApproval'

const {
  mockInvoke,
  mockMarkPlanApproved,
  mockCreateSessionMutateAsync,
  mockSendMessageMutate,
  mockReadPlanFile,
  mockPreferences,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockMarkPlanApproved: vi.fn(),
  mockCreateSessionMutateAsync: vi.fn(),
  mockSendMessageMutate: vi.fn(),
  mockReadPlanFile: vi.fn(),
  mockPreferences: { current: undefined as AppPreferences | undefined },
}))

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: mockPreferences.current }),
}))

vi.mock('@/services/chat', async importOriginal => {
  const actual = await importOriginal<typeof ChatService>()
  return {
    ...actual,
    markPlanApproved: (...args: unknown[]) => mockMarkPlanApproved(...args),
    readPlanFile: (...args: unknown[]) => mockReadPlanFile(...args),
    useCreateSession: () => ({ mutateAsync: mockCreateSessionMutateAsync }),
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
  Wrapper.displayName = 'UseClearContextApprovalTestWrapper'
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
      selected_model: 'gpt-5.4',
      selected_provider: 'provider-a',
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
    planFilePath: '/tmp/plan.md',
    planContent: null,
    pendingPlanMessageId: 'plan-msg-1',
    hasRecap: false,
    recapDigest: null,
    label: null,
  }
}

describe('useClearContextApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferences.current = {
      ...defaultPreferences,
      close_original_on_clear_context: true,
      removal_behavior: 'archive',
      yolo_effort_level: 'medium',
    } as AppPreferences
    mockMarkPlanApproved.mockResolvedValue(undefined)
    mockReadPlanFile.mockResolvedValue('Plan from file')
    mockCreateSessionMutateAsync.mockResolvedValue({
      id: 'session-2',
      name: 'Session 2',
      order: 1,
      created_at: 2,
      updated_at: 2,
      messages: [],
    } as Session)
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'get_session') {
        return Promise.resolve({
          id: 'session-1',
          messages: [
            {
              role: 'user',
              content:
                '[Skill: /skills/frontend-design/SKILL.md - Read and use this skill to guide your response]\n[Image attached: /tmp/screenshot.png - Use the Read tool to view this image]\n[Text file attached: /tmp/notes.txt - Use the Read tool to view this file]',
            },
          ],
        } as Session)
      }
      if (command === 'refresh_agent_board_items') {
        return Promise.resolve([])
      }
      return Promise.resolve(undefined)
    })
    useChatStore.setState({
      activeSessionIds: {},
      activeToolCalls: {
        'session-1': [{ id: 'tool-1', name: 'ExitPlanMode', input: {} }],
      },
      streamingContentBlocks: {
        'session-1': [{ type: 'tool_use', tool_call_id: 'tool-1' }],
      },
      reviewingSessions: { 'session-1': true },
      waitingForInputSessionIds: { 'session-1': true },
      pendingPlanMessageIds: { 'session-1': 'plan-msg-1' },
    })
  })

  it('approves the original plan, creates a replacement session, reattaches references, and archives the original', async () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData<WorktreeSessions>(
      chatQueryKeys.sessions('worktree-1'),
      {
        worktree_id: 'worktree-1',
        active_session_id: 'session-1',
        version: 1,
        sessions: [
          { id: 'session-1', name: 'Original' },
          { id: 'session-2', name: 'Replacement' },
        ],
      } as WorktreeSessions
    )

    const { result } = renderHook(
      () =>
        useClearContextApproval({
          worktreeId: 'worktree-1',
          worktreePath: '/tmp/worktree-1',
        }),
      { wrapper: createWrapper(queryClient) }
    )

    await act(async () => {
      await result.current.handleClearContextApproval(planCard())
    })

    await waitFor(() => {
      expect(mockMarkPlanApproved).toHaveBeenCalledWith(
        'worktree-1',
        '/tmp/worktree-1',
        'session-1',
        'plan-msg-1'
      )
    })
    expect(mockCreateSessionMutateAsync).toHaveBeenCalledWith({
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
    })
    expect(mockInvoke).toHaveBeenCalledWith('update_session_state', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      waitingForInput: false,
      waitingForInputType: null,
    })
    expect(mockSendMessageMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-2',
        worktreeId: 'worktree-1',
        worktreePath: '/tmp/worktree-1',
        executionMode: 'yolo',
        backend: 'codex',
        model: 'gpt-5.4',
        effortLevel: 'medium',
        customProfileName: 'provider-a',
      })
    )
    const sendCall = mockSendMessageMutate.mock.calls[0]
    expect(sendCall).toBeDefined()
    const sentMessage = (sendCall?.[0] as { message: string }).message
    expect(sentMessage).toContain('Plan file: /tmp/plan.md')
    expect(sentMessage).toContain('<plan>\nPlan from file\n</plan>')
    expect(sentMessage).toContain(
      '[Skill: /skills/frontend-design/SKILL.md - Read and use this skill to guide your response]'
    )
    expect(sentMessage).toContain(
      '[Image attached: /tmp/screenshot.png - Use the Read tool to view this image]'
    )
    expect(sentMessage).toContain(
      '[Text file attached: /tmp/notes.txt - Use the Read tool to view this file]'
    )
    expect(mockInvoke).toHaveBeenCalledWith('archive_session', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
    })
    expect(
      queryClient.getQueryData<WorktreeSessions>(
        chatQueryKeys.sessions('worktree-1')
      )
    ).toMatchObject({
      active_session_id: 'session-2',
      sessions: [{ id: 'session-2', name: 'Replacement' }],
    })
  })
})
