import { useEffect, useState } from 'react'
import { Bot, GitCommitHorizontal, Upload } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { SupervisorAction, SupervisorMagicAction } from '@/types/chat'

interface SupervisorActionPopoverProps {
  action?: SupervisorAction | null
  disabled?: boolean
  onChange: (action: SupervisorAction | null) => void
}

const DEFAULT_SUPERVISOR_ACTION: SupervisorAction = {
  enabled: false,
  magic_actions: [],
  prompt: '',
  max_supervisor_created_turns: null,
  supervisor_created_turn_count: 0,
  last_handled_run_id: null,
}

function normalizeAction(action?: SupervisorAction | null): SupervisorAction {
  return {
    ...DEFAULT_SUPERVISOR_ACTION,
    ...action,
    magic_actions: action?.magic_actions ?? [],
    prompt: action?.prompt ?? '',
    max_supervisor_created_turns: action?.max_supervisor_created_turns ?? null,
    supervisor_created_turn_count: action?.supervisor_created_turn_count ?? 0,
    last_handled_run_id: action?.last_handled_run_id ?? null,
  }
}

function toggleMagicAction(
  current: SupervisorMagicAction[],
  action: SupervisorMagicAction,
  checked: boolean
): SupervisorMagicAction[] {
  if (checked) {
    return current.includes(action) ? current : [...current, action]
  }
  return current.filter(item => item !== action)
}

export function SupervisorActionPopover({
  action,
  disabled,
  onChange,
}: SupervisorActionPopoverProps) {
  const [draft, setDraft] = useState(() => normalizeAction(action))

  useEffect(() => {
    setDraft(normalizeAction(action))
  }, [action])

  const normalized = draft
  const maxTurns = normalized.max_supervisor_created_turns
  const progress =
    maxTurns === null
      ? `${normalized.supervisor_created_turn_count} turns`
      : `${normalized.supervisor_created_turn_count} / ${maxTurns}`

  const update = (patch: Partial<SupervisorAction>) => {
    setDraft(current => {
      const next = {
        ...current,
        ...patch,
      }
      onChange(next)
      return next
    })
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Supervisor action"
              aria-pressed={normalized.enabled}
              disabled={disabled}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-50',
                normalized.enabled
                  ? 'bg-primary/15 text-primary'
                  : 'text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              )}
            >
              <Bot className="h-3.5 w-3.5" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Supervisor action</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-80 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Supervisor action</div>
            <div className="text-xs text-muted-foreground">{progress}</div>
          </div>
          <Switch
            checked={normalized.enabled}
            onCheckedChange={checked => update({ enabled: checked })}
            aria-label="Enable supervisor action"
          />
        </div>

        <div className="mt-3 space-y-2">
          <Label className="text-xs text-muted-foreground">Magic actions</Label>
          <label className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
            <Checkbox
              checked={normalized.magic_actions.includes('commit')}
              onCheckedChange={checked =>
                update({
                  magic_actions: toggleMagicAction(
                    normalized.magic_actions,
                    'commit',
                    checked === true
                  ),
                })
              }
            />
            <GitCommitHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
            Create commit
          </label>
          <label className="flex items-center gap-2 rounded-md px-1 py-1 text-sm">
            <Checkbox
              checked={normalized.magic_actions.includes('commit_and_push')}
              onCheckedChange={checked =>
                update({
                  magic_actions: toggleMagicAction(
                    normalized.magic_actions,
                    'commit_and_push',
                    checked === true
                  ),
                })
              }
            />
            <Upload className="h-3.5 w-3.5 text-muted-foreground" />
            Commit and push
          </label>
        </div>

        <div className="mt-3 space-y-1.5">
          <Label
            htmlFor="supervisor-prompt"
            className="text-xs text-muted-foreground"
          >
            Prompt
          </Label>
          <Textarea
            id="supervisor-prompt"
            value={normalized.prompt ?? ''}
            onChange={event => update({ prompt: event.target.value })}
            className="min-h-20 resize-none text-sm"
          />
        </div>

        <div className="mt-3 space-y-1.5">
          <Label
            htmlFor="supervisor-max-turns"
            className="text-xs text-muted-foreground"
          >
            Max supervisor-created turns
          </Label>
          <Input
            id="supervisor-max-turns"
            type="number"
            min={0}
            value={maxTurns ?? ''}
            onChange={event => {
              const value = event.target.value.trim()
              update({
                max_supervisor_created_turns:
                  value === '' ? null : Math.max(0, Number(value)),
              })
            }}
            className="h-8"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
