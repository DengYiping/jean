import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useUIStore } from '@/store/ui-store'

export interface WorkspaceSessionTarget {
  projectId: string
  worktreeId: string
  worktreePath: string
  sessionId: string
}

export function openWorkspaceView(options?: { reopenSessionModal?: boolean }) {
  const uiStore = useUIStore.getState()

  if (options?.reopenSessionModal) {
    const chatStore = useChatStore.getState()
    const worktreeId = uiStore.sessionChatModalWorktreeId
    const sessionId = worktreeId
      ? chatStore.activeSessionIds[worktreeId]
      : undefined

    if (
      uiStore.sessionChatModalOpen &&
      worktreeId &&
      sessionId &&
      !chatStore.activeWorktreePath
    ) {
      uiStore.markWorktreeForAutoOpenSession(worktreeId, sessionId)
    }
  }

  uiStore.setActiveMainView('workspace')
}

export function openWorkspaceSession(target: WorkspaceSessionTarget) {
  const projectsStore = useProjectsStore.getState()
  const chatStore = useChatStore.getState()
  const uiStore = useUIStore.getState()

  projectsStore.selectProject(target.projectId)
  projectsStore.selectWorktree(target.worktreeId)
  chatStore.clearActiveWorktree()
  chatStore.setActiveSession(target.worktreeId, target.sessionId)
  chatStore.setLastOpenedForProject(
    target.projectId,
    target.worktreeId,
    target.sessionId
  )
  uiStore.markWorktreeForAutoOpenSession(target.worktreeId, target.sessionId)
  uiStore.setActiveMainView('workspace')

  setTimeout(() => {
    window.dispatchEvent(
      new CustomEvent('open-session-modal', {
        detail: {
          projectId: target.projectId,
          sessionId: target.sessionId,
          worktreeId: target.worktreeId,
          worktreePath: target.worktreePath,
        },
      })
    )
  }, 50)
}
