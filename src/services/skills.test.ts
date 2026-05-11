import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import {
  useCodexSkillInventory,
  useSetCodexSkillEnabled,
  useSkills,
} from './skills'

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
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  Wrapper.displayName = 'SkillsTestQueryClientWrapper'
  return Wrapper
}

describe('skills service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: vi.fn() },
      configurable: true,
    })
  })

  it('filters disabled Codex skills from the inline picker hook', async () => {
    const queryClient = createTestQueryClient()
    const { invoke } = await import('@/lib/transport')

    vi.mocked(invoke).mockResolvedValueOnce([
      {
        name: 'enabled-skill',
        path: '/tmp/enabled-skill/SKILL.md',
        description: 'Enabled skill',
        enabled: true,
      },
      {
        name: 'disabled-skill',
        path: '/tmp/disabled-skill/SKILL.md',
        description: 'Disabled skill',
        enabled: false,
      },
    ])

    const { result } = renderHook(() => useSkills('codex', '/tmp/worktree'), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toEqual([
      {
        name: 'enabled-skill',
        path: '/tmp/enabled-skill/SKILL.md',
        description: 'Enabled skill',
        enabled: true,
      },
    ])
  })

  it('returns the full Codex skill inventory for settings', async () => {
    const queryClient = createTestQueryClient()
    const { invoke } = await import('@/lib/transport')

    vi.mocked(invoke).mockResolvedValueOnce([
      {
        name: 'enabled-skill',
        path: '/tmp/enabled-skill/SKILL.md',
        description: 'Enabled skill',
        enabled: true,
        scope: 'user',
      },
      {
        name: 'disabled-skill',
        path: '/tmp/disabled-skill/SKILL.md',
        description: 'Disabled skill',
        enabled: false,
        scope: 'user',
      },
    ])

    const { result } = renderHook(
      () => useCodexSkillInventory('/tmp/worktree'),
      {
        wrapper: createWrapper(queryClient),
      }
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(result.current.data).toHaveLength(2)
    expect(result.current.data?.[1]?.enabled).toBe(false)
  })

  it('writes Codex skill config through the backend command', async () => {
    const queryClient = createTestQueryClient()
    const { invoke } = await import('@/lib/transport')

    vi.mocked(invoke).mockResolvedValueOnce(false)

    const { result } = renderHook(() => useSetCodexSkillEnabled(), {
      wrapper: createWrapper(queryClient),
    })

    result.current.mutate({
      path: '/tmp/disabled-skill/SKILL.md',
      enabled: false,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(invoke).toHaveBeenCalledWith('set_codex_skill_enabled', {
      path: '/tmp/disabled-skill/SKILL.md',
      name: undefined,
      enabled: false,
    })
  })
})
