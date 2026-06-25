import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock,
  Loader2,
  MessageSquareText,
  Users,
  X,
  XCircle,
} from 'lucide-react'
import type {
  CodexAgent,
  CodexSubAgentStatus,
  CodexSubAgentSummary,
} from '@/types/chat'
import { cn } from '@/lib/utils'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface CodexSubAgentPanelProps {
  agents: CodexSubAgentSummary[]
  fallbackAgents?: CodexAgent[]
  className?: string
  isLoading?: boolean
  isStreaming?: boolean
  onClose?: () => void
  defaultOpen?: boolean
}

interface DisplayAgent {
  id: string
  name: string
  prompt?: string
  status: CodexSubAgentStatus
  latestMessage?: string
  receiverThreadIds: string[]
  senderThreadId?: string
  events: CodexSubAgentSummary['events']
  snapshot?: CodexSubAgentSummary['snapshot']
}

function hasSnapshotMessages(agent: DisplayAgent) {
  return (agent.snapshot?.messages?.length ?? 0) > 0
}

function fallbackStatus(status: CodexAgent['status']): CodexSubAgentStatus {
  switch (status) {
    case 'completed':
      return 'completed'
    case 'errored':
      return 'errored'
    case 'interrupted':
      return 'interrupted'
    default:
      return 'running'
  }
}

function toDisplayAgents(
  agents: CodexSubAgentSummary[],
  fallbackAgents: CodexAgent[]
): DisplayAgent[] {
  if (agents.length > 0) {
    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      prompt: agent.prompt,
      status: agent.status,
      latestMessage: agent.latestMessage,
      receiverThreadIds: agent.receiverThreadIds,
      senderThreadId: agent.senderThreadId,
      events: agent.events,
      snapshot: agent.snapshot,
    }))
  }

  return fallbackAgents.map(agent => ({
    id: agent.id,
    name: agent.name,
    prompt: agent.prompt,
    status: fallbackStatus(agent.status),
    latestMessage: agent.message,
    receiverThreadIds: [],
    events: [],
  }))
}

function statusLabel(status: CodexSubAgentStatus) {
  switch (status) {
    case 'starting':
      return 'Starting'
    case 'running':
      return 'Running'
    case 'interrupted':
      return 'Interrupted'
    case 'completed':
      return 'Completed'
    case 'errored':
      return 'Errored'
    case 'closed':
      return 'Closed'
    case 'not_found':
      return 'Not found'
  }
}

function statusClassName(status: CodexSubAgentStatus) {
  switch (status) {
    case 'completed':
      return 'bg-green-500/15 text-green-600 dark:text-green-400'
    case 'errored':
    case 'not_found':
    case 'interrupted':
      return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
    case 'closed':
      return 'bg-muted text-muted-foreground'
    case 'starting':
    case 'running':
      return 'bg-blue-500/15 text-blue-600 dark:text-blue-400'
  }
}

function StatusIcon({ status }: { status: CodexSubAgentStatus }) {
  if (status === 'completed') {
    return <CheckCircle2 className="h-4 w-4 text-green-500" />
  }
  if (status === 'errored' || status === 'not_found') {
    return <XCircle className="h-4 w-4 text-amber-500" />
  }
  if (status === 'interrupted') {
    return <CircleDot className="h-4 w-4 text-amber-500" />
  }
  if (status === 'closed') {
    return <CircleDot className="h-4 w-4 text-muted-foreground" />
  }
  return <Loader2 className="h-4 w-4 animate-spin text-primary" />
}

export function CodexSubAgentPanel({
  agents,
  fallbackAgents = [],
  className,
  isLoading = false,
  isStreaming = false,
  onClose,
  defaultOpen = false,
}: CodexSubAgentPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const displayAgents = useMemo(
    () => toDisplayAgents(agents, fallbackAgents),
    [agents, fallbackAgents]
  )

  const resolvedCount = displayAgents.filter(
    agent =>
      agent.status === 'completed' ||
      agent.status === 'closed' ||
      agent.status === 'interrupted'
  ).length
  const runningCount = displayAgents.filter(
    agent => agent.status === 'running' || agent.status === 'starting'
  ).length
  const warningCount = displayAgents.filter(
    agent =>
      agent.status === 'errored' ||
      agent.status === 'not_found' ||
      agent.status === 'interrupted'
  ).length
  const totalCount = displayAgents.length

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className={className}>
      <div
        className={cn(
          'mt-1 rounded-md border border-border bg-sidebar',
          isOpen && 'bg-sidebar'
        )}
      >
        <div className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground">
          <CollapsibleTrigger className="-ml-3 -my-2 flex flex-1 cursor-pointer select-none items-center gap-2 rounded-l-md py-2 pl-3 hover:bg-muted/50">
            <ChevronRight
              className={cn(
                'h-3.5 w-3.5 shrink-0 transition-transform duration-200',
                isOpen && 'rotate-90'
              )}
            />
            {!isOpen && (isLoading || isStreaming || runningCount > 0) ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            ) : (
              <Users className="h-4 w-4 shrink-0" />
            )}
            <span className="font-medium">Agents</span>
            <span
              className={cn(
                'rounded bg-muted/50 px-1.5 py-0.5 text-xs',
                totalCount > 0 &&
                  resolvedCount === totalCount &&
                  warningCount === 0 &&
                  'bg-green-500/20 text-green-600 dark:text-green-400',
                warningCount > 0 &&
                  'bg-amber-500/20 text-amber-600 dark:text-amber-400'
              )}
            >
              {resolvedCount}/{totalCount}
            </span>
            {runningCount > 0 && (
              <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-blue-600 dark:text-blue-400">
                {runningCount} running
              </span>
            )}
          </CollapsibleTrigger>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded p-0.5 transition-colors hover:bg-muted"
              aria-label="Dismiss agents"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <CollapsibleContent>
          <div className="max-h-[58vh] overflow-y-auto border-t border-border/50 px-3 py-2">
            {displayAgents.length === 0 ? (
              <div className="py-1 text-xs text-muted-foreground">
                {isLoading ? 'Loading agent activity...' : 'No sub-agents yet.'}
              </div>
            ) : (
              <ul className="space-y-1.5">
                {displayAgents.map(agent => (
                  <AgentRow key={agent.id} agent={agent} />
                ))}
              </ul>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}

function AgentRow({ agent }: { agent: DisplayAgent }) {
  const [open, setOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const detailCount =
    agent.events.length + (agent.snapshot ? 1 : 0) + (agent.prompt ? 1 : 0)

  return (
    <li className="rounded border border-border/40 bg-background/30">
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <Collapsible open={open} onOpenChange={setOpen}>
          <div className="flex items-start gap-2 px-2 py-1.5 text-xs hover:bg-muted/40">
            <CollapsibleTrigger
              className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
              aria-label={`${open ? 'Collapse' : 'Expand'} ${agent.name}`}
              onClick={event => event.stopPropagation()}
            >
              <ChevronRight
                className={cn(
                  'h-3.5 w-3.5 transition-transform duration-200',
                  open && 'rotate-90'
                )}
              />
            </CollapsibleTrigger>
            <button
              type="button"
              aria-label={`Open ${agent.name} session`}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
              onClick={() => setDialogOpen(true)}
            >
              <span className="mt-0.5 shrink-0">
                <StatusIcon status={agent.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate font-medium text-foreground/90">
                    {agent.name}
                  </span>
                  <span
                    className={cn(
                      'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
                      statusClassName(agent.status)
                    )}
                  >
                    {statusLabel(agent.status)}
                  </span>
                </span>
                {agent.latestMessage && (
                  <span className="mt-0.5 block truncate text-muted-foreground">
                    {agent.latestMessage}
                  </span>
                )}
              </span>
            </button>
          </div>
          <CollapsibleContent>
            <div className="space-y-2 border-t border-border/40 px-2 py-2 text-xs">
              {agent.prompt && (
                <InfoBlock icon={<MessageSquareText className="h-3.5 w-3.5" />}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="line-clamp-3 whitespace-pre-wrap break-words text-foreground/90">
                        {agent.prompt}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      align="start"
                      className="max-w-[32rem] whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed"
                    >
                      {agent.prompt}
                    </TooltipContent>
                  </Tooltip>
                </InfoBlock>
              )}

              {(agent.senderThreadId || agent.receiverThreadIds.length > 0) && (
                <InfoBlock icon={<Users className="h-3.5 w-3.5" />}>
                  <div className="space-y-1 font-mono text-[10px] text-muted-foreground">
                    {agent.senderThreadId && (
                      <div>from {agent.senderThreadId}</div>
                    )}
                    {agent.receiverThreadIds.map(threadId => (
                      <div key={threadId}>to {threadId}</div>
                    ))}
                  </div>
                </InfoBlock>
              )}

              {agent.snapshot && (
                <InfoBlock
                  icon={
                    agent.snapshot.error ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )
                  }
                >
                  <div className="text-muted-foreground">
                    {agent.snapshot.error
                      ? agent.snapshot.error
                      : `${agent.snapshot.turnCount ?? 0} turn${agent.snapshot.turnCount === 1 ? '' : 's'} recorded`}
                  </div>
                </InfoBlock>
              )}

              {agent.events.length > 0 && (
                <div className="space-y-1">
                  {agent.events.map(event => (
                    <div
                      key={`${event.toolCallId}-${event.status ?? ''}-${event.message ?? ''}`}
                      className="rounded bg-muted/30 px-2 py-1 text-muted-foreground"
                    >
                      <span className="font-medium text-foreground/80">
                        {event.toolName}
                      </span>
                      {event.status && <span> · {event.status}</span>}
                      {event.message && <span> · {event.message}</span>}
                    </div>
                  ))}
                </div>
              )}

              {detailCount === 0 && (
                <div className="text-muted-foreground">
                  No detailed events yet.
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
        <SubAgentSessionDialog agent={agent} />
      </Dialog>
    </li>
  )
}

function SubAgentSessionDialog({ agent }: { agent: DisplayAgent }) {
  const messages = agent.snapshot?.messages ?? []

  return (
    <DialogContent className="!w-screen !h-dvh !max-w-screen !max-h-none !rounded-none p-0 sm:!w-[min(760px,calc(100vw-4rem))] sm:!max-w-[min(760px,calc(100vw-4rem))] sm:!h-auto sm:max-h-[85vh] sm:!rounded-lg sm:p-4 bg-background/95 backdrop-blur-sm">
      <DialogHeader className="px-4 pt-4 pr-14 sm:px-0 sm:pt-0 sm:pr-8">
        <DialogTitle className="flex items-center gap-2 text-base">
          <StatusIcon status={agent.status} />
          <span className="min-w-0 truncate">{agent.name}</span>
          <span
            className={cn(
              'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium',
              statusClassName(agent.status)
            )}
          >
            {statusLabel(agent.status)}
          </span>
        </DialogTitle>
      </DialogHeader>

      <ScrollArea className="mt-2 h-[calc(100dvh-5.5rem)] px-4 pb-4 sm:h-auto sm:max-h-[calc(85vh-6rem)] sm:px-0 sm:pb-0">
        <div className="space-y-3 pr-3">
          {agent.snapshot?.error && (
            <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              {agent.snapshot.error}
            </div>
          )}

          {!hasSnapshotMessages(agent) && agent.prompt && (
            <SessionMessage role="user" text={agent.prompt} />
          )}

          {messages.map((message, index) => (
            <SessionMessage
              key={`${message.turnId ?? 'turn'}-${message.role}-${index}`}
              role={message.role}
              text={message.text}
            />
          ))}

          {!agent.snapshot?.error && !agent.prompt && messages.length === 0 && (
            <div className="rounded border border-border/50 bg-muted/20 px-3 py-6 text-center text-sm text-muted-foreground">
              No sub-agent session messages are available yet.
            </div>
          )}

          {agent.latestMessage && messages.length === 0 && (
            <SessionMessage role="assistant" text={agent.latestMessage} />
          )}
        </div>
      </ScrollArea>
    </DialogContent>
  )
}

function SessionMessage({ role, text }: { role: string; text: string }) {
  const assistant = role === 'assistant'

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2',
        assistant
          ? 'border-border bg-background'
          : 'border-blue-500/20 bg-blue-500/10'
      )}
    >
      <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">
        {assistant ? 'Sub-agent' : 'Prompt'}
      </div>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
        {text}
      </div>
    </div>
  )
}

function InfoBlock({
  icon,
  children,
}: {
  icon: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-2 rounded bg-muted/20 px-2 py-1.5">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
