import { fireEvent, render, screen } from '@/test/test-utils'
import { describe, expect, it } from 'vitest'
import { FileChangeCard } from './FileChangeCard'

describe('FileChangeCard', () => {
  it('renders a dedicated file-change summary card without undo actions', () => {
    render(
      <FileChangeCard
        toolCalls={[
          {
            id: 'file-change-1',
            name: 'FileChange',
            input: [
              {
                path: 'src/components/chat/ToolCallInline.test.tsx',
                kind: { type: 'update' },
                diff: '@@ -1,2 +1,3 @@\n line 1\n-line 2\n+line 3\n+line 4\n',
              },
              {
                path: 'src/components/chat/ToolCallInline.tsx',
                kind: { type: 'delete' },
                diff: 'line a\nline b\n',
              },
            ],
          },
        ]}
      />
    )

    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument()
    expect(screen.getByText('D')).toBeInTheDocument()
    expect(screen.queryByText('Undo')).not.toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', {
        name: /ToolCallInline\.test\.tsx/i,
      })
    )

    expect(screen.getByText('@@ -1,2 +1,3 @@')).toBeInTheDocument()
    expect(screen.getByText('line 4')).toBeInTheDocument()
  })
})
