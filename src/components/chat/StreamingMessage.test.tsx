import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@/test/test-utils'
import { StreamingMessage } from './StreamingMessage'
import type { QuestionAnswer, Question } from '@/types/chat'

describe('StreamingMessage', () => {
  const noopQuestionAnswer = (
    _toolCallId: string,
    _answers: QuestionAnswer[],
    _questions: Question[]
  ) => undefined

  const baseProps = {
    sessionId: 'session-1',
    worktreePath: '/tmp/worktree',
    contentBlocks: [],
    toolCalls: [],
    streamingContent: '',
    selectedThinkingLevel: 'think' as const,
    approveShortcut: 'Cmd+Enter',
    onQuestionAnswer: noopQuestionAnswer,
    onQuestionSkip: vi.fn(),
    onFileClick: vi.fn(),
    isQuestionAnswered: vi.fn(() => false),
    getSubmittedAnswers: vi.fn(() => undefined),
    areQuestionsSkipped: vi.fn(() => false),
    isStreamingPlanApproved: vi.fn(() => false),
    onStreamingPlanApproval: vi.fn(),
  }

  it('shows a response placeholder before the first streaming chunk arrives', () => {
    render(<StreamingMessage {...baseProps} />)

    expect(screen.getByTestId('streaming-response-placeholder')).toBeVisible()
  })

  it('hides the placeholder once streaming text is available', () => {
    render(
      <StreamingMessage {...baseProps} streamingContent="Working on it..." />
    )

    expect(
      screen.queryByTestId('streaming-response-placeholder')
    ).not.toBeInTheDocument()
    expect(screen.getByText('Working on it...')).toBeVisible()
  })

  it('shows plan approval controls for an ExitPlanMode tool', () => {
    render(
      <StreamingMessage
        {...baseProps}
        contentBlocks={[{ type: 'tool_use', tool_call_id: 'plan-1' }]}
        toolCalls={[
          {
            id: 'plan-1',
            name: 'ExitPlanMode',
            input: { plan: '- [ ] Investigate regression' },
          },
        ]}
      />
    )

    expect(screen.getByRole('button', { name: 'Approve' })).toBeVisible()
  })
})
