import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { PRItem } from './NewWorktreeItems'
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

describe('PRItem', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-25T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const pr: GitHubPullRequest = {
    number: 99,
    title: 'Keep project PR rows aligned with dashboard behavior',
    body: 'Adds metadata and direct GitHub link',
    url: 'https://github.com/acme/jean/pull/99',
    state: 'OPEN',
    headRefName: 'feature/project-pr-row',
    baseRefName: 'main',
    isDraft: false,
    created_at: '2026-03-24T12:00:00Z',
    author: {
      login: 'octocat',
      avatarUrl: 'https://avatars.example.com/u/99',
    },
    labels: [],
    additions: 7,
    deletions: 3,
    reviewDecision: null,
    checkStatus: 'pending',
  }

  it('renders metadata and opens GitHub without triggering row actions', () => {
    const onClick = vi.fn()
    const onInvestigate = vi.fn()
    const onPreview = vi.fn()
    const onOpenReview = vi.fn()

    render(
      <PRItem
        pr={pr}
        index={0}
        isSelected={false}
        isCreating={false}
        onMouseEnter={vi.fn()}
        onClick={onClick}
        onInvestigate={onInvestigate}
        onPreview={onPreview}
        onOpenReview={onOpenReview}
      />
    )

    expect(screen.getByAltText('octocat avatar')).toBeInTheDocument()
    expect(screen.getByText('octocat')).toBeInTheDocument()
    expect(screen.getByText('opened 1d ago')).toBeInTheDocument()
    expect(screen.getByText('+7')).toBeInTheDocument()
    expect(screen.getByText('-3')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open PR on GitHub' }))

    expect(openExternalMock).toHaveBeenCalledWith(pr.url)
    expect(onClick).not.toHaveBeenCalled()
    expect(onInvestigate).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
    expect(onOpenReview).not.toHaveBeenCalled()
  })

  it('opens the review surface without triggering row actions', () => {
    const onClick = vi.fn()
    const onInvestigate = vi.fn()
    const onPreview = vi.fn()
    const onOpenReview = vi.fn()

    render(
      <PRItem
        pr={pr}
        index={0}
        isSelected={false}
        isCreating={false}
        onMouseEnter={vi.fn()}
        onClick={onClick}
        onInvestigate={onInvestigate}
        onPreview={onPreview}
        onOpenReview={onOpenReview}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Review PR diff and comments' })
    )

    expect(onOpenReview).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
    expect(onInvestigate).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
  })
})
