import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import { ResolveConflictsDialog } from './ResolveConflictsDialog'
import { useProjectsStore } from '@/store/projects-store'

vi.mock('@/services/projects', () => ({
  useWorktree: () => ({
    data: {
      id: 'worktree-1',
      project_id: 'project-1',
      path: '/tmp/project/.worktrees/feature',
    },
  }),
  useProjects: () => ({
    data: [{ id: 'project-1', default_backend: 'codex' }],
  }),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      default_backend: 'claude',
      selected_codex_model: 'gpt-5.4',
      selected_model: 'sonnet',
      selected_opencode_model: 'opencode/gpt-5.3-codex',
      magic_prompt_backends: { resolve_conflicts_backend: 'codex' },
      magic_prompt_models: { resolve_conflicts_model: 'gpt-5.4' },
      magic_prompt_providers: { resolve_conflicts_provider: null },
      custom_codex_models: [],
      custom_cli_profiles: [],
    },
  }),
}))

vi.mock('@/services/opencode-cli', () => ({
  useAvailableOpencodeModels: () => ({ data: [] }),
}))

vi.mock('@/hooks/useInstalledBackends', () => ({
  useInstalledBackends: () => ({
    installedBackends: ['claude', 'codex', 'opencode'],
  }),
}))

vi.mock('@/services/model-catalog', () => ({
  getCodexModelOptions: () => [{ value: 'gpt-5.4', label: 'GPT-5.4' }],
  useModelCatalog: () => ({ data: null }),
}))

describe('ResolveConflictsDialog', () => {
  beforeEach(() => {
    useProjectsStore.setState({ selectedWorktreeId: 'worktree-1' })
  })

  it('confirms default magic-prompt settings as a concrete override', async () => {
    const onConfirm = vi.fn()
    const onOpenChange = vi.fn()

    render(
      <ResolveConflictsDialog
        open
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />
    )

    await userEvent.click(
      screen.getByRole('button', { name: 'Resolve conflicts' })
    )

    expect(onConfirm).toHaveBeenCalledWith({
      backend: 'codex',
      model: 'gpt-5.4',
      provider: null,
    })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
