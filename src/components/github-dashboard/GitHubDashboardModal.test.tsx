import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { GitHubDashboardModal, PRRow } from './GitHubDashboardModal'
import type { GitHubPullRequest } from '@/types/github'

const { openExternalMock, mockInvoke, mockUseProjects, mockUseGhCliAuth } =
  vi.hoisted(() => ({
    openExternalMock: vi.fn(),
    mockInvoke: vi.fn(),
    mockUseProjects: vi.fn(),
    mockUseGhCliAuth: vi.fn(),
  }))

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
  listen: vi.fn(),
}))

vi.mock('@/lib/platform', async () => {
  const actual = await vi.importActual('@/lib/platform')
  return {
    ...actual,
    openExternal: openExternalMock,
  }
})

vi.mock('@/services/projects', () => ({
  isTauri: () => true,
  isFolder: () => false,
  useProjects: mockUseProjects,
  useCreateWorktree: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/hooks/useGhLogin', () => ({
  useGhLogin: () => ({ triggerLogin: vi.fn(), isGhInstalled: true }),
}))

vi.mock('@/services/gh-cli', () => ({
  useGhCliAuth: mockUseGhCliAuth,
}))

vi.mock('@/components/shared/GhAuthError', () => ({
  GhAuthError: () => <div data-testid="gh-auth-error">GitHub auth prompt</div>,
}))

vi.mock('@/components/worktree/IssuePreviewModal', () => ({
  IssuePreviewModal: () => null,
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
  },
}))

describe('PRRow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-25T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const pr: GitHubPullRequest = {
    number: 42,
    title: 'Tighten dashboard action row',
    body: 'Adds a direct PR link button',
    url: 'https://github.com/acme/jean/pull/42',
    state: 'OPEN',
    headRefName: 'feature/pr-link',
    baseRefName: 'main',
    isDraft: false,
    created_at: '2026-03-24T12:00:00Z',
    author: {
      login: 'ydeng',
      avatarUrl: 'https://avatars.example.com/u/42',
    },
    labels: [],
    additions: 120,
    deletions: 18,
    reviewDecision: null,
    checkStatus: 'success',
  }

  it('renders author, open age, and churn metadata', () => {
    render(
      <PRRow
        pr={pr}
        isCreating={false}
        isStacking={false}
        onClick={vi.fn()}
        onPreview={vi.fn()}
        onOpenReview={vi.fn()}
        onInvestigate={vi.fn()}
        onStack={vi.fn()}
      />
    )

    expect(screen.getByAltText('ydeng avatar')).toBeInTheDocument()
    expect(screen.getByText('ydeng')).toBeInTheDocument()
    expect(screen.getByText('opened 1d ago')).toBeInTheDocument()
    expect(screen.getByText('+120')).toBeInTheDocument()
    expect(screen.getByText('-18')).toBeInTheDocument()
  })

  it('renders an approval badge when the PR is approved', () => {
    render(
      <PRRow
        pr={{ ...pr, baseRefName: 'parent-branch', reviewDecision: 'approved' }}
        isCreating={false}
        isStacking={false}
        onClick={vi.fn()}
        onPreview={vi.fn()}
        onOpenReview={vi.fn()}
        onInvestigate={vi.fn()}
        onStack={vi.fn()}
      />
    )

    expect(screen.getByText('Approved')).toBeInTheDocument()
  })

  it('opens the PR URL without triggering row actions', () => {
    const onClick = vi.fn()
    const onPreview = vi.fn()
    const onInvestigate = vi.fn()
    const onOpenReview = vi.fn()
    const onStack = vi.fn()

    render(
      <PRRow
        pr={pr}
        isCreating={false}
        isStacking={false}
        onClick={onClick}
        onPreview={onPreview}
        onOpenReview={onOpenReview}
        onInvestigate={onInvestigate}
        onStack={onStack}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open PR on GitHub' }))

    expect(openExternalMock).toHaveBeenCalledWith(pr.url)
    expect(onClick).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
    expect(onOpenReview).not.toHaveBeenCalled()
    expect(onInvestigate).not.toHaveBeenCalled()
    expect(onStack).not.toHaveBeenCalled()
  })

  it('opens the review surface without triggering row actions', () => {
    const onClick = vi.fn()
    const onPreview = vi.fn()
    const onInvestigate = vi.fn()
    const onOpenReview = vi.fn()
    const onStack = vi.fn()

    render(
      <PRRow
        pr={pr}
        isCreating={false}
        isStacking={false}
        onClick={onClick}
        onPreview={onPreview}
        onOpenReview={onOpenReview}
        onInvestigate={onInvestigate}
        onStack={onStack}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Review PR diff and comments' })
    )

    expect(onOpenReview).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
    expect(onInvestigate).not.toHaveBeenCalled()
    expect(onStack).not.toHaveBeenCalled()
  })

  it('creates a stack worktree without triggering row actions', () => {
    const onClick = vi.fn()
    const onPreview = vi.fn()
    const onInvestigate = vi.fn()
    const onOpenReview = vi.fn()
    const onStack = vi.fn()

    render(
      <PRRow
        pr={pr}
        isCreating={false}
        isStacking={false}
        onClick={onClick}
        onPreview={onPreview}
        onOpenReview={onOpenReview}
        onInvestigate={onInvestigate}
        onStack={onStack}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: `New worktree based on ${pr.headRefName}`,
      })
    )

    expect(onStack).toHaveBeenCalledWith(false)
    expect(onClick).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
    expect(onOpenReview).not.toHaveBeenCalled()
    expect(onInvestigate).not.toHaveBeenCalled()
  })

  it('creates a background stack worktree with modifier click', () => {
    const onStack = vi.fn()

    render(
      <PRRow
        pr={pr}
        isCreating={false}
        isStacking={false}
        onClick={vi.fn()}
        onPreview={vi.fn()}
        onOpenReview={vi.fn()}
        onInvestigate={vi.fn()}
        onStack={onStack}
      />
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: `New worktree based on ${pr.headRefName}`,
      }),
      { metaKey: true }
    )

    expect(onStack).toHaveBeenCalledWith(true)
  })
})

const project = {
  id: 'project-1',
  name: 'Project 1',
  path: '/tmp/project-1',
}

function renderDashboard() {
  useUIStore.setState({ githubDashboardOpen: true })
  render(<GitHubDashboardModal />)
}

function emptyIssueResult() {
  return { issues: [], totalCount: 0 }
}

function resolveEmptyDashboardCommand(command: string) {
  if (command === 'list_github_issues')
    return Promise.resolve(emptyIssueResult())
  if (command === 'list_github_prs') return Promise.resolve([])
  if (command === 'list_dependabot_alerts') return Promise.resolve([])
  if (command === 'list_repository_advisories') return Promise.resolve([])
  return Promise.resolve(null)
}

describe('GitHubDashboardModal auth error handling', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }

    mockInvoke.mockReset()
    mockUseProjects.mockReset()
    mockUseGhCliAuth.mockReset()

    mockUseProjects.mockReturnValue({ data: [project] })
    mockUseGhCliAuth.mockReturnValue({
      data: undefined,
      isLoading: false,
      isFetching: false,
    })
  })

  it('does not show the login prompt for unsupported GitHub remotes that mention gh auth login', async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'list_github_issues') {
        return Promise.reject(
          'gh issue list failed: none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`'
        )
      }
      return resolveEmptyDashboardCommand(command)
    })

    renderDashboard()

    expect(await screen.findByText('No open issues found')).toBeInTheDocument()
    expect(screen.queryByTestId('gh-auth-error')).not.toBeInTheDocument()
    expect(mockUseGhCliAuth).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: false })
    )
  })

  it('shows a command error instead of a login prompt when gh is authenticated', async () => {
    mockUseGhCliAuth.mockReturnValue({
      data: { authenticated: true, error: null },
      isLoading: false,
      isFetching: false,
    })
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'list_github_issues') {
        return Promise.reject(
          "GitHub CLI not authenticated. Run 'gh auth login' first."
        )
      }
      return resolveEmptyDashboardCommand(command)
    })

    renderDashboard()

    expect(
      await screen.findByText(
        "GitHub CLI not authenticated. Run 'gh auth login' first.",
        {},
        { timeout: 3000 }
      )
    ).toBeInTheDocument()
    expect(screen.queryByTestId('gh-auth-error')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(mockUseGhCliAuth).toHaveBeenLastCalledWith(
        expect.objectContaining({ enabled: true })
      )
    })
  })

  it('shows the login prompt only when gh auth status reports unauthenticated', async () => {
    mockUseGhCliAuth.mockReturnValue({
      data: { authenticated: false, error: 'not logged in' },
      isLoading: false,
      isFetching: false,
    })
    mockInvoke.mockImplementation((command: string) => {
      if (command === 'list_github_issues') {
        return Promise.reject(
          "GitHub CLI not authenticated. Run 'gh auth login' first."
        )
      }
      return resolveEmptyDashboardCommand(command)
    })

    renderDashboard()

    expect(
      await screen.findByTestId('gh-auth-error', {}, { timeout: 3000 })
    ).toBeInTheDocument()
  })
})
