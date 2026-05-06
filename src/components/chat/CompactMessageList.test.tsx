import { createRef, type RefObject } from 'react'
import { describe, expect, it, beforeEach, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import type {
  ChatMessage,
  Question,
  QuestionAnswer,
  ReviewFinding,
} from '@/types/chat'
import { CompactMessageList } from './CompactMessageList'

const { messageItemSpy } = vi.hoisted(() => ({
  messageItemSpy: vi.fn(),
}))

vi.mock('./MessageItem', () => ({
  MessageItem: (props: {
    message: ChatMessage
    approveButtonRef?: RefObject<HTMLButtonElement | null>
    pendingPlanMessageId?: string | null
    approvedPlanMessageIds?: ReadonlySet<string>
    onCustomBuildPrompt?: (messageId: string) => void
  }) => {
    messageItemSpy(props)
    return <div data-testid={`message-item-${props.message.id}`} />
  },
}))

function createMessages(): ChatMessage[] {
  return [
    {
      id: 'user-msg-1',
      session_id: 'session-1',
      role: 'user',
      content: 'Inspect the task',
      timestamp: 1,
      tool_calls: [],
      content_blocks: [],
      cancelled: false,
      plan_approved: false,
    },
    {
      id: 'plan-msg-1',
      session_id: 'session-1',
      role: 'assistant',
      content: '',
      timestamp: 2,
      tool_calls: [
        {
          id: 'plan-tool-1',
          name: 'ExitPlanMode',
          input: { plan: '- [ ] Validate compact mode' },
        },
      ],
      content_blocks: [],
      cancelled: false,
      plan_approved: false,
    },
  ]
}

const noopQuestionAnswer = (
  _toolCallId: string,
  _answers: QuestionAnswer[],
  _questions: Question[]
) => undefined

const noopFixFinding = async (_finding: ReviewFinding, _suggestion?: string) =>
  undefined

const noopFixAllFindings = async (
  _findings: { finding: ReviewFinding; suggestion?: string }[]
) => undefined

describe('CompactMessageList', () => {
  beforeEach(() => {
    messageItemSpy.mockClear()
  })

  it('passes fork plan approval props through to rendered plan messages', () => {
    const approveButtonRef = createRef<HTMLButtonElement>()
    const onCustomBuildPrompt = vi.fn()

    render(
      <CompactMessageList
        messages={createMessages()}
        scrollContainerRef={createRef<HTMLDivElement>()}
        totalMessages={2}
        pendingPlanMessageId="plan-msg-1"
        sessionId="session-1"
        worktreePath="/tmp/worktree"
        approveShortcut="Cmd+Enter"
        approveButtonRef={approveButtonRef}
        approvedPlanMessageIds={new Set(['plan-msg-1'])}
        isSending={false}
        onPlanApproval={vi.fn()}
        onCustomBuildPrompt={onCustomBuildPrompt}
        onPlanApprovalYolo={vi.fn()}
        onClearContextApproval={vi.fn()}
        onClearContextApprovalBuild={vi.fn()}
        onWorktreeBuildApproval={vi.fn()}
        onWorktreeYoloApproval={vi.fn()}
        onQuestionAnswer={noopQuestionAnswer}
        onQuestionSkip={vi.fn()}
        onFileClick={vi.fn()}
        onEditedFileClick={vi.fn()}
        onFixFinding={noopFixFinding}
        onFixAllFindings={noopFixAllFindings}
        isQuestionAnswered={vi.fn(() => false)}
        getSubmittedAnswers={vi.fn(() => undefined)}
        areQuestionsSkipped={vi.fn(() => false)}
        isFindingFixed={vi.fn(() => false)}
      />
    )

    expect(screen.getByTestId('message-item-plan-msg-1')).toBeInTheDocument()

    const planProps = messageItemSpy.mock.calls.find(
      ([props]) => props.message.id === 'plan-msg-1'
    )?.[0]
    const userProps = messageItemSpy.mock.calls.find(
      ([props]) => props.message.id === 'user-msg-1'
    )?.[0]

    expect(planProps).toMatchObject({
      pendingPlanMessageId: 'plan-msg-1',
      onCustomBuildPrompt,
    })
    expect(planProps?.approvedPlanMessageIds?.has('plan-msg-1')).toBe(true)
    expect(planProps?.approveButtonRef).toBe(approveButtonRef)
    expect(userProps?.approveButtonRef).toBeUndefined()
  })
})
