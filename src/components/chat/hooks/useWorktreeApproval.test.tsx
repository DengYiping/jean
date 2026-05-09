import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import { useChatStore } from '@/store/chat-store'
import type * as ChatService from '@/services/chat'
import type { Session, WorktreeSessions } from '@/types/chat'
import type { Worktree, WorktreeCreatedEvent } from '@/types/projects'
import type { SessionCardData } from '../session-card-utils'
import { useWorktreeApproval } from './useWorktreeApproval'

const {
  mockInvoke,
  mockListen,
  mockMarkPlanApproved,
  mockSendMessageMutate,
  mockPreferences,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
  mockMarkPlanApproved: vi.fn(),
  mockSendMessageMutate: vi.fn(),
  mockPreferences: { current: undefined as AppPreferences | undefined },
}))

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  listen: (...args: unknown[]) => mockListen(...args),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: mockPreferences.current }),
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
  Wrapper.displayName = 'UseWorktreeApprovalTestWrapper'
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
      backend: 'opencode',
      selected_model: 'opencode/gpt-5.3-codex',
      selected_provider: 'provider-b',
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
    planContent: 'Plan from card',
    pendingPlanMessageId: 'plan-msg-1',
    hasRecap: false,
    recapDigest: null,
    label: null,
  }
}

describe('useWorktreeApproval', () => {
  const pendingWorktree = {
    id: 'worktree-2',
    project_id: 'project-1',
    path: '/tmp/worktree-2-pending',
    branch: 'branch-2',
  } as Worktree
  const readyWorktree = {
    ...pendingWorktree,
    path: '/tmp/worktree-2',
  } as Worktree

  beforeEach(() => {
    vi.clearAllMocks()
    mockPreferences.current = {
      ...defaultPreferences,
      close_original_on_clear_context: true,
      removal_behavior: 'delete',
      build_thinking_level: 'ultrathink',
    } as AppPreferences
    mockMarkPlanApproved.mockResolvedValue(undefined)
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'create_worktree') {
        return Promise.resolve(pendingWorktree)
      }
      if (command === 'get_sessions') {
        return Promise.resolve({
          worktree_id: 'worktree-2',
          active_session_id: 'session-2',
          version: 1,
          sessions: [
            {
              id: 'session-2',
              name: 'Implementation',
              order: 0,
              created_at: 2,
              updated_at: 2,
              messages: [],
            },
          ],
        } as WorktreeSessions)
      }
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
    mockListen.mockImplementation(
      (
        event: string,
        handler: (event: { payload: WorktreeCreatedEvent }) => void
      ) => {
        if (event === 'worktree:created') {
          setTimeout(() => {
            handler({
              payload: {
                worktree: readyWorktree,
              },
            } as unknown as { payload: WorktreeCreatedEvent })
          }, 0)
        }
        return Promise.resolve(vi.fn())
      }
    )
    useChatStore.setState({
      activeWorktreePath: '/tmp/worktree-1',
      activeSessionIds: {},
      worktreePaths: {},
      userInitiatedSessionIds: {},
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

  it('creates a new worktree, sends the continuation there, preserves references, and closes the original', async () => {
    const queryClient = createTestQueryClient()

    const { result } = renderHook(
      () =>
        useWorktreeApproval({
          worktreeId: 'worktree-1',
          worktreePath: '/tmp/worktree-1',
          projectId: 'project-1',
        }),
      { wrapper: createWrapper(queryClient) }
    )

    await act(async () => {
      await result.current.handleWorktreeApproval?.(
        planCard(),
        undefined,
        'build'
      )
    })

    await waitFor(() => {
      expect(mockMarkPlanApproved).toHaveBeenCalledWith(
        'worktree-1',
        '/tmp/worktree-1',
        'session-1',
        'plan-msg-1'
      )
    })
    expect(mockInvoke).toHaveBeenCalledWith('create_worktree', {
      projectId: 'project-1',
    })
    expect(mockInvoke).toHaveBeenCalledWith('get_sessions', {
      worktreeId: 'worktree-2',
      worktreePath: '/tmp/worktree-2',
    })
    expect(mockSendMessageMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-2',
        worktreeId: 'worktree-2',
        worktreePath: '/tmp/worktree-2',
        executionMode: 'build',
        backend: 'opencode',
        model: 'opencode/gpt-5.3-codex',
        thinkingLevel: 'ultrathink',
        customProfileName: 'provider-b',
      })
    )
    const sendCall = mockSendMessageMutate.mock.calls[0]
    expect(sendCall).toBeDefined()
    const sentMessage = (sendCall?.[0] as { message: string }).message
    expect(sentMessage).toContain('Plan file: /tmp/plan.md')
    expect(sentMessage).toContain('<plan>\nPlan from card\n</plan>')
    expect(sentMessage).toContain(
      '[Skill: /skills/frontend-design/SKILL.md - Read and use this skill to guide your response]'
    )
    expect(sentMessage).toContain(
      '[Image attached: /tmp/screenshot.png - Use the Read tool to view this image]'
    )
    expect(sentMessage).toContain(
      '[Text file attached: /tmp/notes.txt - Use the Read tool to view this file]'
    )
    expect(mockInvoke).toHaveBeenCalledWith('close_session', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
    })
    expect(useChatStore.getState().activeSessionIds['worktree-2']).toBe(
      'session-2'
    )
    expect(useChatStore.getState().worktreePaths['worktree-2']).toBe(
      '/tmp/worktree-2'
    )
  })
})
