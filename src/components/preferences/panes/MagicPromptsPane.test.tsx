import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import {
  DEFAULT_MAGIC_PROMPT_BACKENDS,
  DEFAULT_MAGIC_PROMPT_EFFORTS,
  DEFAULT_MAGIC_PROMPT_MODELS,
  DEFAULT_MAGIC_PROMPT_PROVIDERS,
  DEFAULT_MAGIC_PROMPTS,
} from '@/types/preferences'
import { MagicPromptsPane } from './MagicPromptsPane'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: {
      magic_prompts: DEFAULT_MAGIC_PROMPTS,
      magic_prompt_models: DEFAULT_MAGIC_PROMPT_MODELS,
      magic_prompt_providers: DEFAULT_MAGIC_PROMPT_PROVIDERS,
      magic_prompt_backends: DEFAULT_MAGIC_PROMPT_BACKENDS,
      magic_prompt_efforts: DEFAULT_MAGIC_PROMPT_EFFORTS,
      custom_cli_profiles: [],
      default_backend: 'codex',
      default_provider: null,
    },
  }),
  usePatchPreferences: () => ({
    mutate: vi.fn(),
  }),
}))

vi.mock('@/hooks/useInstalledBackends', () => ({
  useInstalledBackends: () => ({
    installedBackends: ['codex'],
  }),
}))

vi.mock('@/services/opencode-cli', () => ({
  useAvailableOpencodeModels: () => ({ data: [] }),
}))

describe('MagicPromptsPane', () => {
  beforeEach(() => {
    globalThis.ResizeObserver = class ResizeObserver {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
  })

  it('shows all PR description template variables', async () => {
    const user = userEvent.setup()
    render(<MagicPromptsPane />)

    await user.click(screen.getByRole('button', { name: 'PR Description' }))

    expect(screen.getByText('{current_branch}')).toBeInTheDocument()
    expect(screen.getByText('{target_branch}')).toBeInTheDocument()
    expect(screen.getByText('{commit_count}')).toBeInTheDocument()
    expect(screen.getByText('{context}')).toBeInTheDocument()
    expect(screen.getByText('{commits}')).toBeInTheDocument()
    expect(screen.getByText('{session_recap}')).toBeInTheDocument()
    expect(screen.getByText('{diff}')).toBeInTheDocument()
  })
})
