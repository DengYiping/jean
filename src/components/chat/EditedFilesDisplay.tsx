import { memo, useMemo, useState } from 'react'
import type { ToolCall } from '@/types/chat'
import { Badge } from '@/components/ui/badge'
import { getFilename } from '@/lib/path-utils'
import { formatWorktreeRelativePath } from './file-change-utils'
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip'
import { FileEditsDiffModal, type FileEdit } from './FileEditsDiffModal'

interface EditInput {
  file_path: string
  old_string?: string
  new_string?: string
}

function isEditTool(
  toolCall: ToolCall
): toolCall is ToolCall & { input: EditInput } {
  return (
    toolCall.name === 'Edit' &&
    typeof toolCall.input === 'object' &&
    toolCall.input !== null &&
    'file_path' in toolCall.input &&
    typeof (toolCall.input as Record<string, unknown>).file_path === 'string'
  )
}

interface EditedFilesDisplayProps {
  toolCalls: ToolCall[] | undefined
  onFileClick: (path: string) => void
  worktreePath?: string | null
}

/**
 * Display edited files at the bottom of assistant messages
 * Collects all Edit tool calls and shows unique file paths
 * Clicking a file opens it in the file content modal
 * Memoized to prevent re-renders when parent state changes
 */
export const EditedFilesDisplay = memo(function EditedFilesDisplay({
  toolCalls,
  onFileClick,
  worktreePath,
}: EditedFilesDisplayProps) {
  const [selectedDiff, setSelectedDiff] = useState<{
    filePath: string
    edits: FileEdit[]
  } | null>(null)

  const editsByPath = useMemo(() => {
    const edits = new Map<string, FileEdit[]>()
    if (!toolCalls) return edits

    for (const toolCall of toolCalls) {
      if (!isEditTool(toolCall)) continue

      const existing = edits.get(toolCall.input.file_path) ?? []
      existing.push({
        oldString: toolCall.input.old_string ?? '',
        newString: toolCall.input.new_string ?? '',
      })
      edits.set(toolCall.input.file_path, existing)
    }

    return edits
  }, [toolCalls])

  if (editsByPath.size === 0) return null

  const uniqueFilePaths = Array.from(editsByPath.keys())

  return (
    <>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground/70">
        <span>
          Edited {uniqueFilePaths.length} file
          {uniqueFilePaths.length === 1 ? '' : 's'}:
        </span>
        {uniqueFilePaths.map(filePath => {
          const displayPath = formatWorktreeRelativePath(filePath, worktreePath)
          return (
            <Tooltip key={filePath}>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  title={displayPath}
                  className="cursor-pointer"
                  onClick={() => {
                    const edits = editsByPath.get(filePath) ?? []
                    if (edits.length === 0) {
                      onFileClick(filePath)
                      return
                    }
                    setSelectedDiff({ filePath, edits })
                  }}
                >
                  {getFilename(displayPath)}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>{displayPath}</TooltipContent>
            </Tooltip>
          )
        })}
      </div>

      <FileEditsDiffModal
        filePath={selectedDiff?.filePath ?? null}
        edits={selectedDiff?.edits ?? []}
        onClose={() => setSelectedDiff(null)}
      />
    </>
  )
})
