import { describe, expect, it } from 'vitest'
import type { ContentBlock, ToolCall } from '@/types/chat'
import { buildTimeline, coalesceContentBlocks } from './tool-call-utils'

describe('buildTimeline', () => {
  it('excludes FileChange tool calls from the inline timeline', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'file-change-1',
        name: 'FileChange',
        input: [{ path: 'src/foo.ts', kind: { type: 'update' }, diff: '' }],
      },
      {
        id: 'bash-1',
        name: 'Bash',
        input: { command: 'pwd' },
      },
    ]

    const contentBlocks: ContentBlock[] = [
      { type: 'tool_use', tool_call_id: 'file-change-1' },
      { type: 'tool_use', tool_call_id: 'bash-1' },
    ]

    const timeline = buildTimeline(contentBlocks, toolCalls)

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      type: 'standalone',
      tool: { id: 'bash-1', name: 'Bash' },
    })
  })

  it('filters collab tools out of the timeline', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'spawn-1',
        name: 'spawnAgent',
        input: {
          prompt: 'Inspect the API surface',
          receiver_thread_ids: ['agent-1'],
          agents_states: {
            'agent-1': { status: 'pendingInit', message: null },
          },
        },
      },
      {
        id: 'wait-1',
        name: 'WaitForAgents',
        input: {
          receiver_thread_ids: ['agent-1'],
        },
      },
    ]

    const contentBlocks: ContentBlock[] = [
      { type: 'tool_use', tool_call_id: 'spawn-1' },
      { type: 'tool_use', tool_call_id: 'wait-1' },
    ]

    const timeline = buildTimeline(contentBlocks, toolCalls)

    expect(timeline).toHaveLength(0)
  })

  it('renders native Codex request_user_input as an inline question card', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'question-1',
        name: 'request_user_input',
        input: {
          questions: [
            {
              question: 'Which path?',
              options: [{ label: 'A' }],
            },
          ],
        },
      },
    ]
    const contentBlocks: ContentBlock[] = [
      { type: 'text', text: 'I need a choice.' },
      { type: 'tool_use', tool_call_id: 'question-1' },
    ]

    const timeline = buildTimeline(contentBlocks, toolCalls)

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      type: 'askUserQuestion',
      introText: 'I need a choice.',
      tool: {
        id: 'question-1',
        input: {
          questions: [
            {
              id: '0',
              question: 'Which path?',
              options: [{ label: 'A', description: undefined }],
            },
          ],
        },
      },
    })
  })

  it('coalesces fragmented text deltas before rendering the timeline', () => {
    const contentBlocks: ContentBlock[] = [
      { type: 'text', text: 'Repo inspected.\n\n' },
      { type: 'text', text: 'Plan:\n- Implement changes' },
      { type: 'text', text: '\n- Add tests' },
    ]

    expect(coalesceContentBlocks(contentBlocks)).toEqual([
      {
        type: 'text',
        text: 'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
      },
    ])

    const timeline = buildTimeline(contentBlocks, [])

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      type: 'text',
      text: 'Repo inspected.\n\nPlan:\n- Implement changes\n- Add tests',
    })
  })

  it('preserves tool grouping when snapshot text is split into multiple deltas', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'task-1',
        name: 'Task',
        input: { description: 'Inspect code' },
      },
      {
        id: 'bash-1',
        name: 'Bash',
        input: { command: 'pwd' },
      },
      {
        id: 'read-1',
        name: 'Read',
        input: { file_path: 'src/App.tsx' },
      },
    ]

    const contentBlocks: ContentBlock[] = [
      { type: 'text', text: 'Starting' },
      { type: 'text', text: ' now' },
      { type: 'tool_use', tool_call_id: 'task-1' },
      { type: 'tool_use', tool_call_id: 'bash-1' },
      { type: 'tool_use', tool_call_id: 'read-1' },
    ]

    const timeline = buildTimeline(contentBlocks, toolCalls)

    expect(timeline).toHaveLength(2)
    expect(timeline[0]).toMatchObject({
      type: 'text',
      text: 'Starting now',
    })
    expect(timeline[1]).toMatchObject({
      type: 'task',
      taskTool: { id: 'task-1' },
    })
    expect(timeline[1]).toMatchObject({
      subTools: [{ id: 'bash-1' }, { id: 'read-1' }],
    })
  })
})
