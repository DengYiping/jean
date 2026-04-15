import { useRef } from 'react'
import { fireEvent, render, screen } from '@/test/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FileChangeCard } from './FileChangeCard'

describe('FileChangeCard', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      (callback: FrameRequestCallback) =>
        setTimeout(() => callback(0), 0) as unknown as number
    )
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
      clearTimeout(frameId as unknown as ReturnType<typeof setTimeout>)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('renders a dedicated file-change summary card without undo actions', () => {
    render(
      <FileChangeCard
        worktreePath="/repo"
        toolCalls={[
          {
            id: 'file-change-1',
            name: 'FileChange',
            input: [
              {
                path: '/repo/src/components/chat/ToolCallInline.test.tsx',
                kind: { type: 'update' },
                diff: '@@ -1,2 +1,3 @@\n line 1\n-line 2\n+line 3\n+line 4\n',
              },
              {
                path: '/repo/src/components/chat/ToolCallInline.tsx',
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

  it('preserves the clicked file row position inside the inline viewport', async () => {
    vi.useFakeTimers()

    const timeoutIds = new Map<number, ReturnType<typeof setTimeout>>()
    let nextFrameId = 1
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const frameId = nextFrameId++
      const timeoutId = setTimeout(() => callback(0), 0)
      timeoutIds.set(frameId, timeoutId)
      return frameId
    })
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
      const timeoutId = timeoutIds.get(frameId)
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutIds.delete(frameId)
      }
    })

    function TestHarness() {
      const viewportRef = useRef<HTMLDivElement>(null)

      return (
        <div ref={viewportRef} data-testid="viewport">
          <FileChangeCard
            worktreePath="/repo"
            toolCalls={[
              {
                id: 'file-change-2',
                name: 'FileChange',
                input: [
                  {
                    path: '/repo/src/components/chat/FileChangeCard.tsx',
                    kind: { type: 'update' },
                    diff: '@@ -1,2 +1,3 @@\n line 1\n-line 2\n+line 3\n+line 4\n',
                  },
                ],
              },
            ]}
            viewportRef={viewportRef}
          />
        </div>
      )
    }

    render(<TestHarness />)

    const viewport = screen.getByTestId('viewport')

    Object.defineProperty(viewport, 'scrollTop', {
      value: 200,
      writable: true,
      configurable: true,
    })
    viewport.getBoundingClientRect = () =>
      ({
        top: 20,
        bottom: 420,
        left: 0,
        right: 0,
        width: 0,
        height: 400,
        x: 0,
        y: 20,
        toJSON: () => ({}),
      }) as DOMRect

    let relativeOffset = 0
    const rowButton = screen.getByTitle(
      '/repo/src/components/chat/FileChangeCard.tsx'
    )
    rowButton.getBoundingClientRect = () => {
      const top = 20 + 160 + relativeOffset - (viewport.scrollTop - 200)
      return {
        top,
        bottom: top + 24,
        left: 0,
        right: 0,
        width: 300,
        height: 24,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect
    }

    fireEvent.click(rowButton)
    relativeOffset = -50
    vi.runAllTimers()

    expect(viewport.scrollTop).toBe(150)
  })

  it('deduplicates repeated file rows and shows worktree-relative paths', () => {
    render(
      <FileChangeCard
        worktreePath="/repo"
        toolCalls={[
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
        ]}
      />
    )

    expect(screen.getByText('1 file changed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ChatInput\.tsx/i })).toHaveTextContent(
      'ChatInput.tsx'
    )
    expect(
      screen.queryByText('/repo/src/components/chat/ChatInput.tsx')
    ).not.toBeInTheDocument()
    expect(screen.getAllByText('+3')).toHaveLength(2)
    expect(screen.getAllByText('-2')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: /ChatInput\.tsx/i }))

    expect(screen.getByText('@@ -1,2 +1,2 @@')).toBeInTheDocument()
    expect(screen.getByText('@@ -10,2 +10,3 @@')).toBeInTheDocument()
  })
})
