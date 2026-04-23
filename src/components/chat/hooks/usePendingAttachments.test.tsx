import { act, renderHook } from '@testing-library/react'
import { createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePendingAttachments } from './usePendingAttachments'
import { useChatStore } from '@/store/chat-store'

const {
  mockInvoke,
  mockPersistEnqueue,
  mockToastLoading,
  mockToastDismiss,
  mockToastError,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockPersistEnqueue: vi.fn(),
  mockToastLoading: vi.fn(() => 'toast-id'),
  mockToastDismiss: vi.fn(),
  mockToastError: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
}))

vi.mock('@/services/chat', () => ({
  persistEnqueue: mockPersistEnqueue,
}))

vi.mock('sonner', () => ({
  toast: {
    loading: mockToastLoading,
    dismiss: mockToastDismiss,
    error: mockToastError,
  },
}))

describe('usePendingAttachments', () => {
  beforeEach(() => {
    mockInvoke.mockReset()
    mockPersistEnqueue.mockReset()
    mockToastLoading.mockClear()
    mockToastDismiss.mockClear()
    mockToastError.mockClear()

    useChatStore.setState({
      messageQueues: {},
      sendingSessionIds: {},
      waitingForInputSessionIds: {},
    })
  })

  it('queues builtin /compact without resolving a command file', async () => {
    const sendMessageNow = vi.fn()

    const { result } = renderHook(() =>
      usePendingAttachments({
        activeSessionId: 'session-1',
        activeWorktreeId: 'worktree-1',
        activeWorktreePath: '/tmp/worktree-1',
        selectedModelRef: { current: 'gpt-5.4' },
        selectedProviderRef: { current: null },
        executionModeRef: { current: 'build' },
        selectedThinkingLevelRef: { current: 'off' },
        selectedEffortLevelRef: { current: 'high' },
        useAdaptiveThinkingRef: { current: false },
        isCodexBackendRef: { current: true },
        mcpServersDataRef: { current: [] },
        enabledMcpServersRef: { current: [] },
        selectedBackendRef: { current: 'codex' },
        inputRef: createRef<HTMLTextAreaElement>(),
        setInputDraft: vi.fn(),
        sendMessageNow,
      })
    )

    await act(async () => {
      result.current.handleCommandExecute({
        name: 'compact',
        path: '',
        source: 'builtin',
      })
    })

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(sendMessageNow).toHaveBeenCalledTimes(1)
    expect(sendMessageNow.mock.calls[0]?.[0]).toMatchObject({
      message: '/compact',
      model: 'gpt-5.4',
      commandAllowedTools: [],
    })
    expect(mockToastLoading).toHaveBeenCalledWith('Queueing /compact...')
    expect(mockToastDismiss).toHaveBeenCalledWith('toast-id')
  })

  it('resolves file-backed slash commands through the backend', async () => {
    const sendMessageNow = vi.fn()
    mockInvoke.mockResolvedValue({
      content: 'resolved command body',
      allowed_tools: ['Read'],
    })

    const { result } = renderHook(() =>
      usePendingAttachments({
        activeSessionId: 'session-1',
        activeWorktreeId: 'worktree-1',
        activeWorktreePath: '/tmp/worktree-1',
        selectedModelRef: { current: 'claude-opus-4-7' },
        selectedProviderRef: { current: null },
        executionModeRef: { current: 'build' },
        selectedThinkingLevelRef: { current: 'off' },
        selectedEffortLevelRef: { current: 'high' },
        useAdaptiveThinkingRef: { current: false },
        isCodexBackendRef: { current: false },
        mcpServersDataRef: { current: [] },
        enabledMcpServersRef: { current: [] },
        selectedBackendRef: { current: 'claude' },
        inputRef: createRef<HTMLTextAreaElement>(),
        setInputDraft: vi.fn(),
        sendMessageNow,
      })
    )

    await act(async () => {
      result.current.handleCommandExecute({
        name: 'review',
        path: '/tmp/review.md',
        source: 'file',
      })
    })

    expect(mockInvoke).toHaveBeenCalledWith('resolve_claude_command', {
      commandPath: '/tmp/review.md',
      workingDir: '/tmp/worktree-1',
    })
    expect(sendMessageNow.mock.calls[0]?.[0]).toMatchObject({
      message: 'resolved command body',
      commandAllowedTools: ['Read'],
    })
  })
})
