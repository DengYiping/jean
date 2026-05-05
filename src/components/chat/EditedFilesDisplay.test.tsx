import { render, screen } from '@/test/test-utils'
import { describe, expect, it, vi } from 'vitest'
import { EditedFilesDisplay } from './EditedFilesDisplay'

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
})
