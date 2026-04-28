import { ChevronDown, Rocket } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { getModifierSymbol, isMacOS } from '@/lib/platform'
import { cn } from '@/lib/utils'
import { Kbd } from '@/components/ui/kbd'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { useIsMobile } from '@/hooks/use-mobile'
import type { Backend } from '@/types/chat'

interface SendCancelButtonProps {
  isSending: boolean
  canSend: boolean
  executionMode: string
  queuedMessageCount?: number
  onCancel: () => void
  installedBackends?: Backend[]
  onHarnessFanoutSend?: (targetBackends: Backend[]) => void
  fanoutDisabled?: boolean
}

const MODE_LABELS: Record<string, string> = {
  plan: 'Plan',
  build: 'Build',
  yolo: 'Yolo',
}

const BACKEND_LABELS: Record<Backend, string> = {
  claude: 'Claude',
  codex: 'Codex',
  opencode: 'OpenCode',
}

export function SendCancelButton({
  isSending,
  canSend,
  executionMode,
  queuedMessageCount,
  onCancel,
  installedBackends = [],
  onHarnessFanoutSend,
  fanoutDisabled = false,
}: SendCancelButtonProps) {
  const isMobile = useIsMobile()
  const fanoutBackends = useMemo(
    () => installedBackends.filter(Boolean),
    [installedBackends]
  )
  const [selectedFanoutBackends, setSelectedFanoutBackends] =
    useState<Backend[]>(fanoutBackends)

  useEffect(() => {
    setSelectedFanoutBackends(current => {
      const valid = current.filter(backend => fanoutBackends.includes(backend))
      return valid.length > 0 ? valid : fanoutBackends
    })
  }, [fanoutBackends])

  if (isSending) {
    const cancelButton = (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onCancel}
            className={cn(
              'flex h-8 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors bg-primary text-primary-foreground hover:bg-primary/90',
              !canSend && 'rounded-r-lg'
            )}
          >
            <span>{queuedMessageCount ? 'Skip to Next' : 'Cancel'}</span>
            {!isMobile && (
              <Kbd className="ml-0.5 h-4 text-[10px] bg-primary-foreground/20 text-primary-foreground">
                {isMacOS ? `${getModifierSymbol()}⌥⌫` : 'Ctrl+Alt+⌫'}
              </Kbd>
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {queuedMessageCount
            ? `Skip to next queued message (${isMacOS ? `${getModifierSymbol()}+Option+Backspace` : 'Ctrl+Alt+Backspace'})`
            : `Cancel (${isMacOS ? `${getModifierSymbol()}+Option+Backspace` : 'Ctrl+Alt+Backspace'})`}
        </TooltipContent>
      </Tooltip>
    )

    if (canSend) {
      return (
        <div className="flex items-center">
          {cancelButton}
          <div className="h-4 w-px shrink-0 bg-border/50" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="submit"
                className="flex h-8 items-center justify-center gap-1.5 rounded-r-lg px-2.5 text-xs font-medium transition-colors text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              >
                <span>Queue</span>
                <Rocket className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {isMobile ? 'Queue message' : 'Queue message (Enter)'}
            </TooltipContent>
          </Tooltip>
        </div>
      )
    }

    return cancelButton
  }

  const hasFanout = Boolean(onHarnessFanoutSend) && fanoutBackends.length > 0
  const fanoutCanRun =
    canSend &&
    !fanoutDisabled &&
    Boolean(onHarnessFanoutSend) &&
    selectedFanoutBackends.length > 0

  const sendButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="submit"
          disabled={!canSend}
          className={cn(
            'flex h-8 items-center justify-center gap-1.5 px-3 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
            hasFanout ? 'rounded-l-lg' : 'rounded-r-lg',
            canSend
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
          )}
        >
          <span className="w-9 text-center">
            {MODE_LABELS[executionMode] ?? executionMode}
          </span>
          <Rocket className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        {isMobile ? 'Send message' : 'Send message (Enter)'}
      </TooltipContent>
    </Tooltip>
  )

  if (!hasFanout) {
    return sendButton
  }

  return (
    <div className="flex items-center">
      {sendButton}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={!canSend || fanoutDisabled}
                className={cn(
                  'flex h-8 w-7 items-center justify-center rounded-r-lg border-l border-primary-foreground/20 text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
                  canSend && !fanoutDisabled
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                )}
                aria-label="Run prompt in multiple harnesses"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>
            Run prompt in isolated harness worktrees
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-56">
          {fanoutBackends.map(backend => (
            <DropdownMenuCheckboxItem
              key={backend}
              checked={selectedFanoutBackends.includes(backend)}
              onCheckedChange={checked => {
                setSelectedFanoutBackends(current =>
                  checked
                    ? [...new Set([...current, backend])]
                    : current.filter(item => item !== backend)
                )
              }}
              onSelect={event => event.preventDefault()}
            >
              {BACKEND_LABELS[backend]}
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!fanoutCanRun}
            onClick={() => onHarnessFanoutSend?.(selectedFanoutBackends)}
          >
            Run in {selectedFanoutBackends.length} harness
            {selectedFanoutBackends.length === 1 ? '' : 'es'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
