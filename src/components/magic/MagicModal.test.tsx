import type { HTMLAttributes, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { MagicModal } from './MagicModal'

const hoisted = vi.hoisted(() => {
  let currentWorktree: {
    id: string
    project_id: string
    path: string
    branch: string
    pr_number?: number
    pr_url?: string
    cached_pr_status?: string
  } | null = null

  const invokeMock = vi.fn()
  const openExternalMock = vi.fn()
  const setMagicModalOpenMock = vi.fn()
  const setReleaseNotesModalModeMock = vi.fn()
  const setWorktreeLoadingMock = vi.fn()
  const clearWorktreeLoadingMock = vi.fn()
  const triggerImmediateGitPollMock = vi.fn()
  const fetchWorktreesStatusMock = vi.fn()

  const uiStore = {
    magicModalOpen: true,
    sessionChatModalWorktreeId: null,
    sessionChatModalOpen: false,
    setMagicModalOpen: setMagicModalOpenMock,
    setUpdatePrModalOpen: vi.fn(),
    setReviewCommentsModalOpen: vi.fn(),
    setLinkedProjectsModalOpen: vi.fn(),
    setReleaseNotesModalOpen: vi.fn(),
    setReleaseNotesModalMode: setReleaseNotesModalModeMock,
  }

  const projectsStore = {
    selectedWorktreeId: 'wt-1',
    selectedProjectId: 'project-1',
    selectWorktree: vi.fn(),
  }

  const chatStore = {
    activeWorktreeId: 'wt-1',
    activeWorktreePath: null as string | null,
    activeSessionIds: { 'wt-1': 'session-1' as string | undefined },
    setWorktreeLoading: setWorktreeLoadingMock,
    clearWorktreeLoading: clearWorktreeLoadingMock,
    setActiveWorktree: vi.fn(),
    setPendingMagicCommand: vi.fn(),
  }

  return {
    invokeMock,
    openExternalMock,
    setMagicModalOpenMock,
    setReleaseNotesModalModeMock,
    setWorktreeLoadingMock,
    clearWorktreeLoadingMock,
    triggerImmediateGitPollMock,
    fetchWorktreesStatusMock,
    uiStore,
    projectsStore,
    chatStore,
    getCurrentWorktree: () => currentWorktree,
    setCurrentWorktree: (worktree: typeof currentWorktree) => {
      currentWorktree = worktree
    },
  }
})

function getDialogContent(): Element {
  const content = document.querySelector('[tabindex="-1"]')
  if (!content) {
    throw new Error('Magic dialog content not found')
  }
  return content
}

function getCurrentWorktree() {
  const worktree = hoisted.getCurrentWorktree()
  if (!worktree) {
    throw new Error('Expected test worktree')
  }
  return worktree
}

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
  DialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
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
  useWorktree: () => ({ data: hoisted.getCurrentWorktree() }),
  useProjects: () => ({
    data: [{ id: 'project-1', name: 'Project', default_branch: 'main' }],
  }),
  projectsQueryKeys: {
    all: ['projects'],
    worktrees: (projectId: string) => ['projects', 'worktrees', projectId],
  },
}))

vi.mock('@/services/github', () => ({
  useLoadedIssueContexts: () => ({ data: [] }),
  useLoadedPRContexts: () => ({ data: [] }),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      magic_prompts: {},
      magic_prompt_models: {},
      magic_prompt_providers: {},
      magic_prompt_efforts: {},
      default_provider: null,
    },
  }),
}))

vi.mock('@/lib/transport', () => ({
  invoke: hoisted.invokeMock,
}))

vi.mock('@/lib/platform', () => ({
  isMacOS: true,
  isWindows: false,
  preOpenWindow: vi.fn(),
  openExternal: hoisted.openExternalMock,
}))

vi.mock('@/hooks/useRemotePicker', () => ({
  useRemotePicker: () => vi.fn(),
}))

vi.mock('@/services/chat', () => ({
  chatQueryKeys: {
    sessions: (worktreeId: string) => ['sessions', worktreeId],
  },
}))

vi.mock('@/services/pr-status', () => ({
  prStatusQueryKeys: {
    worktree: (worktreeId: string) => ['pr-status', worktreeId],
  },
}))

vi.mock('@/services/git-status', () => ({
  gitPush: vi.fn(),
  triggerImmediateGitPoll: hoisted.triggerImmediateGitPollMock,
  fetchWorktreesStatus: hoisted.fetchWorktreesStatusMock,
  performGitPull: vi.fn(),
  performGitPullUpstream: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  notify: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(() => 'toast-id'),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}))

describe('MagicModal', () => {
  beforeEach(() => {
    hoisted.setCurrentWorktree({
      id: 'wt-1',
      project_id: 'project-1',
      path: '/tmp/worktree',
      branch: 'feature/test',
    })
    hoisted.invokeMock.mockReset()
    hoisted.openExternalMock.mockReset()
    hoisted.setMagicModalOpenMock.mockReset()
    hoisted.setReleaseNotesModalModeMock.mockReset()
    hoisted.setWorktreeLoadingMock.mockReset()
    hoisted.clearWorktreeLoadingMock.mockReset()
    hoisted.triggerImmediateGitPollMock.mockReset()
    hoisted.fetchWorktreesStatusMock.mockReset()
  })

  it('shows a separate draft PR action when no PR exists', () => {
    render(<MagicModal />)

    expect(screen.getByRole('button', { name: /create draft/i })).toBeVisible()
    expect(
      screen.queryByRole('button', { name: /ready for review/i })
    ).not.toBeInTheDocument()
  })

  it('shows ready-for-review only for draft PRs', () => {
    hoisted.setCurrentWorktree({
      ...getCurrentWorktree(),
      pr_number: 42,
      pr_url: 'https://github.com/test/repo/pull/42',
      cached_pr_status: 'draft',
    })

    render(<MagicModal />)

    expect(
      screen.queryByRole('button', { name: /create draft/i })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /ready for review/i })
    ).toBeVisible()
  })

  it('keeps O mapped to normal PR creation', async () => {
    hoisted.invokeMock.mockResolvedValueOnce({
      pr_number: 101,
      pr_url: 'https://github.com/test/repo/pull/101',
      title: 'Normal PR',
      is_draft: false,
      existing: false,
    })

    render(<MagicModal />)
    fireEvent.keyDown(getDialogContent(), { key: 'o' })

    await waitFor(() => {
      expect(hoisted.invokeMock).toHaveBeenCalledWith(
        'create_pr_with_ai_content',
        {
          worktreePath: '/tmp/worktree',
          sessionId: 'session-1',
          customPrompt: undefined,
          model: undefined,
          customProfileName: null,
          reasoningEffort: null,
          draft: false,
        }
      )
    })
  })

  it('creates a draft PR from the separate shortcut', async () => {
    hoisted.invokeMock.mockResolvedValueOnce({
      pr_number: 102,
      pr_url: 'https://github.com/test/repo/pull/102',
      title: 'Draft PR',
      is_draft: true,
      existing: false,
    })

    render(<MagicModal />)
    fireEvent.keyDown(getDialogContent(), { key: 'y' })

    await waitFor(() => {
      expect(hoisted.invokeMock).toHaveBeenCalledWith(
        'create_pr_with_ai_content',
        {
          worktreePath: '/tmp/worktree',
          sessionId: 'session-1',
          customPrompt: undefined,
          model: undefined,
          customProfileName: null,
          reasoningEffort: null,
          draft: true,
        }
      )
    })
  })

  it('marks a draft PR ready for review from its dedicated shortcut', async () => {
    hoisted.setCurrentWorktree({
      ...getCurrentWorktree(),
      pr_number: 55,
      pr_url: 'https://github.com/test/repo/pull/55',
      cached_pr_status: 'draft',
    })
    hoisted.invokeMock.mockResolvedValueOnce(null)

    render(<MagicModal />)
    fireEvent.keyDown(getDialogContent(), { key: 'w' })

    await waitFor(() => {
      expect(hoisted.invokeMock).toHaveBeenCalledWith(
        'mark_pr_ready_for_review',
        {
          worktreeId: 'wt-1',
        }
      )
    })
  })

  it('opens release post generation from the magic release section', () => {
    render(<MagicModal />)

    fireEvent.keyDown(getDialogContent(), { key: 'x' })

    expect(hoisted.setReleaseNotesModalModeMock).toHaveBeenCalledWith('post')
    expect(hoisted.setMagicModalOpenMock).toHaveBeenCalledWith(false)
  })
})
