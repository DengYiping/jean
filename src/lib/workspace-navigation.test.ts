import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  openWorkspaceSession,
  openWorkspaceView,
} from '@/lib/workspace-navigation'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}))

describe('workspace navigation', () => {
  beforeEach(() => {
    vi.useRealTimers()
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set(),
      expandedWorktreeIds: new Set(),
    })
    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: {},
      lastOpenedPerProject: {},
      sessionWorktreeMap: {},
    })
    useUIStore.setState({
      activeMainView: 'agent_board',
      sessionChatModalOpen: false,
      sessionChatModalWorktreeId: null,
      autoOpenSessionWorktreeIds: new Set(),
      pendingAutoOpenSessionIds: {},
    })
  })

  it('requeues the previous workspace modal session when returning from the board', () => {
    useUIStore.setState({
      activeMainView: 'agent_board',
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'worktree-1',
    })
    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: { 'worktree-1': 'session-1' },
    })

    openWorkspaceView({ reopenSessionModal: true })

    const uiState = useUIStore.getState()
    expect(uiState.activeMainView).toBe('workspace')
    expect(uiState.autoOpenSessionWorktreeIds.has('worktree-1')).toBe(true)
    expect(uiState.pendingAutoOpenSessionIds['worktree-1']).toBe('session-1')
  })

  it('opens a notification target in the workspace canvas session modal', () => {
    vi.useFakeTimers()
    const listener = vi.fn()
    window.addEventListener('open-session-modal', listener)

    useChatStore.setState({
      activeWorktreeId: 'old-worktree',
      activeWorktreePath: '/repo/old-worktree',
    })

    openWorkspaceSession({
      projectId: 'project-1',
      worktreeId: 'worktree-1',
      worktreePath: '/repo/worktree-1',
      sessionId: 'session-1',
    })

    expect(useUIStore.getState().activeMainView).toBe('workspace')
    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('worktree-1')
    expect(useChatStore.getState().activeWorktreePath).toBeNull()
    expect(useChatStore.getState().activeSessionIds['worktree-1']).toBe(
      'session-1'
    )
    expect(useChatStore.getState().lastOpenedPerProject['project-1']).toEqual({
      worktreeId: 'worktree-1',
      sessionId: 'session-1',
    })
    expect(
      useUIStore.getState().autoOpenSessionWorktreeIds.has('worktree-1')
    ).toBe(true)

    vi.advanceTimersByTime(50)
    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0]?.[0] as CustomEvent
    expect(event.detail).toEqual({
      sessionId: 'session-1',
      worktreeId: 'worktree-1',
      worktreePath: '/repo/worktree-1',
    })

    window.removeEventListener('open-session-modal', listener)
    vi.useRealTimers()
  })
})
