import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectsQueryKeys, useWorktree } from './projects'
import type { Worktree } from '@/types/projects'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
  listen: vi.fn(),
  useWsConnectionStatus: () => ({ isConnected: true }),
  setAppDataDir: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}))

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  Wrapper.displayName = 'TestQueryClientWrapper'
  return Wrapper
}

const worktree: Worktree = {
  id: 'worktree-1',
  project_id: 'project-1',
  name: 'Royal Oriole',
  path: '/repo/worktree-1',
  branch: 'royal-oriole',
  created_at: 1,
  order: 0,
}

describe('projects service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    })
  })

  it('seeds useWorktree from the cached project worktree list', () => {
    const queryClient = createTestQueryClient()
    queryClient.setQueryData(projectsQueryKeys.worktrees('project-1'), [
      worktree,
    ])

    const { result } = renderHook(() => useWorktree('worktree-1'), {
      wrapper: createWrapper(queryClient),
    })

    expect(result.current.data).toEqual(worktree)
    expect(mockInvoke).not.toHaveBeenCalledWith(
      'get_worktree',
      expect.anything()
    )
  })
})
