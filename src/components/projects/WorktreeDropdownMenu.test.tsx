import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { WorktreeDropdownMenu } from './WorktreeDropdownMenu'
import type { Worktree } from '@/types/projects'

const envMocks = vi.hoisted(() => ({ isNativeApp: false, isMobile: false }))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => envMocks.isNativeApp,
}))
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => envMocks.isMobile }))
vi.mock('@/services/projects', () => ({ useProjects: () => ({ data: [] }) }))
vi.mock('@/services/github', () => ({
  useDependabotAlerts: () => ({ data: [] }),
  useGitHubIssues: () => ({ data: { totalCount: 0 } }),
  useGitHubPRs: () => ({ data: [] }),
  useRepositoryAdvisories: () => ({ data: [] }),
  useWorkflowRuns: () => ({ data: { runs: [], failedCount: 0 } }),
}))
vi.mock('@/services/gh-cli', () => ({
  ghCliQueryKeys: { auth: () => ['gh-cli', 'auth'] },
}))
vi.mock('./useWorktreeMenuActions', () => ({
  useWorktreeMenuActions: () => ({
    showDeleteConfirm: false,
    setShowDeleteConfirm: vi.fn(),
    isBase: false,
    hasMessages: false,
    buildScript: null,
    runScripts: [],
    preferences: {},
    effectiveEditor: null,
    handleRun: vi.fn(),
    handleRunCommand: vi.fn(),
    handleBuild: vi.fn(),
    handleOpenInFinder: vi.fn(),
    handleOpenInTerminal: vi.fn(),
    handleOpenInEditor: vi.fn(),
    handleArchiveOrClose: vi.fn(),
    handleDelete: vi.fn(),
    handleOpenJeanConfig: vi.fn(),
    handleGenerateRecap: vi.fn(),
  }),
}))

const worktree: Worktree = {
  id: 'wt-1',
  name: 'feature',
  path: '/tmp/project/feature',
  branch: 'feature',
  base_branch: 'main',
  project_id: 'project-1',
  created_at: 1767225600000,
  order: 0,
}

describe('WorktreeDropdownMenu compact actions', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes terminal, browser, and package scripts supplied by a session modal', async () => {
    const user = userEvent.setup()
    const onToggleTerminal = vi.fn()
    const onToggleBrowser = vi.fn()
    const onRunPackageScript = vi.fn()
    render(
      <WorktreeDropdownMenu
        worktree={worktree}
        projectId="project-1"
        projectPath="/tmp/project"
        onToggleTerminal={onToggleTerminal}
        onToggleBrowser={onToggleBrowser}
        packageScripts={[{ name: 'test', command: 'bun', args: ['test'] }]}
        onRunPackageScript={onRunPackageScript}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Terminal' }))
    expect(onToggleTerminal).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'Browser' }))
    expect(onToggleBrowser).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    expect(
      screen.getByRole('menuitem', { name: 'Scripts' })
    ).toBeInTheDocument()
  })
})
