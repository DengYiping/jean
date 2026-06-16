import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, FileText, Pencil, RotateCcw } from 'lucide-react'
import { logger } from '@/lib/logger'
import { invoke } from '@/lib/transport'
import { readPlanFile } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { useChatStore } from '@/store/chat-store'
import { getFilename } from '@/lib/path-utils'
import { useUIStore } from '@/store/ui-store'
import { resolveApprovalLabel } from './approval-label-utils'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Markdown } from '@/components/ui/markdown'
import { SplitButton } from '@/components/ui/split-button'
import {
  DropdownMenuItem,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu'
import { formatShortcutDisplay, DEFAULT_KEYBINDINGS } from '@/types/keybindings'

export interface ApprovalContext {
  worktreeId: string
  worktreePath: string
  sessionId: string
  pendingPlanMessageId: string | null
}

export type PlanDialogMode = 'default' | 'build-custom'

interface PlanDialogBaseProps {
  isOpen: boolean
  onClose: () => void
  editable?: boolean
  disabled?: boolean
  initialMode?: PlanDialogMode
  approvalContext?: ApprovalContext
  onApprove?: (updatedPlan: string) => void
  onApproveWithCustomPrompt?: (
    updatedPlan: string,
    customPrompt: string
  ) => void
  onApproveYolo?: (updatedPlan: string) => void
  onClearContextApprove?: (updatedPlan: string) => void
  onClearContextBuildApprove?: (updatedPlan: string) => void
  onWorktreeBuildApprove?: (updatedPlan: string) => void
  onWorktreeYoloApprove?: (updatedPlan: string) => void
  /** Hide approve buttons (e.g. for Codex which has no native approval flow) */
  hideApproveButtons?: boolean
}

interface PlanDialogFileProps extends PlanDialogBaseProps {
  filePath: string
  content?: never
}

interface PlanDialogContentProps extends PlanDialogBaseProps {
  content: string
  filePath?: never
}

type PlanDialogProps = PlanDialogFileProps | PlanDialogContentProps

export function PlanDialog({
  filePath,
  content: inlineContent,
  isOpen,
  onClose,
  editable = false,
  disabled = false,
  initialMode = 'default',
  approvalContext: _approvalContext,
  onApprove,
  onApproveWithCustomPrompt,
  onApproveYolo,
  onClearContextApprove,
  onClearContextBuildApprove,
  onWorktreeBuildApprove,
  onWorktreeYoloApprove,
  hideApproveButtons,
}: PlanDialogProps) {
  const filename = filePath ? getFilename(filePath) : null
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const sessionBackend = useChatStore(state =>
    _approvalContext?.sessionId
      ? (state.selectedBackends[_approvalContext.sessionId] ?? null)
      : null
  )
  const buildLabel = resolveApprovalLabel('build', preferences, sessionBackend)
  const yoloLabel = resolveApprovalLabel('yolo', preferences, sessionBackend)

  const { data: fetchedContent, isLoading } = useQuery({
    queryKey: ['planFile', filePath],
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    queryFn: () => readPlanFile(filePath!),
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
    enabled: isOpen && !!filePath && !inlineContent,
  })

  const originalContent = inlineContent ?? fetchedContent ?? ''
  const [editedContent, setEditedContent] = useState('')
  const [isEditMode, setIsEditMode] = useState(false)
  const [dialogMode, setDialogMode] = useState<PlanDialogMode>(initialMode)
  const [customPrompt, setCustomPrompt] = useState('')
  const customPromptRef = useRef<HTMLTextAreaElement | null>(null)

  // Sync edited content when original changes or dialog opens
  useEffect(() => {
    if (isOpen && originalContent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEditedContent(originalContent)
    }
  }, [isOpen, originalContent])

  // Reset edit mode when dialog closes
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsEditMode(false)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDialogMode(initialMode)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCustomPrompt('')
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDialogMode(initialMode)
  }, [initialMode, isOpen])

  useEffect(() => {
    if (isOpen && dialogMode === 'build-custom') {
      customPromptRef.current?.focus()
    }
  }, [dialogMode, isOpen])

  // Track dialog open state in UIStore to block canvas keybindings
  useEffect(() => {
    useUIStore.getState().setPlanDialogOpen(isOpen)
    return () => useUIStore.getState().setPlanDialogOpen(false)
  }, [isOpen])

  const hasChanges = editedContent !== originalContent
  // Enable approve buttons when callbacks are provided and not disabled (session still running)
  const canApprove =
    !hideApproveButtons && !!onApprove && !!onApproveYolo && !disabled
  const canUseCustomPrompt =
    !hideApproveButtons &&
    !!onApprove &&
    !!onApproveWithCustomPrompt &&
    !disabled
  const canSubmitCustomPrompt =
    canUseCustomPrompt && customPrompt.trim().length > 0

  // Auto-save plan file with debounce when content changes
  useEffect(() => {
    if (!filePath || !hasChanges || !isOpen || !editable) return

    const timer = setTimeout(async () => {
      try {
        await invoke('write_file_content', {
          path: filePath,
          content: editedContent,
        })
        queryClient.invalidateQueries({ queryKey: ['planFile', filePath] })
      } catch (err) {
        logger.error('[PlanDialog] Auto-save failed:', err)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [filePath, editedContent, hasChanges, isOpen, editable, queryClient])

  const handleReset = useCallback(() => {
    setEditedContent(originalContent)
  }, [originalContent])

  const handleApprove = useCallback(() => {
    // File is auto-saved, just call the approve callback
    onApprove?.(editedContent)
    onClose()
  }, [editedContent, onApprove, onClose])

  const handleApproveWithCustomPrompt = useCallback(() => {
    const trimmedPrompt = customPrompt.trim()
    if (!trimmedPrompt) return

    onApproveWithCustomPrompt?.(editedContent, trimmedPrompt)
    onClose()
  }, [customPrompt, editedContent, onApproveWithCustomPrompt, onClose])

  const handleApproveYolo = useCallback(() => {
    // File is auto-saved, just call the approve callback
    onApproveYolo?.(editedContent)
    onClose()
  }, [editedContent, onApproveYolo, onClose])

  const handleClearContextApprove = useCallback(() => {
    onClearContextApprove?.(editedContent)
    onClose()
  }, [editedContent, onClearContextApprove, onClose])

  const handleClearContextBuildApprove = useCallback(() => {
    onClearContextBuildApprove?.(editedContent)
    onClose()
  }, [editedContent, onClearContextBuildApprove, onClose])

  const handleWorktreeBuildApprove = useCallback(() => {
    onWorktreeBuildApprove?.(editedContent)
    onClose()
  }, [editedContent, onWorktreeBuildApprove, onClose])

  const handleWorktreeYoloApprove = useCallback(() => {
    onWorktreeYoloApprove?.(editedContent)
    onClose()
  }, [editedContent, onWorktreeYoloApprove, onClose])

  const handleEnterCustomPromptMode = useCallback(() => {
    setDialogMode('build-custom')
  }, [])

  const handleExitCustomPromptMode = useCallback(() => {
    setDialogMode('default')
    setCustomPrompt('')
  }, [])

  // Keyboard shortcuts for approve actions
  useEffect(() => {
    if (!isOpen || !editable) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      if (dialogMode === 'build-custom') {
        if (isMod && e.key === 'Enter' && !e.shiftKey && !e.altKey) {
          e.preventDefault()
          if (canSubmitCustomPrompt) {
            handleApproveWithCustomPrompt()
          }
        }
        return
      }

      // Check most specific combos first to avoid matching simpler patterns

      // Mod+Alt+Enter = Worktree Build
      if (isMod && e.altKey && e.key === 'Enter') {
        e.preventDefault()
        if (canApprove && onWorktreeBuildApprove) {
          handleWorktreeBuildApprove()
        }
        return
      }

      // Mod+Shift+Enter = Clear Context and build
      if (isMod && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        if (canApprove && onClearContextBuildApprove) {
          handleClearContextBuildApprove()
        }
        return
      }

      // Mod+Enter = Approve (no shift, no alt)
      if (isMod && e.key === 'Enter' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (canApprove) {
          handleApprove()
        }
        return
      }

      // Mod+Alt+Y = Worktree Yolo
      if (isMod && e.altKey && (e.key === 'Y' || e.key === 'y')) {
        e.preventDefault()
        if (canApprove && onWorktreeYoloApprove) {
          handleWorktreeYoloApprove()
        }
        return
      }

      // Mod+Shift+Y = Clear Context and yolo
      if (isMod && e.shiftKey && (e.key === 'Y' || e.key === 'y')) {
        e.preventDefault()
        if (canApprove && onClearContextApprove) {
          handleClearContextApprove()
        }
        return
      }

      // Mod+Y = Approve Yolo (no shift, no alt)
      if (isMod && e.key === 'y' && !e.shiftKey && !e.altKey) {
        e.preventDefault()
        if (canApprove) {
          handleApproveYolo()
        }
        return
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    isOpen,
    editable,
    dialogMode,
    canApprove,
    canSubmitCustomPrompt,
    handleApprove,
    handleApproveWithCustomPrompt,
    handleApproveYolo,
    onClearContextApprove,
    handleClearContextApprove,
    onClearContextBuildApprove,
    handleClearContextBuildApprove,
    onWorktreeBuildApprove,
    handleWorktreeBuildApprove,
    onWorktreeYoloApprove,
    handleWorktreeYoloApprove,
  ])

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-7xl h-[80vh] min-w-[90vw] flex flex-col overflow-hidden">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            <span>Plan</span>
            {filename && (
              <code className="ml-1 rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                {filename}
              </code>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 flex-col gap-4">
          {editable && isEditMode ? (
            <Textarea
              value={editedContent}
              onChange={e => setEditedContent(e.target.value)}
              className="flex-1 min-h-0 resize-none font-mono text-sm"
              placeholder="Loading plan..."
            />
          ) : (
            <ScrollArea className="flex-1 min-h-0 -mx-6 px-6 select-text">
              {!inlineContent && isLoading ? (
                <div className="text-sm text-muted-foreground">
                  Loading plan...
                </div>
              ) : (editable ? editedContent : originalContent) ? (
                <Markdown className="text-sm">
                  {editable ? editedContent : originalContent}
                </Markdown>
              ) : (
                <div className="text-sm text-destructive">
                  Failed to load plan file
                </div>
              )}
            </ScrollArea>
          )}

          {dialogMode === 'build-custom' && (
            <div className="shrink-0 border-t pt-4">
              <div className="mb-2 text-sm font-medium">
                Custom build prompt
              </div>
              <Textarea
                ref={customPromptRef}
                value={customPrompt}
                onChange={e => setCustomPrompt(e.target.value)}
                className="min-h-28 resize-y text-sm"
                placeholder="Add extra implementation instructions for build mode."
              />
            </div>
          )}
        </div>

        {editable && (
          <DialogFooter className="shrink-0 border-t pt-4 -mx-6 px-6 mt-4 sm:justify-between">
            <div className="flex flex-wrap items-center gap-2 sm:mr-auto">
              {isEditMode ? (
                <Button
                  variant="ghost"
                  onClick={handleReset}
                  disabled={!hasChanges}
                >
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Reset
                </Button>
              ) : (
                <Button variant="ghost" onClick={() => setIsEditMode(true)}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Edit
                </Button>
              )}
              {dialogMode === 'build-custom' && (
                <Button variant="ghost" onClick={handleExitCustomPromptMode}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
              )}
            </div>

            <div className="flex gap-2">
              {dialogMode === 'build-custom' ? (
                <Button
                  onClick={handleApproveWithCustomPrompt}
                  disabled={!canSubmitCustomPrompt}
                  title={`Build with custom prompt (${formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan)})`}
                >
                  Build (
                  {formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan)})
                </Button>
              ) : (
                <>
                  <SplitButton
                    label="YOLO"
                    tooltip={`Approve with yolo mode (${formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan_yolo)})`}
                    onClick={handleApproveYolo}
                    disabled={!canApprove}
                  >
                    {onClearContextApprove && (
                      <DropdownMenuItem
                        onClick={handleClearContextApprove}
                        disabled={!canApprove}
                      >
                        <span className="flex flex-col">
                          <span>New Session (YOLO)</span>
                          {yoloLabel && (
                            <span className="text-[10px] text-muted-foreground">
                              {yoloLabel}
                            </span>
                          )}
                        </span>
                        <DropdownMenuShortcut>
                          {formatShortcutDisplay(
                            DEFAULT_KEYBINDINGS.approve_plan_clear_context
                          )}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    )}
                    {onWorktreeYoloApprove && (
                      <DropdownMenuItem
                        onClick={handleWorktreeYoloApprove}
                        disabled={!canApprove}
                      >
                        <span className="flex flex-col">
                          <span>New Worktree (YOLO)</span>
                          {yoloLabel && (
                            <span className="text-[10px] text-muted-foreground">
                              {yoloLabel}
                            </span>
                          )}
                        </span>
                        <DropdownMenuShortcut>
                          {formatShortcutDisplay(
                            DEFAULT_KEYBINDINGS.approve_plan_worktree_yolo
                          )}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    )}
                  </SplitButton>
                  <SplitButton
                    label="Approve"
                    tooltip={`Approve plan (${formatShortcutDisplay(DEFAULT_KEYBINDINGS.approve_plan)})`}
                    variant="outline"
                    onClick={handleApprove}
                    disabled={!canApprove}
                  >
                    {canUseCustomPrompt && (
                      <DropdownMenuItem
                        onClick={handleEnterCustomPromptMode}
                        disabled={!canUseCustomPrompt}
                      >
                        <span>Custom Prompt...</span>
                      </DropdownMenuItem>
                    )}
                    {onClearContextBuildApprove && (
                      <DropdownMenuItem
                        onClick={handleClearContextBuildApprove}
                        disabled={!canApprove}
                      >
                        <span className="flex flex-col">
                          <span>New Session</span>
                          {buildLabel && (
                            <span className="text-[10px] text-muted-foreground">
                              {buildLabel}
                            </span>
                          )}
                        </span>
                        <DropdownMenuShortcut>
                          {formatShortcutDisplay(
                            DEFAULT_KEYBINDINGS.approve_plan_clear_context_build
                          )}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    )}
                    {onWorktreeBuildApprove && (
                      <DropdownMenuItem
                        onClick={handleWorktreeBuildApprove}
                        disabled={!canApprove}
                      >
                        <span className="flex flex-col">
                          <span>New Worktree</span>
                          {buildLabel && (
                            <span className="text-[10px] text-muted-foreground">
                              {buildLabel}
                            </span>
                          )}
                        </span>
                        <DropdownMenuShortcut>
                          {formatShortcutDisplay(
                            DEFAULT_KEYBINDINGS.approve_plan_worktree_build
                          )}
                        </DropdownMenuShortcut>
                      </DropdownMenuItem>
                    )}
                  </SplitButton>
                </>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
