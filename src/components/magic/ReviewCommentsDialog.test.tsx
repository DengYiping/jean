import type { HTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { ReviewCommentsDialog } from './ReviewCommentsDialog'

const hoisted = vi.hoisted(() => {
  const invokeMock = vi.fn()
  const setReviewCommentsModalOpenMock = vi.fn()
  const setPendingMagicCommandMock = vi.fn()

  const uiStore = {
    reviewCommentsModalOpen: true,
    sessionChatModalOpen: false,
    sessionChatModalWorktreeId: null as string | null,
    setReviewCommentsModalOpen: setReviewCommentsModalOpenMock,
  }

  const projectsStore = {
    selectedProjectId: 'project-1',
    selectedWorktreeId: 'wt-1',
  }

  const chatStore = {
    activeWorktreeId: 'wt-1' as string | null,
    activeWorktreePath: '/tmp/worktree' as string | null,
    setPendingMagicCommand: setPendingMagicCommandMock,
  }

  return {
    invokeMock,
    setReviewCommentsModalOpenMock,
    setPendingMagicCommandMock,
    uiStore,
    projectsStore,
    chatStore,
  }
})

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
    <div {...props}>{children}</div>
  ),
  DialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/components/ui/markdown', () => ({
  Markdown: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))

vi.mock('@/store/ui-store', () => ({
  useUIStore: Object.assign(
    (selector?: (state: typeof hoisted.uiStore) => unknown) =>
      selector ? selector(hoisted.uiStore) : hoisted.uiStore,
    {
      getState: () => hoisted.uiStore,
    }
  ),
}))

vi.mock('@/store/projects-store', () => ({
  useProjectsStore: Object.assign(
    (selector?: (state: typeof hoisted.projectsStore) => unknown) =>
      selector ? selector(hoisted.projectsStore) : hoisted.projectsStore,
    {
      getState: () => hoisted.projectsStore,
    }
  ),
}))

vi.mock('@/store/chat-store', () => ({
  useChatStore: Object.assign(
    (selector?: (state: typeof hoisted.chatStore) => unknown) =>
      selector ? selector(hoisted.chatStore) : hoisted.chatStore,
    {
      getState: () => hoisted.chatStore,
    }
  ),
}))

vi.mock('@/services/projects', () => ({
  useWorktrees: () => ({
    data: [
      {
        id: 'wt-1',
        path: '/tmp/worktree',
        pr_number: 1083,
      },
    ],
  }),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { magic_prompts: {} } }),
}))

vi.mock('@/lib/transport', () => ({
  invoke: hoisted.invokeMock,
}))

describe('ReviewCommentsDialog', () => {
  beforeEach(() => {
    hoisted.invokeMock.mockReset()
    hoisted.setReviewCommentsModalOpenMock.mockReset()
    hoisted.setPendingMagicCommandMock.mockReset()
    hoisted.uiStore.reviewCommentsModalOpen = true
    hoisted.uiStore.sessionChatModalOpen = false
    hoisted.uiStore.sessionChatModalWorktreeId = null
    hoisted.chatStore.activeWorktreeId = 'wt-1'
    hoisted.chatStore.activeWorktreePath = '/tmp/worktree'
    hoisted.invokeMock.mockImplementation((command: string) => {
      if (command === 'get_pr_review_comments') {
        return Promise.resolve([
          {
            path: 'src/App.tsx',
            line: 12,
            body: 'Please fix this',
            diffHunk: '@@ -1 +1 @@',
            author: { login: 'reviewer' },
            createdAt: '2026-05-21T10:00:00Z',
          },
        ])
      }
      if (command === 'get_github_pr') {
        return Promise.resolve({ comments: [], reviews: [] })
      }
      return Promise.resolve(null)
    })
  })

  it('queues selected PR comments for the active chat', async () => {
    render(<ReviewCommentsDialog />)

    await screen.findByText('Please fix this')
    fireEvent.click(screen.getByRole('button', { name: /send to chat/i }))

    await waitFor(() => {
      expect(hoisted.setPendingMagicCommandMock).toHaveBeenCalledWith({
        command: 'review-comments',
        prompt: expect.stringContaining('Please fix this'),
      })
    })
    expect(hoisted.setReviewCommentsModalOpenMock).toHaveBeenCalledWith(false)
  })

  it('opens the session modal when no chat surface is mounted', async () => {
    hoisted.chatStore.activeWorktreeId = null
    hoisted.chatStore.activeWorktreePath = null
    const openSessionModalListener = vi.fn()
    window.addEventListener('open-session-modal', openSessionModalListener)

    render(<ReviewCommentsDialog />)

    await screen.findByText('Please fix this')
    fireEvent.click(screen.getByRole('button', { name: /send to chat/i }))

    await waitFor(() => {
      expect(openSessionModalListener).toHaveBeenCalled()
    })
    expect(openSessionModalListener.mock.calls[0]?.[0]).toMatchObject({
      detail: {
        worktreeId: 'wt-1',
        worktreePath: '/tmp/worktree',
        sessionId: '',
      },
    })

    window.removeEventListener('open-session-modal', openSessionModalListener)
  })
})
