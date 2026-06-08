import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode, RefObject } from 'react'
import { invoke } from '@/lib/transport'
import { toast } from 'sonner'
import { useChatStore } from '@/store/chat-store'
import { defaultPreferences, type AppPreferences } from '@/types/preferences'
import type { ExecutionMode, McpServerInfo, ThinkingLevel } from '@/types/chat'
import { useInvestigateHandlers } from './useInvestigateHandlers'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}))

function createWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

function createInvestigateHookParams(
  overrides: Partial<Parameters<typeof useInvestigateHandlers>[0]> = {}
) {
  const sendMessage = { mutate: vi.fn() }
  const setSessionProvider = { mutate: vi.fn() }
  const setSessionBackend = { mutate: vi.fn() }
  const setSessionModel = { mutate: vi.fn() }
  const setSessionEffortLevel = { mutate: vi.fn() }
  const createSession = { mutate: vi.fn() }
  const resolveCustomProfile = vi.fn(() => ({
    model: 'sonnet',
    customProfileName: undefined,
  }))

  return {
    params: {
      activeSessionId: 'session-1',
      activeWorktreeId: 'wt-1',
      activeWorktreePath: '/tmp/wt-1',
      inputRef: { current: null } as RefObject<HTMLTextAreaElement | null>,
      preferences: defaultPreferences,
      selectedModelRef: { current: 'sonnet' },
      selectedThinkingLevelRef: {
        current: 'think',
      } as RefObject<ThinkingLevel>,
      executionModeRef: { current: 'plan' } as RefObject<ExecutionMode>,
      mcpServersDataRef: {
        current: [],
      } as RefObject<McpServerInfo[] | undefined>,
      enabledMcpServersRef: { current: [] } as RefObject<string[]>,
      activeWorktreeIdRef: {
        current: 'wt-1',
      } as RefObject<string | null | undefined>,
      activeWorktreePathRef: {
        current: '/tmp/wt-1',
      } as RefObject<string | null | undefined>,
      sendMessage,
      setSessionProvider,
      setSessionBackend,
      setSessionModel,
      setSessionEffortLevel,
      createSession,
      resolveCustomProfile,
      cliVersion: '2.1.32',
      worktreeProjectId: null,
      ...overrides,
    },
    sendMessage,
  }
}

describe('useInvestigateHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(null)
    useChatStore.setState({
      activeSessionIds: {},
      sessionWorktreeMap: {},
      worktreePaths: {},
      lastSentMessages: {},
      lastSentAttachments: {},
      draftSkillBindings: {},
      errors: {},
      sendingSessionIds: {},
      selectedModels: {},
      selectedProviders: {},
      selectedBackends: {},
      executingModes: {},
    })
  })

  it('uses the saved review comments effort override when sending', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const sendMessage = { mutate: vi.fn() }
    const setSessionProvider = { mutate: vi.fn() }
    const setSessionBackend = { mutate: vi.fn() }
    const setSessionModel = { mutate: vi.fn() }
    const setSessionEffortLevel = { mutate: vi.fn() }
    const createSession = {
      mutate: vi.fn(
        (
          _args: { worktreeId: string; worktreePath: string },
          opts?: { onSuccess?: (session: { id: string }) => void }
        ) => opts?.onSuccess?.({ id: 'session-2' })
      ),
    }
    const resolveCustomProfile = vi.fn(() => ({
      model: 'opus',
      customProfileName: undefined,
    }))
    const inputRef: RefObject<HTMLTextAreaElement | null> = { current: null }
    const selectedModelRef = { current: 'sonnet' }
    const selectedThinkingLevelRef: RefObject<ThinkingLevel> = {
      current: 'off',
    }
    const executionModeRef: RefObject<ExecutionMode> = { current: 'build' }
    const mcpServersDataRef: RefObject<McpServerInfo[] | undefined> = {
      current: [],
    }
    const enabledMcpServersRef: RefObject<string[]> = { current: [] }
    const activeWorktreeIdRef: RefObject<string | null | undefined> = {
      current: 'wt-1',
    }
    const activeWorktreePathRef: RefObject<string | null | undefined> = {
      current: '/tmp/wt-1',
    }

    const preferences: AppPreferences = {
      ...defaultPreferences,
      magic_prompt_models: {
        ...defaultPreferences.magic_prompt_models,
        review_comments_model: 'claude-opus-4-7',
      },
      magic_prompt_efforts: {
        ...defaultPreferences.magic_prompt_efforts,
        review_comments_effort: 'medium',
      },
    }

    const { result } = renderHook(
      () =>
        useInvestigateHandlers({
          activeSessionId: 'session-1',
          activeWorktreeId: 'wt-1',
          activeWorktreePath: '/tmp/wt-1',
          inputRef,
          preferences,
          selectedModelRef,
          selectedThinkingLevelRef,
          executionModeRef,
          mcpServersDataRef,
          enabledMcpServersRef,
          activeWorktreeIdRef,
          activeWorktreePathRef,
          sendMessage,
          setSessionProvider,
          setSessionBackend,
          setSessionModel,
          setSessionEffortLevel,
          createSession,
          resolveCustomProfile,
          cliVersion: '2.1.32',
          worktreeProjectId: null,
        }),
      { wrapper: createWrapper(queryClient) }
    )

    await act(async () => {
      await result.current.handleReviewComments('review prompt')
    })

    expect(sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-2',
        message: 'review prompt',
        model: 'claude-opus-4-7',
        effortLevel: 'medium',
        backend: 'claude',
      }),
      expect.any(Object)
    )
  })

  it('runs investigate issue in build mode even when current mode is plan', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const sendMessage = { mutate: vi.fn() }
    const setSessionProvider = { mutate: vi.fn() }
    const setSessionBackend = { mutate: vi.fn() }
    const setSessionModel = { mutate: vi.fn() }
    const setSessionEffortLevel = { mutate: vi.fn() }
    const createSession = {
      mutate: vi.fn(),
    }
    const resolveCustomProfile = vi.fn(() => ({
      model: 'sonnet',
      customProfileName: undefined,
    }))
    const inputRef: RefObject<HTMLTextAreaElement | null> = { current: null }
    const selectedModelRef = { current: 'sonnet' }
    const selectedThinkingLevelRef: RefObject<ThinkingLevel> = {
      current: 'think',
    }
    const executionModeRef: RefObject<ExecutionMode> = { current: 'plan' }
    const mcpServersDataRef: RefObject<McpServerInfo[] | undefined> = {
      current: [],
    }
    const enabledMcpServersRef: RefObject<string[]> = { current: [] }
    const activeWorktreeIdRef: RefObject<string | null | undefined> = {
      current: 'wt-1',
    }
    const activeWorktreePathRef: RefObject<string | null | undefined> = {
      current: '/tmp/wt-1',
    }

    vi.mocked(invoke).mockResolvedValue([{ number: 123 }])

    const { result } = renderHook(
      () =>
        useInvestigateHandlers({
          activeSessionId: 'session-1',
          activeWorktreeId: 'wt-1',
          activeWorktreePath: '/tmp/wt-1',
          inputRef,
          preferences: defaultPreferences,
          selectedModelRef,
          selectedThinkingLevelRef,
          executionModeRef,
          mcpServersDataRef,
          enabledMcpServersRef,
          activeWorktreeIdRef,
          activeWorktreePathRef,
          sendMessage,
          setSessionProvider,
          setSessionBackend,
          setSessionModel,
          setSessionEffortLevel,
          createSession,
          resolveCustomProfile,
          cliVersion: '2.1.32',
          worktreeProjectId: null,
        }),
      { wrapper: createWrapper(queryClient) }
    )

    await act(async () => {
      await result.current.handleInvestigate('issue')
    })

    expect(sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        executionMode: 'build',
      }),
      expect.any(Object)
    )
    expect(useChatStore.getState().executingModes['session-1']).toBe('build')
  })

  it('uses an explicit yolo override for review comments even when current mode is plan', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const createSession = {
      mutate: vi.fn(),
      mutateAsync: vi.fn().mockResolvedValue({ id: 'comment-session-1' }),
    }
    const { params, sendMessage } = createInvestigateHookParams({
      createSession,
      executionModeRef: { current: 'plan' } as RefObject<ExecutionMode>,
    })

    const { result } = renderHook(() => useInvestigateHandlers(params), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.handleReviewComments('fix one', {
        executionMode: 'yolo',
      })
    })

    expect(sendMessage.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'comment-session-1',
        executionMode: 'yolo',
      }),
      expect.any(Object)
    )
    expect(useChatStore.getState().executingModes['comment-session-1']).toBe(
      'yolo'
    )
  })

  it.each([
    {
      type: 'issue' as const,
      command: 'list_loaded_issue_contexts',
      message: 'No issue context loaded for this worktree',
    },
    {
      type: 'pr' as const,
      command: 'list_loaded_pr_contexts',
      message: 'No PR context loaded for this worktree',
    },
  ])(
    'does not send investigate $type prompts without loaded contexts',
    async ({ type, command, message }) => {
      const queryClient = new QueryClient({
        defaultOptions: {
          queries: { retry: false },
          mutations: { retry: false },
        },
      })
      const { params, sendMessage } = createInvestigateHookParams()

      vi.mocked(invoke).mockResolvedValue([])

      const { result } = renderHook(() => useInvestigateHandlers(params), {
        wrapper: createWrapper(queryClient),
      })

      await act(async () => {
        await result.current.handleInvestigate(type)
      })

      expect(invoke).toHaveBeenCalledWith(command, {
        sessionId: 'wt-1',
      })
      expect(toast.error).toHaveBeenCalledWith(message)
      expect(sendMessage.mutate).not.toHaveBeenCalled()
    }
  )
})
