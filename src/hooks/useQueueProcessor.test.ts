import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useChatStore } from '@/store/chat-store'
import type * as TransportModule from '@/lib/transport'
import type { QueuedMessage } from '@/types/chat'
import { useQueueProcessor } from './useQueueProcessor'

const { mockInvoke } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
}))

vi.mock('@/services/chat', () => ({}))

vi.mock('@/services/projects', () => ({
  isTauri: () => true,
}))

vi.mock('@/lib/transport', async importOriginal => {
  const actual = (await importOriginal()) as typeof TransportModule
  return {
    ...actual,
    invoke: mockInvoke,
    useWsConnectionStatus: () => true,
  }
})

function createQueuedMessage(id: string, message: string): QueuedMessage {
  return {
    id,
    message,
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

describe('useQueueProcessor', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockInvoke.mockResolvedValue(null)

    useChatStore.setState({
      messageQueues: {},
      sendingSessionIds: {},
      sendStartedAt: {},
      waitingForInputSessionIds: {},
      sessionWorktreeMap: {},
      worktreePaths: {},
      streamingContents: {},
      streamingContentBlocks: {},
      activeToolCalls: {},
      reviewingSessions: {},
      errors: {},
      lastSentMessages: {},
      lastSentAttachments: {},
      draftSkillBindings: {},
      executingModes: {},
      selectedModels: {},
    })
  })

  it('asks the backend to drain a processable queue', async () => {
    const sessionId = 'session-1'
    const worktreeId = 'worktree-1'
    const worktreePath = '/tmp/worktree-1'
    const first = createQueuedMessage('msg-1', 'first')
    const second = createQueuedMessage('msg-2', 'second')

    useChatStore.setState({
      messageQueues: { [sessionId]: [first, second] },
      sessionWorktreeMap: { [sessionId]: worktreeId },
      worktreePaths: { [worktreeId]: worktreePath },
    })

    renderHook(() => useQueueProcessor())

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('process_message_queue', {
        sessionId,
        worktreeId,
        worktreePath,
      })
    })
  })

  it('only requests one backend drain for a session with multiple queued messages', async () => {
    const sessionId = 'session-1'
    const worktreeId = 'worktree-1'
    const worktreePath = '/tmp/worktree-1'
    const first = createQueuedMessage('msg-1', 'first')
    const second = createQueuedMessage('msg-2', 'second')

    useChatStore.setState({
      messageQueues: { [sessionId]: [first, second] },
      sessionWorktreeMap: { [sessionId]: worktreeId },
      worktreePaths: { [worktreeId]: worktreePath },
    })

    renderHook(() => useQueueProcessor())

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })

    expect(mockInvoke).toHaveBeenCalledWith('process_message_queue', {
      sessionId,
      worktreeId,
      worktreePath,
    })
  })

  it('does not ask the backend to drain while a session is sending', () => {
    const sessionId = 'session-1'
    const worktreeId = 'worktree-1'
    const worktreePath = '/tmp/worktree-1'

    useChatStore.setState({
      messageQueues: {
        [sessionId]: [createQueuedMessage('msg-1', 'first')],
      },
      sendingSessionIds: { [sessionId]: true },
      sessionWorktreeMap: { [sessionId]: worktreeId },
      worktreePaths: { [worktreeId]: worktreePath },
    })

    renderHook(() => useQueueProcessor())

    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it('does not ask the backend to drain while a session is waiting for input', () => {
    const sessionId = 'session-1'
    const worktreeId = 'worktree-1'
    const worktreePath = '/tmp/worktree-1'

    useChatStore.setState({
      messageQueues: {
        [sessionId]: [createQueuedMessage('msg-1', 'first')],
      },
      waitingForInputSessionIds: { [sessionId]: true },
      sessionWorktreeMap: { [sessionId]: worktreeId },
      worktreePaths: { [worktreeId]: worktreePath },
    })

    renderHook(() => useQueueProcessor())

    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
