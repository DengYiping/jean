/**
 * Types for GitHub CLI integration
 */

/**
 * Status of the GitHub CLI installation
 */
export interface GhCliStatus {
  /** Whether GitHub CLI is installed */
  installed: boolean
  /** Installed version (if any) */
  version: string | null
  /** Path to the CLI binary (if installed) */
  path: string | null
}

/**
 * Result of checking GitHub CLI authentication status
 */
export interface GhAuthStatus {
  /** Whether the CLI is authenticated */
  authenticated: boolean
  /** Error message if authentication check failed */
  error: string | null
}

/**
 * A locally authenticated GitHub CLI account discovered from `gh auth status`.
 */
export interface GhCliAccount {
  /** Host for this account (for example github.com or git.hubteam.com) */
  host: string
  /** Login/user name for the account */
  user: string
  /** Whether this is the active account for the host */
  active: boolean
  /** Git protocol reported by gh */
  gitProtocol: string | null
  /** Where gh stores credentials for this account */
  credentialSource: string | null
  /** Token scopes reported by gh */
  tokenScopes: string[]
}

/**
 * Information about a GitHub CLI release
 */
export interface GhReleaseInfo {
  /** Version string (e.g., "2.40.0") */
  version: string
  /** Git tag name (e.g., "v2.40.0") - camelCase alias */
  tagName: string
  /** Publication date in ISO format - camelCase alias */
  publishedAt: string
  /** Whether this is a prerelease */
  prerelease: boolean
}

/**
 * Progress event for CLI installation
 */
export interface GhInstallProgress {
  /** Current stage of installation */
  stage:
    | 'starting'
    | 'downloading'
    | 'extracting'
    | 'installing'
    | 'verifying'
    | 'complete'
  /** Progress message */
  message: string
  /** Percentage complete (0-100) */
  percent: number
}
