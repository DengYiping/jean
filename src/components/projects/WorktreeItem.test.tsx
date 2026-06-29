import { Profiler, type ProfilerOnRenderCallback } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorktreeItem } from './WorktreeItem'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import type { Session } from '@/types/chat'
import type { Worktree } from '@/types/projects'

const sessionsByWorktree = vi.hoisted(() => new Map<string, Session[]>())
const mockUseSessions = vi.hoisted(() =>
  vi.fn((worktreeId: string) => {
    const sessions = sessionsByWorktree.get(worktreeId) ?? []
    return {
      data: {
        worktree_id: worktreeId,
        sessions,
        active_session_id: sessions[0]?.id ?? null,
        version: 2,
      },
    }
  })
)

vi.mock('@/services/chat', () => ({
  useSessions: mockUseSessions,
  useArchiveSession: () => ({ mutate: vi.fn() }),
  useCloseSession: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/services/projects', () => ({
  useProjects: () => ({ data: [] }),
  useRenameWorktree: () => ({ mutate: vi.fn() }),
  useArchiveWorktree: () => ({ mutate: vi.fn() }),
  useCloseBaseSession: () => ({ mutate: vi.fn() }),
  useDeleteWorktree: () => ({ mutate: vi.fn() }),
  useOpenWorktreeInFinder: () => ({ mutate: vi.fn() }),
  useOpenWorktreeInTerminal: () => ({ mutate: vi.fn() }),
  useOpenWorktreeInEditor: () => ({ mutate: vi.fn() }),
  useBuildScript: () => ({ data: null }),
  useRunScript: () => ({ data: null }),
  useRunScripts: () => ({ data: [] }),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { removal_behavior: 'archive' } }),
}))

vi.mock('@/services/git-status', () => ({
  useGitStatus: () => ({ data: null }),
  gitPush: vi.fn(),
  fetchWorktreesStatus: vi.fn(),
  triggerImmediateGitPoll: vi.fn(),
  performGitPull: vi.fn(),
}))

vi.mock('@/components/projects/WorktreeContextMenu', () => ({
  WorktreeContextMenu: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}))

vi.mock('sonner', () => ({
  toast: {
    loading: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}))

const worktree: Worktree = {
  id: 'worktree-1',
  project_id: 'project-1',
  name: 'Royal Oriole',
  path: '/repo/worktree-1',
  branch: 'royal-oriole',
  created_at: 1,
  order: 0,
}

const makeWorktree = (
  id: string,
  name: string,
  projectId = 'project-1'
): Worktree => ({
  id,
  project_id: projectId,
  name,
  path: `/repo/${id}`,
  branch: id,
  created_at: 1,
  order: 0,
})

const makeSession = (id: string, name: string): Session => ({
  id,
  name,
  order: 0,
  created_at: 1,
  updated_at: 1,
  messages: [],
  message_count: 2,
})

describe('WorktreeItem', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    sessionsByWorktree.clear()
    sessionsByWorktree.set('worktree-1', [
      makeSession('session-fallback', 'Fallback session'),
    ])
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set(),
      expandedWorktreeIds: new Set(),
    })
    useChatStore.setState({
      activeWorktreeId: 'old-worktree',
      activeWorktreePath: '/repo/old-worktree',
      activeSessionIds: { 'worktree-1': 'session-existing' },
      lastOpenedPerProject: {},
      sessionWorktreeMap: {},
      sendingSessionIds: {},
      activeToolCalls: {},
      waitingForInputSessionIds: {},
      reviewingSessions: {},
      executionModes: {},
      executingModes: {},
      worktreeLoadingOperations: {},
    })
  })

  it('selects the worktree, preserves the target session, and opens the session modal', () => {
    const listener = vi.fn()
    window.addEventListener('open-session-modal', listener)

    render(
      <WorktreeItem
        worktree={worktree}
        projectId="project-1"
        projectPath="/repo/project"
        defaultBranch="main"
      />
    )

    fireEvent.click(screen.getByText('Royal Oriole'))

    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('worktree-1')
    expect(useChatStore.getState().activeWorktreeId).toBeNull()
    expect(useChatStore.getState().activeWorktreePath).toBeNull()
    expect(useChatStore.getState().activeSessionIds['worktree-1']).toBe(
      'session-existing'
    )
    expect(useChatStore.getState().lastOpenedPerProject['project-1']).toEqual({
      worktreeId: 'worktree-1',
      sessionId: 'session-existing',
    })

    vi.advanceTimersByTime(50)

    expect(listener).toHaveBeenCalledTimes(1)
    const event = listener.mock.calls[0]?.[0] as CustomEvent
    expect(event.detail).toEqual({
      projectId: 'project-1',
      sessionId: 'session-existing',
      worktreeId: 'worktree-1',
      worktreePath: '/repo/worktree-1',
    })

    window.removeEventListener('open-session-modal', listener)
    vi.useRealTimers()
  })

  it('switches around existing worktrees without re-rendering unaffected sidebar items', () => {
    const worktrees = [
      makeWorktree('worktree-1', 'Royal Oriole'),
      makeWorktree('worktree-2', 'Blue Finch'),
      makeWorktree('worktree-3', 'Green Heron'),
      makeWorktree('worktree-4', 'Silent Reference'),
    ]

    for (const currentWorktree of worktrees) {
      sessionsByWorktree.set(currentWorktree.id, [
        makeSession(
          `${currentWorktree.id}-fallback`,
          `${currentWorktree.name} fallback`
        ),
      ])
    }

    useChatStore.setState({
      activeSessionIds: {
        'worktree-1': 'worktree-1-session',
        'worktree-2': 'worktree-2-session',
        'worktree-3': 'worktree-3-session',
        'worktree-4': 'worktree-4-session',
      },
    })

    const listener = vi.fn()
    window.addEventListener('open-session-modal', listener)

    const renderStats: Record<
      string,
      { updates: number; actualDuration: number }
    > = {}
    const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration) => {
      const stat = (renderStats[id] ??= {
        updates: 0,
        actualDuration: 0,
      })
      if (phase === 'update') {
        stat.updates += 1
        stat.actualDuration += actualDuration
      }
    }

    render(
      <>
        {worktrees.map(currentWorktree => (
          <Profiler
            key={currentWorktree.id}
            id={currentWorktree.id}
            onRender={onRender}
          >
            <WorktreeItem
              worktree={currentWorktree}
              projectId="project-1"
              projectPath="/repo/project"
              defaultBranch="main"
            />
          </Profiler>
        ))}
      </>
    )

    fireEvent.click(screen.getByText('Royal Oriole'))
    vi.advanceTimersByTime(50)
    fireEvent.click(screen.getByText('Blue Finch'))
    vi.advanceTimersByTime(50)
    fireEvent.click(screen.getByText('Green Heron'))
    vi.advanceTimersByTime(50)

    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('worktree-3')
    expect(useChatStore.getState().activeWorktreeId).toBeNull()
    expect(useChatStore.getState().activeWorktreePath).toBeNull()
    expect(listener).toHaveBeenCalledTimes(3)
    expect(listener.mock.calls.map(call => (call[0] as CustomEvent).detail))
      .toMatchInlineSnapshot(`
        [
          {
            "projectId": "project-1",
            "sessionId": "worktree-1-session",
            "worktreeId": "worktree-1",
            "worktreePath": "/repo/worktree-1",
          },
          {
            "projectId": "project-1",
            "sessionId": "worktree-2-session",
            "worktreeId": "worktree-2",
            "worktreePath": "/repo/worktree-2",
          },
          {
            "projectId": "project-1",
            "sessionId": "worktree-3-session",
            "worktreeId": "worktree-3",
            "worktreePath": "/repo/worktree-3",
          },
        ]
      `)

    if (process.env.PROFILE_WORKTREE_SWITCH_TEST === '1') {
      console.info(
        '[profile] WorktreeItem hot switch render stats',
        renderStats
      )
      console.info('[profile] useSessions calls', mockUseSessions.mock.calls)
    }

    expect(renderStats['worktree-1']?.updates).toBeLessThanOrEqual(3)
    expect(renderStats['worktree-2']?.updates).toBeLessThanOrEqual(3)
    expect(renderStats['worktree-3']?.updates).toBeLessThanOrEqual(3)
    expect(renderStats['worktree-4']?.updates ?? 0).toBe(0)

    window.removeEventListener('open-session-modal', listener)
    vi.useRealTimers()
  })

  it('does not show a selected highlight for stale worktree selection from another project', () => {
    const projectOneWorktree = makeWorktree(
      'worktree-project-one',
      'Project One Worktree',
      'project-1'
    )
    const projectTwoWorktree = makeWorktree(
      'worktree-project-two',
      'Project Two Worktree',
      'project-2'
    )

    render(
      <>
        <WorktreeItem
          worktree={projectOneWorktree}
          projectId="project-1"
          projectPath="/repo/project-1"
          defaultBranch="main"
        />
        <WorktreeItem
          worktree={projectTwoWorktree}
          projectId="project-2"
          projectPath="/repo/project-2"
          defaultBranch="main"
        />
      </>
    )

    act(() => {
      useProjectsStore.setState({
        selectedProjectId: 'project-2',
        selectedWorktreeId: 'worktree-project-two',
      })
    })

    const projectOneRow = screen
      .getByText('Project One Worktree')
      .closest('div.cursor-pointer')
    const projectTwoRow = screen
      .getByText('Project Two Worktree')
      .closest('div.cursor-pointer')

    expect(projectOneRow?.className).not.toContain('bg-primary/10')
    expect(projectTwoRow?.className).toContain('bg-primary/10')

    act(() => {
      useProjectsStore.getState().selectWorktree('worktree-project-one')
    })

    expect(useProjectsStore.getState().selectedProjectId).toBe('project-2')
    expect(projectOneRow?.className).not.toContain('bg-primary/10')
    expect(projectTwoRow?.className).not.toContain('bg-primary/10')
  })
})
