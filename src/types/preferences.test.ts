import { describe, expect, it } from 'vitest'
import {
  CODEX_DEFAULT_MAGIC_PROMPT_EFFORTS,
  DEFAULT_CLAUDE_SYSTEM_PROMPT,
  DEFAULT_CODEX_SYSTEM_PROMPT,
  DEFAULT_MAGIC_PROMPT_EFFORTS,
  DEFAULT_MAGIC_PROMPTS,
  DEFAULT_MAGIC_PROMPT_MODELS,
  DEFAULT_MAGIC_PROMPT_PROVIDERS,
  DEFAULT_OPENCODE_SYSTEM_PROMPT,
  magicPromptReasoningOptions,
  isMagicPromptModelCompatibleWithBackend,
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
    expect(isMagicPromptModelCompatibleWithBackend('gpt-5.4', 'claude')).toBe(
      false
    )
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

describe('magic prompt review comments defaults', () => {
  it('includes review comments overrides in the shared defaults', () => {
    expect(DEFAULT_MAGIC_PROMPT_MODELS.review_comments_model).toBe(
      'claude-opus-4-7'
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

describe('backend-specific system prompt defaults', () => {
  it('keeps the new prompt fields in the shared defaults', () => {
    expect(DEFAULT_MAGIC_PROMPTS.claude_system_prompt).toBeNull()
    expect(DEFAULT_MAGIC_PROMPTS.codex_system_prompt).toBeNull()
    expect(DEFAULT_MAGIC_PROMPTS.opencode_system_prompt).toBeNull()
  })

  it('uses built-in defaults for Claude and Codex only', () => {
    expect(DEFAULT_CLAUDE_SYSTEM_PROMPT).not.toHaveLength(0)
    expect(DEFAULT_CODEX_SYSTEM_PROMPT).toBe(DEFAULT_CLAUDE_SYSTEM_PROMPT)
    expect(DEFAULT_OPENCODE_SYSTEM_PROMPT).toBe('')
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
