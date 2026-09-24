import { createElement, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNativeNotificationNavigation } from './useNativeNotificationNavigation'

const {
  mockInvoke,
  mockListen,
  mockOpenWorkspaceSession,
  mockMarkSessionsRead,
} = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn(),
  mockOpenWorkspaceSession: vi.fn(),
  mockMarkSessionsRead: vi.fn(),
}))

vi.mock('@/lib/environment', () => ({
  isNativeApp: () => true,
}))

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
  listen: mockListen,
}))

vi.mock('@/lib/workspace-navigation', () => ({
  openWorkspaceSession: mockOpenWorkspaceSession,
}))

vi.mock('@/components/unread/mark-sessions-read', () => ({
  markSessionsRead: mockMarkSessionsRead,
}))

function renderNavigationHook() {
  const queryClient = new QueryClient()
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)
  renderHook(() => useNativeNotificationNavigation(), { wrapper })
  return queryClient
}

describe('useNativeNotificationNavigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockResolvedValue({ entries: [] })
    mockListen.mockResolvedValue(vi.fn())
    mockMarkSessionsRead.mockResolvedValue(undefined)
  })

  it('opens the clicked session and clears its unread notification', async () => {
    const queryClient = renderNavigationHook()

    await waitFor(() => {
      expect(mockListen).toHaveBeenCalledWith(
        'native-notification-clicked',
        expect.any(Function)
      )
    })

    const handler = mockListen.mock.calls[0]?.[1]
    const target = {
      projectId: 'project-1',
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
    }
    await handler({ payload: target })

    expect(mockOpenWorkspaceSession).toHaveBeenCalledWith(target)
    expect(mockInvoke).not.toHaveBeenCalled()
    expect(mockMarkSessionsRead).toHaveBeenCalledWith(queryClient, [
      'session-1',
    ])
  })

  it('resolves the workspace when only the session id was available', async () => {
    mockInvoke.mockResolvedValue({
      entries: [
        {
          project_id: 'project-1',
          worktree_id: 'worktree-1',
          worktree_path: '/tmp/worktree-1',
          sessions: [{ id: 'session-1' }],
        },
      ],
    })
    renderNavigationHook()
    await waitFor(() => expect(mockListen).toHaveBeenCalled())

    const handler = mockListen.mock.calls[0]?.[1]
    await handler({ payload: { sessionId: 'session-1' } })

    expect(mockOpenWorkspaceSession).toHaveBeenCalledWith({
      projectId: 'project-1',
      worktreeId: 'worktree-1',
      worktreePath: '/tmp/worktree-1',
      sessionId: 'session-1',
    })
    expect(mockMarkSessionsRead).toHaveBeenCalled()
  })
})
