import { useCallback } from 'react'
import { ChevronDown, Code } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useOpenFileInEditor } from '@/services/files'
import { useAvailableEditors, usePreferences } from '@/services/preferences'
import {
  getDetectedEditorOptions,
  getEditorLabel,
  getEffectiveEditor,
  type EditorApp,
} from '@/types/preferences'
import { isNativeApp } from '@/lib/environment'

interface OpenFileInEditorButtonProps {
  filePath: string
  lineNumber?: number
  className?: string
  preferredEditor?: EditorApp | null
  disabled?: boolean
}

export function OpenFileInEditorButton({
  filePath,
  lineNumber,
  className,
  preferredEditor,
  disabled = false,
}: OpenFileInEditorButtonProps) {
  const { data: preferences } = usePreferences()
  const { data: availableEditors } = useAvailableEditors()
  const openFileInEditor = useOpenFileInEditor()
  const effectiveEditor = getEffectiveEditor(
    preferredEditor,
    preferences?.editor
  )
  const customEditors = preferences?.custom_editors

  const openEditor = useCallback(
    (editor?: EditorApp) => {
      openFileInEditor.mutate({
        path: filePath,
        editor,
        lineNumber,
      })
    },
    [filePath, lineNumber, openFileInEditor]
  )

  const editorOptions = getDetectedEditorOptions(
    effectiveEditor,
    availableEditors,
    customEditors
  )
  const defaultLabel = getEditorLabel(effectiveEditor, customEditors)

  if (!isNativeApp()) return null

  return (
    <div
      className={`inline-flex items-center rounded-md border border-border/50 bg-muted/50 ${className ?? ''}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            className="h-7 rounded-r-none border-0 px-2 text-xs text-muted-foreground hover:text-foreground sm:px-2.5"
            disabled={disabled}
            aria-label={`Open in ${defaultLabel}`}
            onClick={() => openEditor()}
          >
            <Code className="h-3.5 w-3.5 sm:hidden" />
            <span className="hidden sm:inline">Open in {defaultLabel}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open file in {defaultLabel}</TooltipContent>
      </Tooltip>
      <div className="h-4 w-px bg-border/50" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-6 rounded-l-none border-0 px-0 text-muted-foreground hover:text-foreground"
            disabled={disabled}
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {editorOptions.map(option => (
            <DropdownMenuItem
              key={option.value}
              onSelect={() =>
                openEditor(option.isDefault ? undefined : option.value)
              }
            >
              <Code className="h-4 w-4" />
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
