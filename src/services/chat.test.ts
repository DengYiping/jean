import { describe, expect, it } from 'vitest'
import {
  formatAnswersAsNaturalLanguage,
  formatAnswersForCodexRequestUserInput,
} from './chat'
import type { Question } from '@/types/chat'

describe('chat answer formatting', () => {
  it('formats Claude answers as natural language', () => {
    const questions: Question[] = [
      {
        id: 'focus',
        question: 'What should I focus on?',
        multiSelect: false,
        options: [
          { label: 'Frontend' },
          { label: 'Backend' },
        ],
      },
    ]

    expect(
      formatAnswersAsNaturalLanguage(questions, [
        {
          questionIndex: 0,
          selectedOptions: [1],
          customText: 'Start with the transport layer.',
        },
      ])
    ).toContain('Backend')
  })

  it('formats Codex option answers with an other-note payload', () => {
    const questions: Question[] = [
      {
        id: 'q1',
        header: 'Scope',
        question: 'Pick one',
        multiSelect: false,
        isOther: true,
        options: [{ label: 'UI', description: 'Frontend work' }],
      },
    ]

    expect(
      formatAnswersForCodexRequestUserInput(questions, [
        {
          questionIndex: 0,
          selectedOptions: [],
          customText: 'CLI plumbing',
        },
      ])
    ).toEqual({
      q1: {
        answers: ['None of the above', 'user_note: CLI plumbing'],
      },
    })
  })

  it('formats Codex freeform answers and preserves unanswered questions', () => {
    const questions: Question[] = [
      {
        id: 'path',
        question: 'Enter a path',
        multiSelect: false,
        options: [],
      },
      {
        id: 'confirm',
        question: 'Confirm the approach',
        multiSelect: false,
        options: [{ label: 'Yes' }, { label: 'No' }],
      },
    ]

    expect(
      formatAnswersForCodexRequestUserInput(questions, [
        {
          questionIndex: 0,
          selectedOptions: [],
          customText: '/tmp/output.txt',
        },
      ])
    ).toEqual({
      path: {
        answers: ['/tmp/output.txt'],
      },
      confirm: {
        answers: [],
      },
    })
  })
})
