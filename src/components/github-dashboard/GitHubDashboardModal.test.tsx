import { describe, expect, it, vi } from 'vitest'
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
    author: { login: 'ydeng' },
    labels: [],
    reviewDecision: null,
    checkStatus: 'success',
  }

  it('opens the PR URL without triggering row actions', () => {
    const onClick = vi.fn()
    const onPreview = vi.fn()
    const onInvestigate = vi.fn()

    render(
      <PRRow
        pr={pr}
        isCreating={false}
        onClick={onClick}
        onPreview={onPreview}
        onInvestigate={onInvestigate}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open PR on GitHub' }))

    expect(openExternalMock).toHaveBeenCalledWith(pr.url)
    expect(onClick).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
    expect(onInvestigate).not.toHaveBeenCalled()
  })
})
