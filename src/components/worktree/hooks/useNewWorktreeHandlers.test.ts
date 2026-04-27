import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@/lib/transport'
import { useNewWorktreeHandlers } from './useNewWorktreeHandlers'
import type { GitHubPullRequest } from '@/types/github'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

const pr: GitHubPullRequest = {
  number: 42,
  title: 'Parent PR',
  body: 'Parent body',
  url: 'https://github.com/acme/repo/pull/42',
  state: 'OPEN',
  headRefName: 'parent-branch',
  baseRefName: 'main',
  isDraft: false,
  created_at: '2026-03-24T12:00:00Z',
  author: { login: 'ydeng' },
  labels: [],
  additions: 10,
  deletions: 2,
  reviewDecision: null,
  checkStatus: null,
}

function renderHandlers(
  createWorktree: {
    mutate: ReturnType<typeof vi.fn>
    mutateAsync: ReturnType<typeof vi.fn>
  },
  setters = {
    setActiveTab: vi.fn(),
    setSearchQuery: vi.fn(),
    setSelectedItemIndex: vi.fn(),
    setIncludeClosed: vi.fn(),
  }
) {
  const data = {
    queryClient: {
      invalidateQueries: vi.fn(),
    },
    selectedProjectId: 'project-1',
    selectedProject: {
      id: 'project-1',
      path: '/tmp/repo',
    },
    hasBaseSession: false,
    baseSession: null,
    createWorktree,
    createBaseSession: { mutate: vi.fn(), mutateAsync: vi.fn() },
    createWorktreeFromBranch: { mutate: vi.fn(), mutateAsync: vi.fn() },
  } as unknown as Parameters<typeof useNewWorktreeHandlers>[0]

  return renderHook(() => useNewWorktreeHandlers(data, setters))
}

describe('useNewWorktreeHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue({
      ...pr,
      title: 'Fetched parent PR',
      body: 'Fetched parent body',
      comments: [
        {
          body: 'Looks good',
          author: { login: 'reviewer' },
          created_at: '2026-03-25T12:00:00Z',
        },
      ],
      reviews: [
        {
          body: 'Approved',
          state: 'APPROVED',
          author: { login: 'approver' },
          submittedAt: '2026-03-26T12:00:00Z',
        },
      ],
    })
  })

  it('stacks on a PR by sending baseBranch and relatedPrContext, not prContext', async () => {
    const createWorktree = {
      mutate: vi.fn((_payload, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.()
      }),
      mutateAsync: vi.fn(),
    }
    const { result } = renderHandlers(createWorktree)

    await act(async () => {
      await result.current.handleStackOnPR(pr, false)
    })

    expect(invoke).toHaveBeenCalledWith('get_github_pr', {
      projectPath: '/tmp/repo',
      prNumber: 42,
    })
    expect(createWorktree.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        baseBranch: 'parent-branch',
        relatedPrContext: expect.objectContaining({
          number: 42,
          title: 'Fetched parent PR',
          headRefName: 'parent-branch',
          baseRefName: 'main',
        }),
        background: false,
      }),
      expect.any(Object)
    )
    const payload = createWorktree.mutate.mock.calls[0]?.[0]
    expect(payload).toBeDefined()
    expect(payload).not.toHaveProperty('prContext')
  })

  it('keeps background stack modal state and clears stacking state on success', async () => {
    const createWorktree = {
      mutate: vi.fn((_payload, options?: { onSuccess?: () => void }) => {
        options?.onSuccess?.()
      }),
      mutateAsync: vi.fn(),
    }
    const setters = {
      setActiveTab: vi.fn(),
      setSearchQuery: vi.fn(),
      setSelectedItemIndex: vi.fn(),
      setIncludeClosed: vi.fn(),
    }
    const { result } = renderHandlers(createWorktree, setters)

    await act(async () => {
      await result.current.handleStackOnPR(pr, true)
    })

    expect(createWorktree.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ background: true }),
      expect.any(Object)
    )
    expect(result.current.stackingFromPR).toBeNull()
    expect(setters.setSearchQuery).not.toHaveBeenCalled()
    expect(setters.setActiveTab).not.toHaveBeenCalled()
  })
})
