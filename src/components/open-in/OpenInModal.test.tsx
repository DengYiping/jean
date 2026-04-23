import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { OpenInModal } from './OpenInModal'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

const openInEditorMutate = vi.fn()

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      editor: 'cursor',
      terminal: 'terminal',
    },
  }),
  useAvailableEditors: () => ({
    data: ['cursor', 'zed', 'vscode'],
  }),
}))

vi.mock('@/services/projects', () => ({
  useOpenWorktreeInFinder: () => ({
    mutate: vi.fn(),
  }),
  useOpenWorktreeInTerminal: () => ({
    mutate: vi.fn(),
  }),
  useOpenWorktreeInEditor: () => ({
    mutate: openInEditorMutate,
  }),
  useProjects: () => ({
    data: [
      {
        id: 'project-1',
        name: 'Test Project',
        path: '/tmp/project',
        default_editor: 'zed',
      },
    ],
  }),
  useWorktree: () => ({
    data: {
      path: '/tmp/worktree',
      project_id: 'project-1',
      branch: 'main',
      pr_url: null,
      pr_number: null,
    },
  }),
  usePorts: () => ({
    data: [],
  }),
}))

vi.mock('@/services/github', () => ({
  useLoadedIssueContexts: () => ({
    data: [],
  }),
  useLoadedPRContexts: () => ({
    data: [],
  }),
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
}))

vi.mock('@/lib/platform', () => ({
  isMacOS: true,
  isWindows: false,
  openExternal: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

describe('OpenInModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectsStore.setState({
      selectedWorktreeId: 'worktree-1',
      selectedProjectId: null,
    })
    useChatStore.setState({
      activeWorktreeId: 'worktree-1',
      activeSessionIds: { 'worktree-1': 'session-1' },
    })
    useUIStore.setState({
      openInModalOpen: true,
      sessionChatModalWorktreeId: null,
    })
  })

  it('shows additional detected editors and opens the selected editor', () => {
    render(<OpenInModal />)

    expect(screen.getByRole('button', { name: /Zed/ })).toBeVisible()
    expect(screen.getByRole('button', { name: 'VS Code' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'VS Code' }))

    expect(openInEditorMutate).toHaveBeenCalledWith({
      worktreePath: '/tmp/worktree',
      editor: 'vscode',
    })
  })

  it('uses the project editor for the default open action', () => {
    render(<OpenInModal />)

    fireEvent.click(screen.getByRole('button', { name: /Zed/ }))

    expect(openInEditorMutate).toHaveBeenCalledWith({
      worktreePath: '/tmp/worktree',
      editor: undefined,
    })
  })
})
