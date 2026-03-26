import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { MessageItem } from './MessageItem'
import type {
  ChatMessage,
  Question,
  QuestionAnswer,
  ReviewFinding,
} from '@/types/chat'

function createPlanMessage(): ChatMessage {
  return {
    id: 'plan-msg-1',
    session_id: 'session-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    tool_calls: [
      { id: 'tool-1', name: 'ExitPlanMode', input: { plan: '- [ ] Test' } },
    ],
    content_blocks: [],
    cancelled: false,
    plan_approved: false,
  }
}

function createQuestionAndPlanMessage(): ChatMessage {
  return {
    id: 'plan-msg-1',
    session_id: 'session-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    tool_calls: [
      {
        id: 'question-1',
        name: 'AskUserQuestion',
        input: {
          questions: [
            {
              question: 'Which path?',
              options: [{ label: 'Option A', description: 'Use option A' }],
            },
          ],
        },
      },
      { id: 'tool-1', name: 'ExitPlanMode', input: { plan: '- [ ] Test' } },
    ],
    content_blocks: [],
    cancelled: false,
    plan_approved: false,
  }
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

describe('MessageItem', () => {
  it('hides the inline approve button for persisted approved plan IDs', () => {
    render(
      <MessageItem
        message={createPlanMessage()}
        messageIndex={0}
        totalMessages={1}
        pendingPlanMessageId="plan-msg-1"
        hasFollowUpMessage={false}
        sessionId="session-1"
        worktreePath="/tmp/worktree"
        approveShortcut="Cmd+Enter"
        approvedPlanMessageIds={new Set(['plan-msg-1'])}
        isSending={false}
        onPlanApproval={vi.fn()}
        onPlanApprovalYolo={vi.fn()}
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

    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
  })

  it('shows approve when mixed-message questions are already answered', () => {
    render(
      <MessageItem
        message={createQuestionAndPlanMessage()}
        messageIndex={0}
        totalMessages={1}
        pendingPlanMessageId="plan-msg-1"
        hasFollowUpMessage={false}
        sessionId="session-1"
        worktreePath="/tmp/worktree"
        approveShortcut="Cmd+Enter"
        isSending={false}
        onPlanApproval={vi.fn()}
        onPlanApprovalYolo={vi.fn()}
        onQuestionAnswer={noopQuestionAnswer}
        onQuestionSkip={vi.fn()}
        onFileClick={vi.fn()}
        onEditedFileClick={vi.fn()}
        onFixFinding={noopFixFinding}
        onFixAllFindings={noopFixAllFindings}
        isQuestionAnswered={vi.fn(
          (_sessionId, toolCallId) => toolCallId === 'question-1'
        )}
        getSubmittedAnswers={vi.fn(() => [
          { questionIndex: 0, selectedOptions: [0] },
        ])}
        areQuestionsSkipped={vi.fn(() => false)}
        isFindingFixed={vi.fn(() => false)}
      />
    )

    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
  })

  it('hides approve for stale plan history when no plan is pending', () => {
    render(
      <MessageItem
        message={createPlanMessage()}
        messageIndex={0}
        totalMessages={1}
        pendingPlanMessageId={null}
        hasFollowUpMessage={false}
        sessionId="session-1"
        worktreePath="/tmp/worktree"
        approveShortcut="Cmd+Enter"
        isSending={false}
        onPlanApproval={vi.fn()}
        onPlanApprovalYolo={vi.fn()}
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

    expect(
      screen.queryByRole('button', { name: 'Approve' })
    ).not.toBeInTheDocument()
  })
})
