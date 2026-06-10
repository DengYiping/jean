import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { isTauri } from '@/services/projects'
import { invoke, useWsConnectionStatus } from '@/lib/transport'
import { logger } from '@/lib/logger'

/**
 * Global queue processor hook - must be at App level so it stays active
 * even when ChatWindow is unmounted (e.g., when viewing a different worktree)
 *
 * Processes queued messages for ALL sessions, not just the active one.
 * This fixes the bug where queued prompts don't execute when the worktree is unfocused.
 *
 * The backend owns dequeue + execution so native and web clients cannot race
 * each other into dropping a queued message.
 */
export function useQueueProcessor(): void {
  // Re-run effect when WS connects so queue processing works in web mode
  const wsConnected = useWsConnectionStatus()

  // Track which sessions we're currently processing to prevent race conditions
  const processingRef = useRef<Set<string>>(new Set())

  // PERFORMANCE: Derived boolean selector — only re-renders when the answer changes,
  // not on every mutation to any key in the underlying records.
  const hasProcessableQueue = useChatStore(state => {
    for (const [sessionId, queue] of Object.entries(state.messageQueues)) {
      if (
        queue &&
        queue.length > 0 &&
        !state.sendingSessionIds[sessionId] &&
        !state.waitingForInputSessionIds[sessionId]
      ) {
        return true
      }
    }
    return false
  })

  const processQueues = useCallback(() => {
    if (!isTauri()) return
    // Read fresh state inside effect to avoid subscribing to full records.
    // Store actions are accessed via getState() inside the async callback
    // to ensure fresh references after the await.
    const {
      messageQueues,
      sendingSessionIds,
      waitingForInputSessionIds,
      sessionWorktreeMap,
      worktreePaths,
    } = useChatStore.getState()

    // Process each session's queue
    for (const [sessionId, queue] of Object.entries(messageQueues)) {
      // Skip if queue is empty
      if (!queue || queue.length === 0) continue

      // Skip if already processing this session
      if (processingRef.current.has(sessionId)) continue

      // Skip if session is currently sending
      if (sendingSessionIds[sessionId]) continue

      // Skip if session is waiting for user input (AskUserQuestion/ExitPlanMode)
      if (waitingForInputSessionIds[sessionId]) continue

      const worktreeId = sessionWorktreeMap[sessionId]
      const worktreePath = worktreeId ? worktreePaths[worktreeId] : undefined

      // Skip if we can't find the worktree for this session
      if (!worktreeId || !worktreePath) {
        logger.warn('Queue processor: Cannot find worktree for session', {
          sessionId,
        })
        continue
      }

      // Mark as processing to prevent duplicate processing within this client
      processingRef.current.add(sessionId)

      const capturedSessionId = sessionId
      const capturedWorktreeId = worktreeId
      invoke('process_message_queue', {
        sessionId,
        worktreeId,
        worktreePath,
      })
        .catch(err => {
          logger.error('Queue processor: backend drain request failed', {
            sessionId: capturedSessionId,
            worktreeId: capturedWorktreeId,
            err,
          })
        })
        .finally(() => {
          processingRef.current.delete(capturedSessionId)
        })
    }
  }, [])

  useEffect(() => {
    if (!hasProcessableQueue || !isTauri()) return
    processQueues()
  }, [hasProcessableQueue, processQueues, wsConnected])
}
