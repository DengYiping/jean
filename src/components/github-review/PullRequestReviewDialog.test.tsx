import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { useUIStore } from '@/store/ui-store'
import { PullRequestReviewDialog } from './PullRequestReviewDialog'
import type { GitHubPullRequestReviewData } from '@/types/github'

const refetchMock = vi.fn()
const createInlineCommentMock = vi.fn()
const replyToCommentMock = vi.fn()
const submitReviewMock = vi.fn()

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      syntax_theme_dark: 'vitesse-black',
      syntax_theme_light: 'github-light',
    },
  }),
}))

vi.mock('@pierre/diffs', () => ({
  parsePatchFiles: () => [
    {
      files: [
        {
          name: 'src/example.ts',
          prevName: undefined,
          hunks: [{ additionCount: 4, deletionCount: 1 }],
        },
      ],
    },
  ],
}))

vi.mock('@pierre/diffs/react', () => ({
  FileDiff: ({
    lineAnnotations,
    renderAnnotation,
    options,
  }: {
    lineAnnotations: { metadata?: unknown }[]
    renderAnnotation?: (annotation: { metadata?: unknown }) => React.ReactNode
    options?: { onLineSelected?: (range: unknown) => void }
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          options?.onLineSelected?.({
            start: 3,
            end: 3,
            side: 'additions',
          })
        }
      >
        select-line
      </button>
      {lineAnnotations.map((annotation, index) => (
        <div key={index}>{renderAnnotation?.(annotation)}</div>
      ))}
    </div>
  ),
}))

const reviewData: GitHubPullRequestReviewData = {
  pullRequest: {
    number: 42,
    title: 'Render PR review inline',
    body: 'Review body',
    url: 'https://github.com/acme/jean/pull/42',
    state: 'OPEN',
    headRefName: 'feature/review-dialog',
    baseRefName: 'main',
    isDraft: false,
    created_at: '2026-04-08T10:00:00Z',
    author: { login: 'ydeng', avatarUrl: null },
    labels: [],
    additions: 12,
    deletions: 4,
    reviewDecision: 'review_required',
    checkStatus: 'pending',
  },
  headCommitSha: 'abc123',
  diff: 'diff --git a/src/example.ts b/src/example.ts',
  threads: [
    {
      id: 101,
      path: 'src/example.ts',
      diffHunk: '@@ -1,1 +1,1 @@',
      line: 3,
      originalLine: 3,
      startLine: null,
      originalStartLine: null,
      side: 'RIGHT',
      startSide: null,
      comments: [
        {
          id: 101,
          author: { login: 'reviewer', avatarUrl: null },
          body: 'Please tighten this branch.',
          createdAt: '2026-04-08T11:00:00Z',
          updatedAt: '2026-04-08T11:00:00Z',
          inReplyToId: null,
          htmlUrl: null,
        },
      ],
    },
  ],
}

vi.mock('@/services/github', () => ({
  usePullRequestReviewData: () => ({
    data: reviewData,
    isLoading: false,
    error: null,
    refetch: refetchMock,
    isRefetching: false,
  }),
  useCreatePullRequestInlineComment: () => ({
    mutateAsync: createInlineCommentMock,
    isPending: false,
  }),
  useReplyToPullRequestReviewComment: () => ({
    mutateAsync: replyToCommentMock,
    isPending: false,
  }),
  useSubmitPullRequestReview: () => ({
    mutateAsync: submitReviewMock,
    isPending: false,
  }),
}))

describe('PullRequestReviewDialog', () => {
  beforeEach(() => {
    refetchMock.mockResolvedValue(undefined)
    createInlineCommentMock.mockResolvedValue(undefined)
    replyToCommentMock.mockResolvedValue(undefined)
    submitReviewMock.mockResolvedValue(undefined)
    act(() => {
      useUIStore.getState().openPullRequestReviewDialog({
        projectPath: '/tmp/project',
        prNumber: 42,
      })
    })
  })

  afterEach(() => {
    act(() => {
      useUIStore.getState().closePullRequestReviewDialog()
    })
    vi.clearAllMocks()
  })

  it('renders threads and submits replies, inline comments, and reviews', async () => {
    render(<PullRequestReviewDialog />)

    expect(screen.getByText('Render PR review inline')).toBeInTheDocument()
    expect(screen.getByText('Please tighten this branch.')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('Reply to this thread'), {
      target: { value: 'Updated in the latest push.' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Reply' }))
    })

    await waitFor(() => {
      expect(replyToCommentMock).toHaveBeenCalledWith({
        projectPath: '/tmp/project',
        prNumber: 42,
        commentId: 101,
        body: 'Updated in the latest push.',
      })
    })

    fireEvent.click(screen.getByRole('button', { name: 'select-line' }))
    fireEvent.change(screen.getByPlaceholderText('Leave an inline comment'), {
      target: { value: 'Need a null guard here.' },
    })
    const commentButtons = screen.getAllByRole('button', { name: 'Comment' })
    const inlineCommentButton = commentButtons[0]
    expect(inlineCommentButton).toBeDefined()
    if (!inlineCommentButton) {
      throw new Error('Missing inline comment button')
    }
    await act(async () => {
      fireEvent.click(inlineCommentButton)
    })

    await waitFor(() => {
      expect(createInlineCommentMock).toHaveBeenCalledWith({
        projectPath: '/tmp/project',
        prNumber: 42,
        body: 'Need a null guard here.',
        path: 'src/example.ts',
        line: 3,
        side: 'RIGHT',
        headCommitSha: 'abc123',
        startLine: undefined,
        startSide: undefined,
      })
    })

    fireEvent.change(
      screen.getByPlaceholderText('Add an overall review comment'),
      {
        target: { value: 'Looks good after the fix.' },
      }
    )
    const approveButtons = screen.getAllByRole('button', { name: 'Approve' })
    const approveButton = approveButtons[0]
    expect(approveButton).toBeDefined()
    if (!approveButton) {
      throw new Error('Missing approve button')
    }
    await act(async () => {
      fireEvent.click(approveButton)
    })

    await waitFor(() => {
      expect(submitReviewMock).toHaveBeenCalledWith({
        projectPath: '/tmp/project',
        prNumber: 42,
        body: 'Looks good after the fix.',
        event: 'APPROVE',
      })
    })

    expect(refetchMock).toHaveBeenCalled()
  })
})
