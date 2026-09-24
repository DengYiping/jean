import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { BellDot, Loader2, CheckCircle2 } from 'lucide-react'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover'
import { Kbd } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import { chatQueryKeys, useUnreadSessions } from '@/services/chat'
import { useUnreadCount } from './useUnreadCount'
import { formatShortcutDisplay } from '@/types/keybindings'
import { openWorkspaceSession } from '@/lib/workspace-navigation'
import type { UnreadSessionEntry } from '@/types/chat'
import { useIsMobile } from '@/hooks/use-mobile'
import { getUnreadSessionStatus } from './unread-session-utils'
import { markSessionsRead, markSessionsReadInCache } from './mark-sessions-read'

function formatRelativeTime(timestamp: number): string {
  const ms = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp
  const diffMs = Date.now() - ms
  if (diffMs < 0) return 'just now'
  const minuteMs = 60_000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs
  if (diffMs < hourMs)
    return `${Math.max(1, Math.floor(diffMs / minuteMs))}m ago`
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h ago`
  return `${Math.floor(diffMs / dayMs)}d ago`
}

type UnreadItem = UnreadSessionEntry

interface UnreadBellProps {
  title: string
  hideTitle?: boolean
}

export function UnreadBell({ title, hideTitle }: UnreadBellProps) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const contentRef = useRef<HTMLDivElement>(null)
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const unreadCount = useUnreadCount()
  const { data: unreadSessions, isLoading } = useUnreadSessions(open)
  // Listen for command palette event to open the popover
  useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('command:open-unread-sessions', handler)
    return () =>
      window.removeEventListener('command:open-unread-sessions', handler)
  }, [])

  // Synchronous reset: guarantees open=false is committed before unreadCount
  // can bounce back (e.g. optimistic update overwritten by in-flight refetch).
  // A useEffect would fire after render, missing fast 1→0→1 transitions.
  if (unreadCount === 0 && open) {
    setOpen(false)
  }

  // Invalidate cache each time popover opens
  useEffect(() => {
    if (open) {
      queryClient.invalidateQueries({
        queryKey: chatQueryKeys.unreadSessions(),
      })
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.unreadCount() })
      setFocusedIndex(0)
    }
  }, [open, queryClient])

  // Invalidate when any session is opened (so the count stays fresh)
  useEffect(() => {
    const handler = () =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.unreadSessions(),
        }),
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.unreadCount(),
        }),
      ])
    window.addEventListener('session-opened', handler)
    return () => window.removeEventListener('session-opened', handler)
  }, [queryClient])

  const unreadItems = useMemo((): UnreadItem[] => {
    return unreadSessions?.entries ?? []
  }, [unreadSessions])

  const handleMarkAllRead = useCallback(async () => {
    await markSessionsRead(
      queryClient,
      unreadItems.map(item => item.session.id)
    )
  }, [unreadItems, queryClient])

  const handleMarkOneRead = useCallback(
    async (item: UnreadItem) => {
      await markSessionsRead(queryClient, [item.session.id])
      // Adjust focus: stay at same index or move up if at end
      setFocusedIndex(i => {
        const newTotal = unreadItems.length - 1
        if (newTotal <= 0) return -1
        return Math.min(i, newTotal - 1)
      })
    },
    [queryClient, unreadItems.length]
  )

  const handleSelect = useCallback(
    (item: UnreadItem) => {
      const projectId = item.project_id
      const worktreeId = item.worktree_id
      const worktreePath = item.worktree_path
      openWorkspaceSession({
        projectId,
        worktreeId,
        worktreePath,
        sessionId: item.session.id,
      })
      markSessionsReadInCache(queryClient, [item.session.id])
      setOpen(false)
    },
    [queryClient]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const total = unreadItems.length
      if (!total) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex(i => (i < 0 ? 0 : Math.min(i + 1, total - 1)))
          break
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex(i => (i < 0 ? 0 : Math.max(i - 1, 0)))
          break
        case 'Enter':
          e.preventDefault()
          if (focusedIndex >= 0 && unreadItems[focusedIndex]) {
            handleSelect(unreadItems[focusedIndex])
          }
          break
        case 'Backspace':
          e.preventDefault()
          if (focusedIndex >= 0 && unreadItems[focusedIndex]) {
            handleMarkOneRead(unreadItems[focusedIndex])
          }
          break
      }
    },
    [unreadItems, focusedIndex, handleSelect, handleMarkOneRead]
  )

  // Scroll focused item into view
  useEffect(() => {
    if (focusedIndex < 0) return
    document
      .querySelector(`[data-unread-index="${focusedIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focusedIndex])

  // No unread → show normal title (or nothing if hideTitle)
  if (unreadCount === 0) {
    if (hideTitle) return null
    return (
      <span className="block truncate text-sm font-medium text-foreground/80">
        {title}
      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div>
          <button
            type="button"
            className="relative z-[1] flex items-center gap-1.5 truncate rounded-md bg-background px-1.5 text-sm font-medium text-yellow-400 cursor-pointer"
          >
            <BellDot className="h-3.5 w-3.5 shrink-0 animate-[bell-ring_2s_ease-in-out_infinite]" />
            {unreadCount} finished {unreadCount === 1 ? 'session' : 'sessions'}
            {!isMobile && (
              <Kbd className="ml-1 h-4 px-1 text-[10px] opacity-60">
                {formatShortcutDisplay('mod+shift+f')}
              </Kbd>
            )}
          </button>
        </div>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="center"
        sideOffset={6}
        className="w-[min(440px,calc(100vw-2rem))] p-0"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onEscapeKeyDown={e => e.stopPropagation()}
        onOpenAutoFocus={e => {
          e.preventDefault()
          contentRef.current?.focus()
        }}
      >
        {/* Mark all read */}
        {unreadItems.length > 0 && (
          <div className="flex items-center justify-end px-3 py-1.5 border-b">
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            >
              Mark all read
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : unreadItems.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-xs">
            No unread sessions
          </div>
        ) : (
          <div className="max-h-[min(400px,60vh)] overflow-y-auto p-1">
            {unreadItems.map((item, idx) => {
              const status = getUnreadSessionStatus(item.session)
              const StatusIcon = status?.icon ?? CheckCircle2

              return (
                <button
                  key={item.session.id}
                  type="button"
                  data-unread-index={idx}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setFocusedIndex(idx)}
                  className={cn(
                    'w-full text-left px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors cursor-pointer flex items-start gap-2',
                    focusedIndex === idx && 'bg-accent'
                  )}
                >
                  <StatusIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0 mt-0.5',
                      status?.className ?? 'text-muted-foreground'
                    )}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50 shrink-0">
                        {item.project_name}
                      </span>
                      <span className="text-[11px] text-muted-foreground/40 shrink-0 ml-auto">
                        {formatRelativeTime(item.session.updated_at)}
                      </span>
                    </div>
                    <span className="text-[13px] truncate block">
                      {item.session.name}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
