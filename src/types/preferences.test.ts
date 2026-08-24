import { describe, expect, it } from 'vitest'
import {
  CODEX_DEFAULT_MAGIC_PROMPT_MODELS,
  CODEX_DEFAULT_MAGIC_PROMPT_EFFORTS,
  DEFAULT_AUTOMATION_RUN_PROMPT,
  DEFAULT_AUTOMATE_GITHUB_BUGS_PROMPT,
  DEFAULT_AUTOMATE_SECURITY_ADVISORIES_PROMPT,
  DEFAULT_CLAUDE_SYSTEM_PROMPT,
  DEFAULT_CODEX_SYSTEM_PROMPT,
  DEFAULT_MAGIC_PROMPT_EFFORTS,
  DEFAULT_MAGIC_PROMPTS,
  DEFAULT_MAGIC_PROMPT_MODELS,
  DEFAULT_MAGIC_PROMPT_PROVIDERS,
  DEFAULT_OPENCODE_SYSTEM_PROMPT,
  DEFAULT_PROVIDER_SWITCH_HANDOFF_PROMPT,
  DEFAULT_SMOKE_TEST_PROMPT,
  defaultPreferences,
  getCodexFastInfo,
  magicPromptReasoningOptions,
  isMagicPromptModelCompatibleWithBackend,
  normalizeCodexModelProviderOverrides,
  normalizeCodexModel,
  normalizeCustomCodexModels,
  OPENCODE_DEFAULT_MAGIC_PROMPT_MODELS,
  OPENCODE_DEFAULT_MAGIC_PROMPT_EFFORTS,
  resolveMagicPromptBackend,
  type MagicPromptBackends,
} from './preferences'

describe('magic prompt backend resolution', () => {
  it('prefers the per-prompt backend override when present', () => {
    expect(
      resolveMagicPromptBackend(
        { review_comments_backend: 'codex' } as MagicPromptBackends,
        'review_comments_backend',
        'claude'
      )
    ).toBe('codex')
  })

  it('falls back to the global default backend when no override is set', () => {
    expect(
      resolveMagicPromptBackend(
        { review_comments_backend: null } as MagicPromptBackends,
        'review_comments_backend',
        'opencode'
      )
    ).toBe('opencode')
  })

  it('falls back to claude when both values are missing or invalid', () => {
    expect(
      resolveMagicPromptBackend(undefined, 'review_comments_backend', 'weird')
    ).toBe('claude')
  })
})

describe('preference defaults', () => {
  it('provides configurable smoke test defaults', () => {
    expect(defaultPreferences.magic_prompts.smoke_test).toBeNull()
    expect(defaultPreferences.magic_prompt_models.smoke_test_model).toBe(
      'claude-opus-4-8[1m]'
    )
    expect(DEFAULT_SMOKE_TEST_PROMPT).toContain('{source_session_id}')
    expect(DEFAULT_SMOKE_TEST_PROMPT).toContain('start_run_environment')
  })

  it('provides automation prompts for bug and advisory investigations', () => {
    expect(
      defaultPreferences.magic_prompt_models.automate_github_bugs_model
    ).toBe('claude-opus-4-8[1m]')
    expect(
      defaultPreferences.magic_prompt_models.automate_security_advisories_model
    ).toBe('claude-opus-4-8[1m]')
    expect(DEFAULT_AUTOMATE_GITHUB_BUGS_PROMPT).toContain('list_github_issues')
    expect(DEFAULT_AUTOMATE_SECURITY_ADVISORIES_PROMPT).toContain('ghsaId')
  })

  it('keeps recap prompting disabled by default', () => {
    expect(defaultPreferences.recap_prompting_enabled).toBe(false)
  })

  it('uses Codex default providers unless overrides are configured', () => {
    expect(defaultPreferences.codex_model_provider_overrides).toEqual({})
  })

  it('has no custom Codex models by default', () => {
    expect(defaultPreferences.custom_codex_models).toEqual([])
  })
})

describe('magic prompt model compatibility', () => {
  it('accepts Claude models only for the Claude backend', () => {
    expect(isMagicPromptModelCompatibleWithBackend('opus', 'claude')).toBe(true)
    expect(isMagicPromptModelCompatibleWithBackend('opus', 'codex')).toBe(false)
    expect(isMagicPromptModelCompatibleWithBackend('opus', 'opencode')).toBe(
      false
    )
  })

  it('accepts Codex models only for the Codex backend', () => {
    expect(isMagicPromptModelCompatibleWithBackend('gpt-5.4', 'codex')).toBe(
      true
    )
    expect(
      isMagicPromptModelCompatibleWithBackend('gpt-5.6-sol', 'codex')
    ).toBe(true)
    expect(isMagicPromptModelCompatibleWithBackend('gpt-5.4', 'claude')).toBe(
      false
    )
  })

  it('accepts custom Codex models only for the Codex backend', () => {
    const customCodexModels = [{ model_id: 'o3', display_name: 'O3' }]
    expect(
      isMagicPromptModelCompatibleWithBackend('o3', 'codex', customCodexModels)
    ).toBe(true)
    expect(
      isMagicPromptModelCompatibleWithBackend('o3', 'claude', customCodexModels)
    ).toBe(false)
  })

  it('accepts OpenCode models only for the OpenCode backend', () => {
    expect(
      isMagicPromptModelCompatibleWithBackend(
        'opencode/gpt-5.3-codex',
        'opencode'
      )
    ).toBe(true)
    expect(
      isMagicPromptModelCompatibleWithBackend(
        'opencode/gpt-5.3-codex',
        'claude'
      )
    ).toBe(false)
  })
})

describe('codex fast model handling', () => {
  it('recognizes the supported fast-tier base and fast variants', () => {
    expect(getCodexFastInfo('gpt-5.6-sol')).toMatchObject({
      supportsFast: true,
      isFast: false,
      baseModel: 'gpt-5.6-sol',
      fastModel: 'gpt-5.6-sol-fast',
    })
    expect(getCodexFastInfo('gpt-5.6-sol-fast')).toMatchObject({
      supportsFast: true,
      isFast: true,
      baseModel: 'gpt-5.6-sol',
      fastModel: 'gpt-5.6-sol-fast',
    })
    expect(getCodexFastInfo('gpt-5.5')).toMatchObject({
      supportsFast: true,
      isFast: false,
      baseModel: 'gpt-5.5',
      fastModel: 'gpt-5.5-fast',
    })
    expect(getCodexFastInfo('gpt-5.5-fast')).toMatchObject({
      supportsFast: true,
      isFast: true,
      baseModel: 'gpt-5.5',
      fastModel: 'gpt-5.5-fast',
    })
    expect(getCodexFastInfo('gpt-5.4-mini')).toMatchObject({
      supportsFast: true,
      isFast: false,
      baseModel: 'gpt-5.4-mini',
      fastModel: 'gpt-5.4-mini-fast',
    })
    expect(getCodexFastInfo('gpt-5.4-mini-fast')).toMatchObject({
      supportsFast: true,
      isFast: true,
      baseModel: 'gpt-5.4-mini',
      fastModel: 'gpt-5.4-mini-fast',
    })
  })

  it('normalizes persisted Codex model aliases', () => {
    expect(normalizeCodexModel('gpt-5.6')).toBe('gpt-5.6-sol')
    expect(normalizeCodexModel('gpt-5.6-fast')).toBe('gpt-5.6-sol-fast')
    expect(normalizeCodexModel('gpt-5-6-sol')).toBe('gpt-5.6-sol')
    expect(normalizeCodexModel('gpt-5-6-sol-fast')).toBe('gpt-5.6-sol-fast')
    expect(normalizeCodexModel('gpt-5-6-terra')).toBe('gpt-5.6-terra')
    expect(normalizeCodexModel('gpt-5-6-terra-fast')).toBe('gpt-5.6-terra-fast')
    expect(normalizeCodexModel('gpt-5-6-luna')).toBe('gpt-5.6-luna')
    expect(normalizeCodexModel('gpt-5-6-luna-fast')).toBe('gpt-5.6-luna-fast')
    expect(normalizeCodexModel('gpt-5.5-fast')).toBe('gpt-5.5')
    expect(normalizeCodexModel('gpt-5.4-fast')).toBe('gpt-5.4')
    expect(normalizeCodexModel('gpt-5.4-mini-fast')).toBe('gpt-5.4-mini')
  })

  it('preserves unknown custom Codex model ids', () => {
    expect(normalizeCodexModel(' o3 ')).toBe('o3')
  })
})

describe('codex model provider overrides', () => {
  it('trims configured model provider overrides and drops blanks', () => {
    expect(
      normalizeCodexModelProviderOverrides({
        ' gpt-5.5 ': ' openrouter ',
        'gpt-5.4': '   ',
        '  ': 'openai',
      })
    ).toEqual({ 'gpt-5.5': 'openrouter' })
  })
})

describe('custom Codex models', () => {
  it('trims rows, drops blank ids, dedupes by model id, and falls back to id for blank names', () => {
    expect(
      normalizeCustomCodexModels([
        { model_id: ' o3 ', display_name: ' O3 ' },
        { model_id: 'o3', display_name: 'Duplicate' },
        { model_id: ' custom-model ', display_name: '   ' },
        { model_id: '   ', display_name: 'No id' },
      ])
    ).toEqual([
      { model_id: 'o3', display_name: 'O3' },
      { model_id: 'custom-model', display_name: 'custom-model' },
    ])
  })
})

describe('magic prompt review comments defaults', () => {
  it('includes review comments overrides in the shared defaults', () => {
    expect(DEFAULT_MAGIC_PROMPT_MODELS.review_comments_model).toBe(
      'claude-opus-4-8[1m]'
    )
    expect(DEFAULT_MAGIC_PROMPT_PROVIDERS.review_comments_provider).toBeNull()
    expect(DEFAULT_MAGIC_PROMPT_EFFORTS.review_comments_effort).toBeNull()
  })

  it('includes review comments effort in Codex and OpenCode presets', () => {
    expect(CODEX_DEFAULT_MAGIC_PROMPT_EFFORTS.review_comments_effort).toBe(
      'medium'
    )
    expect(OPENCODE_DEFAULT_MAGIC_PROMPT_EFFORTS.review_comments_effort).toBe(
      'medium'
    )
  })
})

describe('magic release post defaults', () => {
  it('includes release post overrides in shared backend presets', () => {
    expect(DEFAULT_MAGIC_PROMPTS.release_post).toBeNull()
    expect(DEFAULT_MAGIC_PROMPT_MODELS.release_post_model).toBe('sonnet')
    expect(CODEX_DEFAULT_MAGIC_PROMPT_MODELS.release_post_model).toBe(
      'gpt-5.3-codex'
    )
    expect(OPENCODE_DEFAULT_MAGIC_PROMPT_MODELS.release_post_model).toBe(
      'opencode/gpt-5.3-codex'
    )
    expect(DEFAULT_MAGIC_PROMPT_PROVIDERS.release_post_provider).toBeNull()
    expect(DEFAULT_MAGIC_PROMPT_EFFORTS.release_post_effort).toBeNull()
    expect(CODEX_DEFAULT_MAGIC_PROMPT_EFFORTS.release_post_effort).toBe('low')
  })
})

describe('backend-specific system prompt defaults', () => {
  it('keeps the new prompt fields in the shared defaults', () => {
    expect(DEFAULT_MAGIC_PROMPTS.claude_system_prompt).toBeNull()
    expect(DEFAULT_MAGIC_PROMPTS.codex_system_prompt).toBeNull()
    expect(DEFAULT_MAGIC_PROMPTS.opencode_system_prompt).toBeNull()
    expect(DEFAULT_MAGIC_PROMPTS.provider_switch_handoff).toBeNull()
  })

  it('uses built-in defaults for Claude and Codex only', () => {
    expect(DEFAULT_CLAUDE_SYSTEM_PROMPT).not.toHaveLength(0)
    expect(DEFAULT_CODEX_SYSTEM_PROMPT).toBe(DEFAULT_CLAUDE_SYSTEM_PROMPT)
    expect(DEFAULT_OPENCODE_SYSTEM_PROMPT).toBe('')
    expect(DEFAULT_PROVIDER_SWITCH_HANDOFF_PROMPT).toContain('{history}')
  })
})

describe('automation run prompt defaults', () => {
  it('keeps automation run customizable through shared defaults', () => {
    expect(DEFAULT_MAGIC_PROMPTS.automation_run).toBeNull()
    expect(DEFAULT_AUTOMATION_RUN_PROMPT).toContain('{prompt}')
    expect(DEFAULT_AUTOMATION_RUN_PROMPT).toContain('{automationName}')
  })
})

describe('magic prompt reasoning options', () => {
  it('includes the max Claude effort level', () => {
    expect(magicPromptReasoningOptions).toContainEqual({
      value: 'max',
      label: 'Max',
    })
  })
})
