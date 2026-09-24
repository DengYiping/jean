import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@/lib/transport'
import { chatQueryKeys } from '@/services/chat'
import { markSessionsRead } from './mark-sessions-read'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  useWsConnectionStatus: vi.fn(),
}))

describe('markSessionsRead', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  it('removes the session from the unread caches and persists it', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatQueryKeys.unreadSessions(), {
      entries: [
        { session: { id: 'session-1' } },
        { session: { id: 'session-2' } },
      ],
    })
    queryClient.setQueryData(chatQueryKeys.unreadCount(), 2)
    const opened = vi.fn()
    window.addEventListener('session-opened', opened)

    await markSessionsRead(queryClient, ['session-1'])

    expect(queryClient.getQueryData(chatQueryKeys.unreadSessions())).toEqual({
      entries: [{ session: { id: 'session-2' } }],
    })
    expect(queryClient.getQueryData(chatQueryKeys.unreadCount())).toBe(1)
    expect(invoke).toHaveBeenCalledWith('set_session_last_opened', {
      sessionId: 'session-1',
    })
    expect(opened).toHaveBeenCalled()
    window.removeEventListener('session-opened', opened)
  })

  it('leaves the count alone when the session was not listed as unread', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatQueryKeys.unreadSessions(), { entries: [] })
    queryClient.setQueryData(chatQueryKeys.unreadCount(), 3)

    await markSessionsRead(queryClient, ['session-1', 'session-2'])

    expect(queryClient.getQueryData(chatQueryKeys.unreadCount())).toBe(3)
    expect(invoke).toHaveBeenCalledWith('set_sessions_last_opened_bulk', {
      sessionIds: ['session-1', 'session-2'],
    })
  })
})
