import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { SwitchBaseBranchDialog } from './SwitchBaseBranchDialog'
import type { Worktree } from '@/types/projects'

const mutateAsyncMock = vi.hoisted(() => vi.fn())

vi.mock('@/services/projects', () => ({
  useProjectBranches: () => ({
    data: ['main', 'parent-feature', 'child-feature'],
    isLoading: false,
    isRefetching: false,
    refetch: vi.fn(),
  }),
  useSwitchWorktreeBaseBranch: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}))

const worktree: Worktree = {
  id: 'worktree-1',
  project_id: 'project-1',
  name: 'child',
  path: '/repo/child',
  branch: 'child-feature',
  base_branch: 'parent-feature',
  created_at: 1,
  order: 0,
}

describe('SwitchBaseBranchDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('switches base branch without rebase by default', async () => {
    mutateAsyncMock.mockResolvedValue({ worktree, rebase_output: null })
    const onOpenChange = vi.fn()

    render(
      <SwitchBaseBranchDialog
        open
        onOpenChange={onOpenChange}
        worktree={worktree}
        projectId="project-1"
        defaultBranch="main"
      />
    )

    expect(screen.queryByText('child-feature')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith({
        worktreeId: 'worktree-1',
        projectId: 'project-1',
        baseBranch: 'main',
        rebase: false,
      })
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sends rebase mode when selected', async () => {
    mutateAsyncMock.mockResolvedValue({ worktree, rebase_output: 'done' })

    render(
      <SwitchBaseBranchDialog
        open
        onOpenChange={vi.fn()}
        worktree={worktree}
        projectId="project-1"
        defaultBranch="main"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /main/i }))
    fireEvent.click(screen.getByLabelText(/Update and rebase/i))
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }))

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({ rebase: true })
      )
    })
  })
})
