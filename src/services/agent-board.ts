import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invoke } from '@/lib/transport'
import type {
  AgentBoardItem,
  AgentBoardLane,
  CreateAgentBoardItemRequest,
  SessionAgentBoardAssociation,
  UpdateAgentBoardItemRequest,
} from '@/types/agent-board'

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
      queryClient.setQueryData<AgentBoardItem[]>(
        agentBoardQueryKeys.all,
        current =>
          current?.map(item =>
            item.id === itemId
              ? {
                  ...item,
                  lane,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: agentBoardQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
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
