import type { ToolCall } from '@/types/chat'

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
