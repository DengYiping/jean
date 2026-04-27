import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode, RefObject } from 'react'
import { invoke } from '@/lib/transport'
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
})
