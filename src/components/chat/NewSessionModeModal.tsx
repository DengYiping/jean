import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  Bot,
  Code2,
  Loader2,
  MessageSquarePlus,
  Terminal,
  Zap,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useCreateSession } from '@/services/chat'
import { useClaudeCliStatus } from '@/services/claude-cli'
import { useCodexCliStatus } from '@/services/codex-cli'
import { useOpencodeCliStatus } from '@/services/opencode-cli'
import { useChatStore } from '@/store/chat-store'
import { useUIStore, type NewSessionModeOrigin } from '@/store/ui-store'
import { backendOptions, type CliBackend } from '@/types/preferences'
import { usePreferences } from '@/services/preferences'
import {
  NativeCliSessionsModal,
  type NativeCliSessionKind,
} from './NativeCliSessionsModal'

const BACKEND_ORDER: CliBackend[] = ['codex', 'claude', 'opencode']

const backendCommands: Record<CliBackend, string> = {
  codex: 'codex',
  claude: 'claude',
  opencode: 'opencode',
}

const backendIcons: Record<CliBackend, typeof Bot> = {
  codex: Code2,
  claude: Bot,
  opencode: Terminal,
}

const YOLO_ARGS_BY_BACKEND: Partial<Record<CliBackend, string[]>> = {
  codex: ['--dangerously-bypass-approvals-and-sandbox'],
  claude: ['--permission-mode', 'bypassPermissions'],
}

function getBackendLabel(backend: CliBackend): string {
  return (
    backendOptions.find(option => option.value === backend)?.label ?? backend
  )
}

export function NewSessionModeModal() {
  const target = useUIStore(state => state.newSessionModeTarget)
  const close = useUIStore(state => state.closeNewSessionModeModal)
  const createSession = useCreateSession()
  const claudeStatus = useClaudeCliStatus({ enabled: target !== null })
  const codexStatus = useCodexCliStatus({ enabled: target !== null })
  const opencodeStatus = useOpencodeCliStatus({ enabled: target !== null })
  const { data: preferences } = usePreferences()
  const [nativePickerKind, setNativePickerKind] =
    useState<NativeCliSessionKind | null>(null)
  const [nativePickerInitialCommandArgs, setNativePickerInitialCommandArgs] =
    useState<string[]>([])
  const [nativePickerAutoStartNew, setNativePickerAutoStartNew] =
    useState(false)
  const autoHandledTargetRef = useRef<string | null>(null)
  const open = target !== null

  const installedBackendChoices = useMemo(
    () =>
      BACKEND_ORDER.map(backend => {
        const status =
          backend === 'codex'
            ? codexStatus
            : backend === 'claude'
              ? claudeStatus
              : opencodeStatus
        const command =
          backend === 'opencode'
            ? (opencodeStatus.data?.command ??
              opencodeStatus.data?.path ??
              backendCommands[backend])
            : (status.data?.path ?? backendCommands[backend])
        const commandArgs =
          backend === 'opencode'
            ? (opencodeStatus.data?.command_args ?? null)
            : null
        return {
          backend,
          shortcut: String(BACKEND_ORDER.indexOf(backend) + 2),
          installed: Boolean(status.data?.installed),
          command,
          commandArgs,
        }
      }).filter(choice => choice.installed),
    [
      claudeStatus.data?.installed,
      claudeStatus.data?.path,
      codexStatus.data?.installed,
      codexStatus.data?.path,
      opencodeStatus.data?.command,
      opencodeStatus.data?.command_args,
      opencodeStatus.data?.installed,
      opencodeStatus.data?.path,
    ]
  )

  const isCheckingBackends =
    claudeStatus.isLoading || codexStatus.isLoading || opencodeStatus.isLoading

  const nativePickerCommand = useMemo(() => {
    if (nativePickerKind === null || nativePickerKind === 'terminal') {
      return null
    }
    return (
      installedBackendChoices.find(
        choice => choice.backend === nativePickerKind
      )?.command ?? backendCommands[nativePickerKind]
    )
  }, [installedBackendChoices, nativePickerKind])

  const nativePickerCommandArgs = useMemo(() => {
    if (nativePickerKind === null || nativePickerKind === 'terminal') {
      return null
    }
    return (
      installedBackendChoices.find(
        choice => choice.backend === nativePickerKind
      )?.commandArgs ?? null
    )
  }, [installedBackendChoices, nativePickerKind])

  const openSessionModal = useCallback(
    (sessionId: string, origin: NewSessionModeOrigin) => {
      if (!target) return
      const { worktreeId, worktreePath } = target
      if (origin === 'canvas') {
        window.dispatchEvent(
          new CustomEvent('open-session-modal', {
            detail: { sessionId, worktreeId, worktreePath },
          })
        )
      } else if (origin === 'modal') {
        window.dispatchEvent(
          new CustomEvent('open-session-modal', {
            detail: { sessionId },
          })
        )
      }
    },
    [target]
  )

  const chooseChat = useCallback(() => {
    if (!target) return
    const { worktreeId, worktreePath, origin } = target
    close()
    createSession.mutate(
      { worktreeId, worktreePath },
      {
        onSuccess: session => {
          useChatStore.getState().setActiveSession(worktreeId, session.id)
          useUIStore.getState().setSessionPrimarySurface(session.id, 'chat')
          openSessionModal(session.id, origin)
        },
      }
    )
  }, [close, createSession, openSessionModal, target])

  const choosePlainTerminal = useCallback(() => {
    setNativePickerInitialCommandArgs([])
    setNativePickerAutoStartNew(false)
    setNativePickerKind('terminal')
  }, [])

  const chooseBackendTerminal = useCallback((backend: CliBackend) => {
    setNativePickerInitialCommandArgs([])
    setNativePickerAutoStartNew(false)
    setNativePickerKind(backend)
  }, [])

  const chooseBackendTerminalYolo = useCallback((backend: CliBackend) => {
    const yoloArgs = YOLO_ARGS_BY_BACKEND[backend]
    if (!yoloArgs) return
    setNativePickerInitialCommandArgs(yoloArgs)
    setNativePickerAutoStartNew(true)
    setNativePickerKind(backend)
  }, [])

  const closeAll = useCallback(() => {
    autoHandledTargetRef.current = null
    setNativePickerKind(null)
    setNativePickerInitialCommandArgs([])
    setNativePickerAutoStartNew(false)
    close()
  }, [close])

  useEffect(() => {
    if (!target || target.intent !== 'default') {
      autoHandledTargetRef.current = null
      return
    }
    if (!preferences) return

    const defaultKind = preferences.default_new_session_kind ?? 'chat'
    const targetKey = `${target.worktreeId}:${target.worktreePath}:${target.origin}:${defaultKind}`
    if (autoHandledTargetRef.current === targetKey) return
    autoHandledTargetRef.current = targetKey

    if (defaultKind === 'chat') {
      chooseChat()
      return
    }

    if (defaultKind === 'terminal') {
      setNativePickerInitialCommandArgs([])
      setNativePickerAutoStartNew(false)
      setNativePickerKind('terminal')
      return
    }

    setNativePickerInitialCommandArgs([])
    setNativePickerAutoStartNew(false)
    setNativePickerKind(defaultKind)
  }, [chooseChat, preferences, target])

  useEffect(() => {
    if (!open || nativePickerKind !== null) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
        return
      }

      if (event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        chooseChat()
        return
      }

      if (event.key === '1') {
        event.preventDefault()
        event.stopPropagation()
        choosePlainTerminal()
        return
      }

      const choice = installedBackendChoices.find(
        item => item.shortcut === event.key
      )
      if (choice) {
        event.preventDefault()
        event.stopPropagation()
        chooseBackendTerminal(choice.backend)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [
    chooseBackendTerminal,
    chooseBackendTerminalYolo,
    chooseChat,
    choosePlainTerminal,
    installedBackendChoices,
    nativePickerKind,
    open,
  ])

  return (
    <>
      <Dialog
        open={open && nativePickerKind === null && target?.intent !== 'default'}
        onOpenChange={nextOpen => !nextOpen && closeAll()}
      >
        <DialogContent className="w-[min(420px,calc(100vw-32px))] gap-3 p-4 sm:max-w-[420px]">
          <DialogHeader className="space-y-1 pr-6">
            <DialogTitle className="text-base font-semibold">
              New session
            </DialogTitle>
            <DialogDescription className="text-xs leading-5">
              Choose what to open for this worktree.
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-w-0 gap-2">
            <NewSessionChoice
              icon={
                createSession.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <MessageSquarePlus className="size-4" />
                )
              }
              title="Jean Chat"
              subtitle="Use the standard chat session surface"
              badge="Default"
              shortcut="Enter"
              disabled={createSession.isPending}
              onClick={chooseChat}
            />

            <NewSessionChoice
              icon={<Terminal className="size-4" />}
              title="Terminal"
              subtitle="Open a plain terminal on this worktree"
              shortcut="1"
              disabled={createSession.isPending}
              onClick={choosePlainTerminal}
            />

            {installedBackendChoices.map(choice => {
              const Icon = backendIcons[choice.backend]
              const label = getBackendLabel(choice.backend)
              const yoloArgs = YOLO_ARGS_BY_BACKEND[choice.backend]
              return (
                <NativeBackendChoice
                  key={choice.backend}
                  icon={<Icon className="size-4" />}
                  title={label}
                  subtitle={`Open native ${label} in a terminal session`}
                  shortcut={choice.shortcut}
                  yoloAvailable={Boolean(yoloArgs)}
                  disabled={createSession.isPending}
                  onClick={() => chooseBackendTerminal(choice.backend)}
                  onYoloClick={() => chooseBackendTerminalYolo(choice.backend)}
                />
              )
            })}

            {isCheckingBackends && installedBackendChoices.length === 0 && (
              <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                Checking installed backends...
              </div>
            )}

            {!isCheckingBackends && installedBackendChoices.length === 0 && (
              <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 text-xs text-muted-foreground">
                No installed backend CLIs found.
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {target && (
        <NativeCliSessionsModal
          open={open && nativePickerKind !== null}
          kind={nativePickerKind}
          worktreeId={target.worktreeId}
          worktreePath={target.worktreePath}
          command={nativePickerCommand}
          commandArgs={nativePickerCommandArgs}
          initialCommandArgs={nativePickerInitialCommandArgs}
          onBack={() => {
            setNativePickerKind(null)
            setNativePickerInitialCommandArgs([])
            setNativePickerAutoStartNew(false)
          }}
          onClose={closeAll}
          onOpenSessionModal={(sessionId, _worktreeId, _worktreePath) =>
            openSessionModal(sessionId, target.origin)
          }
          autoStartNew={target.intent === 'default' || nativePickerAutoStartNew}
        />
      )}
    </>
  )
}

function NativeBackendChoice({
  icon,
  title,
  subtitle,
  shortcut,
  yoloAvailable,
  disabled,
  onClick,
  onYoloClick,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  shortcut: string
  yoloAvailable: boolean
  disabled?: boolean
  onClick: () => void
  onYoloClick: () => void
}) {
  return (
    <div className="flex w-full min-w-0 max-w-full items-center gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 text-left transition-colors">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {icon}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={cn(
          'min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className="flex items-center gap-2 text-sm font-medium leading-none">
          {title}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1.5">
        {yoloAvailable && (
          <button
            type="button"
            disabled={disabled}
            onClick={onYoloClick}
            title={`Start ${title} in yolo mode`}
            aria-label={`Start ${title} in yolo mode`}
            className={cn(
              'inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 bg-background px-2 text-xs font-medium text-muted-foreground transition-colors',
              'hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              disabled && 'cursor-not-allowed opacity-50 hover:bg-background'
            )}
          >
            <Zap className="size-3.5 text-destructive" />
            Yolo
          </button>
        )}
        <Kbd className="h-7 min-w-7 shrink-0 text-[10px]">{shortcut}</Kbd>
      </span>
    </div>
  )
}

function NewSessionChoice({
  icon,
  title,
  subtitle,
  badge,
  shortcut,
  disabled,
  onClick,
}: {
  icon: ReactNode
  title: string
  subtitle: string
  badge?: string
  shortcut: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex w-full min-w-0 max-w-full items-center gap-3 rounded-lg border border-border/70 bg-muted/25 px-3 py-2.5 text-left transition-colors',
        'hover:border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        disabled && 'cursor-not-allowed opacity-50 hover:bg-muted/25'
      )}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium leading-none">
          {title}
          {badge && (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      </span>
      <Kbd className="shrink-0 text-[10px]">{shortcut}</Kbd>
    </button>
  )
}
