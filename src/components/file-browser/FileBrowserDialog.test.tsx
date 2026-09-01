import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { FileBrowserDialog } from './FileBrowserDialog'

vi.mock('@/services/projects', () => ({
  useWorktree: () => ({ data: { path: '/tmp/worktree' } }),
}))

vi.mock('@/services/files', () => ({
  useWorktreeFiles: () => ({
    data: [
      { relative_path: 'src', extension: '', is_dir: true },
      { relative_path: 'src/App.tsx', extension: 'tsx', is_dir: false },
      { relative_path: 'src/components', extension: '', is_dir: true },
      {
        relative_path: 'src/components/Button.tsx',
        extension: 'tsx',
        is_dir: false,
      },
      { relative_path: 'docs', extension: '', is_dir: true },
      { relative_path: 'docs/readme.md', extension: 'md', is_dir: false },
      { relative_path: 'README.md', extension: 'md', is_dir: false },
    ],
  }),
}))

vi.mock('@/components/chat/FileContentModal', () => ({
  FileContentModal: () => null,
}))

describe('FileBrowserDialog', () => {
  beforeEach(() => {
    useUIStore.setState({ fileBrowserOpen: true })
    useProjectsStore.setState({ selectedWorktreeId: 'worktree-1' })
  })

  it('filters to a selected folder and distinguishes folder and file icons', () => {
    render(<FileBrowserDialog />)

    expect(
      screen
        .getByRole('button', { name: 'src' })
        .querySelector('svg.lucide-folder')
    ).toBeInTheDocument()
    expect(
      screen
        .getByRole('button', { name: 'README.md' })
        .querySelector('svg.lucide-file')
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'src' }))

    expect(screen.getByText('src/App.tsx')).toBeInTheDocument()
    expect(screen.queryByText('docs/readme.md')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show all files' }))

    expect(screen.getByText('docs/readme.md')).toBeInTheDocument()
  })
})
