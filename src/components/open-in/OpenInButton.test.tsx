import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { OpenInButton } from './OpenInButton'

const openInEditorMutate = vi.fn()

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      editor: 'cursor',
      terminal: 'terminal',
      open_in: 'editor',
    },
  }),
  useAvailableEditors: () => ({
    data: ['cursor', 'zed', 'vscode'],
  }),
}))

vi.mock('@/services/projects', () => ({
  useOpenWorktreeInEditor: () => ({
    mutate: openInEditorMutate,
  }),
  useOpenWorktreeInTerminal: () => ({
    mutate: vi.fn(),
  }),
  useOpenWorktreeInFinder: () => ({
    mutate: vi.fn(),
  }),
  useOpenBranchOnGitHub: () => ({
    mutate: vi.fn(),
  }),
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
}))

describe('OpenInButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders additional detected editors in the dropdown and opens the selected editor', () => {
    render(<OpenInButton worktreePath="/tmp/worktree" />)

    const dropdownTrigger = screen.getAllByRole('button')[1]
    if (!dropdownTrigger) {
      throw new Error('Expected open-in dropdown trigger')
    }

    fireEvent.pointerDown(dropdownTrigger)
    expect(screen.getByRole('menuitem', { name: 'VS Code' })).toBeVisible()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Zed' }))

    expect(openInEditorMutate).toHaveBeenCalledWith({
      worktreePath: '/tmp/worktree',
      editor: 'zed',
    })
  })
})
