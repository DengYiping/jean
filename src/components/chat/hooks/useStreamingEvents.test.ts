import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { chatQueryKeys } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { preferencesQueryKeys } from '@/services/preferences'
import { defaultPreferences } from '@/types/preferences'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import type * as ProjectsService from '@/services/projects'
import { shouldPlayPermissionApprovalSound } from './useStreamingEvents'
import useStreamingEvents from './useStreamingEvents'
import type { PermissionDenial } from '@/types/chat'

const { mockInvoke, mockListen, mockToastInfo, mockPlayNotificationSound } =
  vi.hoisted(() => ({
    mockInvoke: vi.fn().mockResolvedValue(undefined),
    mockListen: vi.fn(),
    mockToastInfo: vi.fn(),
    mockPlayNotificationSound: vi.fn(),
  }))

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  listen: (...args: unknown[]) => mockListen(...args),
  useWsConnectionStatus: vi.fn(() => true),
}))

vi.mock('sonner', () => ({
  toast: {
    info: mockToastInfo,
  },
}))

vi.mock('@/lib/sounds', () => ({
  playNotificationSound: mockPlayNotificationSound,
}))

vi.mock('@/services/projects', async importOriginal => {
  const actual = await importOriginal<typeof ProjectsService>()
  return {
    ...actual,
    isTauri: vi.fn(() => true),
    saveWorktreePr: vi.fn(),
  }
})

function createDenial(toolUseId: string): PermissionDenial {
  return {
    tool_name: 'Bash',
    tool_use_id: toolUseId,
    tool_input: { command: 'echo test' },
  }
}

function createAskUserQuestionToolCall() {
  return {
    id: 'tool-question',
    name: 'AskUserQuestion',
    input: {
      questions: [
        {
          question: 'Need approval?',
          multiSelect: false,
          options: [{ label: 'Yes' }, { label: 'No' }],
        },
      ],
    },
  }
}

function createTestQueryClient(): QueryClient {
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
  Wrapper.displayName = 'UseStreamingEventsTestWrapper'
  return Wrapper
}

function resetStores() {
  useChatStore.setState({
    activeWorktreeId: null,
    activeWorktreePath: null,
    activeSessionIds: {},
    reviewResults: {},
    reviewSidebarVisible: false,
    fixedReviewFindings: {},
    worktreePaths: {},
    sendingSessionIds: {},
    sendStartedAt: {},
    waitingForInputSessionIds: {},
    sessionWorktreeMap: {},
    streamingContents: {},
    activeToolCalls: {},
    streamingContentBlocks: {},
    streamingThinkingContent: {},
    inputDrafts: {},
    executionModes: {},
    thinkingLevels: {},
    effortLevels: {},
    selectedBackends: {},
    selectedModels: {},
    selectedProviders: {},
    enabledMcpServers: {},
    parallelExecutionPromptEnabledBySession: {},
    answeredQuestions: {},
    submittedAnswers: {},
    errors: {},
    lastSentMessages: {},
    lastSentAttachments: {},
    setupScriptResults: {},
    pendingImages: {},
    pendingFiles: {},
    pendingSkills: {},
    pendingTextFiles: {},
    activeTodos: {},
    streamingPlanApprovals: {},
    messageQueues: {},
    executingModes: {},
    approvedTools: {},
    pendingPermissionDenials: {},
    deniedMessageContext: {},
    lastCompaction: {},
    threadTokenUsage: {},
    compactingSessions: {},
    reviewingSessions: {},
    planFilePaths: {},
    pendingPlanMessageIds: {},
    savingContext: {},
    skippedQuestionSessions: {},
    pendingDigestSessionIds: {},
    sessionDigests: {},
    worktreeLoadingOperations: {},
    sessionLabels: {},
    pendingMagicCommand: null,
    userInitiatedSessionIds: {},
    completedDurations: {},
  })

  useUIStore.setState({
    sessionChatModalOpen: false,
    sessionChatModalWorktreeId: null,
    loadContextModalOpen: false,
    magicModalOpen: false,
    openInModalOpen: false,
    newWorktreeModalOpen: false,
    commandPaletteOpen: false,
    preferencesOpen: false,
    releaseNotesModalOpen: false,
    updatePrModalOpen: false,
    planDialogOpen: false,
    gitDiffModalOpen: false,
    githubDashboardOpen: false,
  })
}

type RegisteredHandler = (event: { payload: unknown }) => void

function seedSessionCaches(queryClient: QueryClient) {
  queryClient.setQueryData(preferencesQueryKeys.preferences(), {
    ...defaultPreferences,
    waiting_sound: 'choochoo',
  })
  queryClient.setQueryData(projectsQueryKeys.list(), [
    { id: 'project-1', name: 'Project Alpha' },
  ])
  queryClient.setQueryData(projectsQueryKeys.worktrees('project-1'), [
    { id: 'worktree-1', project_id: 'project-1', name: 'Feature Branch' },
  ])
  queryClient.setQueryData(chatQueryKeys.sessions('worktree-1'), {
    worktree_id: 'worktree-1',
    sessions: [
      {
        id: 'session-1',
        name: 'Codex Session',
        order: 0,
        created_at: 1,
        updated_at: 1,
        messages: [],
      },
    ],
    active_session_id: 'session-1',
    version: 1,
  })
  queryClient.setQueryData(chatQueryKeys.session('session-1'), {
    id: 'session-1',
    name: 'Codex Session',
    order: 0,
    created_at: 1,
    updated_at: 1,
    messages: [],
  })
}

async function setupHook() {
  const handlers = new Map<string, RegisteredHandler>()
  mockListen.mockImplementation((event: string, handler: RegisteredHandler) => {
    handlers.set(event, handler)
    return Promise.resolve(() => {
      handlers.delete(event)
    })
  })

  const queryClient = createTestQueryClient()
  seedSessionCaches(queryClient)
  const wrapper = createWrapper(queryClient)
  const rendered = renderHook(() => useStreamingEvents({ queryClient }), {
    wrapper,
  })

  await waitFor(() => expect(mockListen).toHaveBeenCalled())

  return { handlers, queryClient, ...rendered }
}

describe('shouldPlayPermissionApprovalSound', () => {
  it('plays when the first pending approval arrives', () => {
    expect(
      shouldPlayPermissionApprovalSound(undefined, [createDenial('tool-1')])
    ).toBe(true)
  })

  it('does not play when there are no pending approvals', () => {
    expect(shouldPlayPermissionApprovalSound(undefined, [])).toBe(false)
  })

  it('does not replay while approvals are already pending', () => {
    expect(
      shouldPlayPermissionApprovalSound(
        [createDenial('tool-1')],
        [createDenial('tool-1'), createDenial('tool-2')]
      )
    ).toBe(false)
  })
})

describe('useStreamingEvents question notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetStores()
  })

  it('shows a question toast with the unread shortcut and plays the waiting sound for unfocused sessions', async () => {
    useChatStore.setState({
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      activeToolCalls: { 'session-1': [createAskUserQuestionToolCall()] },
      streamingContents: {
        'session-1': 'Need approval?',
      },
    })

    const { handlers, unmount } = await setupHook()
    const unreadSpy = vi.fn()
    window.addEventListener('command:open-unread-sessions', unreadSpy)

    await act(async () => {
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    const title = mockToastInfo.mock.calls[0]?.[0]
    const options = mockToastInfo.mock.calls[0]?.[1] as
      | {
          description?: string
          action?: { onClick: () => void }
        }
      | undefined
    expect(options).toBeDefined()
    expect(title).toBe('Question waiting for input')
    expect(options?.description).toContain(
      'Project Alpha / Feature Branch / Codex Session is waiting for your answer.'
    )
    expect(options?.description).toContain('Open unread sessions with')
    expect(options?.action).toBeDefined()

    act(() => {
      options?.action?.onClick()
    })
    expect(unreadSpy).toHaveBeenCalledTimes(1)

    window.removeEventListener('command:open-unread-sessions', unreadSpy)
    unmount()
  })

  it('does not show the question toast when the session is open in full view', async () => {
    useChatStore.setState({
      activeWorktreeId: 'worktree-1',
      activeSessionIds: { 'worktree-1': 'session-1' },
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      activeToolCalls: { 'session-1': [createAskUserQuestionToolCall()] },
      streamingContents: {
        'session-1': 'Need approval?',
      },
    })

    const { handlers, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(mockToastInfo).not.toHaveBeenCalled()
    unmount()
  })

  it('does not show the question toast when the session is open in a modal view', async () => {
    useChatStore.setState({
      activeSessionIds: { 'worktree-1': 'session-1' },
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      activeToolCalls: { 'session-1': [createAskUserQuestionToolCall()] },
      streamingContents: {
        'session-1': 'Need approval?',
      },
    })
    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'worktree-1',
    })

    const { handlers, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(mockToastInfo).not.toHaveBeenCalled()
    unmount()
  })

  it('does not show the question toast for plan waits', async () => {
    useChatStore.setState({
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      activeToolCalls: {
        'session-1': [
          {
            id: 'tool-plan',
            name: 'ExitPlanMode',
            input: { plan: '- [ ] Test' },
          },
        ],
      },
      streamingContents: {
        'session-1': 'Plan ready',
      },
    })

    const { handlers, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(mockToastInfo).not.toHaveBeenCalled()
    unmount()
  })

  it('shows the unread shortcut toast for permission-denied flows when unfocused', async () => {
    const { handlers, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:permission_denied')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          denials: [createDenial('tool-1')],
        },
      })
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    const title = mockToastInfo.mock.calls[0]?.[0]
    const options = mockToastInfo.mock.calls[0]?.[1] as
      | { description?: string }
      | undefined
    expect(title).toBe('Permission needed')
    expect(options?.description).toContain(
      'Project Alpha / Feature Branch / Codex Session is waiting for your permission.'
    )
    expect(options?.description).toContain('Open unread sessions with')
    unmount()
  })
})
