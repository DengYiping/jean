import { fireEvent, render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { EditedFilesDisplay } from './EditedFilesDisplay'

vi.mock('./InlineFileDiff', () => ({
  InlineFileDiff: ({ filePath }: { filePath?: string }) => (
    <div data-testid="inline-file-diff">{filePath ?? 'no-file'}</div>
  ),
}))

describe('EditedFilesDisplay', () => {
  it('shows worktree-relative paths in edited-file titles', () => {
    render(
      <EditedFilesDisplay
        worktreePath="/tmp/worktree"
        onFileClick={vi.fn()}
        toolCalls={[
          {
            id: 'edit-1',
            name: 'Edit',
            input: {
              file_path: '/tmp/worktree/src/components/ChatWindow.tsx',
            },
          },
        ]}
      />
    )

    expect(
      screen.getByTitle('src/components/ChatWindow.tsx')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('/tmp/worktree/src/components/ChatWindow.tsx')
    ).not.toBeInTheDocument()
  })

  it('opens the edit diff modal when edit replacements are available', () => {
    render(
      <EditedFilesDisplay
        worktreePath="/tmp/worktree"
        onFileClick={vi.fn()}
        toolCalls={[
          {
            id: 'edit-with-diff',
            name: 'Edit',
            input: {
              file_path: '/tmp/worktree/src/components/ChatWindow.tsx',
              old_string: 'const before = true\n',
              new_string: 'const after = true\n',
            },
          },
        ]}
      />
    )

    fireEvent.click(screen.getByText('ChatWindow.tsx'))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByTestId('inline-file-diff')).toHaveTextContent(
      '/tmp/worktree/src/components/ChatWindow.tsx'
    )
  })
})
