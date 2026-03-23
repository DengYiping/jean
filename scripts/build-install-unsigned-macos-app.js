#!/usr/bin/env bun

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: options.cwd,
    env: options.env,
  })

  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited with code ${result.status ?? 1}`)
  }
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true })
}

function renameOrThrow(fromPath, toPath) {
  try {
    fs.renameSync(fromPath, toPath)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to rename ${fromPath} to ${toPath}: ${message}`)
  }
}

function printHelp() {
  console.log(`Builds an unsigned macOS Jean.app and installs it into /Applications.

Usage:
  bun run tauri:build:install:macos:unsigned

What it does:
  1. Builds the macOS .app bundle with Tauri's --no-sign flag
  2. Uses the current host target instead of forcing a universal build
  3. Replaces /Applications/Jean.app with the new build via staged rename
`)
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  printHelp()
  process.exit(0)
}

if (process.platform !== 'darwin') {
  fail(`This command only supports macOS. Current platform: ${process.platform}`)
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const projectDir = path.resolve(scriptDir, '..')
const tauriConfigPath = path.join(projectDir, 'src-tauri', 'tauri.conf.json')

if (!fs.existsSync(tauriConfigPath)) {
  fail(`Tauri config not found at ${tauriConfigPath}`)
}

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'))
const productName = tauriConfig.productName || 'Jean'
const builtAppPath = path.join(
  projectDir,
  'src-tauri',
  'target',
  'release',
  'bundle',
  'macos',
  `${productName}.app`
)
const applicationsDir = '/Applications'
const installedAppPath = path.join(applicationsDir, `${productName}.app`)
const stagedAppPath = path.join(applicationsDir, `.${productName}.app.new`)
const backupAppPath = path.join(applicationsDir, `.${productName}.app.old`)

console.log('==> Building unsigned macOS app bundle...')
run(
  'bun',
  [
    'run',
    'tauri:build',
    '--',
    '--no-sign',
    '--bundles',
    'app',
  ],
  { cwd: projectDir, env: process.env }
)

if (!fs.existsSync(builtAppPath)) {
  fail(`Built app bundle not found at ${builtAppPath}`)
}

console.log(`==> Installing ${productName}.app into ${applicationsDir}...`)
removePath(stagedAppPath)
removePath(backupAppPath)

run('ditto', [builtAppPath, stagedAppPath], { cwd: projectDir, env: process.env })

let movedExistingApp = false

try {
  if (fs.existsSync(installedAppPath)) {
    renameOrThrow(installedAppPath, backupAppPath)
    movedExistingApp = true
  }

  renameOrThrow(stagedAppPath, installedAppPath)
  removePath(backupAppPath)
} catch (error) {
  if (fs.existsSync(stagedAppPath)) {
    removePath(stagedAppPath)
  }

  if (movedExistingApp && fs.existsSync(backupAppPath)) {
    try {
      fs.renameSync(backupAppPath, installedAppPath)
    } catch (restoreError) {
      const restoreMessage =
        restoreError instanceof Error
          ? restoreError.message
          : String(restoreError)
      fail(
        `Install failed and the previous app could not be restored automatically: ${restoreMessage}`
      )
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  fail(`Failed to install app bundle: ${message}`)
}

console.log(`==> Installed ${installedAppPath}`)
