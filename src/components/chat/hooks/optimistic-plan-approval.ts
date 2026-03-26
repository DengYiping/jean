import type { QueryClient } from '@tanstack/react-query'
import { chatQueryKeys } from '@/services/chat'
import type { Session, WorktreeSessions } from '@/types/chat'

interface ApplyOptimisticPlanApprovalParams {
  queryClient: QueryClient
  sessionId: string
  worktreeId: string
  messageId: string
}

export function applyOptimisticPlanApproval({
  queryClient,
  sessionId,
  worktreeId,
  messageId,
}: ApplyOptimisticPlanApprovalParams) {
  queryClient.setQueryData<Session>(chatQueryKeys.session(sessionId), old => {
    if (!old) return old

    const approvedPlanMessageIds = old.approved_plan_message_ids ?? []
    const nextApprovedPlanMessageIds = approvedPlanMessageIds.includes(
      messageId
    )
      ? approvedPlanMessageIds
      : [...approvedPlanMessageIds, messageId]

    return {
      ...old,
      approved_plan_message_ids: nextApprovedPlanMessageIds,
      waiting_for_input: false,
      waiting_for_input_type: null,
      pending_plan_message_id: undefined,
      is_reviewing: false,
      messages: old.messages.map(msg =>
        msg.id === messageId ? { ...msg, plan_approved: true } : msg
      ),
    }
  })

  queryClient.setQueryData<WorktreeSessions>(
    chatQueryKeys.sessions(worktreeId),
    old => {
      if (!old) return old

      return {
        ...old,
        sessions: old.sessions.map(session =>
          session.id === sessionId
            ? {
                ...session,
                waiting_for_input: false,
                waiting_for_input_type: null,
                pending_plan_message_id: undefined,
                is_reviewing: false,
                approved_plan_message_ids: (
                  session.approved_plan_message_ids ?? []
                ).includes(messageId)
                  ? session.approved_plan_message_ids
                  : [...(session.approved_plan_message_ids ?? []), messageId],
              }
            : session
        ),
      }
    }
  )
}
