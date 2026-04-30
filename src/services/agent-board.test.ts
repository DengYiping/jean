import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  agentBoardQueryKeys,
  useMoveAgentBoardItem,
} from '@/services/agent-board'
import type { AgentBoardItem } from '@/types/agent-board'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  })

const createWrapper = (queryClient: QueryClient) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  Wrapper.displayName = 'TestQueryClientWrapper'
  return Wrapper
}

function todoItem(): AgentBoardItem {
  return {
    id: 'item-1',
    title: 'Plan work',
    prompt: 'Plan work',
    project_id: 'project-1',
    backend: 'codex',
    effort_level: 'high',
    lane: 'todo',
    created_at: 1,
    updated_at: 1,
  }
}

describe('agent board service', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = createTestQueryClient()
    vi.clearAllMocks()
  })

  it('optimistically moves a card while the backend lane side effects are pending', async () => {
    const { invoke } = await import('@/lib/transport')
    const item = todoItem()
    queryClient.setQueryData(agentBoardQueryKeys.all, [item])

    let resolveMove!: (item: AgentBoardItem) => void
    vi.mocked(invoke).mockReturnValue(
      new Promise<AgentBoardItem>(resolve => {
        resolveMove = resolve
      })
    )

    const { result } = renderHook(() => useMoveAgentBoardItem(), {
      wrapper: createWrapper(queryClient),
    })

    act(() => {
      result.current.mutate({ itemId: item.id, lane: 'planning' })
    })

    await waitFor(() => {
      expect(
        queryClient.getQueryData<AgentBoardItem[]>(agentBoardQueryKeys.all)?.[0]
          ?.lane
      ).toBe('planning')
    })

    resolveMove({ ...item, lane: 'planning' })
  })
})
