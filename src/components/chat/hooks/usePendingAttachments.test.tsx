import { createRef } from 'react'
import { act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@/test/test-utils'
import { usePendingAttachments } from './usePendingAttachments'
import { useChatStore } from '@/store/chat-store'

vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
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

describe('usePendingAttachments', () => {
  beforeEach(() => {
    resetChatStore()
  })

  it('removes the inline skill token when a pending skill badge is removed', () => {
    const inputRef = createRef<HTMLTextAreaElement>()
    inputRef.current = document.createElement('textarea')
    inputRef.current.value = '$skill-creator add tests'

    useChatStore.setState({
      inputDrafts: {
        'session-1': '$skill-creator add tests',
      },
      pendingSkills: {
        'session-1': [
          {
            id: 'skill-1',
            name: 'skill-creator',
            path: '/tmp/skill-creator/SKILL.md',
          },
        ],
      },
    })

    const { result } = renderHook(() =>
      usePendingAttachments({
        activeSessionId: 'session-1',
        activeWorktreeId: 'worktree-1',
        activeWorktreePath: '/tmp/worktree',
        selectedModelRef: { current: 'gpt-5.4' },
        selectedProviderRef: { current: null },
        executionModeRef: { current: 'build' },
        selectedThinkingLevelRef: { current: 'think' },
        selectedEffortLevelRef: { current: 'medium' },
        useAdaptiveThinkingRef: { current: false },
        isCodexBackendRef: { current: true },
        mcpServersDataRef: { current: undefined },
        enabledMcpServersRef: { current: [] },
        selectedBackendRef: { current: 'codex' },
        inputRef,
        setInputDraft: useChatStore.getState().setInputDraft,
        sendMessageNow: vi.fn(),
      })
    )

    act(() => {
      result.current.handleRemovePendingSkill('skill-1')
    })

    expect(useChatStore.getState().inputDrafts['session-1']).toBe('add tests')
    expect(inputRef.current?.value).toBe('add tests')
    expect(useChatStore.getState().getPendingSkills('session-1')).toEqual([])
  })
})
