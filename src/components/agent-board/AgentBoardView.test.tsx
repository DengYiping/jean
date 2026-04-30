import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentBoardView } from './AgentBoardView'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'
import type { AgentBoardItem } from '@/types/agent-board'
import type { UnreadSessionsResponse } from '@/types/chat'
import type { Project, Worktree } from '@/types/projects'

const mockInvoke = vi.hoisted(() => vi.fn())
const mockCreateAgentBoardItem = vi.hoisted(() => vi.fn())
const mockDeleteAgentBoardItem = vi.hoisted(() => vi.fn())
const mockUnreadSessions = vi.hoisted(
  (): UnreadSessionsResponse => ({ entries: [] })
)

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
}))

const project: Project = {
  id: 'project-1',
  name: 'Project',
  path: '/tmp/project',
  default_branch: 'main',
  added_at: 1,
  order: 0,
}

const item: AgentBoardItem = {
  id: 'item-1',
  title: 'Implement board navigation',
  prompt: 'Open the session',
  project_id: project.id,
  backend: 'codex',
  effort_level: 'high',
  lane: 'planned',
  worktree_id: 'worktree-1',
  planning_session_id: 'session-1',
  created_at: 1,
  updated_at: 1,
}

vi.mock('@/services/projects', () => ({
  useProjects: () => ({ data: [project] }),
}))

vi.mock('@/services/agent-board', () => ({
  useAgentBoardItems: () => ({ data: [item], isLoading: false }),
  useCreateAgentBoardItem: () => ({
    mutateAsync: mockCreateAgentBoardItem,
    isPending: false,
  }),
  useDeleteAgentBoardItem: () => ({
    mutateAsync: mockDeleteAgentBoardItem,
    isPending: false,
  }),
  useMoveAgentBoardItem: () => ({ mutateAsync: vi.fn() }),
  useRefreshAgentBoardItems: () => ({ mutate: vi.fn() }),
}))

vi.mock('@/services/chat', () => ({
  useUnreadSessions: () => ({ data: mockUnreadSessions }),
}))

describe('AgentBoardView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUnreadSessions.entries = []
    item.lane = 'planned'
    item.worktree_id = 'worktree-1'
    item.planning_session_id = 'session-1'
    item.implementation_session_id = undefined
    item.yolo_worktree_id = undefined
    item.yolo_session_id = undefined
    item.pr_url = undefined
    item.active_run_status = undefined
    item.archived_at = undefined
    mockCreateAgentBoardItem.mockResolvedValue(undefined)
    mockDeleteAgentBoardItem.mockResolvedValue(undefined)
    Element.prototype.setPointerCapture = vi.fn()
    Element.prototype.releasePointerCapture = vi.fn()
    Element.prototype.hasPointerCapture = vi.fn(() => true)

    useUIStore.setState({ activeMainView: 'agent_board' })
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set(),
    })
    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: {},
      lastOpenedPerProject: {},
      worktreePaths: {},
    })
    mockInvoke.mockResolvedValue({
      id: 'worktree-1',
      project_id: project.id,
      name: 'Worktree',
      path: '/tmp/worktree',
      branch: 'worktree-1',
      created_at: 1,
      order: 0,
    } satisfies Worktree)
  })

  it('creates todos with the selected effort level', async () => {
    render(<AgentBoardView />)

    fireEvent.click(screen.getByRole('button', { name: /add todo/i }))
    fireEvent.change(screen.getByPlaceholderText('Describe the work...'), {
      target: { value: 'Investigate session effort' },
    })
    const effortSelect = screen.getAllByRole('combobox')[2]
    if (!effortSelect) {
      throw new Error('Expected effort select to render')
    }
    fireEvent.change(effortSelect, {
      target: { value: 'max' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(mockCreateAgentBoardItem).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Investigate session effort',
          project_id: project.id,
          backend: 'codex',
          effort_level: 'max',
        })
      )
    })
  })

  it('opens the associated workspace session when a card is clicked', async () => {
    render(<AgentBoardView />)

    const card = screen
      .getByText('Implement board navigation')
      .closest('[data-agent-board-item-id]')

    if (!card) {
      throw new Error('Expected agent board card to render')
    }
    fireEvent.pointerDown(card, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerUp(card, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    })

    await waitFor(() => {
      expect(useUIStore.getState().activeMainView).toBe('workspace')
      expect(useProjectsStore.getState().selectedProjectId).toBe(project.id)
      expect(useProjectsStore.getState().selectedWorktreeId).toBe('worktree-1')
      expect(useChatStore.getState().activeWorktreeId).toBe('worktree-1')
      expect(useChatStore.getState().activeWorktreePath).toBe('/tmp/worktree')
      expect(useChatStore.getState().activeSessionIds['worktree-1']).toBe(
        'session-1'
      )
      expect(useChatStore.getState().lastOpenedPerProject[project.id]).toEqual({
        worktreeId: 'worktree-1',
        sessionId: 'session-1',
      })
    })
  })

  it('refreshes a stale card before reporting that it has no session', async () => {
    item.worktree_id = undefined
    item.planning_session_id = undefined
    mockInvoke.mockImplementation(command => {
      if (command === 'refresh_agent_board_items') {
        return Promise.resolve([
          {
            ...item,
            worktree_id: 'worktree-1',
            planning_session_id: 'session-1',
          },
        ])
      }
      return Promise.resolve({
        id: 'worktree-1',
        project_id: project.id,
        name: 'Worktree',
        path: '/tmp/worktree',
        branch: 'worktree-1',
        created_at: 1,
        order: 0,
      } satisfies Worktree)
    })

    render(<AgentBoardView />)

    const card = screen
      .getByText('Implement board navigation')
      .closest('[data-agent-board-item-id]')

    if (!card) {
      throw new Error('Expected agent board card to render')
    }
    fireEvent.pointerDown(card, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    })
    fireEvent.pointerUp(card, {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('refresh_agent_board_items')
      expect(useChatStore.getState().activeSessionIds['worktree-1']).toBe(
        'session-1'
      )
    })
  })

  it('shows consolidated board columns', () => {
    render(<AgentBoardView />)

    for (const name of ['Todo', 'Plan', 'Implement', 'PR', 'Yolo', 'Archive']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    expect(
      screen.queryByRole('heading', { name: 'Planning' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Planned' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Implementing' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Implemented' })
    ).not.toBeInTheDocument()
  })

  it('shows a spinner for active work lanes', () => {
    item.lane = 'planning'

    render(<AgentBoardView />)

    expect(screen.getByLabelText('Work in progress')).toBeInTheDocument()
  })

  it('shows the PR URL directly when a card has an opened PR', () => {
    item.lane = 'pr_opened'
    item.pr_url = 'https://github.com/acme/repo/pull/123'

    render(<AgentBoardView />)

    expect(
      screen.getByRole('link', {
        name: 'https://github.com/acme/repo/pull/123',
      })
    ).toHaveAttribute('href', 'https://github.com/acme/repo/pull/123')
  })

  it('renders the lane selector as a compact non-clipping control', () => {
    render(<AgentBoardView />)

    expect(screen.getByRole('combobox')).toHaveClass('h-7', 'py-0', 'leading-7')
  })

  it('does not show a spinner when the associated session was cancelled', () => {
    item.lane = 'implementing'
    item.implementation_session_id = 'session-1'
    item.active_run_status = 'cancelled'

    render(<AgentBoardView />)

    expect(screen.queryByLabelText('Work in progress')).not.toBeInTheDocument()
  })

  it('shows delete instead of archive for archived cards and deletes the board item', async () => {
    item.lane = 'archived'
    item.archived_at = 2

    render(<AgentBoardView />)

    expect(screen.queryByLabelText('Archive card')).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Delete archived worktree'))

    await waitFor(() => {
      expect(mockDeleteAgentBoardItem).toHaveBeenCalledWith('item-1')
    })
  })

  it('flashes an item while its associated session is unread', () => {
    mockUnreadSessions.entries = [
      {
        session: {
          id: 'session-1',
          name: 'Session 1',
          order: 0,
          created_at: 1,
          updated_at: 2,
          messages: [],
          waiting_for_input: true,
          waiting_for_input_type: 'plan',
        },
        project_id: project.id,
        project_name: project.name,
        worktree_id: 'worktree-1',
        worktree_name: 'Worktree',
        worktree_path: '/tmp/worktree',
      },
    ]

    const { rerender } = render(<AgentBoardView />)

    const card = screen
      .getByText('Implement board navigation')
      .closest('[data-agent-board-item-id]')
    if (!card) {
      throw new Error('Expected agent board card to render')
    }
    expect(card).toHaveClass('animate-pulse')

    mockUnreadSessions.entries = []
    rerender(<AgentBoardView />)

    expect(card).not.toHaveClass('animate-pulse')
  })
})
