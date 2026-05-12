import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useChatStore } from '@/store/chat-store'
import type * as TransportModule from '@/lib/transport'
import type { QueuedMessage } from '@/types/chat'
import { useQueueProcessor } from './useQueueProcessor'

const { mockInvoke, mockMutate, mockPersistDequeue, mockToastLoading } =
  vi.hoisted(() => ({
    mockInvoke: vi.fn(),
    mockMutate: vi.fn(),
    mockPersistDequeue: vi.fn(),
    mockToastLoading: vi.fn(),
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

vi.mock('@/services/git-status', () => ({
  triggerImmediateGitPoll: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: mockToastLoading,
    success: vi.fn(),
    error: vi.fn(),
  },
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
    mockMutate.mockReset()
    mockPersistDequeue.mockReset()
    mockToastLoading.mockReturnValue('toast-1')

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

    mockPersistDequeue
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
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

  it('executes queued messages in dequeue order', async () => {
    const sessionId = 'session-1'
    const worktreeId = 'worktree-1'
    const worktreePath = '/tmp/worktree-1'
    const first = createQueuedMessage('msg-1', 'first')
    const second = createQueuedMessage('msg-2', 'second')

    useChatStore.setState({
      messageQueues: { [sessionId]: [second, first] },
      sessionWorktreeMap: { [sessionId]: worktreeId },
      worktreePaths: { [worktreeId]: worktreePath },
    })

    mockPersistDequeue
      .mockResolvedValueOnce(second)
      .mockResolvedValueOnce(first)
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
      expect(mockMutate).toHaveBeenCalledTimes(2)
    })

    expect(mockMutate.mock.calls[0]?.[0]).toMatchObject({ message: 'second' })
    expect(mockMutate.mock.calls[1]?.[0]).toMatchObject({ message: 'first' })
  })

  it('executes a queued magic commit without sending a chat message', async () => {
    const sessionId = 'session-1'
    const worktreeId = 'worktree-1'
    const worktreePath = '/tmp/worktree-1'
    const magic = {
      ...createQueuedMessage('magic-1', '/commit'),
      kind: 'magic_command' as const,
      magicCommand: 'commit' as const,
      magicCommandLabel: 'Commit',
    }

    useChatStore.setState({
      messageQueues: { [sessionId]: [magic] },
      sessionWorktreeMap: { [sessionId]: worktreeId },
      worktreePaths: { [worktreeId]: worktreePath },
    })

    mockPersistDequeue.mockResolvedValueOnce(magic)
    mockInvoke.mockResolvedValue({ message: 'test commit', commit_hash: 'abc' })

    renderHook(() => useQueueProcessor())

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'create_commit_with_ai',
        expect.objectContaining({
          worktreePath,
          push: false,
        })
      )
    })
    expect(mockMutate).not.toHaveBeenCalled()
  })

  it('executes a queued draft PR with draft enabled', async () => {
    const sessionId = 'session-1'
    const worktreeId = 'worktree-1'
    const worktreePath = '/tmp/worktree-1'
    const magic = {
      ...createQueuedMessage('magic-1', '/create draft pr'),
      kind: 'magic_command' as const,
      magicCommand: 'draft-pr' as const,
      magicCommandLabel: 'Create draft PR',
    }

    useChatStore.setState({
      messageQueues: { [sessionId]: [magic] },
      sessionWorktreeMap: { [sessionId]: worktreeId },
      worktreePaths: { [worktreeId]: worktreePath },
    })

    mockPersistDequeue.mockResolvedValueOnce(magic)
    mockInvoke.mockResolvedValue({
      title: 'Test PR',
      pr_number: 12,
      pr_url: 'https://example.com/pr/12',
      existing: false,
      is_draft: true,
    })

    renderHook(() => useQueueProcessor())

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(
        'create_pr_with_ai_content',
        expect.objectContaining({
          worktreePath,
          sessionId,
          draft: true,
        })
      )
    })
    expect(mockMutate).not.toHaveBeenCalled()
  })
})
