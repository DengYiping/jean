import { createElement } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  projectsQueryKeys,
  useReorderWorktrees,
  usePackageScripts,
  useSwitchWorktreeBaseBranch,
  useUpdateAllPrimaryBranches,
  useUpdateProjectSettings,
  useWorktree,
} from './projects'
import type { Project, Worktree } from '@/types/projects'
import { toast } from 'sonner'
import { useProjectsStore } from '@/store/projects-store'

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
    useProjectsStore.setState({ projectCanvasSettings: {} })
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: vi.fn() },
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

  it('loads package scripts through the shared backend transport', async () => {
    const queryClient = createTestQueryClient()
    mockInvoke.mockResolvedValue([
      { name: 'dev', command: 'bun', args: ['run', 'dev'] },
    ])

    const { result } = renderHook(() => usePackageScripts('/repo'), {
      wrapper: createWrapper(queryClient),
    })

    await waitFor(() => {
      expect(result.current.data).toEqual([
        { name: 'dev', command: 'bun', args: ['run', 'dev'] },
      ])
    })
    expect(mockInvoke).toHaveBeenCalledWith('get_package_scripts', {
      worktreePath: '/repo',
    })
  })

  it('updates all base worktrees through the shared transport', async () => {
    const queryClient = createTestQueryClient()
    mockInvoke.mockResolvedValue({
      updated: ['Jean'],
      skipped: 1,
      failures: [],
    })

    const { result } = renderHook(() => useUpdateAllPrimaryBranches(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync()
    })

    expect(mockInvoke).toHaveBeenCalledWith('update_all_primary_branches')
    expect(toast.success).toHaveBeenCalledWith('Updated 1 project', {
      description: 'Skipped 1 folder.',
    })
  })

  it('forwards linked project ids when updating project settings', async () => {
    const queryClient = createTestQueryClient()
    const updatedProject: Project = {
      id: 'project-1',
      name: 'Jean',
      path: '/repo',
      default_branch: 'main',
      added_at: 1,
      order: 0,
      linked_project_ids: ['project-2', 'project-3'],
    }
    mockInvoke.mockResolvedValue(updatedProject)

    const { result } = renderHook(() => useUpdateProjectSettings(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'project-1',
        linkedProjectIds: ['project-2', 'project-3'],
      })
    })

    expect(mockInvoke).toHaveBeenCalledWith('update_project_settings', {
      projectId: 'project-1',
      name: undefined,
      defaultBranch: undefined,
      enabledMcpServers: undefined,
      knownMcpServers: undefined,
      customSystemPrompt: undefined,
      defaultProvider: undefined,
      defaultBackend: undefined,
      defaultEditor: undefined,
      githubAccountHost: undefined,
      githubAccountUser: undefined,
      worktreesDir: undefined,
      stableWorktreeSlotsEnabled: undefined,
      linearApiKey: undefined,
      linearTeamId: undefined,
      hideGithubIssuesAndPrs: undefined,
      linkedProjectIds: ['project-2', 'project-3'],
    })
  })

  it('switches a worktree base branch and refreshes project state', async () => {
    const queryClient = createTestQueryClient()
    const updatedWorktree = {
      ...worktree,
      base_branch: 'parent-feature',
    }
    mockInvoke.mockResolvedValue({
      worktree: updatedWorktree,
      rebase_output: null,
    })

    const { result } = renderHook(() => useSwitchWorktreeBaseBranch(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        worktreeId: 'worktree-1',
        projectId: 'project-1',
        baseBranch: 'parent-feature',
        rebase: false,
      })
    })

    expect(mockInvoke).toHaveBeenCalledWith('switch_worktree_base_branch', {
      worktreeId: 'worktree-1',
      baseBranch: 'parent-feature',
      rebase: false,
    })
    expect(mockInvoke).toHaveBeenCalledWith('trigger_immediate_git_poll')
    expect(mockInvoke).toHaveBeenCalledWith('fetch_worktrees_status', {
      projectId: 'project-1',
    })
    expect(
      queryClient.getQueryData([
        ...projectsQueryKeys.all,
        'worktree',
        'worktree-1',
      ])
    ).toEqual(updatedWorktree)
    expect(toast.success).toHaveBeenCalledWith('Base branch switched')
  })

  it('preserves cached worktrees and switches canvas to manual sort when reordering', async () => {
    const queryClient = createTestQueryClient()
    const base: Worktree = {
      ...worktree,
      id: 'base',
      name: 'main',
      branch: 'main',
      session_type: 'base',
      order: 0,
    }
    const first: Worktree = { ...worktree, id: 'first', order: 1 }
    const second: Worktree = { ...worktree, id: 'second', order: 2 }
    const pending: Worktree = {
      ...worktree,
      id: 'pending',
      status: 'pending',
      order: 99,
    }
    queryClient.setQueryData(projectsQueryKeys.worktrees('project-1'), [
      base,
      first,
      second,
      pending,
    ])
    mockInvoke.mockResolvedValue(null)

    const { result } = renderHook(() => useReorderWorktrees(), {
      wrapper: createWrapper(queryClient),
    })

    await act(async () => {
      await result.current.mutateAsync({
        projectId: 'project-1',
        worktreeIds: ['second', 'first'],
        switchToManualSort: true,
      })
    })

    expect(mockInvoke).toHaveBeenCalledWith('reorder_worktrees', {
      projectId: 'project-1',
      worktreeIds: ['second', 'first'],
    })
    expect(
      queryClient
        .getQueryData<Worktree[]>(projectsQueryKeys.worktrees('project-1'))
        ?.map(w => [w.id, w.order])
    ).toEqual([
      ['base', 0],
      ['first', 2],
      ['second', 1],
      ['pending', 99],
    ])
    expect(
      useProjectsStore.getState().projectCanvasSettings['project-1']
        ?.worktreeSortMode
    ).toBe('manual')
  })
})
