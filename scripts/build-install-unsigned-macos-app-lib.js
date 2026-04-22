import fs from 'fs'
import os from 'os'
import path from 'path'

function expandHomeDir(targetPath, homeDir) {
  if (!targetPath) {
    return targetPath
  }

  if (targetPath === '~') {
    return homeDir
  }

  if (targetPath.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, targetPath.slice(2))
  }

  return targetPath
}

function getPathEntries(env, homeDir) {
  return (env.PATH ?? '')
    .split(path.delimiter)
    .map(entry => expandHomeDir(entry, homeDir))
    .filter(Boolean)
}

export function isPathOnPath(
  targetPath,
  { env = process.env, homeDir = os.homedir() } = {}
) {
  const normalizedTargetPath = path.resolve(expandHomeDir(targetPath, homeDir))
  return getPathEntries(env, homeDir).some(
    entry => path.resolve(entry) === normalizedTargetPath
  )
}

export function getCliBinDirCandidates({
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  const standardDirs = [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    path.join(homeDir, '.local', 'bin'),
  ]

  const candidates = []
  const seen = new Set()

  const addCandidate = dirPath => {
    if (!dirPath) {
      return
    }

    const normalizedDirPath = path.resolve(expandHomeDir(dirPath, homeDir))
    if (seen.has(normalizedDirPath)) {
      return
    }

    seen.add(normalizedDirPath)
    candidates.push(normalizedDirPath)
  }

  addCandidate(env.JEAN_CLI_BIN_DIR)

  for (const entry of getPathEntries(env, homeDir)) {
    if (standardDirs.includes(entry)) {
      addCandidate(entry)
    }
  }

  for (const dirPath of standardDirs) {
    addCandidate(dirPath)
  }

  return candidates
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true })
}

export function installCliSymlink({
  installedCliBinaryPath,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  if (!installedCliBinaryPath) {
    throw new Error('installedCliBinaryPath is required')
  }

  const candidates = getCliBinDirCandidates({ env, homeDir })
  const failures = []

  for (const cliBinDir of candidates) {
    const cliSymlinkPath = path.join(cliBinDir, 'jean')

    try {
      fs.mkdirSync(cliBinDir, { recursive: true })
      fs.accessSync(cliBinDir, fs.constants.W_OK)
      removePath(cliSymlinkPath)
      fs.symlinkSync(installedCliBinaryPath, cliSymlinkPath)

      return {
        linked: true,
        cliBinDir,
        cliSymlinkPath,
        isOnPath: isPathOnPath(cliBinDir, { env, homeDir }),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ cliBinDir, message })
    }
  }

  return {
    linked: false,
    candidates,
    failures,
  }
}
