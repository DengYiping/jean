import { useEffect, useMemo, useState } from 'react'
import {
  Bot,
  CalendarClock,
  Pause,
  Play,
  Plus,
  Save,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  useAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  usePauseAutomation,
  useResumeAutomation,
  useRunAutomationNow,
  useUpdateAutomation,
} from '@/services/automations'
import { useWorktrees } from '@/services/projects'
import type {
  Automation,
  AutomationStatus,
  AutomationTargetMode,
} from '@/types/automations'
import type {
  Backend,
  EffortLevel,
  ExecutionMode,
  ThinkingLevel,
} from '@/types/chat'
import type { Worktree } from '@/types/projects'
import {
  buildScheduleRRule,
  defaultScheduleFields,
  formatHourLabel,
  getRunWindowPayload,
  parseSchedule,
  WEEKDAYS,
  type Frequency,
  type WeekdayCode,
} from './automation-schedule'

interface AutomationFormState {
  name: string
  prompt: string
  targetMode: AutomationTargetMode
  targetWorktreeIds: string[]
  backend: Backend
  model: string
  provider: string
  executionMode: ExecutionMode
  thinkingLevel: ThinkingLevel | ''
  effortLevel: EffortLevel | ''
  frequency: Frequency
  interval: number
  time: string
  weekdays: WeekdayCode[]
  runWindowEnabled: boolean
  runWindowStartHour: number
  runWindowEndHour: number
  status: AutomationStatus
}

function defaultTargetIds(worktrees: Worktree[]): string[] {
  const ready = worktrees.filter(worktree => !worktree.archived_at)
  const base = ready.find(worktree => worktree.session_type === 'base')
  return base ? [base.id] : ready[0] ? [ready[0].id] : []
}

function emptyForm(worktrees: Worktree[]): AutomationFormState {
  const schedule = defaultScheduleFields()

  return {
    name: '',
    prompt: '',
    targetMode: 'existing_worktrees',
    targetWorktreeIds: defaultTargetIds(worktrees),
    backend: 'codex',
    model: '',
    provider: '',
    executionMode: 'plan',
    thinkingLevel: '',
    effortLevel: '',
    frequency: schedule.frequency,
    interval: schedule.interval,
    time: schedule.time,
    weekdays: schedule.weekdays,
    runWindowEnabled: schedule.runWindowEnabled,
    runWindowStartHour: schedule.runWindowStartHour,
    runWindowEndHour: schedule.runWindowEndHour,
    status: 'enabled',
  }
}

function fromAutomation(
  automation: Automation,
  worktrees: Worktree[]
): AutomationFormState {
  const schedule = parseSchedule(
    automation.schedule_rrule,
    automation.run_window_start_hour,
    automation.run_window_end_hour
  )

  return {
    name: automation.name,
    prompt: automation.prompt,
    targetMode: automation.target_mode ?? 'existing_worktrees',
    targetWorktreeIds:
      automation.target_mode === 'fresh_worktree'
        ? []
        : automation.target_worktree_ids.length > 0
          ? automation.target_worktree_ids
          : defaultTargetIds(worktrees),
    backend: automation.backend ?? 'codex',
    model: automation.model ?? '',
    provider: automation.provider ?? '',
    executionMode: automation.execution_mode ?? 'plan',
    thinkingLevel: automation.thinking_level ?? '',
    effortLevel: automation.effort_level ?? '',
    frequency: schedule.frequency,
    interval: schedule.interval,
    time: schedule.time,
    weekdays: schedule.weekdays,
    runWindowEnabled: schedule.runWindowEnabled,
    runWindowStartHour: schedule.runWindowStartHour,
    runWindowEndHour: schedule.runWindowEndHour,
    status: automation.status,
  }
}

export function buildAutomationInput(form: AutomationFormState) {
  return {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    target_mode: form.targetMode,
    target_worktree_ids:
      form.targetMode === 'fresh_worktree' ? [] : form.targetWorktreeIds,
    backend: form.backend,
    model: form.model.trim() || null,
    provider: form.provider.trim() || null,
    execution_mode: form.executionMode,
    thinking_level: form.thinkingLevel || null,
    effort_level: form.effortLevel || null,
    schedule_rrule: buildScheduleRRule(form),
    ...getRunWindowPayload(form),
    status: form.status,
  }
}

function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) return 'Never'
  return new Date(timestamp * 1000).toLocaleString()
}

function formatRunWindowSummary(form: AutomationFormState): string | null {
  if (form.frequency !== 'hourly' || !form.runWindowEnabled) {
    return null
  }

  return `${formatHourLabel(form.runWindowStartHour)}-${formatHourLabel(form.runWindowEndHour)}`
}

function statusTone(status?: string | null): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'running':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    case 'failed':
      return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
    case 'skipped':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300'
    default:
      return 'border-border bg-muted/40 text-muted-foreground'
  }
}

export function AutomationsPane({
  projectId,
}: {
  projectId: string
  projectPath: string
}) {
  const { data: automations = [] } = useAutomations(projectId)
  const { data: worktrees = [] } = useWorktrees(projectId)
  const createAutomation = useCreateAutomation()
  const updateAutomation = useUpdateAutomation()
  const deleteAutomation = useDeleteAutomation()
  const runAutomationNow = useRunAutomationNow()
  const pauseAutomation = usePauseAutomation()
  const resumeAutomation = useResumeAutomation()

  const activeWorktrees = useMemo(
    () => worktrees.filter(worktree => !worktree.archived_at),
    [worktrees]
  )

  const [selectedAutomationId, setSelectedAutomationId] = useState<
    string | 'new'
  >('new')
  const [form, setForm] = useState<AutomationFormState>(() =>
    emptyForm(activeWorktrees)
  )

  useEffect(() => {
    if (selectedAutomationId === 'new') return

    const selectedAutomation = automations.find(
      automation => automation.id === selectedAutomationId
    )
    if (!selectedAutomation) {
      setSelectedAutomationId('new')
      setForm(emptyForm(activeWorktrees))
      return
    }
    setForm(fromAutomation(selectedAutomation, activeWorktrees))
  }, [activeWorktrees, automations, selectedAutomationId])

  const selectedAutomation =
    selectedAutomationId === 'new'
      ? null
      : (automations.find(
          automation => automation.id === selectedAutomationId
        ) ?? null)

  const scheduleRRule = useMemo(() => buildScheduleRRule(form), [form])
  const runWindowSummary = useMemo(() => formatRunWindowSummary(form), [form])

  const isDirty = useMemo(() => {
    if (!selectedAutomation) {
      return (
        form.name.trim().length > 0 ||
        form.prompt.trim().length > 0 ||
        form.model.trim().length > 0 ||
        form.provider.trim().length > 0
      )
    }

    return (
      JSON.stringify(buildAutomationInput(form)) !==
      JSON.stringify(
        buildAutomationInput(
          fromAutomation(selectedAutomation, activeWorktrees)
        )
      )
    )
  }, [activeWorktrees, form, selectedAutomation])

  const toggleTarget = (
    worktreeId: string,
    checked: boolean | 'indeterminate'
  ) => {
    setForm(current => ({
      ...current,
      targetWorktreeIds:
        checked === true
          ? Array.from(new Set([...current.targetWorktreeIds, worktreeId]))
          : current.targetWorktreeIds.filter(id => id !== worktreeId),
    }))
  }

  const handleSave = async () => {
    const input = buildAutomationInput(form)

    if (selectedAutomation) {
      const updated = await updateAutomation.mutateAsync({
        id: selectedAutomation.id,
        input,
      })
      setSelectedAutomationId(updated.id)
      return
    }

    const created = await createAutomation.mutateAsync({
      projectId,
      input,
    })
    setSelectedAutomationId(created.id)
  }

  const pending =
    createAutomation.isPending ||
    updateAutomation.isPending ||
    deleteAutomation.isPending ||
    pauseAutomation.isPending ||
    resumeAutomation.isPending

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(18rem,22rem)_1fr]">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-medium text-foreground">Automations</h3>
          <Separator className="mt-2" />
        </div>
        <p className="text-xs text-muted-foreground">
          Scheduled AI runs stored in Jean app data. Each automation keeps its
          own dedicated session history.
        </p>
        <Button
          variant={selectedAutomationId === 'new' ? 'default' : 'outline'}
          className="w-full justify-start"
          onClick={() => {
            setSelectedAutomationId('new')
            setForm(emptyForm(activeWorktrees))
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New Automation
        </Button>

        <div className="space-y-3">
          {automations.length === 0 ? (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                No automations configured for this project yet.
              </CardContent>
            </Card>
          ) : (
            automations.map(automation => (
              <Card
                key={automation.id}
                className={cn(
                  'cursor-pointer border transition-colors',
                  selectedAutomationId === automation.id && 'border-primary'
                )}
                onClick={() => setSelectedAutomationId(automation.id)}
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-col items-start gap-2 sm:flex-row sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="line-clamp-2 text-base leading-snug sm:line-clamp-1">
                        {automation.name}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Next run {formatTimestamp(automation.next_run_at)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn(
                        'shrink-0 self-start',
                        statusTone(automation.last_run_status)
                      )}
                    >
                      {automation.status === 'paused'
                        ? 'Paused'
                        : (automation.last_run_status ?? 'Idle')}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                  <p className="line-clamp-3 text-xs text-muted-foreground">
                    {automation.prompt}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={event => {
                        event.stopPropagation()
                        void runAutomationNow.mutateAsync(automation.id)
                      }}
                    >
                      <Play className="mr-1 h-3.5 w-3.5" />
                      Run Now
                    </Button>
                    {automation.status === 'paused' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={event => {
                          event.stopPropagation()
                          void resumeAutomation.mutateAsync({
                            id: automation.id,
                            projectId,
                          })
                        }}
                      >
                        <Play className="mr-1 h-3.5 w-3.5" />
                        Resume
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={event => {
                          event.stopPropagation()
                          void pauseAutomation.mutateAsync({
                            id: automation.id,
                            projectId,
                          })
                        }}
                      >
                        <Pause className="mr-1 h-3.5 w-3.5" />
                        Pause
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      onClick={event => {
                        event.stopPropagation()
                        void deleteAutomation.mutateAsync({
                          id: automation.id,
                          projectId,
                        })
                        if (selectedAutomationId === automation.id) {
                          setSelectedAutomationId('new')
                          setForm(emptyForm(activeWorktrees))
                        }
                      }}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                  {automation.last_error && (
                    <p className="rounded-md border border-red-500/30 bg-red-500/5 px-2 py-1 text-xs text-red-700 dark:text-red-300">
                      {automation.last_error}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      <div className="space-y-6">
        <div>
          <h3 className="text-lg font-medium text-foreground">
            {selectedAutomation ? 'Edit Automation' : 'Create Automation'}
          </h3>
          <Separator className="mt-2" />
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Bot className="h-4 w-4" />
                Definition
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="automation-name">Name</Label>
                <Input
                  id="automation-name"
                  value={form.name}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Daily triage"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="automation-prompt">Prompt</Label>
                <Textarea
                  id="automation-prompt"
                  value={form.prompt}
                  onChange={event =>
                    setForm(current => ({
                      ...current,
                      prompt: event.target.value,
                    }))
                  }
                  placeholder="Review the repository status, summarize urgent changes, and propose the next action."
                  className="min-h-40"
                />
              </div>
              <div className="space-y-2">
                <Label>Run Target</Label>
                <Select
                  value={form.targetMode}
                  onValueChange={value =>
                    setForm(current => ({
                      ...current,
                      targetMode: value as AutomationTargetMode,
                      targetWorktreeIds:
                        value === 'fresh_worktree'
                          ? []
                          : current.targetWorktreeIds.length > 0
                            ? current.targetWorktreeIds
                            : defaultTargetIds(activeWorktrees),
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="existing_worktrees">
                      Existing worktrees
                    </SelectItem>
                    <SelectItem value="fresh_worktree">
                      Fresh worktree each run
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Targets</Label>
                <div className="space-y-2 rounded-md border p-3">
                  {form.targetMode === 'fresh_worktree' ? (
                    <p className="text-sm text-muted-foreground">
                      Each run creates a brand new worktree from the project
                      default branch, then archives older automation-created
                      runs.
                    </p>
                  ) : activeWorktrees.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Add or restore a worktree before configuring targets.
                    </p>
                  ) : (
                    activeWorktrees.map(worktree => (
                      <label
                        key={worktree.id}
                        className="flex items-center gap-3 text-sm"
                      >
                        <Checkbox
                          checked={form.targetWorktreeIds.includes(worktree.id)}
                          onCheckedChange={checked =>
                            toggleTarget(worktree.id, checked)
                          }
                        />
                        <span className="flex-1 truncate">
                          {worktree.name}
                          {worktree.session_type === 'base' && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              Base session
                            </span>
                          )}
                        </span>
                      </label>
                    ))
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarClock className="h-4 w-4" />
                Schedule And Runtime
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Backend</Label>
                  <Select
                    value={form.backend}
                    onValueChange={value =>
                      setForm(current => ({
                        ...current,
                        backend: value as Backend,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="codex">Codex</SelectItem>
                      <SelectItem value="claude">Claude</SelectItem>
                      <SelectItem value="opencode">OpenCode</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Execution Mode</Label>
                  <Select
                    value={form.executionMode}
                    onValueChange={value =>
                      setForm(current => ({
                        ...current,
                        executionMode: value as ExecutionMode,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="plan">Plan</SelectItem>
                      <SelectItem value="build">Build</SelectItem>
                      <SelectItem value="yolo">YOLO</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="automation-model">Model</Label>
                  <Input
                    id="automation-model"
                    value={form.model}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        model: event.target.value,
                      }))
                    }
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="automation-provider">Provider Profile</Label>
                  <Input
                    id="automation-provider"
                    value={form.provider}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        provider: event.target.value,
                      }))
                    }
                    placeholder="Optional"
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Thinking</Label>
                  <Select
                    value={form.thinkingLevel || '__none__'}
                    onValueChange={value =>
                      setForm(current => ({
                        ...current,
                        thinkingLevel:
                          value === '__none__' ? '' : (value as ThinkingLevel),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Inherit</SelectItem>
                      <SelectItem value="off">Off</SelectItem>
                      <SelectItem value="think">Think</SelectItem>
                      <SelectItem value="megathink">Megathink</SelectItem>
                      <SelectItem value="ultrathink">Ultrathink</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Effort</Label>
                  <Select
                    value={form.effortLevel || '__none__'}
                    onValueChange={value =>
                      setForm(current => ({
                        ...current,
                        effortLevel:
                          value === '__none__' ? '' : (value as EffortLevel),
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Inherit</SelectItem>
                      <SelectItem value="off">Off</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="max">Max</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label>Frequency</Label>
                  <Select
                    value={form.frequency}
                    onValueChange={value =>
                      setForm(current => ({
                        ...current,
                        frequency: value as Frequency,
                        runWindowEnabled:
                          value === 'hourly' ? current.runWindowEnabled : false,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">Hourly</SelectItem>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="automation-interval">Interval</Label>
                  <Input
                    id="automation-interval"
                    type="number"
                    min={1}
                    value={form.interval}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        interval: Math.max(1, Number(event.target.value) || 1),
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="automation-time">
                    {form.frequency === 'hourly' ? 'Minute Marker' : 'Time'}
                  </Label>
                  <Input
                    id="automation-time"
                    type="time"
                    step={60}
                    value={form.time}
                    onChange={event =>
                      setForm(current => ({
                        ...current,
                        time: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              {form.frequency === 'hourly' && (
                <div className="space-y-3 rounded-md border p-3">
                  <label className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={form.runWindowEnabled}
                      onCheckedChange={checked =>
                        setForm(current => ({
                          ...current,
                          runWindowEnabled: checked === true,
                        }))
                      }
                    />
                    <span>Restrict runs to specific hours</span>
                  </label>

                  {form.runWindowEnabled && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Start Hour</Label>
                        <Select
                          value={String(form.runWindowStartHour)}
                          onValueChange={value =>
                            setForm(current => {
                              const startHour = Number(value)
                              return {
                                ...current,
                                runWindowStartHour: startHour,
                                runWindowEndHour:
                                  current.runWindowEndHour <= startHour
                                    ? Math.min(23, startHour + 1)
                                    : current.runWindowEndHour,
                              }
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 23 }, (_, hour) => (
                              <SelectItem key={hour} value={String(hour)}>
                                {formatHourLabel(hour)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>End Hour</Label>
                        <Select
                          value={String(form.runWindowEndHour)}
                          onValueChange={value =>
                            setForm(current => ({
                              ...current,
                              runWindowEndHour: Number(value),
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Array.from({ length: 23 }, (_, index) => index + 1)
                              .filter(hour => hour > form.runWindowStartHour)
                              .map(hour => (
                                <SelectItem key={hour} value={String(hour)}>
                                  {formatHourLabel(hour)}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {form.frequency === 'weekly' && (
                <div className="space-y-2">
                  <Label>Weekdays</Label>
                  <div className="flex flex-wrap gap-2 rounded-md border p-3">
                    {WEEKDAYS.map(day => {
                      const selected = form.weekdays.includes(day.code)
                      return (
                        <button
                          key={day.code}
                          type="button"
                          className={cn(
                            'rounded-md border px-3 py-1.5 text-sm transition-colors',
                            selected
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-border bg-background text-muted-foreground'
                          )}
                          onClick={() =>
                            setForm(current => {
                              const weekdays = selected
                                ? current.weekdays.filter(
                                    code => code !== day.code
                                  )
                                : [...current.weekdays, day.code]
                              return {
                                ...current,
                                weekdays:
                                  weekdays.length > 0 ? weekdays : [day.code],
                              }
                            })
                          }
                        >
                          {day.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="rounded-md border bg-muted/20 p-3 text-xs text-muted-foreground">
                <div>RRULE</div>
                <code className="mt-1 block break-all text-foreground/80">
                  {scheduleRRule}
                </code>
                {runWindowSummary && (
                  <div className="mt-2">Allowed hours {runWindowSummary}</div>
                )}
                <div className="mt-2">
                  Next run{' '}
                  {selectedAutomation
                    ? formatTimestamp(selectedAutomation.next_run_at)
                    : 'will be calculated after save'}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-wrap gap-3">
          <Button
            onClick={() => void handleSave()}
            disabled={!isDirty || pending}
          >
            <Save className="mr-2 h-4 w-4" />
            {selectedAutomation ? 'Save Changes' : 'Create Automation'}
          </Button>
          {selectedAutomation && (
            <Button
              variant="outline"
              onClick={() =>
                void runAutomationNow.mutateAsync(selectedAutomation.id)
              }
            >
              <Play className="mr-2 h-4 w-4" />
              Run Now
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
