import { describe, expect, it } from 'vitest'
import type { ContentBlock, ToolCall } from '@/types/chat'
import { buildTimeline } from './tool-call-utils'

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
})
