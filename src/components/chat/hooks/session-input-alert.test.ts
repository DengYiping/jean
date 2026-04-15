import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { chatQueryKeys } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { preferencesQueryKeys } from '@/services/preferences'
import { DEFAULT_KEYBINDINGS, formatShortcutDisplay } from '@/types/keybindings'
import {
  showSessionPermissionRequestAlert,
  showSessionQuestionWaitingAlert,
} from './session-input-alert'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  useWsConnectionStatus: vi.fn(() => true),
}))

vi.mock('sonner', () => ({
  toast: {
    info: vi.fn(),
  },
}))

describe('showSessionQuestionWaitingAlert', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    queryClient.setQueryData(projectsQueryKeys.list(), [
      { id: 'project-1', name: 'Project Alpha' },
    ])
    queryClient.setQueryData(projectsQueryKeys.worktrees('project-1'), [
      { id: 'worktree-1', project_id: 'project-1', name: 'Feature Branch' },
    ])
    queryClient.setQueryData(chatQueryKeys.sessions('worktree-1'), {
      worktree_id: 'worktree-1',
      sessions: [{ id: 'session-1', name: 'Codex Session' }],
      active_session_id: 'session-1',
      version: 1,
    })
  })

  it('falls back to the default unread shortcut when preferences are missing', () => {
    showSessionQuestionWaitingAlert(queryClient, 'session-1', 'worktree-1')

    expect(toast.info).toHaveBeenCalledWith('Question waiting for input', {
      description: expect.stringContaining(
        `Project Alpha / Feature Branch / Codex Session is waiting for your answer. Open unread sessions with ${formatShortcutDisplay(DEFAULT_KEYBINDINGS.open_unread_sessions)}.`
      ),
      action: expect.objectContaining({
        label: 'Open Unread',
        onClick: expect.any(Function),
      }),
    })
  })

  it('dispatches the unread-sessions command when the toast action is clicked', () => {
    queryClient.setQueryData(preferencesQueryKeys.preferences(), {
      keybindings: {
        ...DEFAULT_KEYBINDINGS,
        open_unread_sessions: 'mod+alt+u',
      },
    })
    const eventSpy = vi.fn()
    window.addEventListener('command:open-unread-sessions', eventSpy)

    showSessionQuestionWaitingAlert(queryClient, 'session-1', 'worktree-1')

    const options = vi.mocked(toast.info).mock.calls[0]?.[1] as
      | { action?: { onClick?: () => void } }
      | undefined
    options?.action?.onClick?.()

    expect(eventSpy).toHaveBeenCalledTimes(1)

    window.removeEventListener('command:open-unread-sessions', eventSpy)
  })

  it('uses the same unread shortcut hint for permission requests', () => {
    showSessionPermissionRequestAlert(queryClient, 'session-1', 'worktree-1')

    expect(toast.info).toHaveBeenCalledWith('Permission needed', {
      description: expect.stringContaining(
        `Project Alpha / Feature Branch / Codex Session is waiting for your permission. Open unread sessions with ${formatShortcutDisplay(DEFAULT_KEYBINDINGS.open_unread_sessions)}.`
      ),
      action: expect.objectContaining({
        label: 'Open Unread',
        onClick: expect.any(Function),
      }),
    })
  })
})
