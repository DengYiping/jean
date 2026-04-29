import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { OpenFileInEditorButton } from './OpenFileInEditorButton'

const openFileInEditorMutate = vi.fn()

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      editor: 'cursor',
    },
  }),
  useAvailableEditors: () => ({
    data: ['cursor', 'zed', 'vscode'],
  }),
}))

vi.mock('@/services/files', () => ({
  useOpenFileInEditor: () => ({
    mutate: openFileInEditorMutate,
  }),
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
}))

describe('OpenFileInEditorButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the project editor as the default label', () => {
    render(
      <OpenFileInEditorButton
        filePath="/tmp/worktree/src/example.ts"
        preferredEditor="zed"
      />
    )

    expect(screen.getByRole('button', { name: /Open in Zed/i })).toBeVisible()
  })

  it('opens with backend editor resolution for the default action', () => {
    render(
      <OpenFileInEditorButton
        filePath="/tmp/worktree/src/example.ts"
        preferredEditor="zed"
        lineNumber={12}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /Open in Zed/i }))

    expect(openFileInEditorMutate).toHaveBeenCalledWith({
      path: '/tmp/worktree/src/example.ts',
      editor: undefined,
      lineNumber: 12,
    })
  })

  it('renders detected editors in the dropdown and opens the selected editor', () => {
    render(
      <OpenFileInEditorButton
        filePath="/tmp/worktree/src/example.ts"
        preferredEditor="zed"
      />
    )

    const dropdownTrigger = screen.getAllByRole('button')[1]
    if (!dropdownTrigger) {
      throw new Error('Expected open-file dropdown trigger')
    }

    fireEvent.pointerDown(dropdownTrigger)
    expect(screen.getByRole('menuitem', { name: 'VS Code' })).toBeVisible()
    fireEvent.click(screen.getByRole('menuitem', { name: 'VS Code' }))

    expect(openFileInEditorMutate).toHaveBeenCalledWith({
      path: '/tmp/worktree/src/example.ts',
      editor: 'vscode',
      lineNumber: undefined,
    })
  })

  it('renders as disabled when the file cannot be opened', () => {
    render(
      <OpenFileInEditorButton
        filePath="/tmp/worktree/src/deleted.ts"
        preferredEditor="zed"
        disabled
      />
    )

    expect(screen.getByRole('button', { name: /Open in Zed/i })).toBeDisabled()
  })
})
