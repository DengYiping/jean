import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { GitDiffModal } from './GitDiffModal'
import { useUIStore } from '@/store/ui-store'
import type { GitDiff } from '@/types/git-diff'

const mockGetGitDiff = vi.fn()
const mockReadFileContent = vi.fn()
const mockReadGitFileContent = vi.fn()
const mockMemoizedFileView = vi.fn()
const mockMemoizedFileDiff = vi.fn()

vi.mock('@/services/git-status', () => ({
  getGitDiff: (...args: unknown[]) => mockGetGitDiff(...args),
  readFileContent: (...args: unknown[]) => mockReadFileContent(...args),
  readGitFileContent: (...args: unknown[]) => mockReadGitFileContent(...args),
  revertFile: vi.fn(),
  triggerImmediateGitPoll: vi.fn(),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      syntax_theme_dark: 'vitesse-black',
      syntax_theme_light: 'github-light',
    },
  }),
}))

vi.mock('@/hooks/use-theme', () => ({
  useTheme: () => ({ theme: 'light' }),
}))

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

vi.mock('./CommitsTabView', () => ({
  CommitsTabView: () => <div>Commits tab</div>,
}))

vi.mock('./MemoizedFileDiff', () => ({
  MemoizedFileDiff: (props: {
    fileName: string
    oldLines?: string[]
    newLines?: string[]
    expandUnchanged?: boolean
  }) => {
    mockMemoizedFileDiff(props)
    return <div data-testid="diff-view">Diff view: {props.fileName}</div>
  },
  getStatusColor: () => 'text-blue-500',
}))

vi.mock('./MemoizedFileView', () => ({
  MemoizedFileView: ({
    fileName,
    fileContents,
    touchedLines,
  }: {
    fileName: string
    fileContents: { contents: string }
    touchedLines?: number[]
  }) =>
    (() => {
      mockMemoizedFileView({ fileName, fileContents, touchedLines })
      return (
        <div data-testid="file-view">
          File view: {fileName} :: {fileContents.contents}
        </div>
      )
    })(),
}))

vi.mock('@pierre/diffs', () => ({
  parsePatchFiles: vi.fn(),
  getFiletypeFromFileName: vi.fn(() => 'ts'),
}))

function buildDiff(overrides: Partial<GitDiff> = {}): GitDiff {
  return {
    diff_type: 'uncommitted',
    base_ref: 'HEAD',
    target_ref: 'working directory',
    total_additions: 1,
    total_deletions: 0,
    files: [
      {
        path: 'src/example.ts',
        old_path: null,
        status: 'modified',
        additions: 1,
        deletions: 0,
        is_binary: false,
        hunks: [],
      },
    ],
    raw_patch: 'mock patch',
    ...overrides,
  }
}

describe('GitDiffModal', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    useUIStore.getState().clearGitDiffSelectedFiles()
    useUIStore.getState().setGitDiffModalOpen(false)

    const pierreDiffs = await import('@pierre/diffs')
    vi.mocked(pierreDiffs.parsePatchFiles).mockReturnValue([
      {
        files: [
          {
            name: 'src/example.ts',
            prevName: undefined,
            type: 'change',
            hunks: [
              {
                additionStart: 10,
                additionCount: 1,
                deletionCount: 0,
                hunkContent: [
                  {
                    type: 'context',
                    lines: ['context before'],
                  },
                  {
                    type: 'change',
                    additions: ['new line 1', 'new line 2'],
                    deletions: ['old line 1'],
                  },
                  {
                    type: 'context',
                    lines: ['context after'],
                  },
                ],
              },
            ],
            splitLineCount: 1,
            unifiedLineCount: 1,
          },
        ],
      },
    ] as never)
  })

  afterEach(() => {
    useUIStore.getState().clearGitDiffSelectedFiles()
  })

  it('uses git-ref-backed content reads when toggling branch diffs into file mode', async () => {
    mockGetGitDiff.mockResolvedValueOnce(
      buildDiff({
        diff_type: 'branch',
        base_ref: 'origin/main',
        target_ref: 'HEAD',
      })
    )
    mockReadGitFileContent.mockResolvedValueOnce('export const branchView = 1')

    render(
      <GitDiffModal
        diffRequest={{
          type: 'branch',
          worktreePath: '/tmp/worktree',
          baseBranch: 'main',
        }}
        onClose={vi.fn()}
      />
    )

    await screen.findByText('Diff view: src/example.ts')

    fireEvent.keyDown(document, { key: 'f' })

    await waitFor(() => {
      expect(mockReadGitFileContent).toHaveBeenCalledWith(
        '/tmp/worktree',
        'src/example.ts',
        'HEAD'
      )
    })

    expect(mockReadFileContent).not.toHaveBeenCalled()
    expect(screen.getByTestId('file-view')).toHaveTextContent(
      'File view: src/example.ts :: export const branchView = 1'
    )
    expect(mockMemoizedFileView).toHaveBeenCalledWith(
      expect.objectContaining({
        touchedLines: [11, 12],
      })
    )
  })

  it('shows the deleted-file message in file mode without fetching content', async () => {
    mockGetGitDiff.mockResolvedValueOnce(
      buildDiff({
        files: [
          {
            path: 'src/deleted.ts',
            old_path: null,
            status: 'deleted',
            additions: 0,
            deletions: 12,
            is_binary: false,
            hunks: [],
          },
        ],
        raw_patch: '',
      })
    )

    const pierreDiffs = await import('@pierre/diffs')
    vi.mocked(pierreDiffs.parsePatchFiles).mockReturnValue([])

    render(
      <GitDiffModal
        diffRequest={{
          type: 'uncommitted',
          worktreePath: '/tmp/worktree',
          baseBranch: 'main',
        }}
        onClose={vi.fn()}
      />
    )

    await screen.findByText('Diff view: src/deleted.ts')

    fireEvent.click(screen.getByRole('button', { name: /view file/i }))

    expect(
      screen.getByText(
        'This file was deleted. Switch to diff view to see the removed content.'
      )
    ).toBeInTheDocument()
    expect(mockReadFileContent).not.toHaveBeenCalled()
    expect(mockReadGitFileContent).not.toHaveBeenCalled()
  })

  it('loads old and new file contents when expanding uncommitted diff context', async () => {
    mockGetGitDiff.mockResolvedValueOnce(buildDiff())
    mockReadGitFileContent.mockResolvedValueOnce('old line\n')
    mockReadFileContent.mockResolvedValueOnce('new line\n')

    render(
      <GitDiffModal
        diffRequest={{
          type: 'uncommitted',
          worktreePath: '/tmp/worktree',
          baseBranch: 'main',
        }}
        onClose={vi.fn()}
      />
    )

    await screen.findByText('Diff view: src/example.ts')

    fireEvent.click(
      screen.getByRole('button', { name: /expand unchanged lines/i })
    )

    await waitFor(() => {
      expect(mockReadGitFileContent).toHaveBeenCalledWith(
        '/tmp/worktree',
        'src/example.ts',
        'HEAD'
      )
      expect(mockReadFileContent).toHaveBeenCalledWith(
        '/tmp/worktree/src/example.ts'
      )
      expect(mockMemoizedFileDiff).toHaveBeenLastCalledWith(
        expect.objectContaining({
          oldLines: ['old line\n'],
          newLines: ['new line\n'],
          expandUnchanged: true,
        })
      )
    })
  })
})
