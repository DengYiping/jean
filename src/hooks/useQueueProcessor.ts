import { useCallback, useEffect, useRef } from 'react'
import { useChatStore } from '@/store/chat-store'
import { useSendMessage, persistDequeue } from '@/services/chat'
import { usePreferences } from '@/services/preferences'
import { isTauri, projectsQueryKeys } from '@/services/projects'
import { invoke, useWsConnectionStatus } from '@/lib/transport'
import { logger } from '@/lib/logger'
import { buildQueuedMessageWithRefs } from '@/lib/queued-message'
import { resolveParallelExecutionPromptForSession } from '@/lib/parallel-execution-prompt'
import {
  resolveMagicPromptProvider,
  type AppPreferences,
} from '@/types/preferences'
import { triggerImmediateGitPoll } from '@/services/git-status'
import { toast } from 'sonner'
import type { QueuedMessage } from '@/types/chat'
import { queryClient } from '@/lib/query-client'
import { agentBoardQueryKeys } from '@/services/agent-board'

// GIT_ALLOWED_TOOLS duplicated from ChatWindow - tools always allowed for git operations
const GIT_ALLOWED_TOOLS = ['Bash', 'Read', 'Glob', 'Grep']

async function executeQueuedMagicCommand({
  msg,
  sessionId,
  worktreeId,
  worktreePath,
  preferences,
}: {
  msg: QueuedMessage
  sessionId: string
  worktreeId: string
  worktreePath: string
  preferences: AppPreferences | undefined
}) {
  const command = msg.magicCommand
  if (!command) return

  const store = useChatStore.getState()
  const label = msg.magicCommandLabel ?? 'Magic command'
  const operation =
    command === 'commit' || command === 'commit-and-push' ? 'commit' : 'pr'
  store.setWorktreeLoading(worktreeId, operation)
  const toastId = toast.loading(`${label}...`)

  try {
    if (command === 'commit' || command === 'commit-and-push') {
      const push = command === 'commit-and-push'
      const result = await invoke<{ message?: string; commit_hash?: string }>(
        'create_commit_with_ai',
        {
          worktreePath,
          customPrompt: preferences?.magic_prompts?.commit_message,
          push,
          remote: null,
          prNumber: null,
          model: preferences?.magic_prompt_models?.commit_message_model,
          customProfileName: resolveMagicPromptProvider(
            preferences?.magic_prompt_providers,
            'commit_message_provider',
            preferences?.default_provider
          ),
          reasoningEffort:
            preferences?.magic_prompt_efforts?.commit_message_effort ?? null,
          specificFiles: msg.specificFiles ?? null,
        }
      )

      triggerImmediateGitPoll()
      window.dispatchEvent(new CustomEvent('git-commit-completed'))
      toast.success(result.message?.split('\n')[0] ?? label, { id: toastId })
      return
    }

    const draft = command === 'draft-pr'
    const result = await invoke<{
      title: string
      pr_number: number
      pr_url: string
      existing: boolean
      is_draft: boolean
    }>('create_pr_with_ai_content', {
      worktreePath,
      sessionId,
      customPrompt: preferences?.magic_prompts?.pr_content,
      model: preferences?.magic_prompt_models?.pr_content_model,
      customProfileName: resolveMagicPromptProvider(
        preferences?.magic_prompt_providers,
        'pr_content_provider',
        preferences?.default_provider
      ),
      reasoningEffort:
        preferences?.magic_prompt_efforts?.pr_content_effort ?? null,
      draft,
    })

    triggerImmediateGitPoll()
    queryClient.invalidateQueries({ queryKey: projectsQueryKeys.all })
    queryClient.invalidateQueries({ queryKey: agentBoardQueryKeys.all })
    toast.success(
      result.existing
        ? `PR linked: ${result.title}`
        : `${result.is_draft ? 'Draft PR' : 'PR'} created: ${result.title}`,
      { id: toastId }
    )
  } catch (error) {
    toast.error(`${label} failed: ${error}`, { id: toastId })
  } finally {
    store.clearWorktreeLoading(worktreeId)
  }
}

/**
 * Global queue processor hook - must be at App level so it stays active
 * even when ChatWindow is unmounted (e.g., when viewing a different worktree)
 *
 * Processes queued messages for ALL sessions, not just the active one.
 * This fixes the bug where queued prompts don't execute when the worktree is unfocused.
 *
 * Uses atomic backend dequeue to prevent double-processing when both native
 * and web clients are running simultaneously.
 */
export function useQueueProcessor(): void {
  const sendMessage = useSendMessage()
  const { data: preferences } = usePreferences()
  // Re-run effect when WS connects so queue processing works in web mode
  const wsConnected = useWsConnectionStatus()

  // Track which sessions we're currently processing to prevent race conditions
  const processingRef = useRef<Set<string>>(new Set())
  const processQueuesRef = useRef<() => void>(() => undefined)

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

      // Atomically dequeue from backend — only ONE client wins each message.
      // The backend uses per-session locking, so concurrent dequeue calls from
      // native and web clients are serialized. The loser gets null.
      const capturedSessionId = sessionId
      const capturedWorktreeId = worktreeId
      const capturedWorktreePath = worktreePath
      persistDequeue(worktreeId, worktreePath, sessionId)
        .then(msg => {
          if (!msg) {
            // Another client already dequeued this message, or the backend
            // queue was empty. Clear local Zustand queue to prevent phantom
            // entries from lingering (defense against stale state).
            useChatStore.getState().clearQueue(capturedSessionId)
            processingRef.current.delete(capturedSessionId)
            queueMicrotask(() => processQueuesRef.current())
            return
          }

          // Remove the specific dequeued message from local Zustand by ID.
          // This is idempotent: if the queue:updated event already synced,
          // the message won't be found and this is a no-op.
          useChatStore.getState().removeQueuedMessage(capturedSessionId, msg.id)

          logger.info('Queue processor: Processing queued message', {
            sessionId: capturedSessionId,
            worktreeId: capturedWorktreeId,
            messageId: msg.id,
          })

          if (msg.kind === 'magic_command') {
            executeQueuedMagicCommand({
              msg,
              sessionId: capturedSessionId,
              worktreeId: capturedWorktreeId,
              worktreePath: capturedWorktreePath,
              preferences,
            })
              .catch(error => {
                logger.error('Queue processor: queued magic command failed', {
                  sessionId: capturedSessionId,
                  messageId: msg.id,
                  error,
                })
              })
              .finally(() => {
                processingRef.current.delete(capturedSessionId)
                queueMicrotask(() => processQueuesRef.current())
              })
            return
          }

          const store = useChatStore.getState()

          // Clear stale streaming state before starting new message
          store.clearStreamingContent(capturedSessionId)
          store.clearToolCalls(capturedSessionId)
          store.clearStreamingContentBlocks(capturedSessionId)

          // Set up session state
          store.setLastSentMessage(capturedSessionId, msg.message)
          store.setError(capturedSessionId, null)
          store.addSendingSession(capturedSessionId)
          store.setSessionReviewing(capturedSessionId, false)
          store.setExecutingMode(capturedSessionId, msg.executionMode)
          store.setSelectedModel(capturedSessionId, msg.model)

          // Get session-approved tools
          const sessionApprovedTools = store.getApprovedTools(capturedSessionId)
          const allowedTools =
            sessionApprovedTools.length > 0
              ? [...GIT_ALLOWED_TOOLS, ...sessionApprovedTools]
              : undefined

          // Build full message with attachment refs
          const fullMessage = buildQueuedMessageWithRefs(msg)

          // Send the message
          sendMessage.mutate(
            {
              sessionId: capturedSessionId,
              worktreeId: capturedWorktreeId,
              worktreePath: capturedWorktreePath,
              message: fullMessage,
              model: msg.model,
              executionMode: msg.executionMode,
              thinkingLevel: msg.thinkingLevel,
              effortLevel: msg.effortLevel,
              mcpConfig: msg.mcpConfig,
              customProfileName: msg.provider ?? undefined,
              parallelExecutionPrompt: resolveParallelExecutionPromptForSession(
                capturedSessionId,
                preferences
              ),
              chromeEnabled: preferences?.chrome_enabled ?? false,
              allowedTools,
            },
            {
              onSettled: () => {
                processingRef.current.delete(capturedSessionId)
                queueMicrotask(() => processQueuesRef.current())
              },
            }
          )
        })
        .catch(err => {
          logger.error('Queue processor: backend dequeue failed', {
            sessionId: capturedSessionId,
            err,
          })
          processingRef.current.delete(capturedSessionId)
          queueMicrotask(() => processQueuesRef.current())
        })
    }
  }, [sendMessage, preferences])

  useEffect(() => {
    processQueuesRef.current = processQueues
  }, [processQueues])

  useEffect(() => {
    if (!hasProcessableQueue || !isTauri()) return
    processQueues()
  }, [hasProcessableQueue, processQueues, wsConnected])
}
