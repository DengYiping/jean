import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft,
  Bot,
  Code2,
  Loader2,
  Plus,
  Search,
  Terminal,
  X,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Kbd } from '@/components/ui/kbd'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { invoke } from '@/lib/transport'
import {
  useCreateSession,
  useNativeCliSessions,
  useSessions,
  type NativeCliHistorySession,
} from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useUIStore } from '@/store/ui-store'
import type { Session } from '@/types/chat'
import { backendOptions, type CliBackend } from '@/types/preferences'

interface PreparedBackendTerminalContext {
  commandArgs: string[]
}

export type NativeCliSessionKind = 'terminal' | CliBackend
const RECENT_SESSION_LIMIT = 5

const backendIcons: Record<CliBackend, typeof Bot> = {
  codex: Code2,
  claude: Bot,
  opencode: Terminal,
}

function getBackendLabel(backend: CliBackend): string {
  return (
    backendOptions.find(option => option.value === backend)?.label ?? backend
  )
}

interface NativeCliSessionsModalProps {
  open: boolean
  kind: NativeCliSessionKind | null
  worktreeId: string
  worktreePath: string
  command: string | null
  commandArgs?: string[] | null
  onBack: () => void
  onClose: () => void
  onOpenSessionModal: (
    sessionId: string,
    worktreeId: string,
    worktreePath: string
  ) => void
}

function isCliBackend(kind: NativeCliSessionKind | null): kind is CliBackend {
  return kind !== null && kind !== 'terminal'
}

function sessionMatchesKind(
  session: Session,
  kind: NativeCliSessionKind,
  runtimeSurface: string | undefined
): boolean {
  const isTerminalSession =
    session.primary_surface === 'terminal' || runtimeSurface === 'terminal'
  if (!isTerminalSession) return false
  if (kind === 'terminal') {
    return !session.backend || session.name === 'Terminal'
  }
  return session.backend === kind
}

function formatSessionDescription(session: Session): string {
  const parts: string[] = []
  if (session.message_count != null) {
    parts.push(
      `${session.message_count} message${session.message_count === 1 ? '' : 's'}`
    )
  }
  const timestamp =
    session.last_opened_at ?? session.last_message_at ?? session.updated_at
  if (timestamp) {
    parts.push(`updated ${new Date(timestamp * 1000).toLocaleDateString()}`)
  }
  return parts.join(' · ') || 'Pure CLI terminal session'
}

function getSessionUpdatedAt(session: Session): number {
  return (
    session.last_opened_at ?? session.last_message_at ?? session.updated_at ?? 0
  )
}

export function NativeCliSessionsModal({
  open,
  kind,
  worktreeId,
  worktreePath,
  command,
  commandArgs,
  onBack,
  onClose,
  onOpenSessionModal,
}: NativeCliSessionsModalProps) {
  const [openingSessionId, setOpeningSessionId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const newSessionButtonRef = useRef<HTMLButtonElement>(null)
  const createSession = useCreateSession()
  const backend = isCliBackend(kind) ? kind : undefined
  const sessionsQuery = useSessions(worktreeId, worktreePath, {
    includeMessageCounts: true,
  })
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const nativeSessionsQuery = useNativeCliSessions(
    worktreePath,
    backend ?? null,
    {
      enabled: open && !!backend,
      searchQuery: normalizedSearch,
      resultLimit: normalizedSearch ? 100 : RECENT_SESSION_LIMIT,
    }
  )
  const runtimeSurfaces = useUIStore(state => state.sessionPrimarySurface)

  const title =
    kind === 'terminal'
      ? 'Terminal sessions'
      : kind
        ? `${getBackendLabel(kind)} sessions`
        : 'CLI sessions'
  const label = backend ? getBackendLabel(backend) : 'Terminal'
  const Icon = backend ? backendIcons[backend] : Terminal

  const sessions = useMemo(() => {
    if (!kind) return []
    return (sessionsQuery.data?.sessions ?? [])
      .filter(session =>
        sessionMatchesKind(session, kind, runtimeSurfaces[session.id])
      )
      .sort((a, b) => getSessionUpdatedAt(b) - getSessionUpdatedAt(a))
  }, [kind, runtimeSurfaces, sessionsQuery.data?.sessions])

  const nativeSessions = useMemo(() => {
    if (!backend) return []
    const existingResumeIds = new Set(
      sessions
        .flatMap(session => [
          session.codex_thread_id,
          session.claude_session_id,
          session.opencode_session_id,
          ...(session.terminal_command_args ?? []),
        ])
        .filter((value): value is string => Boolean(value))
    )
    return (nativeSessionsQuery.data ?? [])
      .filter(session => !existingResumeIds.has(session.id))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [backend, nativeSessionsQuery.data, sessions])

  const filteredSessions = useMemo(() => {
    if (!normalizedSearch) return sessions
    return sessions.filter(session =>
      [
        session.name,
        session.backend,
        session.terminal_label,
        session.terminal_command,
        ...(session.terminal_command_args ?? []),
        formatSessionDescription(session),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    )
  }, [normalizedSearch, sessions])

  const filteredNativeSessions = useMemo(() => {
    if (!normalizedSearch) return nativeSessions
    return nativeSessions.filter(session =>
      [
        session.title,
        session.backend,
        session.id,
        session.cwd,
        session.sourcePath,
        ...session.resumeArgs,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    )
  }, [nativeSessions, normalizedSearch])

  const visibleRows = useMemo(() => {
    const rows = [
      ...filteredSessions.map(session => ({
        type: 'jean' as const,
        key: `jean-${session.id}`,
        updatedAt: getSessionUpdatedAt(session),
        session,
      })),
      ...filteredNativeSessions.map(session => ({
        type: 'native' as const,
        key: `native-${session.backend}-${session.id}`,
        updatedAt: session.updatedAt,
        session,
      })),
    ].sort((a, b) => b.updatedAt - a.updatedAt)

    return normalizedSearch ? rows : rows.slice(0, RECENT_SESSION_LIMIT)
  }, [filteredNativeSessions, filteredSessions, normalizedSearch])

  const prepareCommandArgs = useCallback(
    async (sessionId: string): Promise<string[]> => {
      if (!backend) return []
      try {
        const prepared = await invoke<PreparedBackendTerminalContext>(
          'prepare_backend_terminal_context',
          { sessionId, worktreeId, backend }
        )
        return prepared.commandArgs
      } catch {
        return []
      }
    },
    [backend, worktreeId]
  )

  const openTerminalSession = useCallback(
    async (session: Session) => {
      setOpeningSessionId(session.id)
      try {
        const terminalStore = useTerminalStore.getState()
        const uiStore = useUIStore.getState()
        const existingTerminalId = uiStore.sessionTerminalIds[session.id]
        const existingTerminal = existingTerminalId
          ? (terminalStore.terminals[worktreeId] ?? []).find(
              terminal => terminal.id === existingTerminalId
            )
          : undefined

        let terminalId = existingTerminal?.id
        if (!terminalId) {
          const resolvedCommandArgs =
            session.terminal_command_args &&
            session.terminal_command_args.length > 0
              ? session.terminal_command_args
              : await prepareCommandArgs(session.id)
          terminalId = terminalStore.addTerminal(
            worktreeId,
            session.terminal_command ?? command ?? undefined,
            session.terminal_label ?? session.name,
            {
              kind: 'session',
              commandArgs: resolvedCommandArgs,
              activate: false,
              openPanel: false,
            }
          )
        }

        uiStore.setSessionPrimarySurface(session.id, 'terminal')
        uiStore.setSessionTerminalId(session.id, terminalId)
        const chatStore = useChatStore.getState()
        chatStore.setActiveSession(worktreeId, session.id)
        if (backend) chatStore.setSelectedBackend(session.id, backend)
        onClose()
        onOpenSessionModal(session.id, worktreeId, worktreePath)
      } finally {
        setOpeningSessionId(null)
      }
    },
    [
      backend,
      command,
      onClose,
      onOpenSessionModal,
      prepareCommandArgs,
      worktreeId,
      worktreePath,
    ]
  )

  const createNewSession = useCallback(() => {
    createSession.mutate(
      {
        worktreeId,
        worktreePath,
        name: label,
        backend,
        primarySurface: 'terminal',
        terminalCommand: command,
        terminalCommandArgs: commandArgs ?? [],
        terminalLabel: label,
      },
      {
        onSuccess: session => {
          void openTerminalSession({
            ...session,
            primary_surface: 'terminal',
            terminal_command: command,
            terminal_command_args: commandArgs ?? [],
            terminal_label: label,
          })
        },
      }
    )
  }, [
    backend,
    command,
    commandArgs,
    createSession,
    label,
    openTerminalSession,
    worktreeId,
    worktreePath,
  ])

  const openNativeHistorySession = useCallback(
    (nativeSession: NativeCliHistorySession) => {
      createSession.mutate(
        {
          worktreeId,
          worktreePath,
          name: nativeSession.title,
          backend,
          primarySurface: 'terminal',
          terminalCommand: command,
          terminalCommandArgs: nativeSession.resumeArgs,
          terminalLabel: nativeSession.title,
        },
        {
          onSuccess: session => {
            void openTerminalSession({
              ...session,
              primary_surface: 'terminal',
              terminal_command: command,
              terminal_command_args: nativeSession.resumeArgs,
              terminal_label: nativeSession.title,
            })
          },
        }
      )
    },
    [
      backend,
      command,
      createSession,
      openTerminalSession,
      worktreeId,
      worktreePath,
    ]
  )

  const isLoading = sessionsQuery.isLoading || nativeSessionsQuery.isLoading
  const hasAnySessions = sessions.length > 0 || nativeSessions.length > 0
  const hasFilteredSessions = visibleRows.length > 0

  return (
    <Dialog open={open} onOpenChange={nextOpen => !nextOpen && onClose()}>
      <DialogContent
        className="grid h-[min(760px,calc(100vh-64px))] w-[min(860px,calc(100vw-32px))] grid-rows-[auto_auto_auto_auto_minmax(0,1fr)] gap-4 p-5 sm:max-w-[860px]"
        onOpenAutoFocus={event => {
          event.preventDefault()
          newSessionButtonRef.current?.focus()
        }}
      >
        <DialogHeader className="space-y-1 pr-6">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={onBack}
            >
              <ArrowLeft className="size-4" />
            </Button>
            <DialogTitle className="text-base font-semibold">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs leading-5">
            Continue an existing pure CLI session or start a new one.
          </DialogDescription>
        </DialogHeader>

        <Button
          ref={newSessionButtonRef}
          type="button"
          variant="outline"
          className="h-10 justify-start gap-3 px-3"
          disabled={createSession.isPending || openingSessionId !== null}
          onClick={createNewSession}
        >
          {createSession.isPending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plus className="size-4" />
          )}
          New {label} session
          <Kbd aria-hidden="true" className="shrink-0 text-[10px]">
            Enter
          </Kbd>
        </Button>

        <Separator
          data-testid="native-cli-session-search-separator"
          className="my-1 bg-border/70"
        />

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search sessions, prompts, paths, or resume IDs..."
            aria-label="Search native CLI sessions"
            className="h-10 pl-9 pr-9"
          />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="grid min-h-0 min-w-0 auto-rows-min gap-2 overflow-y-auto pr-1">
          {isLoading && (
            <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Loading sessions...
            </div>
          )}

          {!isLoading &&
            visibleRows.map(row => {
              if (row.type === 'jean') {
                const session = row.session
                return (
                  <SessionButton
                    key={row.key}
                    title={session.name}
                    description={formatSessionDescription(session)}
                    disabled={
                      openingSessionId !== null || createSession.isPending
                    }
                    loading={openingSessionId === session.id}
                    icon={Icon}
                    onClick={() => void openTerminalSession(session)}
                  />
                )
              }

              const session = row.session
              return (
                <SessionButton
                  key={row.key}
                  title={session.title}
                  description={`updated ${new Date(
                    session.updatedAt * 1000
                  ).toLocaleDateString()} · ${session.cwd}`}
                  badge="Native"
                  disabled={
                    openingSessionId !== null || createSession.isPending
                  }
                  icon={Icon}
                  onClick={() => openNativeHistorySession(session)}
                />
              )
            })}

          {!isLoading && !hasAnySessions && (
            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
              No existing {label} sessions for this worktree.
            </div>
          )}

          {!isLoading && hasAnySessions && !hasFilteredSessions && (
            <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
              No sessions match <span>{searchQuery}</span>.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SessionButton({
  title,
  description,
  badge,
  disabled,
  loading,
  icon: Icon,
  onClick,
}: {
  title: string
  description: string
  badge?: string
  disabled?: boolean
  loading?: boolean
  icon: typeof Terminal
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full min-w-0 items-start gap-3 rounded-lg border border-border/70 bg-muted/25 px-3.5 py-3 text-left transition-colors',
        'hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-muted/25'
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {loading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2 text-sm font-medium leading-5">
          <span className="break-words">{title}</span>
          {badge && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-1 block break-all text-xs leading-5 text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  )
}
