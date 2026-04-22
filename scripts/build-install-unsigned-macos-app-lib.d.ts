type EnvMap = Record<string, string | undefined>

interface InstallCliSymlinkSuccess {
  linked: true
  cliBinDir: string
  cliSymlinkPath: string
  isOnPath: boolean
}

interface InstallCliSymlinkFailure {
  linked: false
  candidates: string[]
  failures: {
    cliBinDir: string
    message: string
  }[]
}

export function isPathOnPath(
  targetPath: string,
  options?: {
    env?: EnvMap
    homeDir?: string
  }
): boolean

export function getCliBinDirCandidates(options?: {
  env?: EnvMap
  homeDir?: string
}): string[]

export function installCliSymlink(options: {
  installedCliBinaryPath: string
  env?: EnvMap
  homeDir?: string
}): InstallCliSymlinkSuccess | InstallCliSymlinkFailure
