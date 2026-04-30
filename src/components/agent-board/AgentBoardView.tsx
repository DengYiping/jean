import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
} from 'react'
import {
  Archive,
  ExternalLink,
  Kanban,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { invoke } from '@/lib/transport'
import { cn } from '@/lib/utils'
import { AGENT_BOARD_FOCUS_EVENT } from '@/lib/agent-board-navigation'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { NativeSelect } from '@/components/ui/native-select'
import {
  canMoveAgentBoardItem,
  type AgentBoardItem,
  type AgentBoardLane,
} from '@/types/agent-board'
import type { Backend, EffortLevel } from '@/types/chat'
import type { Project, Worktree } from '@/types/projects'
import { useProjects } from '@/services/projects'
import {
  useAgentBoardItems,
  useCreateAgentBoardItem,
  useDeleteAgentBoardItem,
  useMoveAgentBoardItem,
  useRefreshAgentBoardItems,
} from '@/services/agent-board'
import { useUnreadSessions } from '@/services/chat'
import { DEFAULT_KEYBINDINGS, formatShortcutDisplay } from '@/types/keybindings'

const POINTER_DRAG_THRESHOLD_PX = 6

type AgentBoardColumnId =
  | 'todo'
  | 'plan'
  | 'implement'
  | 'pr'
  | 'yolo'
  | 'archive'

const AGENT_BOARD_COLUMNS: {
  id: AgentBoardColumnId
  label: string
  lanes: AgentBoardLane[]
}[] = [
  { id: 'todo', label: 'Todo', lanes: ['todo'] },
  { id: 'plan', label: 'Plan', lanes: ['planning', 'planned'] },
  {
    id: 'implement',
    label: 'Implement',
    lanes: ['implementing', 'implemented'],
  },
  { id: 'pr', label: 'PR', lanes: ['pr_opened'] },
  { id: 'yolo', label: 'Yolo', lanes: ['yoloing', 'yoloed'] },
  { id: 'archive', label: 'Archive', lanes: ['archived'] },
]

const AGENT_BOARD_COLUMN_LABELS = Object.fromEntries(
  AGENT_BOARD_COLUMNS.map(column => [column.id, column.label])
) as Record<AgentBoardColumnId, string>

interface NewAgentTodoDialogProps {
  open: boolean
  projects: Project[]
  onOpenChange: (open: boolean) => void
}

function NewAgentTodoDialog({
  open,
  projects,
  onOpenChange,
}: NewAgentTodoDialogProps) {
  const createItem = useCreateAgentBoardItem()
  const realProjects = projects.filter(project => !project.is_folder)
  const [projectId, setProjectId] = useState('')
  const [backend, setBackend] = useState<Backend>('codex')
  const [effortLevel, setEffortLevel] = useState<EffortLevel>('high')
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (open && !projectId && realProjects[0]) {
      setProjectId(realProjects[0].id)
    }
  }, [open, projectId, realProjects])

  const handleSubmit = useCallback(async () => {
    if (!projectId || !prompt.trim()) return
    try {
      await createItem.mutateAsync({
        project_id: projectId,
        title: title.trim() || undefined,
        prompt: prompt.trim(),
        backend,
        effort_level: effortLevel,
      })
      setTitle('')
      setPrompt('')
      onOpenChange(false)
    } catch (error) {
      toast.error(`Failed to create todo: ${error}`)
    }
  }, [backend, createItem, effortLevel, onOpenChange, projectId, prompt, title])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New agent todo</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <Input
            placeholder="Title (optional)"
            value={title}
            onChange={event => setTitle(event.target.value)}
          />
          <Textarea
            className="min-h-32 resize-none"
            placeholder="Describe the work..."
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
          />
          <div className="grid grid-cols-3 gap-2">
            <NativeSelect
              value={projectId}
              onChange={event => setProjectId(event.target.value)}
            >
              {realProjects.map(project => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              value={backend}
              onChange={event => setBackend(event.target.value as Backend)}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude</option>
              <option value="opencode">OpenCode</option>
            </NativeSelect>
            <NativeSelect
              value={effortLevel}
              onChange={event =>
                setEffortLevel(event.target.value as EffortLevel)
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </NativeSelect>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!projectId || !prompt.trim() || createItem.isPending}
          >
            {createItem.isPending && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function planPreview(item: AgentBoardItem) {
  return item.prompt
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 3)
}

function columnForLane(lane: AgentBoardLane): AgentBoardColumnId {
  for (const column of AGENT_BOARD_COLUMNS) {
    if (column.lanes.includes(lane)) return column.id
  }
  return 'todo'
}

function isAgentBoardColumnId(
  value: string | undefined
): value is AgentBoardColumnId {
  return AGENT_BOARD_COLUMNS.some(column => column.id === value)
}

function columnFromPoint(clientX: number, clientY: number) {
  const element = document.elementFromPoint(clientX, clientY)
  const columnElement = element?.closest<HTMLElement>(
    '[data-agent-board-column]'
  )
  const column = columnElement?.dataset.agentBoardColumn
  return isAgentBoardColumnId(column) ? column : undefined
}

function isInteractiveCardTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? Boolean(target.closest('button,a,input,textarea,select,[role="button"]'))
    : false
}

function isStartingLaneSideEffect(item: AgentBoardItem) {
  return (
    (item.lane === 'planning' && !item.planning_session_id) ||
    (item.lane === 'implementing' && !item.implementation_session_id) ||
    (item.lane === 'yoloing' && !item.yolo_session_id)
  )
}

function isAgentBoardItemInProgress(item: AgentBoardItem) {
  if (item.active_run_status) {
    return (
      item.active_run_status === 'running' ||
      item.active_run_status === 'resumable'
    )
  }

  return (
    item.lane === 'planning' ||
    item.lane === 'implementing' ||
    item.lane === 'yoloing' ||
    isStartingLaneSideEffect(item)
  )
}

function targetLaneForColumn(
  item: AgentBoardItem,
  column: AgentBoardColumnId
): AgentBoardLane | null {
  if (columnForLane(item.lane) === column) {
    return item.lane
  }

  const targetByColumn: Record<AgentBoardColumnId, AgentBoardLane | null> = {
    todo: null,
    plan: 'planning',
    implement: 'implementing',
    pr: 'pr_opened',
    yolo: 'yoloing',
    archive: 'archived',
  }
  const target = targetByColumn[column]
  return target && canMoveAgentBoardItem(item.lane, target) ? target : null
}

function sessionTargetForItem(item: AgentBoardItem) {
  const sessionId =
    item.implementation_session_id ??
    item.planning_session_id ??
    item.yolo_session_id
  const worktreeId =
    item.implementation_session_id || item.planning_session_id
      ? item.worktree_id
      : item.yolo_worktree_id

  return sessionId && worktreeId ? { sessionId, worktreeId } : null
}

export function AgentBoardView() {
  const { data: items = [], isLoading } = useAgentBoardItems()
  const { data: unreadSessions } = useUnreadSessions(true)
  const { data: projects = [] } = useProjects()
  const moveItem = useMoveAgentBoardItem()
  const deleteItem = useDeleteAgentBoardItem()
  const refreshItems = useRefreshAgentBoardItems()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightItemId, setHighlightItemId] = useState<string | null>(null)
  const [draggingItemId, setDraggingItemId] = useState<string | null>(null)

  useEffect(() => {
    const handler = () => {
      setDialogOpen(true)
    }
    window.addEventListener('agent-board:new-todo', handler)
    return () => window.removeEventListener('agent-board:new-todo', handler)
  }, [])

  useEffect(() => {
    const handler = (event: Event) => {
      const itemId = (event as CustomEvent<{ itemId?: string }>).detail?.itemId
      if (!itemId) return
      setHighlightItemId(itemId)
      window.setTimeout(() => {
        document
          .querySelector(`[data-agent-board-item-id="${CSS.escape(itemId)}"]`)
          ?.scrollIntoView({ block: 'center', inline: 'center' })
      }, 0)
      window.setTimeout(() => {
        setHighlightItemId(current => (current === itemId ? null : current))
      }, 2500)
    }
    window.addEventListener(AGENT_BOARD_FOCUS_EVENT, handler)
    return () => window.removeEventListener(AGENT_BOARD_FOCUS_EVENT, handler)
  }, [])

  const projectById = useMemo(
    () => new Map(projects.map(project => [project.id, project])),
    [projects]
  )

  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase()
    if (!search) return items
    return items.filter(item => {
      const project = projectById.get(item.project_id)
      return (
        item.title.toLowerCase().includes(search) ||
        item.prompt.toLowerCase().includes(search) ||
        project?.name.toLowerCase().includes(search)
      )
    })
  }, [items, projectById, query])

  const grouped = useMemo(() => {
    const columns = new Map<AgentBoardColumnId, AgentBoardItem[]>()
    for (const column of AGENT_BOARD_COLUMNS) columns.set(column.id, [])
    for (const item of filteredItems) {
      columns.get(columnForLane(item.lane))?.push(item)
    }
    return columns
  }, [filteredItems])

  const attentionItemIds = useMemo(() => {
    const sessionToItemId = new Map<string, string>()
    for (const item of items) {
      for (const sessionId of [
        item.planning_session_id,
        item.implementation_session_id,
        item.yolo_session_id,
      ]) {
        if (sessionId) {
          sessionToItemId.set(sessionId, item.id)
        }
      }
    }

    const ids = new Set<string>()
    for (const entry of unreadSessions?.entries ?? []) {
      if (entry.session.agent_board_item_id) {
        ids.add(entry.session.agent_board_item_id)
      }
      const itemId = sessionToItemId.get(entry.session.id)
      if (itemId) {
        ids.add(itemId)
      }
    }
    return ids
  }, [items, unreadSessions])

  const openSession = useCallback(async (item: AgentBoardItem) => {
    let target = sessionTargetForItem(item)
    if (!target) {
      try {
        const latestItems = await invoke<AgentBoardItem[]>(
          'refresh_agent_board_items'
        )
        const latestItem = latestItems.find(
          candidate => candidate.id === item.id
        )
        target = latestItem ? sessionTargetForItem(latestItem) : null
      } catch {
        target = null
      }
    }

    if (!target) {
      toast.info('This card does not have a session yet')
      return
    }
    try {
      const worktree = await invoke<Worktree>('get_worktree', {
        worktreeId: target.worktreeId,
      })
      useUIStore.getState().setActiveMainView('workspace')
      useProjectsStore.getState().selectProject(worktree.project_id)
      useProjectsStore.getState().expandProject(worktree.project_id)
      useProjectsStore.getState().selectWorktree(worktree.id)
      useChatStore.getState().setActiveWorktree(worktree.id, worktree.path)
      useChatStore.getState().setActiveSession(worktree.id, target.sessionId)
      useChatStore
        .getState()
        .setLastOpenedForProject(
          worktree.project_id,
          worktree.id,
          target.sessionId
        )
    } catch (error) {
      toast.error(`Failed to open session: ${error}`)
    }
  }, [])

  const move = useCallback(
    async (item: AgentBoardItem, lane: AgentBoardLane) => {
      if (lane === item.lane) return
      try {
        await moveItem.mutateAsync({ itemId: item.id, lane })
      } catch (error) {
        toast.error(`Failed to move card: ${error}`)
      }
    },
    [moveItem]
  )

  const deleteArchivedItem = useCallback(
    async (item: AgentBoardItem) => {
      try {
        await deleteItem.mutateAsync(item.id)
        toast.success('Archived worktree delete started')
      } catch (error) {
        toast.error(`Failed to delete archived worktree: ${error}`)
      }
    },
    [deleteItem]
  )

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold">Global Board</h1>
            <Kanban className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className="text-xs text-muted-foreground">
            AI agent work across all repositories
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refreshItems.mutate()}
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4" />
            Add todo
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
        <Input
          className="h-8 max-w-sm"
          placeholder="Filter tasks..."
          value={query}
          onChange={event => setQuery(event.target.value)}
        />
        <Badge variant="outline" className="h-7 gap-1 font-normal">
          {formatShortcutDisplay(DEFAULT_KEYBINDINGS.new_agent_todo)}
        </Badge>
        <Button variant="ghost" size="icon" className="ml-auto h-8 w-8">
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-2 overflow-x-auto p-3">
        {AGENT_BOARD_COLUMNS.map(column => {
          const columnItems = grouped.get(column.id) ?? []
          return (
            <section
              key={column.id}
              data-agent-board-column={column.id}
              className="flex w-64 shrink-0 flex-col rounded-md border bg-muted/20"
            >
              <div className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
                <h2 className="text-xs font-semibold">{column.label}</h2>
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                  {columnItems.length}
                </Badge>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                {isLoading ? (
                  <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading
                  </div>
                ) : (
                  columnItems.map(item => (
                    <AgentBoardCard
                      key={item.id}
                      item={item}
                      project={projectById.get(item.project_id)}
                      highlighted={highlightItemId === item.id}
                      attention={attentionItemIds.has(item.id)}
                      dragging={draggingItemId === item.id}
                      onDragStart={() => setDraggingItemId(item.id)}
                      onDragEnd={() => setDraggingItemId(null)}
                      onPointerColumnDrop={column => {
                        const targetLane = targetLaneForColumn(item, column)
                        if (targetLane) move(item, targetLane)
                      }}
                      onMove={column => {
                        const targetLane = targetLaneForColumn(item, column)
                        if (targetLane) move(item, targetLane)
                      }}
                      onDelete={() => deleteArchivedItem(item)}
                      deleting={deleteItem.isPending}
                      onOpenSession={() => openSession(item)}
                    />
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>

      <NewAgentTodoDialog
        open={dialogOpen}
        projects={projects}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}

function AgentBoardCard({
  item,
  project,
  highlighted,
  attention,
  dragging,
  onDragStart,
  onDragEnd,
  onPointerColumnDrop,
  onMove,
  onDelete,
  deleting,
  onOpenSession,
}: {
  item: AgentBoardItem
  project?: Project
  highlighted?: boolean
  attention?: boolean
  dragging?: boolean
  onDragStart: () => void
  onDragEnd: () => void
  onPointerColumnDrop: (column: AgentBoardColumnId) => void
  onMove: (column: AgentBoardColumnId) => void
  onDelete: () => void
  deleting?: boolean
  onOpenSession: () => void
}) {
  const pointerDragRef = useRef<{
    pointerId: number
    startX: number
    startY: number
    moved: boolean
  } | null>(null)
  const preview = planPreview(item)
  const hasSession =
    item.planning_session_id ||
    item.implementation_session_id ||
    item.yolo_session_id
  const inProgress = isAgentBoardItemInProgress(item)
  const currentColumn = columnForLane(item.lane)

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.button !== 0 || isInteractiveCardTarget(event.target)) return
    pointerDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    onDragStart()
  }

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const distance = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY
    )
    if (distance >= POINTER_DRAG_THRESHOLD_PX) {
      drag.moved = true
    }
  }

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    pointerDragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    onDragEnd()

    if (!drag.moved) {
      onOpenSession()
      return
    }
    const column = columnFromPoint(event.clientX, event.clientY)
    if (column) {
      onPointerColumnDrop(column)
    }
  }

  const handlePointerCancel = (event: PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    pointerDragRef.current = null
    onDragEnd()
  }

  return (
    <article
      data-agent-board-item-id={item.id}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className={cn(
        'cursor-grab touch-none rounded-md border bg-background p-2 shadow-sm transition-colors hover:border-foreground/20 active:cursor-grabbing',
        attention &&
          'animate-pulse border-primary bg-primary/5 ring-2 ring-primary/30',
        highlighted && 'border-primary shadow-md ring-2 ring-primary/25',
        dragging && 'opacity-75 ring-2 ring-primary/20',
        item.last_error && 'border-destructive/50'
      )}
    >
      <div className="mb-2 text-[11px] text-muted-foreground">
        {project?.name ?? 'Unknown repo'}
      </div>
      <h3 className="mb-2 line-clamp-3 text-sm font-medium leading-snug">
        {item.title}
      </h3>
      <div className="mb-2 flex flex-wrap gap-1">
        {inProgress && (
          <Loader2
            className="h-4 w-4 animate-spin text-primary"
            aria-label="Work in progress"
          />
        )}
        <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
          {item.backend}
        </Badge>
        {item.effort_level && (
          <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
            {item.effort_level}
          </Badge>
        )}
      </div>
      {(item.lane === 'planned' || item.lane === 'planning') &&
        preview.length > 0 && (
          <div className="mb-2 rounded border bg-muted/30 px-2 py-1.5">
            <div className="mb-1 text-[10px] font-medium">Plan preview</div>
            <ul className="space-y-1 text-[11px] text-muted-foreground">
              {preview.map(line => (
                <li key={line} className="line-clamp-1">
                  - {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      {item.pr_url && (
        <a
          href={item.pr_url}
          target="_blank"
          rel="noreferrer"
          className="mb-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
        >
          PR <ExternalLink className="h-3 w-3" />
        </a>
      )}
      {item.last_error && (
        <p className="mb-2 line-clamp-2 text-[11px] text-destructive">
          {item.last_error}
        </p>
      )}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          disabled={!hasSession}
          onClick={onOpenSession}
        >
          Open
        </Button>
        <NativeSelect
          className="h-7 text-xs"
          value={currentColumn}
          onChange={event => onMove(event.target.value as AgentBoardColumnId)}
        >
          {AGENT_BOARD_COLUMNS.map(column => (
            <option
              key={column.id}
              value={column.id}
              disabled={!targetLaneForColumn(item, column.id)}
            >
              {AGENT_BOARD_COLUMN_LABELS[column.id]}
            </option>
          ))}
        </NativeSelect>
        {item.lane === 'archived' ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            aria-label="Delete archived worktree"
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Archive card"
            onClick={() => onMove('archive')}
          >
            <Archive className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </article>
  )
}
