import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/store/chat-store'
import type { QueuedMessage } from '@/types/chat'
import { useQueuedMessages } from './useQueuedMessages'

const {
  mockCancelChatMessage,
  mockPersistRemoveQueued,
  mockPersistReorderQueued,
  mockPersistUpdateQueued,
  mockSteerCodexTurn,
  mockToastInfo,
} = vi.hoisted(() => ({
  mockCancelChatMessage: vi.fn(),
  mockPersistRemoveQueued: vi.fn(),
  mockPersistReorderQueued: vi.fn(),
  mockPersistUpdateQueued: vi.fn(),
  mockSteerCodexTurn: vi.fn(),
  mockToastInfo: vi.fn(),
}))

vi.mock('@/services/chat', () => ({
  cancelChatMessage: mockCancelChatMessage,
  persistRemoveQueued: mockPersistRemoveQueued,
  persistReorderQueued: mockPersistReorderQueued,
  persistUpdateQueued: mockPersistUpdateQueued,
  steerCodexTurn: mockSteerCodexTurn,
}))

vi.mock('sonner', () => ({
  toast: {
    info: mockToastInfo,
  },
}))

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

describe('useQueuedMessages', () => {
  const sessionId = 'session-1'
  const worktreeId = 'worktree-1'
  const worktreePath = '/tmp/worktree-1'
  const first = createQueuedMessage('msg-1', 'first')
  const second = createQueuedMessage('msg-2', 'second')

  beforeEach(() => {
    mockCancelChatMessage.mockReset()
    mockPersistRemoveQueued.mockReset()
    mockPersistReorderQueued.mockReset()
    mockPersistUpdateQueued.mockReset()
    mockSteerCodexTurn.mockReset()
    mockToastInfo.mockReset()

    useChatStore.setState({
      messageQueues: {
        [sessionId]: [first, second],
      },
      sendingSessionIds: {},
      waitingForInputSessionIds: {},
      sessionWorktreeMap: {
        [sessionId]: worktreeId,
      },
      worktreePaths: {
        [worktreeId]: worktreePath,
      },
    })
  })

  it('removes queued messages and persists the delete', () => {
    const { result } = renderHook(() =>
      useQueuedMessages({
        activeSessionId: sessionId,
        activeWorktreeId: worktreeId,
        activeWorktreePath: worktreePath,
        selectedBackend: 'claude',
      })
    )

    act(() => {
      result.current.handleRemoveQueuedMessage(sessionId, first.id)
    })

    expect(
      useChatStore.getState().messageQueues[sessionId]?.map(m => m.id)
    ).toEqual([second.id])
    expect(mockPersistRemoveQueued).toHaveBeenCalledWith(
      worktreeId,
      worktreePath,
      sessionId,
      first.id
    )
  })

  it('reorders queued messages and persists the new order', () => {
    const { result } = renderHook(() =>
      useQueuedMessages({
        activeSessionId: sessionId,
        activeWorktreeId: worktreeId,
        activeWorktreePath: worktreePath,
        selectedBackend: 'claude',
      })
    )

    act(() => {
      result.current.handleReorderQueuedMessages(sessionId, [second, first])
    })

    expect(
      useChatStore.getState().messageQueues[sessionId]?.map(m => m.id)
    ).toEqual([second.id, first.id])
    expect(mockPersistReorderQueued).toHaveBeenCalledWith(
      worktreeId,
      worktreePath,
      sessionId,
      [second, first]
    )
  })

  it('edits queued messages and persists the new text', async () => {
    mockPersistUpdateQueued.mockResolvedValue(true)

    const { result } = renderHook(() =>
      useQueuedMessages({
        activeSessionId: sessionId,
        activeWorktreeId: worktreeId,
        activeWorktreePath: worktreePath,
        selectedBackend: 'claude',
      })
    )

    await act(async () => {
      await result.current.handleEditQueuedMessage(
        sessionId,
        first.id,
        'updated first'
      )
    })

    expect(mockPersistUpdateQueued).toHaveBeenCalledWith(
      worktreeId,
      worktreePath,
      sessionId,
      first.id,
      'updated first'
    )
    expect(useChatStore.getState().messageQueues[sessionId]?.[0]?.message).toBe(
      'updated first'
    )
  })

  it('drops stale queued messages when edit persistence reports it is gone', async () => {
    mockPersistUpdateQueued.mockResolvedValue(false)

    const { result } = renderHook(() =>
      useQueuedMessages({
        activeSessionId: sessionId,
        activeWorktreeId: worktreeId,
        activeWorktreePath: worktreePath,
        selectedBackend: 'claude',
      })
    )

    await act(async () => {
      await result.current.handleEditQueuedMessage(
        sessionId,
        first.id,
        'updated first'
      )
    })

    expect(
      useChatStore.getState().messageQueues[sessionId]?.map(m => m.id)
    ).toEqual([second.id])
  })

  it('steers Claude by moving the queued message to the front and cancelling the current turn', async () => {
    useChatStore.setState({
      sendingSessionIds: {
        [sessionId]: true,
      },
    })
    mockCancelChatMessage.mockResolvedValue(true)

    const { result } = renderHook(() =>
      useQueuedMessages({
        activeSessionId: sessionId,
        activeWorktreeId: worktreeId,
        activeWorktreePath: worktreePath,
        selectedBackend: 'claude',
      })
    )

    await act(async () => {
      await result.current.handleSteerQueuedMessage(sessionId, second.id)
    })

    expect(mockPersistReorderQueued).toHaveBeenCalledWith(
      worktreeId,
      worktreePath,
      sessionId,
      [second, first]
    )
    expect(mockCancelChatMessage).toHaveBeenCalledWith(sessionId, worktreeId)
    expect(mockSteerCodexTurn).not.toHaveBeenCalled()
  })

  it('steers Codex through the app-server and removes the queued message', async () => {
    useChatStore.setState({
      sendingSessionIds: {
        [sessionId]: true,
      },
    })
    mockSteerCodexTurn.mockResolvedValue('turn-1')

    const { result } = renderHook(() =>
      useQueuedMessages({
        activeSessionId: sessionId,
        activeWorktreeId: worktreeId,
        activeWorktreePath: worktreePath,
        selectedBackend: 'codex',
      })
    )

    await act(async () => {
      await result.current.handleSteerQueuedMessage(sessionId, first.id)
    })

    expect(mockSteerCodexTurn).toHaveBeenCalledWith(sessionId, 'first')
    expect(mockPersistRemoveQueued).toHaveBeenCalledWith(
      worktreeId,
      worktreePath,
      sessionId,
      first.id
    )
    expect(
      useChatStore.getState().messageQueues[sessionId]?.map(m => m.id)
    ).toEqual([second.id])
    expect(mockCancelChatMessage).not.toHaveBeenCalled()
    expect(mockToastInfo).toHaveBeenCalledWith('Steer sent')
  })
})
