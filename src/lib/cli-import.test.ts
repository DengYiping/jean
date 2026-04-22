import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { applyCliImportNavigation } from './cli-import'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { projectsQueryKeys } from '@/services/projects'
import type { CliImportedProjectResult } from '@/types/projects'

describe('applyCliImportNavigation', () => {
  beforeEach(() => {
    useProjectsStore.setState({
      selectedProjectId: null,
      selectedWorktreeId: null,
      expandedProjectIds: new Set(),
      expandedWorktreeIds: new Set(),
      dashboardWorktreeCollapseOverrides: {},
      expandedFolderIds: new Set(),
      projectAccessTimestamps: {},
      projectCanvasSettings: {},
      addProjectDialogOpen: false,
      addProjectParentFolderId: null,
      projectSettingsDialogOpen: false,
      projectSettingsProjectId: null,
      projectSettingsInitialPane: null,
      gitInitModalOpen: false,
      gitInitModalPath: null,
      cloneModalOpen: false,
      jeanConfigWizardOpen: false,
      jeanConfigWizardProjectId: null,
      editingFolderId: null,
    })

    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
      lastActiveWorktreeId: null,
      lastOpenedPerProject: {},
      activeSessionIds: {},
      reviewResults: {},
      reviewSidebarVisible: false,
      fixedReviewFindings: {},
      tableCheckedRows: {},
      worktreePaths: {},
      sendingSessionIds: {},
      sendStartedAt: {},
      completedDurations: {},
      userInitiatedSessionIds: {},
      waitingForInputSessionIds: {},
      sessionWorktreeMap: {},
      streamingContents: {},
      activeToolCalls: {},
      streamingContentBlocks: {},
      streamingThinkingContent: {},
      inputDrafts: {},
      executionModes: {},
      thinkingLevels: {},
      effortLevels: {},
      selectedBackends: {},
      selectedModels: {},
      selectedProviders: {},
      enabledMcpServers: {},
      parallelExecutionPromptEnabledBySession: {},
      answeredQuestions: {},
      submittedAnswers: {},
      errors: {},
      lastSentMessages: {},
      lastSentAttachments: {},
      setupScriptResults: {},
      pendingImages: {},
      pendingFiles: {},
      pendingSkills: {},
      pendingTextFiles: {},
      activeTodos: {},
      streamingPlanApprovals: {},
      messageQueues: {},
      executingModes: {},
      approvedTools: {},
      pendingPermissionDenials: {},
      pendingCodexMcpElicitations: {},
      deniedMessageContext: {},
      lastCompaction: {},
      threadTokenUsage: {},
      compactingSessions: {},
      reviewingSessions: {},
      planFilePaths: {},
      pendingPlanMessageIds: {},
      savingContext: {},
      skippedQuestionSessions: {},
      pendingDigestSessionIds: {},
      sessionDigests: {},
      worktreeLoadingOperations: {},
      sessionLabels: {},
      pendingMagicCommand: null,
    })

    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'old-worktree',
    })
  })

  it('selects the project and opens the imported base session in the main chat view', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })
    const result: CliImportedProjectResult = {
      project: {
        id: 'project-1',
        name: 'repo',
        path: '/tmp/repo',
        default_branch: 'main',
        added_at: 1,
        order: 0,
      },
      worktree: {
        id: 'worktree-1',
        project_id: 'project-1',
        name: 'Base',
        path: '/tmp/repo',
        branch: 'main',
        created_at: 1,
        order: 0,
        session_type: 'base',
      },
      session_id: 'session-1',
      created: true,
    }

    applyCliImportNavigation(queryClient, result)

    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('worktree-1')
    expect(useChatStore.getState().activeWorktreeId).toBe('worktree-1')
    expect(useChatStore.getState().activeWorktreePath).toBe('/tmp/repo')
    expect(useChatStore.getState().getActiveSession('worktree-1')).toBe(
      'session-1'
    )
    expect(useChatStore.getState().lastOpenedPerProject['project-1']).toEqual({
      worktreeId: 'worktree-1',
      sessionId: 'session-1',
    })
    expect(useUIStore.getState().sessionChatModalOpen).toBe(false)
    expect(queryClient.getQueryData(projectsQueryKeys.list())).toEqual([
      result.project,
    ])
  })
})
