import { describe, expect, it } from 'vitest'
import { shouldSkipInstalledCliVersionCheck } from './cli-version-check'

describe('shouldSkipInstalledCliVersionCheck', () => {
  it('skips Codex update checks for the 0.0.0 placeholder version', () => {
    expect(shouldSkipInstalledCliVersionCheck('codex', '0.0.0')).toBe(true)
    expect(shouldSkipInstalledCliVersionCheck('codex', 'v0.0.0')).toBe(true)
  })

  it('does not skip other Codex versions', () => {
    expect(shouldSkipInstalledCliVersionCheck('codex', '0.1.0')).toBe(false)
    expect(shouldSkipInstalledCliVersionCheck('codex', null)).toBe(false)
  })

  it('does not skip non-Codex CLIs', () => {
    expect(shouldSkipInstalledCliVersionCheck('claude', '0.0.0')).toBe(false)
    expect(shouldSkipInstalledCliVersionCheck('gh', '0.0.0')).toBe(false)
    expect(shouldSkipInstalledCliVersionCheck('opencode', '0.0.0')).toBe(false)
  })
})
