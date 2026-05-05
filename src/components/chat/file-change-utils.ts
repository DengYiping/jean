import type { ToolCall } from '@/types/chat'
import { getFilename, normalizePath } from '@/lib/path-utils'

export type FileChangeLineKind =
  | 'hunk'
  | 'added'
  | 'removed'
  | 'context'
  | 'meta'

export interface FileChangeLine {
  kind: FileChangeLineKind
  text: string
  oldLineNumber?: number
  newLineNumber?: number
}

export interface ParsedFileChange {
  path: string
  previousPath?: string
  kind: string
  lines: FileChangeLine[]
  added: number
  removed: number
}

export function isFileChangeTool(toolCall: ToolCall): boolean {
  return toolCall.name === 'FileChange'
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function trimTrailingEmptyLine(lines: string[]): string[] {
  if (lines.length > 0 && lines.at(-1) === '') {
    return lines.slice(0, -1)
  }
  return lines
}

function parseUnifiedDiffLines(lines: string[]): FileChangeLine[] {
  const parsed: FileChangeLine[] = []
  let oldLineNumber = 0
  let newLineNumber = 0

  for (const rawLine of lines) {
    if (
      rawLine.startsWith('diff --git') ||
      rawLine.startsWith('index ') ||
      rawLine.startsWith('new file mode') ||
      rawLine.startsWith('deleted file mode') ||
      rawLine.startsWith('--- ') ||
      rawLine.startsWith('+++ ')
    ) {
      continue
    }

    if (rawLine.startsWith('@@')) {
      const match = rawLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLineNumber = Number(match[1])
        newLineNumber = Number(match[2])
      }
      parsed.push({ kind: 'hunk', text: rawLine })
      continue
    }

    if (rawLine.startsWith('+')) {
      parsed.push({
        kind: 'added',
        text: rawLine.slice(1),
        newLineNumber,
      })
      newLineNumber += 1
      continue
    }

    if (rawLine.startsWith('-')) {
      parsed.push({
        kind: 'removed',
        text: rawLine.slice(1),
        oldLineNumber,
      })
      oldLineNumber += 1
      continue
    }

    if (rawLine.startsWith(' ')) {
      parsed.push({
        kind: 'context',
        text: rawLine.slice(1),
        oldLineNumber,
        newLineNumber,
      })
      oldLineNumber += 1
      newLineNumber += 1
      continue
    }

    if (rawLine.startsWith('\\') || rawLine.startsWith('rename ')) {
      parsed.push({ kind: 'meta', text: rawLine })
    }
  }

  return parsed
}

function parseWholeFileLines(
  diff: string,
  kind: string,
  previousPath?: string
): FileChangeLine[] {
  if (!diff) {
    if (previousPath) {
      return [{ kind: 'meta', text: `renamed from ${previousPath}` }]
    }
    return []
  }

  const lines = trimTrailingEmptyLine(normalizeNewlines(diff).split('\n'))

  switch (kind) {
    case 'add':
    case 'create':
      return lines.map((text, index) => ({
        kind: 'added',
        text,
        newLineNumber: index + 1,
      }))
    case 'delete':
      return lines.map((text, index) => ({
        kind: 'removed',
        text,
        oldLineNumber: index + 1,
      }))
    default:
      return lines.map((text, index) => ({
        kind: 'context',
        text,
        oldLineNumber: index + 1,
        newLineNumber: index + 1,
      }))
  }
}

function parseFileChangeLines(
  diff: string,
  kind: string,
  previousPath?: string
): FileChangeLine[] {
  const normalized = normalizeNewlines(diff)
  const lines = trimTrailingEmptyLine(normalized.split('\n'))
  const looksLikeUnifiedDiff = lines.some(line => line.startsWith('@@ '))

  if (looksLikeUnifiedDiff) {
    const parsed = parseUnifiedDiffLines(lines)
    if (parsed.length > 0) {
      return parsed
    }
  }

  return parseWholeFileLines(normalized, kind, previousPath)
}

export function normalizeFileChanges(raw: unknown): ParsedFileChange[] {
  const parsed = parseMaybeJson(raw)
  const rawChanges = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.changes)
      ? parsed.changes
      : isRecord(parsed) && typeof parsed.path === 'string'
        ? [parsed]
        : []

  const changes: ParsedFileChange[] = []

  for (const change of rawChanges) {
    if (!isRecord(change)) continue

    const kindRecord = isRecord(change.kind) ? change.kind : {}
    const path =
      (change.path as string | undefined) ??
      (change.file as string | undefined) ??
      (change.file_path as string | undefined)
    const kind = (kindRecord.type as string | undefined) ?? 'update'
    const previousPath =
      (kindRecord.move_path as string | undefined) ??
      (kindRecord.old_path as string | undefined) ??
      (change.previous_path as string | undefined)
    const diff = typeof change.diff === 'string' ? change.diff : ''

    if (!path) continue

    const lines = parseFileChangeLines(diff, kind, previousPath)

    changes.push({
      path,
      previousPath,
      kind,
      lines,
      added: lines.filter(line => line.kind === 'added').length,
      removed: lines.filter(line => line.kind === 'removed').length,
    })
  }

  return changes
}

export function collectFileChanges(
  toolCalls: ToolCall[] | undefined
): ParsedFileChange[] {
  if (!toolCalls) return []

  return toolCalls
    .filter(isFileChangeTool)
    .flatMap(toolCall => normalizeFileChanges(toolCall.input))
}

export function getFileChangeTotals(changes: ParsedFileChange[]): {
  added: number
  removed: number
} {
  return {
    added: changes.reduce((sum, change) => sum + change.added, 0),
    removed: changes.reduce((sum, change) => sum + change.removed, 0),
  }
}

function trimTrailingPathSeparators(path: string): string {
  const trimmed = path.replace(/\/+$/g, '')
  return trimmed || path
}

export function formatWorktreeRelativePath(
  filePath: string,
  worktreePath?: string | null
): string {
  const normalizedFilePath = normalizePath(filePath)
  if (!worktreePath) return normalizedFilePath

  const normalizedWorktreePath = trimTrailingPathSeparators(
    normalizePath(worktreePath)
  )
  if (!normalizedWorktreePath) return normalizedFilePath

  const prefix = `${normalizedWorktreePath}/`
  if (!normalizedFilePath.startsWith(prefix)) {
    return normalizedFilePath
  }

  return normalizedFilePath.slice(prefix.length)
}

export function computeDisplayNames(paths: string[]): Map<string, string> {
  const result = new Map<string, string>()
  if (paths.length === 0) return result

  const entries = paths.map(p => ({
    original: p,
    norm: normalizePath(p),
    basename: getFilename(p),
  }))

  const groups = new Map<string, typeof entries>()
  for (const entry of entries) {
    const group = groups.get(entry.basename)
    if (group) {
      group.push(entry)
    } else {
      groups.set(entry.basename, [entry])
    }
  }

  for (const [basename, group] of groups) {
    const sole = group.length === 1 ? group[0] : undefined
    if (sole) {
      result.set(sole.original, basename)
      continue
    }

    const withSegs = group.map(e => ({
      ...e,
      segments: e.norm.split('/').slice(0, -1),
    }))

    for (let depth = 1; depth <= 20; depth++) {
      const seen = new Map<string, typeof withSegs>()
      for (const entry of withSegs) {
        const suffix = entry.segments.slice(-depth).join('/')
        const key = suffix ? `${suffix}/${basename}` : basename
        const bucket = seen.get(key)
        if (bucket) {
          bucket.push(entry)
        } else {
          seen.set(key, [entry])
        }
      }

      for (const [name, bucket] of seen) {
        const single = bucket.length === 1 ? bucket[0] : undefined
        if (single && !result.has(single.original)) {
          const isPartial = name !== single.norm
          result.set(single.original, isPartial ? `\u2026/${name}` : name)
        }
      }

      if (withSegs.every(e => result.has(e.original))) break
    }

    for (const entry of withSegs) {
      if (!result.has(entry.original)) {
        result.set(entry.original, entry.norm)
      }
    }
  }

  return result
}

export function formatFileChangeKind(kind: string): string {
  switch (kind) {
    case 'add':
    case 'create':
      return 'Added'
    case 'delete':
      return 'Deleted'
    case 'move':
    case 'rename':
      return 'Renamed'
    default:
      return 'Modified'
  }
}
