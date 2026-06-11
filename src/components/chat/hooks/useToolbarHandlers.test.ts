import { act, renderHook } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useToolbarHandlers } from './useToolbarHandlers'
import { useChatStore } from '@/store/chat-store'
import type { Session } from '@/types/chat'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}))

function renderHandlers(
  overrides: Partial<Parameters<typeof useToolbarHandlers>[0]> = {}
) {
  const setSessionBackend = {
    mutate: vi.fn((_args, opts?: { onSuccess?: () => void }) => {
      opts?.onSuccess?.()
    }),
  }
  const setSessionModel = { mutate: vi.fn() }
  const params: Parameters<typeof useToolbarHandlers>[0] = {
    activeSessionId: 'session-1',
    activeWorktreeId: 'worktree-1',
    activeWorktreePath: '/tmp/worktree',
    activeSessionIdRef: { current: 'session-1' },
    activeWorktreeIdRef: { current: 'worktree-1' },
    activeWorktreePathRef: { current: '/tmp/worktree' },
    enabledMcpServersRef: { current: [] },
    selectedBackend: 'claude',
    installedBackends: ['claude', 'codex'],
    session: {
      id: 'session-1',
      messages: [
        {
          id: 'message-1',
          session_id: 'session-1',
          role: 'user',
          content: 'hello',
          timestamp: 1,
          tool_calls: [],
        },
      ],
    } as unknown as Session,
    preferences: {
      selected_model: 'claude-opus-4-8[1m]',
      selected_codex_model: 'gpt-5.5',
      selected_opencode_model: 'opencode/gpt-5.3-codex',
    },
    queryClient: new QueryClient(),
    worktreeProjectId: 'project-1',
    setSessionModel,
    setSessionBackend,
    setSessionProvider: { mutate: vi.fn() },
    setSessionThinkingLevel: { mutate: vi.fn() },
    setSessionEffortLevel: { mutate: vi.fn() },
    setExecutionMode: vi.fn(),
    setLoadContextModalOpen: vi.fn(),
    ...overrides,
  }

  return {
    ...renderHook(() => useToolbarHandlers(params)),
    setSessionBackend,
    setSessionModel,
  }
}

describe('useToolbarHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useChatStore.setState({
      selectedBackends: {},
      selectedModels: {},
    })
  })

  it('cycles backend with Tab after the session has messages', () => {
    const { result, setSessionBackend, setSessionModel } = renderHandlers()

    act(() => {
      result.current.handleTabBackendSwitch()
    })

    expect(useChatStore.getState().selectedBackends['session-1']).toBe('codex')
    expect(useChatStore.getState().selectedModels['session-1']).toBe('gpt-5.5')
    expect(setSessionBackend.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ backend: 'codex' }),
      expect.any(Object)
    )
    expect(setSessionModel.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.5' })
    )
  })
})
