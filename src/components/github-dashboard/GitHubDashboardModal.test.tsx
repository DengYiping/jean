import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { PRRow } from './GitHubDashboardModal'
import type { GitHubPullRequest } from '@/types/github'

const { openExternalMock } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
}))

vi.mock('@/lib/platform', async () => {
  const actual = await vi.importActual('@/lib/platform')
  return {
    ...actual,
    openExternal: openExternalMock,
  }
})

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
