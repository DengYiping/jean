import fs from 'fs'
import os from 'os'
import path from 'path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  getCliBinDirCandidates,
  installCliSymlink,
  isPathOnPath,
} from '../../scripts/build-install-unsigned-macos-app-lib.js'

const tempDirs: string[] = []

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop()
    if (!tempDir) {
      continue
    }

    const readonlyBinDir = path.join(tempDir, 'readonly-bin')
    if (fs.existsSync(readonlyBinDir)) {
      fs.chmodSync(readonlyBinDir, 0o755)
    }

    fs.rmSync(tempDir, { recursive: true, force: true })
  }
})

describe('build-install-unsigned-macos-app-lib', () => {
  it('orders CLI bin candidates using env override, PATH, and standard fallbacks', () => {
    const homeDir = '/Users/tester'
    const env = {
      PATH: [
        '/custom/bin',
        '/usr/local/bin',
        path.join(homeDir, '.local', 'bin'),
        '/opt/homebrew/bin',
      ].join(path.delimiter),
      JEAN_CLI_BIN_DIR: '~/custom-jean-bin',
    }

    expect(getCliBinDirCandidates({ env, homeDir })).toEqual([
      path.join(homeDir, 'custom-jean-bin'),
      '/usr/local/bin',
      path.join(homeDir, '.local', 'bin'),
      '/opt/homebrew/bin',
    ])
  })

  it('falls back to a writable user bin dir when the preferred location is not writable', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jean-install-'))
    tempDirs.push(tempDir)

    const readonlyBinDir = path.join(tempDir, 'readonly-bin')
    fs.mkdirSync(readonlyBinDir, { recursive: true })
    fs.chmodSync(readonlyBinDir, 0o555)

    const installedCliBinaryPath = path.join(
      tempDir,
      'Applications',
      'Jean.app',
      'Contents',
      'MacOS',
      'jean'
    )
    fs.mkdirSync(path.dirname(installedCliBinaryPath), { recursive: true })
    fs.writeFileSync(installedCliBinaryPath, '')

    const result = installCliSymlink({
      installedCliBinaryPath,
      homeDir: tempDir,
      env: {
        PATH: path.join(tempDir, '.local', 'bin'),
        JEAN_CLI_BIN_DIR: readonlyBinDir,
      },
    })

    expect(result.linked).toBe(true)
    if (!result.linked) {
      throw new Error('Expected CLI symlink installation to succeed')
    }

    expect(result.cliSymlinkPath).toBe(
      path.join(tempDir, '.local', 'bin', 'jean')
    )
    expect(fs.readlinkSync(result.cliSymlinkPath)).toBe(installedCliBinaryPath)
    expect(
      isPathOnPath(result.cliBinDir, {
        env: { PATH: path.join(tempDir, '.local', 'bin') },
        homeDir: tempDir,
      })
    ).toBe(true)
  })
})
