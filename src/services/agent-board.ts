import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import { chatQueryKeys } from '@/services/chat'
import { useChatStore } from '@/store/chat-store'
import { isExitPlanMode } from '@/types/chat'
import type {
  AgentBoardItem,
  AgentBoardLane,
  CreateAgentBoardItemRequest,
  SessionAgentBoardAssociation,
  UpdateAgentBoardItemRequest,
} from '@/types/agent-board'
import type {
  AllSessionsResponse,
  RunStatus,
  Session,
  UnreadSessionsResponse,
  WorktreeSessions,
} from '@/types/chat'

export const agentBoardQueryKeys = {
  all: ['agent-board'] as const,
  session: (sessionId: string) =>
    ['agent-board', 'session', sessionId] as const,
}

export function useAgentBoardItems() {
  return useQuery({
    queryKey: agentBoardQueryKeys.all,
    queryFn: () => invoke<AgentBoardItem[]>('list_agent_board_items'),
  })
}

export function setCachedAgentBoardSessionRunStatus(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  status: RunStatus
) {
  queryClient.setQueryData<AgentBoardItem[]>(agentBoardQueryKeys.all, items =>
    items?.map(item =>
      item.planning_session_id === sessionId ||
      item.implementation_session_id === sessionId ||
      item.yolo_session_id === sessionId
        ? { ...item, active_run_status: status }
        : item
    )
  )
}

export function useCreateAgentBoardItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (request: CreateAgentBoardItemRequest) =>
      invoke<AgentBoardItem>('create_agent_board_item', { request }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentBoardQueryKeys.all }),
  })
}

export function useUpdateAgentBoardItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      itemId,
      patch,
    }: {
      itemId: string
      patch: UpdateAgentBoardItemRequest
    }) => invoke<AgentBoardItem>('update_agent_board_item', { itemId, patch }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentBoardQueryKeys.all }),
  })
}

export function useDeleteAgentBoardItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      invoke('delete_agent_board_item', { itemId }),
    onSuccess: (_result, itemId) => {
      queryClient.setQueryData<AgentBoardItem[]>(
        agentBoardQueryKeys.all,
        current => current?.filter(item => item.id !== itemId) ?? current
      )
      queryClient.invalidateQueries({ queryKey: agentBoardQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.all })
    },
  })
}

function clearSessionAttention(session: Session): Session {
  const now = Math.floor(Date.now() / 1000)
  let latestExitPlanMessageId: string | undefined
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index]
    if (
      message?.role === 'assistant' &&
      message.tool_calls?.some(isExitPlanMode)
    ) {
      latestExitPlanMessageId = message.id
      break
    }
  }
  const pendingPlanMessageId =
    session.pending_plan_message_id ??
    session.session_derived_state?.pending_plan_message_id ??
    latestExitPlanMessageId
  const approvedPlanMessageIds =
    pendingPlanMessageId &&
    !(session.approved_plan_message_ids ?? []).includes(pendingPlanMessageId)
      ? [...(session.approved_plan_message_ids ?? []), pendingPlanMessageId]
      : session.approved_plan_message_ids
  return {
    ...session,
    waiting_for_input: false,
    waiting_for_input_type: null,
    pending_plan_message_id: undefined,
    approved_plan_message_ids: approvedPlanMessageIds,
    messages: session.messages.map(message =>
      message.id === pendingPlanMessageId
        ? { ...message, plan_approved: true }
        : message
    ),
    last_opened_at: now,
    session_derived_state: session.session_derived_state
      ? {
          ...session.session_derived_state,
          status:
            session.session_derived_state.status === 'waiting'
              ? 'completed'
              : session.session_derived_state.status,
          is_waiting: false,
          waiting_type: null,
          has_question: false,
          has_exit_plan: false,
          pending_plan_message_id: null,
          is_unread: false,
        }
      : session.session_derived_state,
  }
}

function markSessionRead(session: Session): Session {
  const now = Math.floor(Date.now() / 1000)
  return {
    ...session,
    last_opened_at: now,
    session_derived_state: session.session_derived_state
      ? {
          ...session.session_derived_state,
          is_unread: false,
        }
      : session.session_derived_state,
  }
}

function updateCachedSession(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  updateSession: (session: Session) => Session
) {
  queryClient.setQueryData<Session>(chatQueryKeys.session(sessionId), old =>
    old ? updateSession(old) : old
  )
  queryClient.setQueriesData<WorktreeSessions>(
    { queryKey: [...chatQueryKeys.all, 'sessions'] },
    old =>
      old
        ? {
            ...old,
            sessions: old.sessions.map(session =>
              session.id === sessionId ? updateSession(session) : session
            ),
          }
        : old
  )
  queryClient.setQueryData<AllSessionsResponse>(['all-sessions'], old =>
    old
      ? {
          ...old,
          entries: old.entries.map(entry => ({
            ...entry,
            sessions: entry.sessions.map(session =>
              session.id === sessionId ? updateSession(session) : session
            ),
          })),
        }
      : old
  )
}

function removeSessionsFromUnreadCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionIds: string[]
) {
  if (sessionIds.length === 0) return
  const sessionIdSet = new Set(sessionIds)
  let removedCount = 0
  queryClient.setQueryData<UnreadSessionsResponse>(
    chatQueryKeys.unreadSessions(),
    old => {
      if (!old) return old
      const entries = old.entries.filter(entry => {
        const remove = sessionIdSet.has(entry.session.id)
        if (remove) removedCount += 1
        return !remove
      })
      return { ...old, entries }
    }
  )
  if (removedCount > 0) {
    queryClient.setQueryData<number>(chatQueryKeys.unreadCount(), old =>
      old == null ? old : Math.max(0, old - removedCount)
    )
  }
}

function associatedSessionIds(item?: AgentBoardItem | null) {
  if (!item) return []
  return [
    item.planning_session_id,
    item.implementation_session_id,
    item.yolo_session_id,
  ].filter((sessionId, index, sessionIds): sessionId is string => {
    return Boolean(sessionId) && sessionIds.indexOf(sessionId) === index
  })
}

function markCachedSessionsRead(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionIds: string[]
) {
  for (const sessionId of sessionIds) {
    updateCachedSession(queryClient, sessionId, markSessionRead)
  }
  removeSessionsFromUnreadCaches(queryClient, sessionIds)
}

function clearCachedSessionAttention(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string
) {
  useChatStore.getState().setWaitingForInput(sessionId, false)
  useChatStore.getState().setExecutionMode(sessionId, 'build')
  updateCachedSession(queryClient, sessionId, clearSessionAttention)
  removeSessionsFromUnreadCaches(queryClient, [sessionId])
}

export function useMoveAgentBoardItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, lane }: { itemId: string; lane: AgentBoardLane }) =>
      invoke<AgentBoardItem>('move_agent_board_item', { itemId, lane }),
    onMutate: async ({ itemId, lane }) => {
      await queryClient.cancelQueries({ queryKey: agentBoardQueryKeys.all })
      const previousItems = queryClient.getQueryData<AgentBoardItem[]>(
        agentBoardQueryKeys.all
      )
      const movingItem = previousItems?.find(item => item.id === itemId)
      const sessionIds = associatedSessionIds(movingItem)
      const startedSessionId =
        lane === 'implementing'
          ? (movingItem?.implementation_session_id ??
            movingItem?.planning_session_id)
          : null
      if (startedSessionId) {
        clearCachedSessionAttention(queryClient, startedSessionId)
        markCachedSessionsRead(
          queryClient,
          sessionIds.filter(sessionId => sessionId !== startedSessionId)
        )
      } else {
        markCachedSessionsRead(queryClient, sessionIds)
      }
      queryClient.setQueryData<AgentBoardItem[]>(
        agentBoardQueryKeys.all,
        current =>
          current?.map(item =>
            item.id === itemId
              ? {
                  ...item,
                  lane,
                  active_run_status: undefined,
                  updated_at: Math.floor(Date.now() / 1000),
                  last_error: undefined,
                }
              : item
          ) ?? current
      )
      return { previousItems }
    },
    onError: (_error, _variables, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(agentBoardQueryKeys.all, context.previousItems)
      }
    },
    onSuccess: item => {
      queryClient.setQueryData<AgentBoardItem[]>(
        agentBoardQueryKeys.all,
        current =>
          current?.map(existing =>
            existing.id === item.id ? item : existing
          ) ?? [item]
      )
      queryClient.invalidateQueries({ queryKey: agentBoardQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: chatQueryKeys.all })
    },
  })
}

export function useRefreshAgentBoardItems() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => invoke<AgentBoardItem[]>('refresh_agent_board_items'),
    onSuccess: items =>
      queryClient.setQueryData(agentBoardQueryKeys.all, items),
  })
}

export function useAgentBoardItemForSession(sessionId?: string | null) {
  return useQuery({
    queryKey: sessionId
      ? agentBoardQueryKeys.session(sessionId)
      : ['agent-board', 'session', 'none'],
    queryFn: () =>
      invoke<SessionAgentBoardAssociation | null>(
        'get_agent_board_item_for_session',
        { sessionId }
      ),
    enabled: !!sessionId,
  })
}
