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

const preferencesMock = vi.hoisted(() => ({
  data: undefined as
    | {
        magic_prompts: typeof DEFAULT_MAGIC_PROMPTS
        magic_prompt_models: typeof DEFAULT_MAGIC_PROMPT_MODELS
        magic_prompt_providers: typeof DEFAULT_MAGIC_PROMPT_PROVIDERS
        magic_prompt_backends: typeof DEFAULT_MAGIC_PROMPT_BACKENDS
        magic_prompt_efforts: typeof DEFAULT_MAGIC_PROMPT_EFFORTS
        custom_cli_profiles: never[]
        default_backend: 'claude' | 'codex'
        default_provider: null
      }
    | undefined,
}))
const installedBackendsMock = vi.hoisted(() => ({
  value: ['codex'],
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({
    data: preferencesMock.data,
  }),
  usePatchPreferences: () => ({
    mutate: vi.fn(),
  }),
}))

vi.mock('@/hooks/useInstalledBackends', () => ({
  useInstalledBackends: () => ({
    installedBackends: installedBackendsMock.value,
  }),
}))

vi.mock('@/services/opencode-cli', () => ({
  useAvailableOpencodeModels: () => ({ data: [] }),
}))

vi.mock('@/services/model-catalog', () => ({
  getCatalogModelOptions: (_catalog: unknown, backend: 'claude' | 'codex') =>
    backend === 'claude'
      ? [
          { value: 'claude-fable-5', label: 'Claude Fable 5' },
          { value: 'claude-sonnet-5', label: 'Claude Sonnet 5' },
        ]
      : [],
  getCodexModelOptions: () => [{ value: 'gpt-5.4', label: 'GPT 5.4' }],
  useModelCatalog: () => ({ data: null }),
}))

describe('MagicPromptsPane', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    installedBackendsMock.value = ['codex']
    preferencesMock.data = {
      magic_prompts: DEFAULT_MAGIC_PROMPTS,
      magic_prompt_models: DEFAULT_MAGIC_PROMPT_MODELS,
      magic_prompt_providers: DEFAULT_MAGIC_PROMPT_PROVIDERS,
      magic_prompt_backends: DEFAULT_MAGIC_PROMPT_BACKENDS,
      magic_prompt_efforts: DEFAULT_MAGIC_PROMPT_EFFORTS,
      custom_cli_profiles: [],
      default_backend: 'codex',
      default_provider: null,
    }
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

  it('does not replace an active edit when saved preferences refresh', async () => {
    const user = userEvent.setup()
    const { container, rerender } = render(<MagicPromptsPane />)
    const textarea = container.querySelector('textarea')
    if (!textarea || !preferencesMock.data) {
      throw new Error('Expected magic prompt textarea and preferences')
    }

    await user.clear(textarea)
    await user.type(textarea, 'hello world')
    textarea.setSelectionRange(5, 5)
    await user.type(textarea, ', brave', { skipClick: true })

    preferencesMock.data = {
      ...preferencesMock.data,
      magic_prompts: {
        ...DEFAULT_MAGIC_PROMPTS,
        investigate_issue: 'hello',
      },
    }
    rerender(<MagicPromptsPane />)

    expect(textarea).toHaveValue('hello, brave world')
    expect(textarea).toHaveFocus()
    expect(textarea.selectionStart).toBe(12)
  })

  it('includes release post as an editable magic prompt', () => {
    render(<MagicPromptsPane />)

    expect(screen.getByText('Release Post')).toBeInTheDocument()
  })

  it('uses the catalog Claude models for magic prompt model choices', async () => {
    installedBackendsMock.value = ['claude']
    if (!preferencesMock.data) throw new Error('Expected preferences')
    preferencesMock.data = {
      ...preferencesMock.data,
      default_backend: 'claude',
      magic_prompt_backends: {
        ...DEFAULT_MAGIC_PROMPT_BACKENDS,
        investigate_issue_backend: 'claude',
      },
    }

    const user = userEvent.setup()
    render(<MagicPromptsPane />)

    const [, modelCombobox] = screen.getAllByRole('combobox')
    if (!modelCombobox) throw new Error('Expected model combobox')
    await user.click(modelCombobox)

    expect(screen.getByText('Fable 5')).toBeInTheDocument()
  })
})
