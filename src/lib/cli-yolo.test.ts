import { beforeEach, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  applyCliYoloNavigation,
  resolveCliYoloExecutionConfig,
} from './cli-yolo'
import { useProjectsStore } from '@/store/projects-store'
import { useChatStore } from '@/store/chat-store'
import { useUIStore } from '@/store/ui-store'
import { projectsQueryKeys } from '@/services/projects'
import { chatQueryKeys } from '@/services/chat'
import { defaultPreferences } from '@/types/preferences'
import type { CliYoloSessionResult } from '@/types/projects'

describe('cli yolo helpers', () => {
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
      draftSkillBindings: {},
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

  it('navigates to the prepared base session in the session modal and primes the cache', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    })

    const result: CliYoloSessionResult = {
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
        name: 'main',
        path: '/tmp/repo',
        branch: 'main',
        created_at: 1,
        order: 0,
        session_type: 'base',
      },
      session: {
        id: 'session-1',
        name: 'Session 1',
        order: 0,
        created_at: 1,
        updated_at: 1,
        messages: [],
        backend: 'codex',
      },
      prompt: 'tell me about Iceberg',
    }

    applyCliYoloNavigation(queryClient, result)

    expect(useProjectsStore.getState().selectedProjectId).toBe('project-1')
    expect(useProjectsStore.getState().selectedWorktreeId).toBe('worktree-1')
    expect(useChatStore.getState().activeWorktreeId).toBeNull()
    expect(useChatStore.getState().activeWorktreePath).toBeNull()
    expect(useChatStore.getState().getActiveSession('worktree-1')).toBe(
      'session-1'
    )
    expect(useChatStore.getState().worktreePaths['worktree-1']).toBe(
      '/tmp/repo'
    )
    expect(useChatStore.getState().lastOpenedPerProject['project-1']).toEqual({
      worktreeId: 'worktree-1',
      sessionId: 'session-1',
    })
    expect(queryClient.getQueryData(projectsQueryKeys.list())).toEqual([
      result.project,
    ])
    expect(
      queryClient.getQueryData(chatQueryKeys.session(result.session.id))
    ).toEqual(result.session)
    expect(
      queryClient.getQueryData(chatQueryKeys.sessions('worktree-1'))
    ).toEqual({
      worktree_id: 'worktree-1',
      sessions: [result.session],
      active_session_id: 'session-1',
      default_model: undefined,
      version: 2,
      branch_naming_completed: undefined,
    })
    expect(
      useUIStore.getState().autoOpenSessionWorktreeIds.has('worktree-1')
    ).toBe(true)
    expect(useUIStore.getState().pendingAutoOpenSessionIds['worktree-1']).toBe(
      'session-1'
    )
    expect(useUIStore.getState().sessionChatModalOpen).toBe(true)
    expect(useUIStore.getState().sessionChatModalWorktreeId).toBe(
      'old-worktree'
    )
  })

  it('resolves yolo overrides before falling back to backend defaults', () => {
    const config = resolveCliYoloExecutionConfig({
      sessionBackend: 'claude',
      preferences: {
        ...defaultPreferences,
        default_provider: 'OpenRouter',
        yolo_backend: 'codex',
        yolo_model: 'gpt-5.4-mini',
        yolo_thinking_level: 'high',
        yolo_effort_level: 'xhigh',
      },
      projectDefaultProvider: null,
    })

    expect(config.backend).toBe('codex')
    expect(config.model).toBe('gpt-5.4-mini')
    expect(config.provider).toBe('OpenRouter')
    expect(config.thinkingLevel).toBe('off')
    expect(config.effortLevel).toBe('max')
  })

  it('falls back to the project provider and backend-aware defaults', () => {
    const config = resolveCliYoloExecutionConfig({
      sessionBackend: 'opencode',
      preferences: defaultPreferences,
      projectDefaultProvider: 'Project Profile',
    })

    expect(config.backend).toBe('opencode')
    expect(config.model).toBe(defaultPreferences.selected_opencode_model)
    expect(config.provider).toBe('Project Profile')
    expect(config.thinkingLevel).toBe(defaultPreferences.thinking_level)
    expect(config.effortLevel).toBeUndefined()
  })
})
