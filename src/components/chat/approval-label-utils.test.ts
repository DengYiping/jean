import { describe, expect, it } from 'vitest'
import { resolveApprovalLabel } from './approval-label-utils'

describe('resolveApprovalLabel', () => {
  it('formats Codex fast variants with a friendly label', () => {
    expect(
      resolveApprovalLabel(
        'build',
        {
          build_model: 'gpt-5.4-fast',
          build_backend: 'codex',
          selected_codex_model: 'gpt-5.5',
          default_backend: 'codex',
        },
        'codex'
      )
    ).toBe('codex · GPT 5.4 Fast')
  })

  it('falls back to the newer default Codex model label', () => {
    expect(
      resolveApprovalLabel(
        'build',
        {
          selected_codex_model: undefined,
          default_backend: 'codex',
        },
        'codex'
      )
    ).toBe('codex · GPT 5.5')
  })
})
