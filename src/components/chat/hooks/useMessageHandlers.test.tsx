import { act, renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import type { PermissionDenial, QueuedMessage } from '@/types/chat'
import { useMessageHandlers } from './useMessageHandlers'

const { mockInvoke, mockMutate } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockMutate: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
  listen: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}))

function ref<T>(current: T) {
  return { current }
}

function createQueuedMessage(id: string): QueuedMessage {
  return {
    id,
    message: 'queued prompt',
    pendingImages: [],
    pendingFiles: [],
    skills: [],
    pendingTextFiles: [],
    model: 'gpt-5.4',
    provider: null,
    executionMode: 'build',
    thinkingLevel: 'off',
    queuedAt: Date.now(),
  }
}

function resetChatStore() {
  useChatStore.setState({
    activeWorktreeId: null,
    activeWorktreePath: null,
    activeSessionIds: {},
    worktreePaths: {},
    sendingSessionIds: {},
    sendStartedAt: {},
    waitingForInputSessionIds: {},
    sessionWorktreeMap: {},
    streamingContents: {},
    activeToolCalls: {},
    streamingContentBlocks: {},
    executionModes: {},
    selectedModels: {},
    errors: {},
    lastSentMessages: {},
    lastSentAttachments: {},
    streamingPlanApprovals: {},
    messageQueues: {},
    executingModes: {},
    approvedTools: {},
    pendingPermissionDenials: {},
    pendingCodexMcpElicitations: {},
    deniedMessageContext: {},
    reviewingSessions: {},
  })
}

function observeProcessableQueue(sessionId: string) {
  const observed: boolean[] = []
  const unsubscribe = useChatStore.subscribe(state => {
    observed.push(
      (state.messageQueues[sessionId]?.length ?? 0) > 0 &&
        !state.sendingSessionIds[sessionId] &&
        !state.waitingForInputSessionIds[sessionId]
    )
  })
  return { observed, unsubscribe }
}

function renderUseMessageHandlers(queryClient = new QueryClient()) {
  return renderHook(() =>
    useMessageHandlers({
      activeSessionIdRef: ref('session-1'),
      activeWorktreeIdRef: ref('worktree-1'),
      activeWorktreePathRef: ref('/tmp/worktree-1'),
      selectedModelRef: ref('gpt-5.4'),
      buildModelRef: ref(null),
      buildBackendRef: ref(null),
      buildThinkingLevelRef: ref(null),
      buildEffortLevelRef: ref(null),
      yoloModelRef: ref(null),
      yoloBackendRef: ref(null),
      yoloThinkingLevelRef: ref(null),
      yoloEffortLevelRef: ref(null),
      getCustomProfileName: () => undefined,
      executionModeRef: ref('build'),
      selectedThinkingLevelRef: ref('off'),
      selectedEffortLevelRef: ref('high'),
      useAdaptiveThinkingRef: ref(false),
      getMcpConfig: () => undefined,
      sendMessage: { mutate: mockMutate },
      createSession: { mutateAsync: vi.fn() },
      queryClient,
      scrollToBottom: vi.fn(),
      markAtBottom: vi.fn(),
      inputRef: ref(null),
      pendingPlanMessage: null,
      projectIdRef: ref(null),
    })
  )
}

describe('useMessageHandlers permission approval', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue(undefined)
    mockMutate.mockImplementation((_params, options) => {
      options?.onSettled?.()
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    })
    resetChatStore()
  })

  it('does not expose a queued message while approving a Claude permission', () => {
    const sessionId = 'session-1'
    const queuedMessage = createQueuedMessage('queued-1')
    const denial: PermissionDenial = {
      tool_name: 'Bash',
      tool_use_id: 'tool-1',
      tool_input: { command: 'bun test' },
    }

    useChatStore.setState({
      messageQueues: { [sessionId]: [queuedMessage] },
      waitingForInputSessionIds: { [sessionId]: true },
      pendingPermissionDenials: { [sessionId]: [denial] },
      deniedMessageContext: {
        [sessionId]: {
          message: 'original prompt',
          model: 'gpt-5.4',
          executionMode: 'build',
          thinkingLevel: 'off',
        },
      },
    })

    const { observed, unsubscribe } = observeProcessableQueue(sessionId)
    const { result } = renderUseMessageHandlers()

    act(() => {
      result.current.handlePermissionApproval(sessionId, ['Bash(bun test)'])
    })
    unsubscribe()

    expect(observed).not.toContain(true)
    expect(useChatStore.getState().messageQueues[sessionId]).toEqual([
      queuedMessage,
    ])
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId,
        message: 'I approved the command. Run it now: `bun test`',
      }),
      expect.any(Object)
    )
  })

  it('does not expose a queued message while approving a Codex permission', () => {
    const sessionId = 'session-1'
    const queuedMessage = createQueuedMessage('queued-1')
    const denial: PermissionDenial = {
      tool_name: 'Bash',
      tool_use_id: 'tool-1',
      tool_input: { command: 'bun test' },
      rpc_id: 42,
    }

    useChatStore.setState({
      messageQueues: { [sessionId]: [queuedMessage] },
      waitingForInputSessionIds: { [sessionId]: true },
      pendingPermissionDenials: { [sessionId]: [denial] },
      executionModes: { [sessionId]: 'build' },
    })

    const { observed, unsubscribe } = observeProcessableQueue(sessionId)
    const { result } = renderUseMessageHandlers()

    act(() => {
      result.current.handlePermissionApproval(sessionId, ['Bash(bun test)'])
    })
    unsubscribe()

    expect(observed).not.toContain(true)
    expect(useChatStore.getState().messageQueues[sessionId]).toEqual([
      queuedMessage,
    ])
    expect(mockMutate).not.toHaveBeenCalled()
    expect(mockInvoke).toHaveBeenCalledWith('approve_codex_command', {
      sessionId,
      rpcId: 42,
      decision: 'accept',
    })
  })
})
