import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useChatStore } from '@/store/chat-store'
import type { QueuedMessage } from '@/types/chat'
import { useQueueProcessor } from './useQueueProcessor'

const { mockMutate, mockPersistDequeue } = vi.hoisted(() => ({
  mockMutate: vi.fn(),
  mockPersistDequeue: vi.fn(),
}))

vi.mock('@/services/chat', () => ({
  useSendMessage: () => ({ mutate: mockMutate }),
  persistDequeue: mockPersistDequeue,
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))

vi.mock('@/services/projects', () => ({
  isTauri: () => true,
}))

vi.mock('@/lib/transport', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/transport')>()
  return {
    ...actual,
    useWsConnectionStatus: () => true,
  }
})

function createQueuedMessage(id: string, message: string): QueuedMessage {
  return {
    id,
    message,
    pendingImages: [],
    pendingFiles: [],
    pendingSkills: [],
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
    mockMutate.mockReset()
    mockPersistDequeue.mockReset()

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
      executingModes: {},
      selectedModels: {},
    })
  })

  it('continues draining queued prompts after completion clears sending before mutate settles', async () => {
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

    mockPersistDequeue.mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    mockMutate.mockImplementation(
      (
        _args: unknown,
        opts?: {
          onSettled?: () => void
        }
      ) => {
        useChatStore.getState().setStreamingContent(sessionId, 'done')
        useChatStore.getState().completeSession(sessionId)
        opts?.onSettled?.()
      }
    )

    renderHook(() => useQueueProcessor())

    await waitFor(() => {
      expect(mockPersistDequeue).toHaveBeenCalledTimes(2)
    })

    expect(mockMutate).toHaveBeenCalledTimes(2)
  })
})
