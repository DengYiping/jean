/**
 * Model utilities for feature detection and CLI compatibility.
 *
 * Claude Opus and Sonnet models expose adaptive thinking (effort parameter)
 * instead of traditional thinking levels (budget_tokens). This is supported
 * from Claude CLI >= 2.1.32.
 */

import { compareVersions } from './version-utils'

/** Minimum CLI version that supports Claude adaptive thinking */
const ADAPTIVE_THINKING_MIN_CLI_VERSION = '2.1.32'

/**
 * Resolve which CLI backend to use based on the model string.
 */
export function resolveBackend(model: string): 'claude' | 'codex' | 'opencode' {
  if (model.startsWith('opencode/')) return 'opencode'
  if (model.startsWith('codex') || model.includes('codex')) return 'codex'
  return 'claude'
}

/**
 * Check if the current model + CLI version combination supports
 * adaptive thinking (effort parameter) instead of traditional thinking levels.
 *
 * Returns true when:
 * - Model is a Claude Opus variant ('claude-opus-*') or the legacy 'opus' alias
 * - CLI version is >= 2.1.32
 */
export function supportsAdaptiveThinking(
  model: string,
  cliVersion: string | null | undefined
): boolean {
  const isOpusModel = model === 'opus' || model.startsWith('claude-opus-')
  if (!isOpusModel) return false
  if (!cliVersion) return false
  return compareVersions(cliVersion, ADAPTIVE_THINKING_MIN_CLI_VERSION) >= 0
}
