import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chatQueryKeys,
  SESSIONS_GC_TIME_MS,
  SESSIONS_STALE_TIME_MS,
} from '@/services/chat'
import { createProjectCanvasSessionsQuery } from './project-canvas-session-queries'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
}))

describe('createProjectCanvasSessionsQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: { invoke: vi.fn() },
      configurable: true,
    })
  })

  it('uses the standard sessions query key and cache timing', () => {
    const query = createProjectCanvasSessionsQuery({
      id: 'worktree-1',
      path: '/repo/worktree-1',
    })

    expect(query.queryKey).toEqual(chatQueryKeys.sessions('worktree-1'))
    expect(query.staleTime).toBe(SESSIONS_STALE_TIME_MS)
    expect(query.gcTime).toBe(SESSIONS_GC_TIME_MS)
  })

  it('loads sessions without includeMessageCounts', async () => {
    mockInvoke.mockResolvedValue({
      worktree_id: 'worktree-1',
      sessions: [],
      active_session_id: null,
      version: 2,
    })

    const query = createProjectCanvasSessionsQuery({
      id: 'worktree-1',
      path: '/repo/worktree-1',
    })

    await query.queryFn()

    expect(mockInvoke).toHaveBeenCalledWith('get_sessions', {
      worktreeId: 'worktree-1',
      worktreePath: '/repo/worktree-1',
    })
    expect(mockInvoke.mock.calls[0]?.[1]).not.toHaveProperty(
      'includeMessageCounts'
    )
  })

  it('reuses a warm normal sessions cache entry without refetching', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })
    const cachedSessions = {
      worktree_id: 'worktree-1',
      sessions: [
        {
          id: 'session-1',
          name: 'Cached session',
          order: 0,
          created_at: 1,
          updated_at: 1,
          messages: [],
          message_count: 2,
        },
      ],
      active_session_id: 'session-1',
      version: 2,
    }
    queryClient.setQueryData(
      chatQueryKeys.sessions('worktree-1'),
      cachedSessions
    )

    const data = await queryClient.fetchQuery(
      createProjectCanvasSessionsQuery({
        id: 'worktree-1',
        path: '/repo/worktree-1',
      })
    )

    expect(data).toBe(cachedSessions)
    expect(mockInvoke).not.toHaveBeenCalled()
  })
})
