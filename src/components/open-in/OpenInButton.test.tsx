import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { OpenInButton } from './OpenInButton'

const openInEditorMutate = vi.fn()

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      editor: 'cursor',
      custom_editors: [
        {
          id: 'custom:helix',
          name: 'Helix',
          command: 'hx',
          args: ['{path}'],
          supports_line_number: false,
        },
      ],
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

  it('uses the project editor as the default label', () => {
    render(<OpenInButton worktreePath="/tmp/worktree" preferredEditor="zed" />)

    expect(screen.getByRole('button', { name: /Open in Zed/i })).toBeVisible()
  })

  it('renders additional detected editors in the dropdown and opens the selected editor', () => {
    render(<OpenInButton worktreePath="/tmp/worktree" preferredEditor="zed" />)

    const dropdownTrigger = screen.getAllByRole('button')[1]
    if (!dropdownTrigger) {
      throw new Error('Expected open-in dropdown trigger')
    }

    fireEvent.pointerDown(dropdownTrigger)
    expect(screen.getByRole('menuitem', { name: 'VS Code' })).toBeVisible()
    fireEvent.click(screen.getByRole('menuitem', { name: 'VS Code' }))

    expect(openInEditorMutate).toHaveBeenCalledWith({
      worktreePath: '/tmp/worktree',
      editor: 'vscode',
    })
  })

  it('does not force the global editor for the default action', () => {
    render(<OpenInButton worktreePath="/tmp/worktree" preferredEditor="zed" />)

    fireEvent.click(screen.getByRole('button', { name: /Open in Zed/i }))

    expect(openInEditorMutate).toHaveBeenCalledWith({
      worktreePath: '/tmp/worktree',
      editor: undefined,
    })
  })

  it('uses a custom project editor as the default label', () => {
    render(
      <OpenInButton
        worktreePath="/tmp/worktree"
        preferredEditor="custom:helix"
      />
    )

    expect(screen.getByRole('button', { name: /Open in Helix/i })).toBeVisible()
  })
})
