import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { ChatInput } from './ChatInput'
import { useChatStore } from '@/store/chat-store'

vi.mock('@/hooks/use-mobile', () => ({
  useIsMobile: () => false,
}))

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
}))

vi.mock('@/services/skills', () => ({
  useSkills: () => ({
    data: [
      {
        name: 'skill-creator',
        path: '/tmp/skill-creator/SKILL.md',
        enabled: true,
      },
    ],
  }),
}))

vi.mock('./FileMentionPopover', () => ({
  FileMentionPopover: () => null,
}))

vi.mock('./SlashPopover', () => ({
  SlashPopover: ({
    onSelectSkill,
  }: {
    onSelectSkill: (skill: { id: string; name: string; path: string }) => void
  }) => (
    <button
      type="button"
      onClick={() =>
        onSelectSkill({
          id: 'skill-1',
          name: 'skill-creator',
          path: '/tmp/skill-creator/SKILL.md',
        })
      }
    >
      Select skill
    </button>
  ),
}))

function resetChatStore() {
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
    pendingSkills: {},
    pendingTextFiles: {},
    activeTodos: {},
    fixedFindings: {},
    streamingPlanApprovals: {},
    messageQueues: {},
    executingModes: {},
    approvedTools: {},
    pendingPermissionDenials: {},
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
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  Object.defineProperty(textarea, 'selectionStart', {
    configurable: true,
    value: value.length,
  })
  Object.defineProperty(textarea, 'selectionEnd', {
    configurable: true,
    value: value.length,
  })
  fireEvent.change(textarea, {
    target: {
      value,
    },
  })
}

describe('ChatInput skill sync', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    resetChatStore()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => null
    )
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(cb => {
      cb(0)
      return 0
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the selected skill token inline while adding pending skill state', async () => {
    const formRef = createRef<HTMLFormElement>()
    const inputRef = createRef<HTMLTextAreaElement>()

    render(
      <form ref={formRef}>
        <ChatInput
          activeSessionId="session-1"
          activeWorktreePath="/tmp/worktree"
          isSending={false}
          executionMode="build"
          focusChatShortcut="Cmd+L"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          backend="codex"
          formRef={formRef}
          inputRef={inputRef}
        />
      </form>
    )

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    setTextareaValue(textarea, '$')
    setTextareaValue(textarea, '$sk')

    fireEvent.click(screen.getByRole('button', { name: 'Select skill' }))

    await waitFor(() => {
      expect(textarea).toHaveValue('$skill-creator ')
    })

    expect(useChatStore.getState().getPendingSkills('session-1')).toEqual([
      {
        id: 'skill-1',
        name: 'skill-creator',
        path: '/tmp/skill-creator/SKILL.md',
      },
    ])
  })

  it('adds and removes pending skills when the inline token is edited', async () => {
    const formRef = createRef<HTMLFormElement>()
    const inputRef = createRef<HTMLTextAreaElement>()

    render(
      <form ref={formRef}>
        <ChatInput
          activeSessionId="session-1"
          activeWorktreePath="/tmp/worktree"
          isSending={false}
          executionMode="build"
          focusChatShortcut="Cmd+L"
          onSubmit={vi.fn()}
          onCancel={vi.fn()}
          backend="codex"
          formRef={formRef}
          inputRef={inputRef}
        />
      </form>
    )

    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement

    setTextareaValue(textarea, '$skill-creator ')

    await waitFor(() => {
      expect(
        useChatStore.getState().getPendingSkills('session-1')
      ).toHaveLength(1)
    })

    setTextareaValue(textarea, '')

    await waitFor(() => {
      expect(
        useChatStore.getState().getPendingSkills('session-1')
      ).toHaveLength(0)
    })
  })
})
