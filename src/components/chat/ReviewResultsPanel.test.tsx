import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@/test/test-utils'
import { useChatStore } from '@/store/chat-store'
import { ReviewResultsPanel } from './ReviewResultsPanel'
import type { ReviewResponse } from '@/types/projects'

let codeReviewFixMode = 'build'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: { code_review_fix_mode: codeReviewFixMode } }),
}))

const reviewResults: ReviewResponse = {
  summary: 'Found issues to fix.',
  approval_status: 'changes_requested',
  findings: [
    {
      severity: 'warning',
      file: 'src/example.ts',
      line: 12,
      title: 'Use the safer branch',
      description: 'The current branch can skip the required guard.',
      suggestion: 'Add the missing guard before mutating state.',
    },
  ],
}

describe('ReviewResultsPanel', () => {
  beforeEach(() => {
    codeReviewFixMode = 'build'
    useChatStore.setState({
      reviewResults: { 'session-1': reviewResults },
      fixedReviewFindings: {},
      reviewSidebarVisible: false,
    })
  })

  it('sends single-finding fixes in build mode by default', () => {
    const onSendFix = vi.fn()

    render(<ReviewResultsPanel sessionId="session-1" onSendFix={onSendFix} />)

    fireEvent.click(screen.getByText(/#1: Use the safer branch/i))
    fireEvent.click(screen.getByRole('button', { name: /^fix$/i }))

    expect(onSendFix).toHaveBeenCalledTimes(1)
    expect(onSendFix.mock.calls[0]?.[1]).toBe('build')
  })

  it('sends fix-all actions in build mode by default', () => {
    const onSendFix = vi.fn()

    render(<ReviewResultsPanel sessionId="session-1" onSendFix={onSendFix} />)

    fireEvent.click(screen.getByRole('button', { name: /fix all \(1\)/i }))

    expect(onSendFix).toHaveBeenCalledTimes(1)
    expect(onSendFix.mock.calls[0]?.[1]).toBe('build')
  })

  it('uses the configured mode for selected findings', () => {
    codeReviewFixMode = 'yolo'
    const onSendFix = vi.fn()

    render(<ReviewResultsPanel sessionId="session-1" onSendFix={onSendFix} />)

    fireEvent.click(
      screen.getByRole('button', { name: /send selected to chat/i })
    )

    expect(onSendFix.mock.calls[0]?.[1]).toBe('yolo')
  })
})
