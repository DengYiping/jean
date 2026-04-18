#!/usr/bin/env node

import fs from 'fs'
import os from 'os'
import path from 'path'

const APP_ID = 'com.jean.desktop'

function showHelp() {
  console.log(`
Jean worktree migration helper

Usage:
  bun run worktrees:migrate -- --to /absolute/path [options]

Options:
  --to PATH                Required. New base directory for worktrees.
  --app-data PATH          Jean app-data directory. Defaults by platform.
  --project VALUE          Limit migration to one project id or exact project name.
  --set-global-default     Also set preferences.worktrees_base_dir to the target.
  --dry-run                Show planned changes without writing anything.
  --help                   Show this message.

Examples:
  bun run worktrees:migrate -- --to ~/Developer/jean-worktrees --dry-run
  bun run worktrees:migrate -- --to /Volumes/FastSSD/jean --set-global-default
  bun run worktrees:migrate -- --to ~/jean-ssd --project my-repo

Notes:
  - Quit Jean before running this script.
  - The script moves tracked worktree directories, updates projects.json,
    updates ui-state.json, and optionally updates preferences.json.
`)
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    setGlobalDefault: false,
    appData: null,
    project: null,
    to: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg === '--set-global-default') {
      options.setGlobalDefault = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      showHelp()
      process.exit(0)
    }
    if (arg === '--to' || arg === '--app-data' || arg === '--project') {
      const value = argv[i + 1]
      if (!value) {
        throw new Error(`Missing value for ${arg}`)
      }
      i += 1
      if (arg === '--to') options.to = value
      if (arg === '--app-data') options.appData = value
      if (arg === '--project') options.project = value
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!options.to) {
    throw new Error('Missing required --to path')
  }

  return options
}

function expandHome(inputPath) {
  if (inputPath === '~') return os.homedir()
  if (inputPath.startsWith('~/'))
    return path.join(os.homedir(), inputPath.slice(2))
  return inputPath
}

function resolveAppDataDir(overridePath) {
  if (overridePath) return path.resolve(expandHome(overridePath))

  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', APP_ID)
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA
    if (!appData) throw new Error('APPDATA is not set')
    return path.join(appData, APP_ID)
  }

  const xdgDataHome =
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  return path.join(xdgDataHome, APP_ID)
}

function readJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function writeJson(filePath, value, dryRun) {
  if (dryRun) return
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function backupFile(filePath, suffix, dryRun) {
  if (dryRun || !fs.existsSync(filePath)) return
  fs.copyFileSync(filePath, `${filePath}.${suffix}.bak`)
}

function sanitizeDirectoryName(name) {
  return Array.from(name)
    .map(char => (/^[a-zA-Z0-9_-]$/.test(char) ? char : '-'))
    .join('')
}

function ensureDir(dirPath, dryRun) {
  if (dryRun) return
  fs.mkdirSync(dirPath, { recursive: true })
}

function moveDirectory(sourcePath, destinationPath, dryRun) {
  if (dryRun) return

  try {
    fs.renameSync(sourcePath, destinationPath)
    return
  } catch (error) {
    if (error && typeof error === 'object' && error.code !== 'EXDEV') {
      throw error
    }
  }

  fs.cpSync(sourcePath, destinationPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
  })
  fs.rmSync(sourcePath, { recursive: true, force: false })
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const appDataDir = resolveAppDataDir(options.appData)
  const targetBaseDir = path.resolve(expandHome(options.to))
  const projectsPath = path.join(appDataDir, 'projects.json')
  const preferencesPath = path.join(appDataDir, 'preferences.json')
  const uiStatePath = path.join(appDataDir, 'ui-state.json')

  if (!fs.existsSync(projectsPath)) {
    throw new Error(`projects.json not found at ${projectsPath}`)
  }

  const projectsData = readJson(projectsPath)
  const preferences = readJson(preferencesPath, {})
  const uiState = readJson(uiStatePath, {})
  const projects = projectsData.projects ?? []
  const worktrees = projectsData.worktrees ?? []
  const selectedProjects = projects.filter(project => {
    if (project.is_folder) return false
    if (!options.project) return true
    return project.id === options.project || project.name === options.project
  })

  if (selectedProjects.length === 0) {
    throw new Error(
      options.project
        ? `No project matched "${options.project}"`
        : 'No projects found to migrate'
    )
  }

  const selectedProjectIds = new Set(
    selectedProjects.map(project => project.id)
  )
  const worktreesToMove = worktrees.filter(worktree =>
    selectedProjectIds.has(worktree.project_id)
  )

  if (worktreesToMove.length === 0) {
    console.log('No tracked worktrees matched the selection.')
    return
  }

  const projectById = new Map(
    selectedProjects.map(project => [project.id, project])
  )
  const moves = []
  const destinationSet = new Set()

  for (const worktree of worktreesToMove) {
    const project = projectById.get(worktree.project_id)
    if (!project) continue

    const sourcePath = path.resolve(worktree.path)
    const destinationPath = path.join(
      targetBaseDir,
      sanitizeDirectoryName(project.name),
      worktree.name
    )

    if (sourcePath === destinationPath) {
      moves.push({
        project,
        worktree,
        sourcePath,
        destinationPath,
        status: 'unchanged',
      })
      continue
    }

    if (destinationSet.has(destinationPath)) {
      throw new Error(
        `Multiple worktrees resolve to the same destination: ${destinationPath}`
      )
    }
    destinationSet.add(destinationPath)

    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        `Tracked worktree path does not exist on disk: ${sourcePath} (${project.name}/${worktree.name})`
      )
    }

    if (fs.existsSync(destinationPath)) {
      throw new Error(`Destination already exists: ${destinationPath}`)
    }

    moves.push({
      project,
      worktree,
      sourcePath,
      destinationPath,
      status: 'move',
    })
  }

  const backupSuffix = new Date().toISOString().replaceAll(':', '-')

  console.log(`App data: ${appDataDir}`)
  console.log(`Target base directory: ${targetBaseDir}`)
  console.log(`Mode: ${options.dryRun ? 'dry-run' : 'apply'}`)
  console.log('')

  for (const move of moves) {
    if (move.status === 'unchanged') {
      console.log(`SKIP  ${move.project.name}/${move.worktree.name}`)
      console.log(`      already at ${move.destinationPath}`)
      continue
    }

    console.log(`MOVE  ${move.project.name}/${move.worktree.name}`)
    console.log(`      ${move.sourcePath}`)
    console.log(`   -> ${move.destinationPath}`)
  }

  const changedMoves = moves.filter(move => move.status === 'move')
  if (changedMoves.length === 0 && !options.setGlobalDefault) {
    console.log('\nNothing to change.')
    return
  }

  if (!options.dryRun) {
    backupFile(projectsPath, backupSuffix, false)
    backupFile(preferencesPath, backupSuffix, false)
    backupFile(uiStatePath, backupSuffix, false)
    ensureDir(targetBaseDir, false)
  }

  for (const move of changedMoves) {
    ensureDir(path.dirname(move.destinationPath), options.dryRun)
    moveDirectory(move.sourcePath, move.destinationPath, options.dryRun)
    move.worktree.path = move.destinationPath
  }

  for (const project of selectedProjects) {
    project.worktrees_dir = targetBaseDir
  }

  if (uiState?.active_worktree_path) {
    const activeMove = changedMoves.find(
      move => path.resolve(uiState.active_worktree_path) === move.sourcePath
    )
    if (activeMove) {
      uiState.active_worktree_path = activeMove.destinationPath
    }
  }

  if (options.setGlobalDefault) {
    preferences.worktrees_base_dir = targetBaseDir
  }

  writeJson(projectsPath, projectsData, options.dryRun)
  if (options.setGlobalDefault || fs.existsSync(preferencesPath)) {
    writeJson(preferencesPath, preferences, options.dryRun)
  }
  if (fs.existsSync(uiStatePath)) {
    writeJson(uiStatePath, uiState, options.dryRun)
  }

  console.log('')
  console.log(
    options.dryRun
      ? `Dry run complete. ${changedMoves.length} worktree(s) would be moved.`
      : `Migration complete. ${changedMoves.length} worktree(s) moved.`
  )
  console.log(
    `Updated ${selectedProjects.length} project override(s) to use ${targetBaseDir}.`
  )
  if (options.setGlobalDefault) {
    console.log('Updated global worktrees default in preferences.json.')
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
