import { memo } from 'react'
import { useChatStore } from '@/store/chat-store'
import { TerminalView } from './TerminalView'

interface TerminalPanelProps {
  isCollapsed?: boolean
  onExpand?: () => void
}

/**
 * Memoized wrapper for the active worktree terminal surface.
 */
const WorktreeTerminals = memo(function WorktreeTerminals({
  worktreeId,
  worktreePath,
  isCollapsed,
  onExpand,
}: {
  worktreeId: string
  worktreePath: string
  isCollapsed?: boolean
  onExpand?: () => void
}) {
  return (
    <div className="absolute inset-0 flex flex-col">
      <TerminalView
        worktreeId={worktreeId}
        worktreePath={worktreePath}
        isCollapsed={isCollapsed}
        isWorktreeActive
        onExpand={onExpand}
      />
    </div>
  )
})

/**
 * Container that renders the active worktree's terminal surface only. Terminal
 * instances persist outside React, so switching worktrees detaches the inactive
 * DOM without stopping its process or discarding its xterm buffer.
 */
export function TerminalPanel({ isCollapsed, onExpand }: TerminalPanelProps) {
  const activeWorktreeId = useChatStore(state => state.activeWorktreeId)
  const activeWorktreePath = useChatStore(state => state.activeWorktreePath)
  const worktreePaths = useChatStore(state => state.worktreePaths)
  const activeWorktreeResolvedPath = activeWorktreeId
    ? (worktreePaths[activeWorktreeId] ?? activeWorktreePath)
    : null

  return (
    <div className="relative h-full w-full overflow-hidden">
      {activeWorktreeId && activeWorktreeResolvedPath ? (
        <WorktreeTerminals
          key={activeWorktreeId}
          worktreeId={activeWorktreeId}
          worktreePath={activeWorktreeResolvedPath}
          isCollapsed={isCollapsed}
          onExpand={onExpand}
        />
      ) : null}
    </div>
  )
}
