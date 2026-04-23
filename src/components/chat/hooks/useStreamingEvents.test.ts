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
import type { CodexMcpElicitation, PermissionDenial } from '@/types/chat'

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

function createCodexDenial(toolUseId: string, rpcId = 42): PermissionDenial {
  return {
    ...createDenial(toolUseId),
    rpc_id: rpcId,
  }
}

function createCodexMcpElicitation(
  rpcId = 42,
  overrides: Partial<CodexMcpElicitation> = {}
): CodexMcpElicitation {
  return {
    rpc_id: rpcId,
    thread_id: 'thread-1',
    turn_id: 'turn-1',
    server_name: 'devex-mcp-server',
    message:
      'Allow the devex-mcp-server MCP server to run tool "list_ij_projects"?',
    requested_schema: {
      type: 'object',
      properties: {},
    },
    metadata: {
      codex_approval_kind: 'mcp_tool_call',
      tool_description: 'List all IntelliJ IDEA projects',
    },
    ...overrides,
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
    draftSkillBindings: {},
    pendingTextFiles: {},
    activeTodos: {},
    streamingPlanApprovals: {},
    messageQueues: {},
    executingModes: {},
    approvedTools: {},
    pendingPermissionDenials: {},
    pendingCodexMcpElicitations: {},
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
    review_sound: 'choochoo',
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
  queryClient.setQueryData(['all-sessions'], {
    entries: [
      {
        project_id: 'project-1',
        project_name: 'Project Alpha',
        worktree_id: 'worktree-1',
        worktree_name: 'Feature Branch',
        worktree_path: '/tmp/worktree-1',
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
      },
    ],
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

  it('writes request_user_input waits into caches immediately on tool_use', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_worktree') {
        return Promise.resolve({ path: '/tmp/worktree-1' })
      }
      return Promise.resolve(undefined)
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:tool_use')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
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
            rpcId: 123,
          },
        },
      })
      await Promise.resolve()
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      id: 'session-1',
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      is_reviewing: false,
      updated_at: expect.any(Number),
    })
    expect(queryClient.getQueryData(['all-sessions'])).toMatchObject({
      entries: [
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              id: 'session-1',
              waiting_for_input: true,
              waiting_for_input_type: 'question',
              is_reviewing: false,
              updated_at: expect.any(Number),
            }),
          ],
        }),
      ],
    })
    expect(mockInvoke).toHaveBeenCalledWith('get_worktree', {
      worktreeId: 'worktree-1',
    })
    expect(mockInvoke).toHaveBeenCalledWith('update_session_state', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      waitingForInput: true,
      waitingForInputType: 'question',
      isReviewing: false,
    })
    unmount()
  })

  it('writes question waits into session, worktree, and unread caches for unfocused sessions', async () => {
    useChatStore.setState({
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      activeToolCalls: { 'session-1': [createAskUserQuestionToolCall()] },
      streamingContents: {
        'session-1': 'Need approval?',
      },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(mockToastInfo).not.toHaveBeenCalled()
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      id: 'session-1',
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      last_run_status: 'resumable',
      is_reviewing: false,
    })
    expect(
      queryClient.getQueryData(chatQueryKeys.sessions('worktree-1'))
    ).toMatchObject({
      sessions: [
        expect.objectContaining({
          id: 'session-1',
          waiting_for_input: true,
          waiting_for_input_type: 'question',
          last_run_status: 'resumable',
          is_reviewing: false,
        }),
      ],
    })
    expect(queryClient.getQueryData(['all-sessions'])).toMatchObject({
      entries: [
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              id: 'session-1',
              waiting_for_input: true,
              waiting_for_input_type: 'question',
              last_run_status: 'resumable',
              is_reviewing: false,
            }),
          ],
        }),
      ],
    })
    expect(mockInvoke).toHaveBeenCalledWith('update_session_state', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      waitingForInput: true,
      waitingForInputType: 'question',
    })
    unmount()
  })

  it('marks in-view question waits as opened immediately in full view', async () => {
    useChatStore.setState({
      activeWorktreeId: 'worktree-1',
      activeSessionIds: { 'worktree-1': 'session-1' },
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      activeToolCalls: { 'session-1': [createAskUserQuestionToolCall()] },
      streamingContents: {
        'session-1': 'Need approval?',
      },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(mockToastInfo).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith('set_session_last_opened', {
      sessionId: 'session-1',
    })
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      id: 'session-1',
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      last_run_status: 'resumable',
      is_reviewing: false,
    })
    unmount()
  })

  it('marks in-view question waits as opened immediately in modal view', async () => {
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

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(mockToastInfo).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith('set_session_last_opened', {
      sessionId: 'session-1',
    })
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      id: 'session-1',
      waiting_for_input: true,
      waiting_for_input_type: 'question',
      last_run_status: 'resumable',
      is_reviewing: false,
    })
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

  it('does not show a permission toast for permission-denied flows', async () => {
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
    expect(mockToastInfo).not.toHaveBeenCalled()
    unmount()
  })

  it('auto-approves codex permission requests when the session is already in yolo', async () => {
    useChatStore.setState({
      executionModes: { 'session-1': 'yolo' },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:permission_denied')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          denials: [createCodexDenial('tool-1')],
        },
      })
      await Promise.resolve()
    })

    expect(mockInvoke).toHaveBeenCalledWith('approve_codex_command', {
      sessionId: 'session-1',
      rpcId: 42,
      decision: 'accept',
    })
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).not.toHaveProperty('waiting_for_input')
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).not.toHaveProperty('pending_permission_denials')
    expect(
      useChatStore.getState().pendingPermissionDenials['session-1']
    ).toBeUndefined()
    unmount()
  })

  it('writes permission waits into session, worktree, and unread caches immediately', async () => {
    useChatStore.setState({
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      lastSentMessages: { 'session-1': 'run the command' },
      selectedModels: { 'session-1': 'gpt-5.4' },
      executionModes: { 'session-1': 'build' },
      thinkingLevels: { 'session-1': 'think' },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:permission_denied')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          denials: [createDenial('tool-1')],
        },
      })
    })

    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      waiting_for_input: true,
      waiting_for_input_type: null,
      is_reviewing: false,
      updated_at: expect.any(Number),
      pending_permission_denials: [createDenial('tool-1')],
    })
    expect(
      queryClient.getQueryData(chatQueryKeys.sessions('worktree-1'))
    ).toMatchObject({
      sessions: [
        expect.objectContaining({
          id: 'session-1',
          waiting_for_input: true,
          waiting_for_input_type: null,
          updated_at: expect.any(Number),
          pending_permission_denials: [createDenial('tool-1')],
        }),
      ],
    })
    expect(queryClient.getQueryData(['all-sessions'])).toMatchObject({
      entries: [
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              id: 'session-1',
              waiting_for_input: true,
              waiting_for_input_type: null,
              updated_at: expect.any(Number),
              pending_permission_denials: [createDenial('tool-1')],
            }),
          ],
        }),
      ],
    })
    const updatedSession = queryClient.getQueryData<{
      updated_at: number
      last_opened_at?: number
    }>(chatQueryKeys.session('session-1'))
    expect(updatedSession?.updated_at).toBeGreaterThan(1)
    expect(updatedSession?.last_opened_at).toBeUndefined()
    expect(mockInvoke).toHaveBeenCalledWith('update_session_state', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      pendingPermissionDenials: [createDenial('tool-1')],
      deniedMessageContext: {
        message: 'run the command',
        model: 'gpt-5.4',
        thinking_level: 'think',
      },
      waitingForInput: true,
      waitingForInputType: null,
      isReviewing: false,
    })
    unmount()
  })

  it('marks in-view permission requests as opened immediately', async () => {
    useChatStore.setState({
      activeWorktreeId: 'worktree-1',
      activeSessionIds: { 'worktree-1': 'session-1' },
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      lastSentMessages: { 'session-1': 'run the command' },
      selectedModels: { 'session-1': 'gpt-5.4' },
      executionModes: { 'session-1': 'build' },
      thinkingLevels: { 'session-1': 'think' },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:permission_denied')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          denials: [createDenial('tool-1')],
        },
      })
    })

    expect(mockToastInfo).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith('set_session_last_opened', {
      sessionId: 'session-1',
    })
    expect(
      queryClient.getQueryData<{ last_opened_at?: number }>(
        chatQueryKeys.session('session-1')
      )?.last_opened_at
    ).toEqual(expect.any(Number))
    unmount()
  })

  it('keeps permission waits in the unread path when chat:done arrives after denial', async () => {
    useChatStore.setState({
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      lastSentMessages: { 'session-1': 'run the command' },
      selectedModels: { 'session-1': 'gpt-5.4' },
      executionModes: { 'session-1': 'build' },
      thinkingLevels: { 'session-1': 'think' },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:permission_denied')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          denials: [createDenial('tool-1')],
        },
      })
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      waiting_for_input: true,
      waiting_for_input_type: null,
      last_run_status: 'resumable',
      is_reviewing: false,
      pending_permission_denials: [createDenial('tool-1')],
    })
    expect(queryClient.getQueryData(['all-sessions'])).toMatchObject({
      entries: [
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              id: 'session-1',
              waiting_for_input: true,
              waiting_for_input_type: null,
              last_run_status: 'resumable',
              pending_permission_denials: [createDenial('tool-1')],
            }),
          ],
        }),
      ],
    })
    unmount()
  })

  it('keeps earlier codex approvals visible when a later denial resolves first', async () => {
    useChatStore.setState({
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      lastSentMessages: { 'session-1': 'run the command' },
      selectedModels: { 'session-1': 'gpt-5.4' },
      executionModes: { 'session-1': 'build' },
      thinkingLevels: { 'session-1': 'off' },
      activeToolCalls: {
        'session-1': [
          { id: 'tool-1', name: 'Bash', input: { command: 'echo one' } },
          { id: 'tool-2', name: 'Bash', input: { command: 'echo two' } },
        ],
      },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:permission_denied')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          denials: [createCodexDenial('tool-1', 36)],
        },
      })
      handlers.get('chat:permission_denied')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          denials: [createCodexDenial('tool-2', 37)],
        },
      })
      handlers.get('chat:tool_result')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          tool_use_id: 'tool-2',
          output: 'done',
        },
      })
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
      await Promise.resolve()
    })

    expect(
      useChatStore.getState().pendingPermissionDenials['session-1']
    ).toEqual([createCodexDenial('tool-1', 36)])
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      pending_permission_denials: [createCodexDenial('tool-1', 36)],
      waiting_for_input: true,
      waiting_for_input_type: null,
    })
    unmount()
  })

  it('writes codex MCP elicitation waits into session, worktree, and unread caches immediately', async () => {
    useChatStore.setState({
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      selectedModels: { 'session-1': 'gpt-5.4' },
      executionModes: { 'session-1': 'build' },
      thinkingLevels: { 'session-1': 'off' },
    })

    const { handlers, queryClient, unmount } = await setupHook()
    const elicitation = createCodexMcpElicitation()

    await act(async () => {
      handlers.get('chat:codex_mcp_elicitation_request')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          elicitation,
        },
      })
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      waiting_for_input: true,
      waiting_for_input_type: null,
      is_reviewing: false,
      pending_codex_mcp_elicitations: [elicitation],
    })
    expect(
      queryClient.getQueryData(chatQueryKeys.sessions('worktree-1'))
    ).toMatchObject({
      sessions: [
        expect.objectContaining({
          id: 'session-1',
          waiting_for_input: true,
          waiting_for_input_type: null,
          pending_codex_mcp_elicitations: [elicitation],
        }),
      ],
    })
    expect(queryClient.getQueryData(['all-sessions'])).toMatchObject({
      entries: [
        expect.objectContaining({
          sessions: [
            expect.objectContaining({
              id: 'session-1',
              waiting_for_input: true,
              waiting_for_input_type: null,
              pending_codex_mcp_elicitations: [elicitation],
            }),
          ],
        }),
      ],
    })
    expect(mockInvoke).toHaveBeenCalledWith('update_session_state', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      pendingCodexMcpElicitations: [elicitation],
      waitingForInput: true,
      waitingForInputType: null,
      isReviewing: false,
    })
    expect(
      useChatStore.getState().pendingCodexMcpElicitations['session-1']
    ).toEqual([elicitation])
    unmount()
  })

  it('plays the review sound for successful completion', async () => {
    useChatStore.setState({
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      streamingContents: {
        'session-1': 'Finished successfully',
      },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:done')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
        },
      })
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      last_run_status: 'completed',
      waiting_for_input: false,
      is_reviewing: true,
    })
    unmount()
  })

  it('plays the waiting sound for failed runs', async () => {
    useChatStore.setState({
      sessionWorktreeMap: { 'session-1': 'worktree-1' },
      lastSentMessages: { 'session-1': 'please run this' },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:error')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          error: 'boom',
        },
      })
      await Promise.resolve()
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      last_run_status: 'crashed',
    })
    unmount()
  })

  it('plays the waiting sound for cancelled runs', async () => {
    useChatStore.setState({
      sessionWorktreeMap: { 'session-1': 'worktree-1' },
      worktreePaths: { 'worktree-1': '/tmp/worktree-1' },
      sendStartedAt: { 'session-1': 1 },
      lastSentMessages: { 'session-1': 'please run this' },
    })

    const { handlers, queryClient, unmount } = await setupHook()

    await act(async () => {
      handlers.get('chat:cancelled')?.({
        payload: {
          session_id: 'session-1',
          worktree_id: 'worktree-1',
          undo_send: true,
          emitted_at_ms: Date.now(),
        },
      })
      await Promise.resolve()
    })

    expect(mockPlayNotificationSound).toHaveBeenCalledWith('choochoo')
    expect(
      queryClient.getQueryData(chatQueryKeys.session('session-1'))
    ).toMatchObject({
      last_run_status: 'cancelled',
    })
    unmount()
  })
})
