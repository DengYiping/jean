export type CliVersionCheckType = 'claude' | 'gh' | 'codex' | 'opencode'

/**
 * Some package-manager installs can report placeholder versions that should
 * not participate in update checks.
 */
export function shouldSkipInstalledCliVersionCheck(
  type: CliVersionCheckType,
  version: string | null | undefined
): boolean {
  if (!version) return false

  const normalizedVersion = version.trim().replace(/^v/, '')
  return type === 'codex' && normalizedVersion === '0.0.0'
}
