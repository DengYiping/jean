import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import { useChatStore } from '@/store/chat-store'
import { useProjectsStore } from '@/store/projects-store'
import { useTerminalStore } from '@/store/terminal-store'
import { useUIStore } from '@/store/ui-store'
import {
  addTerminalTabForShortcut,
  closeActiveTerminalTabForShortcut,
  getTerminalShortcutWorktreeId,
  switchActiveTerminalTabByIndexForShortcut,
  useMainWindowEventListeners,
} from './useMainWindowEventListeners'

const { mockInvoke, mockListen, mockDisposeTerminal } = vi.hoisted(() => ({
  mockInvoke: vi.fn().mockResolvedValue(undefined),
  mockListen: vi.fn().mockResolvedValue(() => undefined),
  mockDisposeTerminal: vi.fn(),
}))

vi.mock('@/lib/transport', () => ({
  invoke: mockInvoke,
  listen: mockListen,
}))

vi.mock('@/lib/terminal-instances', () => ({
  disposeTerminal: mockDisposeTerminal,
  startHeadless: vi.fn(),
}))

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))

vi.mock('./use-command-context', () => ({
  useCommandContext: () => ({
    openPreferences: vi.fn(),
  }),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

function focusTerminal() {
  document.body.innerHTML = ''

  const terminal = document.createElement('div')
  terminal.className = 'xterm'

  const input = document.createElement('textarea')
  terminal.appendChild(input)
  document.body.appendChild(terminal)

  input.focus()
  return input
}

describe('useMainWindowEventListeners terminal shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''

    useChatStore.setState({
      activeWorktreeId: null,
      activeWorktreePath: null,
      activeSessionIds: {},
      reviewResults: {},
      reviewSidebarVisible: false,
      fixedReviewFindings: {},
      worktreePaths: {},
      sendingSessionIds: {},
      sendStartedAt: {},
      waitingForInputSessionIds: {},
      sessionWorktreeMap: {},
      streamingContents: {},
      activeToolCalls: {},
      streamingContentBlocks: {},
      streamingThinkingContent: {},
      inputDrafts: {},
      executionModes: {},
      thinkingLevels: {},
      selectedModels: {},
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
      fixedFindings: {},
      streamingPlanApprovals: {},
      messageQueues: {},
      executingModes: {},
      approvedTools: {},
      pendingPermissionDenials: {},
      pendingCodexMcpElicitations: {},
      deniedMessageContext: {},
      lastCompaction: {},
      compactingSessions: {},
      reviewingSessions: {},
      sessionLabels: {},
      savingContext: {},
      skippedQuestionSessions: {},
    })

    useTerminalStore.setState({
      terminals: {},
      activeTerminalIds: {},
      runningTerminals: new Set(),
      terminalVisible: false,
      terminalPanelOpen: {},
      terminalHeight: 30,
      modalTerminalOpen: {},
      modalTerminalWidth: 400,
    })

    useUIStore.setState({
      sessionChatModalOpen: false,
      sessionChatModalWorktreeId: null,
      loadContextModalOpen: false,
      magicModalOpen: false,
      openInModalOpen: false,
      newWorktreeModalOpen: false,
      commandPaletteOpen: false,
      preferencesOpen: false,
      releaseNotesModalOpen: false,
      updatePrModalOpen: false,
      planDialogOpen: false,
      gitDiffModalOpen: false,
      githubDashboardOpen: false,
    })

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
  })

  it('does not resolve terminal shortcuts when the terminal is open but unfocused', () => {
    useChatStore.setState({ activeWorktreeId: 'canvas-worktree' })
    useTerminalStore.setState({
      terminalPanelOpen: { 'canvas-worktree': true },
      terminalVisible: true,
    })

    expect(getTerminalShortcutWorktreeId()).toBeNull()
  })

  it('resolves terminal shortcuts against the modal worktree', () => {
    focusTerminal()

    useChatStore.setState({ activeWorktreeId: 'canvas-worktree' })
    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'modal-worktree',
    })
    useTerminalStore.setState({
      modalTerminalOpen: { 'modal-worktree': true },
    })

    expect(getTerminalShortcutWorktreeId()).toBe('modal-worktree')
  })

  it('uses the terminal shortcut path to open a new terminal tab for the modal worktree', () => {
    focusTerminal()

    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'modal-worktree',
    })
    useTerminalStore.setState({
      terminals: {
        'modal-worktree': [
          {
            id: 'term-1',
            worktreeId: 'modal-worktree',
            command: null,
            label: 'Shell',
          },
        ],
      },
      activeTerminalIds: { 'modal-worktree': 'term-1' },
      modalTerminalOpen: { 'modal-worktree': true },
      terminalVisible: true,
    })

    expect(addTerminalTabForShortcut()).toBe(true)

    expect(
      useTerminalStore.getState().terminals['modal-worktree']
    ).toHaveLength(2)
  })

  it('uses the terminal shortcut path to close the active terminal tab for the modal worktree', () => {
    focusTerminal()

    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'modal-worktree',
    })
    useTerminalStore.setState({
      terminals: {
        'modal-worktree': [
          {
            id: 'term-1',
            worktreeId: 'modal-worktree',
            command: null,
            label: 'Shell',
          },
        ],
      },
      activeTerminalIds: { 'modal-worktree': 'term-1' },
      modalTerminalOpen: { 'modal-worktree': true },
      terminalVisible: true,
    })

    expect(closeActiveTerminalTabForShortcut()).toBe(true)

    expect(mockInvoke).toHaveBeenCalledWith('stop_terminal', {
      terminalId: 'term-1',
    })
    expect(mockDisposeTerminal).toHaveBeenCalledWith('term-1')
    expect(useTerminalStore.getState().terminals['modal-worktree']).toEqual([])
    expect(
      useTerminalStore.getState().modalTerminalOpen['modal-worktree']
    ).toBe(false)
  })

  it('switches the active terminal tab by index for the modal worktree', () => {
    focusTerminal()

    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'modal-worktree',
    })
    useTerminalStore.setState({
      terminals: {
        'modal-worktree': [
          {
            id: 'term-1',
            worktreeId: 'modal-worktree',
            command: null,
            label: 'Shell',
          },
          {
            id: 'term-2',
            worktreeId: 'modal-worktree',
            command: 'bun run dev',
            label: 'dev',
          },
        ],
      },
      activeTerminalIds: { 'modal-worktree': 'term-1' },
      modalTerminalOpen: { 'modal-worktree': true },
      terminalVisible: true,
    })

    expect(switchActiveTerminalTabByIndexForShortcut(1)).toBe(true)
    expect(
      useTerminalStore.getState().activeTerminalIds['modal-worktree']
    ).toBe('term-2')
  })

  it('consumes invalid terminal tab indexes without falling back to session switching', () => {
    focusTerminal()

    useUIStore.setState({
      sessionChatModalOpen: true,
      sessionChatModalWorktreeId: 'modal-worktree',
    })
    useTerminalStore.setState({
      terminals: {
        'modal-worktree': [
          {
            id: 'term-1',
            worktreeId: 'modal-worktree',
            command: null,
            label: 'Shell',
          },
        ],
      },
      activeTerminalIds: { 'modal-worktree': 'term-1' },
      modalTerminalOpen: { 'modal-worktree': true },
      terminalVisible: true,
    })

    expect(switchActiveTerminalTabByIndexForShortcut(8)).toBe(true)
    expect(
      useTerminalStore.getState().activeTerminalIds['modal-worktree']
    ).toBe('term-1')
  })

  it('opens the new project dialog when the shortcut is pressed', () => {
    renderHook(() => useMainWindowEventListeners(), {
      wrapper: createWrapper(),
    })

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'N',
        code: 'KeyN',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      })
    )

    expect(useProjectsStore.getState().addProjectDialogOpen).toBe(true)
  })

  it('does not retrigger the new project shortcut while the add-project flow is open', () => {
    const setAddProjectDialogOpen = vi.fn()
    useProjectsStore.setState({
      addProjectDialogOpen: true,
      setAddProjectDialogOpen,
    })

    renderHook(() => useMainWindowEventListeners(), {
      wrapper: createWrapper(),
    })

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'N',
        code: 'KeyN',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      })
    )

    expect(setAddProjectDialogOpen).not.toHaveBeenCalled()
  })
})
