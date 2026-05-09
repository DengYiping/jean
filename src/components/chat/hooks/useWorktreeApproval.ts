import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { logger } from '@/lib/logger'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import { usePreferences } from '@/services/preferences'
import { useSendMessage, readPlanFile, chatQueryKeys } from '@/services/chat'
import { invoke, listen } from '@/lib/transport'
import type { Session, WorktreeSessions } from '@/types/chat'
import type {
  Worktree,
  WorktreeCreatedEvent,
  WorktreeCreateErrorEvent,
} from '@/types/projects'
import type { SessionCardData } from '../session-card-utils'
import {
  extractImagePaths,
  extractSkillPaths,
  extractTextFilePaths,
} from '../message-content-utils'
import { navigateToApprovedWorktree } from '../worktree-approval-navigation'
import { resolveApprovedPlanContinuation } from './approved-plan-continuation'
import { completePlanApprovalTransition } from './plan-approval-transition'
import { sendApprovedPlanContinuation } from './send-approved-plan-continuation'
import { markWorktreeSilentReady } from '@/services/worktree-silent-ready'

interface UseWorktreeApprovalParams {
  worktreeId: string
  worktreePath: string
  projectId: string | null
}

/**
 * Provides "Worktree Build" and "Worktree YOLO" handlers for canvas session cards.
 * Marks the plan approved on the original session, creates a new worktree,
 * waits for it to be ready, creates a session, and sends the plan.
 */
export function useWorktreeApproval({
  worktreeId,
  worktreePath,
  projectId,
}: UseWorktreeApprovalParams) {
  const queryClient = useQueryClient()
  const { data: preferences } = usePreferences()
  const sendMessage = useSendMessage()

  const handleWorktreeApproval = useCallback(
    async (
      card: SessionCardData,
      updatedPlan?: string,
      mode: 'yolo' | 'build' = 'build'
    ) => {
      if (!projectId) {
        toast.error('No project context available')
        return
      }

      const sessionId = card.session.id
      const messageId = card.pendingPlanMessageId

      // Step 1: Approve the plan and clear waiting state on the original session
      void completePlanApprovalTransition({
        queryClient,
        worktreeId,
        worktreePath,
        sessionId,
        messageId,
        logContext: 'useWorktreeApproval',
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

      // Step 3: Create new worktree
      let pendingWorktree: Worktree
      try {
        pendingWorktree = await invoke<Worktree>('create_worktree', {
          projectId,
        })
      } catch (err) {
        toast.error(`Failed to create worktree: ${err}`)
        return
      }
      markWorktreeSilentReady(pendingWorktree.id)

      // Step 4: Wait for worktree to be ready
      let readyWorktree: Worktree
      try {
        readyWorktree = await new Promise<Worktree>((resolve, reject) => {
          const timeout = setTimeout(() => {
            void unlistenCreated.then(fn => fn())
            void unlistenError.then(fn => fn())
            reject(new Error('Worktree creation timed out'))
          }, 120_000)

          const unlistenCreated = listen<WorktreeCreatedEvent>(
            'worktree:created',
            event => {
              if (event.payload.worktree.id === pendingWorktree.id) {
                clearTimeout(timeout)
                void unlistenCreated.then(fn => fn())
                void unlistenError.then(fn => fn())
                resolve(event.payload.worktree)
              }
            }
          )

          const unlistenError = listen<WorktreeCreateErrorEvent>(
            'worktree:error',
            event => {
              if (event.payload.id === pendingWorktree.id) {
                clearTimeout(timeout)
                void unlistenCreated.then(fn => fn())
                void unlistenError.then(fn => fn())
                reject(new Error(event.payload.error))
              }
            }
          )
        })
      } catch (err) {
        toast.error(`Worktree creation failed: ${err}`)
        return
      }

      // Step 5: Use the default session auto-created by the backend, or create one if none exists
      let newSession: Session
      try {
        const sessionsData = await invoke<WorktreeSessions>('get_sessions', {
          worktreeId: readyWorktree.id,
          worktreePath: readyWorktree.path,
        })
        if (sessionsData.sessions.length > 0 && sessionsData.sessions[0]) {
          newSession = sessionsData.sessions[0]
        } else {
          newSession = await invoke<Session>('create_session', {
            worktreeId: readyWorktree.id,
            worktreePath: readyWorktree.path,
          })
        }
      } catch (err) {
        toast.error(`Failed to get session: ${err}`)
        return
      }

      // Step 6: Switch to new session and preserve the current presentation mode
      const chatStore = useChatStore.getState()
      chatStore.setActiveSession(readyWorktree.id, newSession.id)
      chatStore.addUserInitiatedSession(newSession.id)
      const projectsStore = useProjectsStore.getState()
      const uiStore = useUIStore.getState()
      navigateToApprovedWorktree(
        readyWorktree,
        {
          activeWorktreePath: chatStore.activeWorktreePath,
          sessionChatModalOpen: uiStore.sessionChatModalOpen,
        },
        {
          expandProject: projectsStore.expandProject,
          selectWorktree: projectsStore.selectWorktree,
          registerWorktreePath: chatStore.registerWorktreePath,
          setActiveWorktree: chatStore.setActiveWorktree,
          openWorktreeModal: (worktreeId, worktreePath) => {
            window.dispatchEvent(
              new CustomEvent('open-worktree-modal', {
                detail: { worktreeId, worktreePath },
              })
            )
          },
        }
      )

      // Step 7: Extract attachment references from original session
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
        logger.error('[useWorktreeApproval] Failed to fetch session:', err)
      }

      const imagePaths = extractImagePaths(allUserContent)
      const skillPaths = extractSkillPaths(allUserContent)
      const textFilePaths = extractTextFilePaths(allUserContent)

      // Step 8: Send plan as first message with mode-specific overrides
      const resolvedPlanFilePath =
        card.planFilePath || chatStore.getPlanFilePath(sessionId)
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

      await sendApprovedPlanContinuation({
        queryClient,
        sendMessage,
        target: {
          sessionId: newSession.id,
          worktreeId: readyWorktree.id,
          worktreePath: readyWorktree.path,
        },
        mode,
        continuation,
        logContext: 'useWorktreeApproval',
        customProfileName: card.session.selected_provider ?? undefined,
      })

      // Optionally close the original session
      if (preferences?.close_original_on_clear_context) {
        const command =
          preferences.removal_behavior === 'archive'
            ? 'archive_session'
            : 'close_session'

        queryClient.setQueryData<WorktreeSessions>(
          chatQueryKeys.sessions(worktreeId),
          old => {
            if (!old) return old
            return {
              ...old,
              sessions: old.sessions.filter(s => s.id !== sessionId),
            }
          }
        )

        invoke(command, { worktreeId, worktreePath, sessionId })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: chatQueryKeys.sessions(worktreeId),
            })
          )
          .catch(err =>
            logger.error(
              '[useWorktreeApproval] Failed to close original session:',
              err
            )
          )
      }
    },
    [worktreeId, worktreePath, projectId, queryClient, preferences, sendMessage]
  )

  const handleWorktreeApprovalYolo = useCallback(
    (card: SessionCardData, updatedPlan?: string) =>
      handleWorktreeApproval(card, updatedPlan, 'yolo'),
    [handleWorktreeApproval]
  )

  // Return null handlers if no project context (buttons won't render)
  if (!projectId) {
    return { handleWorktreeApproval: null, handleWorktreeApprovalYolo: null }
  }

  return { handleWorktreeApproval, handleWorktreeApprovalYolo }
}
