import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { useSession } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import type { ThreadTokenUsage } from '@/types/chat'
import { DEFAULT_KEYBINDINGS, formatShortcutDisplay } from '@/types/keybindings'

interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  totalTokens: number
}

interface SessionUsageMeterProps {
  side?: 'top' | 'right'
  align?: 'start' | 'center' | 'end'
  variant?: 'dock' | 'toolbar'
}

function CodexIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M83.7733 42.8087C84.6678 40.1149 84.9771 37.2613 84.6807 34.4385C84.3843 31.6156 83.489 28.8885 82.0544 26.4394C77.6908 18.8436 68.9203 14.9365 60.3548 16.7725C57.9831 14.1344 54.9591 12.1668 51.5864 11.0673C48.2137 9.96772 44.611 9.77498 41.1402 10.5084C37.6694 11.2418 34.4527 12.8755 31.8132 15.2455C29.1736 17.6155 27.204 20.6383 26.1024 24.0103C23.3212 24.5806 20.6938 25.738 18.3958 27.405C16.0977 29.0721 14.1819 31.2104 12.7765 33.6772C8.36538 41.2609 9.3669 50.8267 15.2527 57.3327C14.3549 60.0251 14.0424 62.8782 14.3361 65.7012C14.6298 68.5241 15.523 71.2518 16.9558 73.7017C21.325 81.3002 30.1011 85.207 38.6712 83.3686C40.5554 85.4904 42.8707 87.1858 45.4623 88.3416C48.0539 89.4975 50.8622 90.0871 53.6999 90.0713C62.4793 90.079 70.2575 84.4114 72.9393 76.0515C75.7201 75.4802 78.347 74.3225 80.6449 72.6555C82.9427 70.9886 84.8587 68.8507 86.2649 66.3846C90.6227 58.8145 89.6172 49.3005 83.7733 42.8087ZM53.6999 84.8356C50.1955 84.8411 46.801 83.6129 44.1116 81.3661L44.5848 81.098L60.5123 71.9043C60.9087 71.6718 61.2379 71.3402 61.4674 70.942C61.6969 70.5439 61.8189 70.0929 61.8215 69.6333V47.1769L68.5553 51.072C68.6225 51.1063 68.6694 51.1707 68.6814 51.2456V69.854C68.6641 78.1208 61.9667 84.8183 53.6999 84.8356ZM21.4977 71.0843C19.7402 68.0497 19.1092 64.4925 19.7156 61.0386L20.1885 61.3225L36.1321 70.5165C36.5266 70.748 36.9757 70.87 37.4331 70.87C37.8905 70.87 38.3396 70.748 38.7341 70.5165L58.21 59.2883V67.0628C58.2081 67.1031 58.1973 67.1424 58.1782 67.1779C58.1591 67.2134 58.1322 67.2441 58.0996 67.2678L41.9671 76.5722C34.798 80.7022 25.6388 78.2463 21.4977 71.0843ZM17.3026 36.3898C19.0723 33.3357 21.8655 31.0062 25.1878 29.8138V48.7376C25.1818 49.1949 25.2986 49.6453 25.5261 50.042C25.7535 50.4387 26.0833 50.7671 26.4809 50.9928L45.8622 62.1739L39.1283 66.069C39.0919 66.0883 39.0513 66.0984 39.0101 66.0984C38.9689 66.0984 38.9283 66.0883 38.8919 66.069L22.7908 56.7809C15.6359 52.6337 13.1822 43.4816 17.3026 36.3112V36.3898ZM72.624 49.2426L53.1792 37.9512L59.8976 34.0718C59.9341 34.0524 59.9747 34.0423 60.016 34.0423C60.0573 34.0423 60.0979 34.0524 60.1344 34.0718L76.2355 43.3761C78.6973 44.7966 80.7043 46.8882 82.0221 49.4065C83.3398 51.9249 83.914 54.7661 83.6775 57.5985C83.4411 60.431 82.4038 63.1377 80.6867 65.4027C78.9696 67.6677 76.6436 69.3975 73.9803 70.3901V51.466C73.9663 51.0096 73.834 50.5647 73.5962 50.1749C73.3584 49.7851 73.0234 49.4638 72.624 49.2426ZM79.3261 39.1657L78.8529 38.8815L62.9411 29.6089C62.5442 29.376 62.0924 29.2532 61.6322 29.2532C61.172 29.2532 60.7202 29.376 60.3233 29.6089L40.8629 40.8374V33.0628C40.8587 33.0233 40.8654 32.9834 40.882 32.9473C40.8987 32.9113 40.9248 32.8803 40.9575 32.8579L57.0586 23.5692C59.5263 22.1476 62.3478 21.458 65.193 21.5811C68.0382 21.7042 70.7896 22.6348 73.1253 24.2642C75.461 25.8936 77.2845 28.1543 78.3825 30.782C79.4806 33.4097 79.8077 36.2957 79.3257 39.1025V39.1657H79.3261ZM37.1888 52.9484L30.455 49.069C30.4213 49.0487 30.3925 49.0212 30.3707 48.9884C30.3488 48.9557 30.3345 48.9186 30.3286 48.8797V30.3188C30.3323 27.4714 31.1466 24.6839 32.6761 22.2822C34.2057 19.8805 36.3874 17.9639 38.9661 16.7564C41.5448 15.549 44.4139 15.1005 47.2381 15.4636C50.0622 15.8267 52.7247 16.9862 54.9141 18.8067L54.4409 19.0748L38.5134 28.2686C38.117 28.5011 37.7879 28.8327 37.5584 29.2308C37.329 29.629 37.207 30.0799 37.2045 30.5395L37.1888 52.9487V52.9484ZM40.8472 45.0632L49.5209 40.0643L58.21 45.0635V55.0615L49.5523 60.0608L40.8632 55.0615L40.8472 45.0632Z"
        fill="currentColor"
      />
    </svg>
  )
}

export function SessionUsageMeter({
  side = 'top',
  align = 'start',
  variant = 'dock',
}: SessionUsageMeterProps) {
  const isMobile = useIsMobile()
  const { data: preferences } = usePreferences()
  const selectedWorktreeId = useProjectsStore(state => state.selectedWorktreeId)
  const activeWorktreeId = useChatStore(state => state.activeWorktreeId)
  const sessionChatModalOpen = useUIStore(state => state.sessionChatModalOpen)
  const sessionChatModalWorktreeId = useUIStore(
    state => state.sessionChatModalWorktreeId
  )
  const currentWorktreeId = sessionChatModalOpen
    ? (sessionChatModalWorktreeId ?? activeWorktreeId ?? selectedWorktreeId)
    : (activeWorktreeId ?? selectedWorktreeId)
  const activeSessionId = useChatStore(state =>
    currentWorktreeId ? state.activeSessionIds[currentWorktreeId] : undefined
  )
  const currentWorktreePath = useChatStore(state =>
    currentWorktreeId
      ? (state.worktreePaths[currentWorktreeId] ??
        (state.activeWorktreeId === currentWorktreeId
          ? state.activeWorktreePath
          : null))
      : null
  )
  const selectedBackend = useChatStore(state =>
    activeSessionId ? state.selectedBackends[activeSessionId] : undefined
  )
  const threadTokenUsage = useChatStore(state =>
    activeSessionId ? state.threadTokenUsage[activeSessionId] : undefined
  )
  const [usageMenuOpen, setUsageMenuOpen] = useState(false)
  const usageTriggerRef = useRef<HTMLButtonElement>(null)

  const activeBackend = (selectedBackend ??
    preferences?.default_backend ??
    'claude') as 'claude' | 'codex' | 'opencode'

  const { data: activeSession } = useSession(
    activeSessionId ?? null,
    currentWorktreeId ?? null,
    currentWorktreePath
  )

  const activeUsageEntry = useMemo(() => {
    const usageTotals = getFloatingDockUsageTotals(
      activeBackend,
      activeSession?.messages,
      threadTokenUsage
    )
    const iconMap = {
      claude: Sparkles,
      codex: CodexIcon,
      opencode: Terminal,
    } as const
    const labelMap = {
      claude: 'Claude',
      codex: 'Codex',
      opencode: 'OpenCode',
    } as const

    return {
      id: activeBackend,
      label: labelMap[activeBackend],
      Icon: iconMap[activeBackend],
      sessionId: activeSessionId ?? null,
      ...usageTotals,
    }
  }, [
    activeBackend,
    activeSession?.messages,
    activeSessionId,
    threadTokenUsage,
  ])

  const contextMeter = useMemo(() => {
    if (!threadTokenUsage?.modelContextWindow) return null
    const usedTokens = activeUsageEntry.input + activeUsageEntry.output
    const pct = computeContextPercent(
      usedTokens,
      threadTokenUsage.modelContextWindow
    )
    return {
      percent: pct,
      used: usedTokens,
      window: threadTokenUsage.modelContextWindow,
    }
  }, [activeUsageEntry.input, activeUsageEntry.output, threadTokenUsage])

  const usageBadge = useMemo(
    () => ({
      text: contextMeter
        ? `${contextMeter.percent}%`
        : activeUsageEntry.totalTokens > 0
          ? `${formatTokens(activeUsageEntry.totalTokens)} tok`
          : '-- tok',
    }),
    [activeUsageEntry.totalTokens, contextMeter]
  )

  const toggleUsageMenu = useCallback(() => {
    setUsageMenuOpen(prev => !prev)
  }, [])

  const handleUsageMenuCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    requestAnimationFrame(() => {
      usageTriggerRef.current?.blur()
    })
  }, [])

  useEffect(() => {
    const handler = () => toggleUsageMenu()
    window.addEventListener('toggle-usage-menu', handler)
    return () => window.removeEventListener('toggle-usage-menu', handler)
  }, [toggleUsageMenu])

  if (isMobile) return null

  const usageShortcut = formatShortcutDisplay(
    (preferences?.keybindings?.open_usage_dropdown ??
      DEFAULT_KEYBINDINGS.open_usage_dropdown) as string
  )
  const isToolbar = variant === 'toolbar'

  return (
    <DropdownMenu open={usageMenuOpen} onOpenChange={setUsageMenuOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              ref={usageTriggerRef}
              variant="ghost"
              size={isToolbar ? 'sm' : 'icon'}
              aria-label={`${activeUsageEntry.label} context usage`}
              className={cn(
                isToolbar
                  ? 'h-8 gap-1 rounded-none px-2 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                  : 'h-7 w-7 rounded-full text-muted-foreground hover:text-foreground',
                !isToolbar && side === 'top' && 'w-[88px] justify-center px-2'
              )}
            >
              <activeUsageEntry.Icon
                className={cn(
                  isToolbar || side === 'top' ? 'size-3.5 shrink-0' : 'size-4',
                  !isToolbar && side === 'top' && 'mr-1'
                )}
              />
              {(isToolbar || side === 'top') && (
                <span className="text-[11px] leading-none tabular-nums">
                  {usageBadge.text}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={side}>
          {contextMeter
            ? `${contextMeter.percent}% context remaining`
            : `${activeUsageEntry.label} current session tokens`}{' '}
          <kbd className="ml-1 text-[0.625rem] opacity-60">{usageShortcut}</kbd>
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side={side}
        align={align}
        className="min-w-[240px]"
        onEscapeKeyDown={e => e.stopPropagation()}
        onCloseAutoFocus={handleUsageMenuCloseAutoFocus}
      >
        <DropdownMenuItem disabled>
          <activeUsageEntry.Icon className="mr-2 h-4 w-4 shrink-0" />
          <div className="flex min-w-0 flex-col">
            <span>{activeUsageEntry.label}</span>
            <span className="max-w-[180px] truncate font-mono text-[11px] text-muted-foreground">
              Session: {activeUsageEntry.sessionId ?? 'none'}
            </span>
          </div>
          <DropdownMenuShortcut>{usageBadge.text}</DropdownMenuShortcut>
        </DropdownMenuItem>
        {contextMeter && (
          <DropdownMenuItem disabled>
            <div className="flex min-w-0 flex-col gap-1.5 w-full">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Context window</span>
                <span className="tabular-nums">
                  {contextMeter.percent}% remaining
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    contextMeter.percent > 30
                      ? 'bg-primary/60'
                      : contextMeter.percent > 10
                        ? 'bg-yellow-500/60'
                        : 'bg-red-500/60'
                  }`}
                  style={{ width: `${100 - contextMeter.percent}%` }}
                />
              </div>
              <span className="text-[10px] text-muted-foreground/70 tabular-nums">
                {formatTokens(contextMeter.used)} /{' '}
                {formatTokens(contextMeter.window)} tokens
              </span>
            </div>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem disabled>
          <div className="flex min-w-0 flex-col text-[11px] text-muted-foreground">
            <span>In: {formatTokens(activeUsageEntry.input)}</span>
            <span>Out: {formatTokens(activeUsageEntry.output)}</span>
            {(activeUsageEntry.cacheRead > 0 ||
              activeUsageEntry.cacheCreation > 0) && (
              <span>
                Cache: {formatTokens(activeUsageEntry.cacheRead)} read /{' '}
                {formatTokens(activeUsageEntry.cacheCreation)} write
              </span>
            )}
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return tokens.toString()
}

export function getFloatingDockUsageTotals(
  backend: 'claude' | 'codex' | 'opencode',
  messages: {
    usage?: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
    }
  }[] = [],
  threadTokenUsage?: ThreadTokenUsage
): UsageTotals {
  if (backend === 'codex' && threadTokenUsage) {
    const input = threadTokenUsage.last.inputTokens
    const output = threadTokenUsage.last.outputTokens
    const cacheRead = threadTokenUsage.last.cachedInputTokens
    const cacheCreation = 0
    return {
      input,
      output,
      cacheRead,
      cacheCreation,
      totalTokens: input + output + cacheRead + cacheCreation,
    }
  }

  const sessionTotals = messages.reduce<UsageTotals>(
    (totals, message) => {
      if (!message.usage) return totals
      totals.input += message.usage.input_tokens
      totals.output += message.usage.output_tokens
      totals.cacheRead += message.usage.cache_read_input_tokens ?? 0
      totals.cacheCreation += message.usage.cache_creation_input_tokens ?? 0
      totals.totalTokens =
        totals.input + totals.output + totals.cacheRead + totals.cacheCreation
      return totals
    },
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, totalTokens: 0 }
  )

  return sessionTotals
}

export function computeContextPercent(
  usedTokens: number,
  contextWindow: number
): number {
  if (contextWindow <= 0) return 0
  const used = Math.max(usedTokens, 0)
  const remaining = Math.max(contextWindow - used, 0)
  return Math.round(
    Math.min(Math.max((remaining / contextWindow) * 100, 0), 100)
  )
}
