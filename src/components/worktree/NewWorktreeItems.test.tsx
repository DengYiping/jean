import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { fireEvent, render, screen } from '@/test/test-utils'
import { PRItem, SecurityAlertItem } from './NewWorktreeItems'
import type { DependabotAlert, GitHubPullRequest } from '@/types/github'

const { openExternalMock, mobileState } = vi.hoisted(() => ({
  openExternalMock: vi.fn(),
  mobileState: { isMobile: false },
}))

vi.mock('@/lib/platform', async () => {
  const actual = await vi.importActual('@/lib/platform')
  return {
    ...actual,
    openExternal: openExternalMock,
  }
})

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => mobileState.isMobile,
}))

describe('PRItem', () => {
  beforeEach(() => {
    mobileState.isMobile = false
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
        isStacking={false}
        onMouseEnter={vi.fn()}
        onClick={onClick}
        onInvestigate={onInvestigate}
        onStack={vi.fn()}
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
        isStacking={false}
        onMouseEnter={vi.fn()}
        onClick={onClick}
        onInvestigate={onInvestigate}
        onStack={vi.fn()}
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

const alert: DependabotAlert = {
  number: 12,
  state: 'open',
  packageName: 'lodash',
  packageEcosystem: 'npm',
  manifestPath: 'package.json',
  ghsaId: 'GHSA-test-1234',
  severity: 'critical',
  summary: 'Prototype pollution',
  description: 'A test advisory',
  createdAt: '2026-01-01T00:00:00Z',
  htmlUrl: 'https://github.com/example/repo/security/dependabot/12',
}

describe('NewWorktreeItems mobile actions', () => {
  beforeEach(() => {
    mobileState.isMobile = true
  })

  afterEach(() => {
    mobileState.isMobile = false
  })

  it('puts preview, investigate, and background investigation behind a mobile overflow menu', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const onInvestigate = vi.fn()

    render(
      <SecurityAlertItem
        alert={alert}
        index={0}
        isSelected={false}
        isCreating={false}
        onMouseEnter={vi.fn()}
        onClick={vi.fn()}
        onInvestigate={onInvestigate}
        onPreview={onPreview}
      />
    )

    expect(screen.queryByRole('button', { name: /preview alert/i })).toBeNull()
    expect(
      screen.queryByRole('button', { name: /investigate alert/i })
    ).toBeNull()

    await user.click(screen.getByRole('button', { name: /alert actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /preview/i }))
    expect(onPreview).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: /alert actions/i }))
    await user.click(screen.getByRole('menuitem', { name: /^investigate$/i }))
    expect(onInvestigate).toHaveBeenLastCalledWith(false)

    await user.click(screen.getByRole('button', { name: /alert actions/i }))
    await user.click(
      screen.getByRole('menuitem', { name: /investigate in background/i })
    )
    expect(onInvestigate).toHaveBeenLastCalledWith(true)
  })
})
