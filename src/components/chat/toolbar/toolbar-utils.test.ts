import { describe, expect, it } from 'vitest'
import { formatClaudeModelLabel, getPrStatusDisplay } from './toolbar-utils'

describe('getPrStatusDisplay', () => {
  it('uses amber styling for draft PRs', () => {
    expect(getPrStatusDisplay('draft')).toEqual({
      label: 'Draft',
      className: 'text-amber-600 dark:text-amber-400',
    })
  })
})

describe('formatClaudeModelLabel', () => {
  it('formats future Claude model ids without a hardcoded option', () => {
    expect(formatClaudeModelLabel('claude-sonnet-6-1')).toBe('Sonnet 6 1')
  })
})
