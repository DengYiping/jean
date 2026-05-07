import { act, renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import type { FormEvent } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMessageSending } from './useMessageSending'
import { useChatStore } from '@/store/chat-store'

const { mockInvoke, mockToastInfo, mockToastSuccess, mockToastError } =
  vi.hoisted(() => ({
    mockInvoke: vi.fn(),
    mockToastInfo: vi.fn(),
    mockToastSuccess: vi.fn(),
    mockToastError: vi.fn(),
  }))

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
}))

vi.mock('sonner', () => ({
  toast: {
    info: mockToastInfo,
    success: mockToastSuccess,
    error: mockToastError,
  },
}))

describe('useMessageSending', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      inputDrafts: {},
      pendingImages: {},
      pendingFiles: {},
      pendingTextFiles: {},
      draftSkillBindings: {},
      waitingForInputSessionIds: {},
      sendingSessionIds: {},
    })
  })

  function renderUseMessageSending(inputValue: string) {
    const input = document.createElement('textarea')
    input.value = inputValue

    const sendMessage = { mutate: vi.fn() }
    const clearInputDraft = vi.fn()
    const clearChatInputState = vi.fn()

    const rendered = renderHook(() =>
      useMessageSending({
        activeSessionId: 'session-1',
        activeWorktreeId: 'worktree-1',
        activeWorktreePath: '/tmp/worktree-1',
        inputRef: { current: input },
        selectedModelRef: { current: 'gpt-5.4' },
        selectedProviderRef: { current: null },
        selectedThinkingLevelRef: { current: 'off' },
        selectedEffortLevelRef: { current: 'high' },
        executionModeRef: { current: 'build' },
        useAdaptiveThinkingRef: { current: false },
        isCodexBackendRef: { current: true },
        mcpServersDataRef: { current: [] },
        enabledMcpServersRef: { current: [] },
        selectedBackendRef: { current: 'codex' },
        preferences: undefined,
        sendMessage,
        queryClient: new QueryClient(),
        markAtBottom: vi.fn(),
        sessionsData: { sessions: [{ id: 'session-1' }] },
        setInputDraft: vi.fn(),
        clearInputDraft,
        clearChatInputState,
      })
    )

    return {
      ...rendered,
      sendMessage,
      clearInputDraft,
      clearChatInputState,
    }
  }

  it('sets a codex goal before sending the trimmed message body', async () => {
    mockInvoke.mockResolvedValue(null)
    const { result, sendMessage, clearInputDraft, clearChatInputState } =
      renderUseMessageSending('/goal Ship the migration')

    await act(async () => {
      result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mockInvoke).toHaveBeenCalledWith('codex_goal_set', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
      objective: 'Ship the migration',
    })
    expect(sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        worktreeId: 'worktree-1',
        worktreePath: '/tmp/worktree-1',
        message: 'Ship the migration',
        backend: 'codex',
      }),
      expect.any(Object)
    )
    expect(clearInputDraft).toHaveBeenCalledWith('session-1')
    expect(clearChatInputState).toHaveBeenCalled()
  })

  it('clears a codex goal without sending a chat turn', async () => {
    mockInvoke.mockResolvedValue(null)
    const { result, sendMessage, clearInputDraft, clearChatInputState } =
      renderUseMessageSending('/goal clear')

    await act(async () => {
      result.current.handleSubmit({
        preventDefault: vi.fn(),
      } as unknown as FormEvent)
      await Promise.resolve()
    })

    expect(mockInvoke).toHaveBeenCalledWith('codex_goal_clear', {
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
    })
    expect(sendMessage.mutate).not.toHaveBeenCalled()
    expect(clearInputDraft).toHaveBeenCalledWith('session-1')
    expect(clearChatInputState).toHaveBeenCalled()
  })
})
