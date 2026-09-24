import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@/lib/transport'
import { chatQueryKeys } from '@/services/chat'
import { projectsQueryKeys } from '@/services/projects'
import { useChatStore } from '@/store/chat-store'
import type * as Environment from './environment'
import {
  buildSessionNotificationContent,
  notifyIfBackground,
  notifySessionEvent,
  summarizePreview,
} from './session-notifications'

const environment = vi.hoisted(() => ({ native: true }))

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  useWsConnectionStatus: vi.fn(),
}))

vi.mock('./environment', async importOriginal => ({
  ...(await importOriginal<typeof Environment>()),
  isNativeApp: () => environment.native,
}))

const target = {
  projectId: 'project-1',
  worktreeId: 'worktree-1',
  worktreePath: '/tmp/worktree-1',
  sessionId: 'session-1',
}

describe('notifyIfBackground', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    environment.native = true
    vi.mocked(invoke).mockResolvedValue(undefined)
  })

  it('lets the native backend decide whether the window is backgrounded', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)

    notifyIfBackground(
      { title: 'Session finished: Fix notifications', subtitle: 'jean › main' },
      target
    )

    expect(invoke).toHaveBeenCalledWith('send_native_notification', {
      title: 'Session finished: Fix notifications',
      subtitle: 'jean › main',
      body: undefined,
      backgroundOnly: true,
      target,
    })
  })

  it('does not invoke the desktop command in web access', () => {
    environment.native = false

    notifyIfBackground({ title: 'Session finished' })

    expect(invoke).not.toHaveBeenCalled()
  })
})

describe('buildSessionNotificationContent', () => {
  it('names the session, its location, and a response preview', () => {
    expect(
      buildSessionNotificationContent(
        'Session finished',
        {
          sessionName: 'Fix notifications',
          projectName: 'jean',
          worktreeName: 'keen-koala',
        },
        '## Done\n\nFixed the **click** handler.'
      )
    ).toEqual({
      title: 'Session finished: Fix notifications',
      subtitle: 'jean › keen-koala',
      body: 'Done Fixed the click handler.',
    })
  })

  it('falls back to the status when nothing else is known', () => {
    expect(buildSessionNotificationContent('Needs your input', {})).toEqual({
      title: 'Needs your input',
      subtitle: undefined,
      body: undefined,
    })
  })

  it('does not repeat identical project and worktree names', () => {
    expect(
      buildSessionNotificationContent('Session finished', {
        projectName: 'jean',
        worktreeName: 'jean',
      }).subtitle
    ).toBe('jean')
  })
})

describe('summarizePreview', () => {
  it('drops code blocks and truncates long responses', () => {
    const preview = summarizePreview(
      `Intro\n\`\`\`ts\nconst x = 1\n\`\`\`\n${'a'.repeat(300)}`
    )
    expect(preview.startsWith('Intro a')).toBe(true)
    expect(preview).not.toContain('const x')
    expect(preview.length).toBe(180)
    expect(preview.endsWith('…')).toBe(true)
  })
})

describe('notifySessionEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    environment.native = true
    vi.mocked(invoke).mockResolvedValue(undefined)
    useChatStore.setState({ sessionWorktreeMap: {}, worktreePaths: {} })
  })

  it('resolves details and the click target from cached queries', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData(chatQueryKeys.sessions('worktree-1'), {
      worktree_id: 'worktree-1',
      sessions: [{ id: 'session-1', name: 'Fix notifications' }],
      active_session_id: null,
    })
    queryClient.setQueryData(projectsQueryKeys.worktrees('project-1'), [
      {
        id: 'worktree-1',
        project_id: 'project-1',
        name: 'keen-koala',
        path: '/tmp/worktree-1',
      },
    ])
    queryClient.setQueryData(projectsQueryKeys.list(), [
      { id: 'project-1', name: 'jean' },
    ])

    await notifySessionEvent(
      queryClient,
      'session-1',
      'Session finished',
      'All done'
    )

    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('send_native_notification', {
      title: 'Session finished: Fix notifications',
      subtitle: 'jean › keen-koala',
      body: 'All done',
      backgroundOnly: true,
      target,
    })
  })

  it('falls back to the backend session index when caches are cold', async () => {
    vi.mocked(invoke).mockImplementation(async command =>
      command === 'list_all_sessions'
        ? {
            entries: [
              {
                project_id: 'project-1',
                project_name: 'jean',
                worktree_id: 'worktree-1',
                worktree_name: 'keen-koala',
                worktree_path: '/tmp/worktree-1',
                sessions: [{ id: 'session-1', name: 'Fix notifications' }],
              },
            ],
          }
        : undefined
    )

    await notifySessionEvent(new QueryClient(), 'session-1', 'Needs your input')

    expect(invoke).toHaveBeenCalledWith('send_native_notification', {
      title: 'Needs your input: Fix notifications',
      subtitle: 'jean › keen-koala',
      body: undefined,
      backgroundOnly: true,
      target,
    })
  })
})
