import { useCallback } from 'react'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { buildQueuedMessageWithRefs } from '@/lib/queued-message'
import {
  cancelChatMessage,
  persistRemoveQueued,
  persistReorderQueued,
  steerCodexTurn,
} from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import type { Backend, QueuedMessage } from '@/types/chat'

interface UseQueuedMessagesParams {
  activeSessionId: string | null | undefined
  activeWorktreeId: string | null | undefined
  activeWorktreePath: string | null | undefined
  selectedBackend: Backend
}

function moveMessageToFront(
  queue: QueuedMessage[],
  messageId: string
): QueuedMessage[] {
  const target = queue.find(message => message.id === messageId)
  if (!target) return queue
  return [target, ...queue.filter(message => message.id !== messageId)]
}

export function useQueuedMessages({
  activeSessionId,
  activeWorktreeId,
  activeWorktreePath,
  selectedBackend,
}: UseQueuedMessagesParams) {
  const resolveWorktreeContext = useCallback(
    (sessionId: string) => {
      if (
        activeSessionId === sessionId &&
        activeWorktreeId &&
        activeWorktreePath
      ) {
        return {
          worktreeId: activeWorktreeId,
          worktreePath: activeWorktreePath,
        }
      }

      const { sessionWorktreeMap, worktreePaths } = useChatStore.getState()
      const worktreeId = sessionWorktreeMap[sessionId]
      return {
        worktreeId,
        worktreePath: worktreeId ? worktreePaths[worktreeId] : undefined,
      }
    },
    [activeSessionId, activeWorktreeId, activeWorktreePath]
  )

  const handleRemoveQueuedMessage = useCallback(
    (sessionId: string, messageId: string) => {
      useChatStore.getState().removeQueuedMessage(sessionId, messageId)

      const { worktreeId, worktreePath } = resolveWorktreeContext(sessionId)
      if (worktreeId && worktreePath) {
        persistRemoveQueued(worktreeId, worktreePath, sessionId, messageId)
      }
    },
    [resolveWorktreeContext]
  )

  const handleReorderQueuedMessages = useCallback(
    (sessionId: string, messages: QueuedMessage[]) => {
      useChatStore.getState().reorderQueuedMessages(sessionId, messages)

      const { worktreeId, worktreePath } = resolveWorktreeContext(sessionId)
      if (worktreeId && worktreePath) {
        persistReorderQueued(worktreeId, worktreePath, sessionId, messages)
      }
    },
    [resolveWorktreeContext]
  )

  const handleForceSendQueued = useCallback((sessionId: string) => {
    useChatStore.getState().forceProcessQueue(sessionId)
  }, [])

  const handleSteerQueuedMessage = useCallback(
    async (sessionId: string, messageId: string) => {
      const store = useChatStore.getState()
      const queue = store.messageQueues[sessionId] ?? []
      const targetMessage = queue.find(message => message.id === messageId)
      if (!targetMessage) return

      const isSending = store.sendingSessionIds[sessionId] ?? false

      if (selectedBackend === 'codex' && isSending) {
        try {
          await steerCodexTurn(
            sessionId,
            buildQueuedMessageWithRefs(targetMessage)
          )
          handleRemoveQueuedMessage(sessionId, messageId)
          toast.info('Steer sent')
          return
        } catch (error) {
          logger.warn(
            'Failed to steer Codex turn, falling back to cancel/send',
            {
              error,
              sessionId,
              messageId,
            }
          )
        }
      }

      const reorderedQueue = moveMessageToFront(queue, messageId)
      handleReorderQueuedMessages(sessionId, reorderedQueue)

      if (!isSending) {
        useChatStore.getState().forceProcessQueue(sessionId)
        return
      }

      const { worktreeId } = resolveWorktreeContext(sessionId)
      if (!worktreeId) return

      const cancelled = await cancelChatMessage(sessionId, worktreeId)
      if (!cancelled) {
        const stillSending =
          useChatStore.getState().sendingSessionIds[sessionId] ?? false
        if (!stillSending) {
          useChatStore.getState().forceProcessQueue(sessionId)
        }
      }
    },
    [
      handleRemoveQueuedMessage,
      handleReorderQueuedMessages,
      resolveWorktreeContext,
      selectedBackend,
    ]
  )

  return {
    handleRemoveQueuedMessage,
    handleReorderQueuedMessages,
    handleForceSendQueued,
    handleSteerQueuedMessage,
  }
}
