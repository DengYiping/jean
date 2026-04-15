import { describe, expect, it } from 'vitest'
import type { ToolCall } from '@/types/chat'
import {
  collectFileChanges,
  computeDisplayNames,
  getFileChangeTotals,
} from './file-change-utils'

describe('file-change-utils', () => {
  it('merges repeated file changes for the same normalized path', () => {
    const toolCalls: ToolCall[] = [
      {
        id: 'file-change-1',
        name: 'FileChange',
        input: [
          {
            path: '/repo/src/components/chat/ChatInput.tsx',
            kind: { type: 'update' },
            diff: '@@ -1,2 +1,2 @@\n line 1\n-line 2\n+line 3\n',
          },
        ],
      },
      {
        id: 'file-change-2',
        name: 'FileChange',
        input: [
          {
            path: '/repo/src/components/chat/ChatInput.tsx',
            kind: { type: 'update' },
            diff: '@@ -10,2 +10,3 @@\n line 10\n-line 11\n+line 12\n+line 13\n',
          },
        ],
      },
    ]

    const changes = collectFileChanges(toolCalls)

    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({
      path: '/repo/src/components/chat/ChatInput.tsx',
      added: 3,
      removed: 2,
    })
    expect(changes[0]?.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'hunk', text: '@@ -1,2 +1,2 @@' }),
        expect.objectContaining({ kind: 'hunk', text: '@@ -10,2 +10,3 @@' }),
      ])
    )
    expect(getFileChangeTotals(changes)).toEqual({ added: 3, removed: 2 })
  })

  it('builds worktree-relative display names and keeps out-of-tree paths absolute', () => {
    const displayNames = computeDisplayNames(
      [
        '/repo/src/components/chat/ChatInput.tsx',
        '/repo/src/lib/ChatInput.tsx',
        '/outside/ChatInput.tsx',
      ],
      '/repo'
    )

    expect(displayNames.get('/repo/src/components/chat/ChatInput.tsx')).toBe(
      '…/chat/ChatInput.tsx'
    )
    expect(displayNames.get('/repo/src/lib/ChatInput.tsx')).toBe(
      '…/lib/ChatInput.tsx'
    )
    expect(displayNames.get('/outside/ChatInput.tsx')).toBe(
      '/outside/ChatInput.tsx'
    )
  })
})
