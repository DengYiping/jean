import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { useChatStore } from '@/store/chat-store'
import { usePreferences } from '@/services/preferences'
import {
  useCreateSession,
  useSendMessage,
  readPlanFile,
  chatQueryKeys,
} from '@/services/chat'
import { invoke } from '@/lib/transport'
import type { Session, WorktreeSessions } from '@/types/chat'
import type { SessionCardData } from '../session-card-utils'
import {
  extractImagePaths,
  extractSkillPaths,
  extractTextFilePaths,
} from '../message-content-utils'
import { resolveApprovedPlanContinuation } from './approved-plan-continuation'
import { completePlanApprovalTransition } from './plan-approval-transition'

interface UseClearContextApprovalParams {
  worktreeId: string
  worktreePath: string
}

/**
 * Provides a "Clear Context & Approve" handler for canvas session cards.
 * Marks the plan approved on the original session, creates a new session,
 * switches to it, and sends the plan as the first message in YOLO mode.
 */
export function useClearContextApproval({
  worktreeId,
  worktreePath,
}: UseClearContextApprovalParams) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const createSession = useCreateSession()
  const sendMessage = useSendMessage()

  const handleClearContextApproval = useCallback(
    async (
      card: SessionCardData,
      updatedPlan?: string,
      mode: 'yolo' | 'build' = 'yolo'
    ) => {
      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId

      // Step 1: Approve the plan and clear waiting state on the original session
      void completePlanApprovalTransition({
        queryClient,
        worktreeId,
        worktreePath,
        sessionId,
        messageId,
        logContext: 'useClearContextApproval',
      }).finally(() => {
        queryClient.invalidateQueries({
          queryKey: chatQueryKeys.sessions(worktreeId),
        })
      })

      // Step 2: Resolve plan content
      let planContent = updatedPlan || card.planContent
      if (!planContent && card.planFilePath) {
        try {
          planContent = await readPlanFile(card.planFilePath)
        } catch (err) {
          toast.error(`Failed to read plan file: ${err}`)
          return
        }
      }
      if (!planContent) {
        toast.error('No plan content available')
        return
      }

      // Step 3: Create new session
      let newSession: Session
      try {
        newSession = await createSession.mutateAsync({
          worktreeId,
          worktreePath,
        })
      } catch (err) {
        toast.error(`Failed to create session: ${err}`)
        return
      }

      // Step 4: Switch to new session
      const store = useChatStore.getState()
      store.setActiveSession(worktreeId, newSession.id)
      store.addUserInitiatedSession(newSession.id)

      // Extract attachment references from all user messages in the original session.
      // Pending attachments are already cleared by handleSubmit, so we scan the
      // actual sent messages to find image/skill/text-file references.
      // The canvas view only uses the sessions list query (no messages), so we
      // must fetch the full session from the backend.
      let allUserContent = ''
      try {
        const fullSession = await invoke<Session>('get_session', {
          worktreeId,
          worktreePath,
          sessionId,
        })
        allUserContent = fullSession.messages
          .filter(m => m.role === 'user')
          .map(m => m.content)
          .join('\n')
      } catch (err) {
        logger.error('[useClearContextApproval] Failed to fetch session:', err)
      }

      const imagePaths = extractImagePaths(allUserContent)
      const skillPaths = extractSkillPaths(allUserContent)
      const textFilePaths = extractTextFilePaths(allUserContent)

      const resolvedPlanFilePath =
        card.planFilePath || store.getPlanFilePath(sessionId)
      const continuation = resolveApprovedPlanContinuation({
        mode,
        planContent,
        planFilePath: resolvedPlanFilePath,
        originalBackend: card.session.backend,
        originalModel: card.session.selected_model,
        preferences,
        imagePaths,
        skillPaths,
        textFilePaths,
      })
      if (continuation.modeOverride) {
        toast.info(`${continuation.modeLabel}: ${continuation.modeOverride}`)
      }

      store.setExecutionMode(newSession.id, mode)
      store.setLastSentMessage(newSession.id, continuation.message)
      store.setError(newSession.id, null)
      store.addSendingSession(newSession.id)
      store.setSelectedModel(newSession.id, continuation.model)
      store.setExecutingMode(newSession.id, mode)
      if (continuation.backend) {
        store.setSelectedBackend(newSession.id, continuation.backend)
      }
      // Optimistically update TanStack Query cache so UI shows correct backend/model
      // immediately. Without this, session?.backend (from query cache) defaults to 'claude'
      // and overrides the Zustand value in the backend resolution chain.
      queryClient.setQueryData<Session>(
        chatQueryKeys.session(newSession.id),
        old =>
          old
            ? {
                ...old,
                backend: continuation.backend ?? old.backend,
                selected_model: continuation.model,
              }
            : old
      )

      // Persist model and backend to Rust session BEFORE sending so send_chat_message
      // reads the updated session state (both use with_sessions_mut, so ordering matters)
      await invoke('set_session_model', {
        worktreeId,
        worktreePath,
        sessionId: newSession.id,
        model: continuation.model,
      }).catch(err =>
        logger.error('[useClearContextApproval] Failed to persist model:', err)
      )
      if (continuation.backend) {
        await invoke('set_session_backend', {
          worktreeId,
          worktreePath,
          sessionId: newSession.id,
          backend: continuation.backend,
        }).catch(err =>
          logger.error(
            '[useClearContextApproval] Failed to persist backend:',
            err
          )
        )
      }

      sendMessage.mutate({
        sessionId: newSession.id,
        worktreeId,
        worktreePath,
        message: continuation.message,
        model: continuation.model,
        executionMode: mode,
        thinkingLevel: continuation.thinkingLevel,
        effortLevel: continuation.effortLevel,
        customProfileName: card.session.selected_provider ?? undefined,
        backend: continuation.backend,
      })

      // Optionally close the original session immediately.
      // cancel_process_if_running (used by close/archive commands) safely skips
      // idle sessions, so no spurious chat:cancelled events are emitted.
      // The with_sessions_mut mutex in storage.rs serializes concurrent writes,
      // so there's no file-level race with send_chat_message.
      if (preferences?.close_original_on_clear_context) {
        const command =
          preferences.removal_behavior === 'archive'
            ? 'archive_session'
            : 'close_session'

        // Optimistically remove from UI immediately so the user sees it gone at once
        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktreeId),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.filter(s => s.id !== sessionId),
              active_session_id:
                old.active_session_id === sessionId
                  ? newSession.id
                  : old.active_session_id,
            }
          }
        )

        // Close in background, then sync with backend
        invoke(command, { worktreeId, worktreePath, sessionId })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: chatQueryKeys.sessions(worktreeId),
            })
          )
          .catch(err =>
            logger.error(
              '[useClearContextApproval] Failed to close original session:',
              err
            )
          )
      }
    },
    [
      worktreeId,
      worktreePath,
      queryClient,
      preferences,
      createSession,
      sendMessage,
    ]
  )

  const handleClearContextApprovalBuild = useCallback(
    (card: SessionCardData, updatedPlan?: string) =>
      handleClearContextApproval(card, updatedPlan, 'build'),
    [handleClearContextApproval]
  )

  return { handleClearContextApproval, handleClearContextApprovalBuild }
}
