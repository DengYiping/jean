import { useCallback } from 'react'
import {
  Code,
  Terminal,
  FolderOpen,
  Github,
  ChevronDown,
  Settings,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  useOpenWorktreeInEditor,
  useOpenWorktreeInTerminal,
  useOpenWorktreeInFinder,
  useOpenBranchOnGitHub,
} from '@/services/projects'
import { useAvailableEditors, usePreferences } from '@/services/preferences'
import {
  getDetectedEditorOptions,
  getEffectiveEditor,
  getOpenInDefaultLabel,
  type EditorApp,
} from '@/types/preferences'
import { isNativeApp } from '@/lib/environment'
import { useUIStore } from '@/store/ui-store'

interface OpenInButtonProps {
  worktreePath: string
  branch?: string | null
  className?: string
  preferredEditor?: EditorApp | null
}

export function OpenInButton({
  worktreePath,
  branch,
  className,
  preferredEditor,
}: OpenInButtonProps) {
  const { data: preferences } = usePreferences()
  const { data: availableEditors } = useAvailableEditors()
  const openPreferencesPane = useUIStore(state => state.openPreferencesPane)
  const openInEditor = useOpenWorktreeInEditor()
  const openInTerminal = useOpenWorktreeInTerminal()
  const openInFinder = useOpenWorktreeInFinder()
  const openOnGitHub = useOpenBranchOnGitHub()
  const effectiveEditor = getEffectiveEditor(
    preferredEditor,
    preferences?.editor
  )
  const customEditors = preferences?.custom_editors

  const openEditor = useCallback(
    (editor?: EditorApp) => {
      openInEditor.mutate({
        worktreePath,
        editor,
      })
    },
    [openInEditor, worktreePath]
  )

  const openAction = useCallback(
    (target: string) => {
      switch (target) {
        case 'terminal':
          openInTerminal.mutate({
            worktreePath,
            terminal: preferences?.terminal,
          })
          break
        case 'finder':
          openInFinder.mutate(worktreePath)
          break
        case 'github':
          if (branch) openOnGitHub.mutate({ repoPath: worktreePath, branch })
          else openEditor()
          break
        default:
          openEditor()
      }
    },
    [
      openInTerminal,
      openInFinder,
      openOnGitHub,
      openEditor,
      worktreePath,
      branch,
      preferences?.terminal,
    ]
  )

  const editorOptions = getDetectedEditorOptions(
    effectiveEditor,
    availableEditors,
    customEditors
  )

  const defaultLabel = getOpenInDefaultLabel(
    preferences?.open_in ?? 'editor',
    effectiveEditor,
    preferences?.terminal,
    customEditors
  )

  if (!isNativeApp()) return null

  return (
    <div
      className={`hidden items-center rounded-md border border-border/50 bg-muted/50 sm:inline-flex ${className ?? ''}`}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            className="h-7 rounded-r-none border-0 px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => openAction(preferences?.open_in ?? 'editor')}
          >
            Open in {defaultLabel}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open in {defaultLabel}</TooltipContent>
      </Tooltip>
      <div className="h-4 w-px bg-border/50" />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-6 rounded-l-none border-0 px-0 text-muted-foreground hover:text-foreground"
          >
            <ChevronDown className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openAction('editor')}>
            <Code className="h-4 w-4" />
            {getOpenInDefaultLabel(
              'editor',
              effectiveEditor,
              preferences?.terminal,
              customEditors
            )}
          </DropdownMenuItem>
          {editorOptions
            .filter(option => !option.isDefault)
            .map(option => (
              <DropdownMenuItem
                key={option.value}
                onSelect={() => openEditor(option.value)}
              >
                <Code className="h-4 w-4" />
                {option.label}
              </DropdownMenuItem>
            ))}
          <DropdownMenuItem onSelect={() => openAction('terminal')}>
            <Terminal className="h-4 w-4" />
            {getOpenInDefaultLabel(
              'terminal',
              effectiveEditor,
              preferences?.terminal,
              customEditors
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openAction('finder')}>
            <FolderOpen className="h-4 w-4" />
            Finder
          </DropdownMenuItem>
          {branch && (
            <DropdownMenuItem onSelect={() => openAction('github')}>
              <Github className="h-4 w-4" />
              GitHub
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openPreferencesPane('general')}>
            <Settings className="h-4 w-4" />
            Change default...
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
