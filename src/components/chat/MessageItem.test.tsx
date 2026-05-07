import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { MessageItem } from './MessageItem'
import type {
  ChatMessage,
  Question,
  QuestionAnswer,
  ReviewFinding,
} from '@/types/chat'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: {} }),
}))

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

function createMultiEditMessage(): ChatMessage {
  return {
    id: 'edit-msg-1',
    session_id: 'session-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    tool_calls: [
      {
        id: 'edit-1',
        name: 'Edit',
        input: {
          file_path: '/tmp/worktree/src/components/ChatWindow.tsx',
          old_string: 'const before = true\n',
          new_string: 'const after = true\n',
        },
      },
      {
        id: 'edit-2',
        name: 'Edit',
        input: {
          file_path: '/tmp/worktree/src/components/ChatWindow.tsx',
          old_string: 'const first = 1\n',
          new_string: 'const second = 2\n',
        },
      },
    ],
    content_blocks: [
      { type: 'tool_use', tool_call_id: 'edit-1' },
      { type: 'tool_use', tool_call_id: 'edit-2' },
    ],
    cancelled: false,
    plan_approved: false,
  }
}

function createCodexFileChangeMessage(): ChatMessage {
  return {
    id: 'codex-file-change-msg-1',
    session_id: 'session-1',
    role: 'assistant',
    content: '',
    timestamp: 1,
    tool_calls: [
      {
        id: 'file-change-1',
        name: 'FileChange',
        input: [
          {
            path: '/tmp/worktree/src/components/ChatWindow.tsx',
            kind: { type: 'update' },
            diff: '@@ -1,1 +1,1 @@\n-before\n+after\n',
          },
        ],
      },
      {
        id: 'file-change-2',
        name: 'FileChange',
        input: [
          {
            path: '/tmp/worktree/src/components/ChatWindow.tsx',
            kind: { type: 'update' },
            diff: '@@ -5,1 +5,1 @@\n-first\n+second\n',
          },
        ],
      },
    ],
    content_blocks: [
      { type: 'tool_use', tool_call_id: 'file-change-1' },
      { type: 'tool_use', tool_call_id: 'file-change-2' },
    ],
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

  it('passes custom prompt actions through to the plan approval menu', () => {
    const onCustomBuildPrompt = vi.fn()

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
        isSending={false}
        onPlanApproval={vi.fn()}
        onCustomBuildPrompt={onCustomBuildPrompt}
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

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Approve options' })
    )
    fireEvent.click(screen.getByText('Custom Prompt...'))

    expect(onCustomBuildPrompt).toHaveBeenCalledWith('plan-msg-1')
  })

  it('keeps edited-file pills visible while a completed message replaces streaming state', () => {
    render(
      <MessageItem
        message={createMultiEditMessage()}
        messageIndex={0}
        totalMessages={1}
        pendingPlanMessageId={null}
        hasFollowUpMessage={false}
        sessionId="session-1"
        worktreePath="/tmp/worktree"
        approveShortcut="Cmd+Enter"
        isSending={true}
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

    expect(screen.getByText('Edited 1 file:')).toBeInTheDocument()
    expect(screen.getByText('ChatWindow.tsx')).toBeInTheDocument()
  })

  it('keeps Codex file-change summaries visible after streaming finishes', () => {
    render(
      <MessageItem
        message={createCodexFileChangeMessage()}
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

    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(screen.getAllByText('src/components/ChatWindow.tsx')).toHaveLength(2)
  })
})
