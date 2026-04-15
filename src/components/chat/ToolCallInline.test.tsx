import { useRef } from 'react'
import { fireEvent, render, screen } from '@/test/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolCallInline } from './ToolCallInline'

describe('ToolCallInline', () => {
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

  it('renders OpenCode ToolSearch calls without the unhandled fallback', () => {
    render(
      <ToolCallInline
        toolCall={{
          id: 'tool-1',
          name: 'ToolSearch',
          input: {
            query: 'selectExitPlanMode',
            max_results: 1,
          },
        }}
      />
    )

    expect(screen.getByText('Tool Search')).toBeInTheDocument()
    expect(screen.getByText('selectExitPlanMode')).toBeInTheDocument()
    expect(screen.queryByText(/unhandled tool/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    const expandedContent = screen.getByText((_, element) =>
      Boolean(
        element?.classList.contains('whitespace-pre-wrap') &&
        element.textContent === 'Query: selectExitPlanMode\nMax results: 1'
      )
    )

    expect(expandedContent).toBeInTheDocument()
  })

  it('renders Codex file changes as parsed diffs with line counts', () => {
    render(
      <ToolCallInline
        worktreePath="/tmp"
        toolCall={{
          id: 'tool-2',
          name: 'FileChange',
          input: [
            {
              path: '/tmp/GenerateViewRequestIF.java',
              kind: { type: 'delete' },
              diff: 'line 1\nline 2\n',
            },
            {
              path: '/tmp/DmsMetadataClient.java',
              kind: { type: 'update' },
              diff: '@@ -1,2 +1,2 @@\n line 1\n-line 2\n+line 3\n',
            },
          ],
        }}
      />
    )

    expect(screen.getByText('File Change')).toBeInTheDocument()
    expect(screen.getByText('2 files (+1/-3)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('2 files changed')).toBeInTheDocument()
    expect(screen.getByText('D')).toBeInTheDocument()
    expect(screen.getByText('M')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: /GenerateViewRequestIF\.java/i })
    )

    fireEvent.click(
      screen.getByRole('button', { name: /DmsMetadataClient\.java/i })
    )
    expect(screen.getByText('@@ -1,2 +1,2 @@')).toBeInTheDocument()
    expect(screen.getByText('line 3')).toBeInTheDocument()
    expect(screen.queryByText(/"diff":/)).not.toBeInTheDocument()
  })

  it('threads the chat viewport ref into inline file-change expansion', async () => {
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
          <ToolCallInline
            worktreePath="/tmp"
            viewportRef={viewportRef}
            toolCall={{
              id: 'tool-viewport',
              name: 'FileChange',
              input: [
                {
                  path: '/tmp/DmsMetadataClient.java',
                  kind: { type: 'update' },
                  diff: '@@ -1,2 +1,2 @@\n line 1\n-line 2\n+line 3\n',
                },
              ],
            }}
          />
        </div>
      )
    }

    render(<TestHarness />)

    fireEvent.click(screen.getByRole('button', { name: /File Change/i }))

    const viewport = screen.getByTestId('viewport')

    Object.defineProperty(viewport, 'scrollTop', {
      value: 300,
      writable: true,
      configurable: true,
    })
    viewport.getBoundingClientRect = () =>
      ({
        top: 40,
        bottom: 440,
        left: 0,
        right: 0,
        width: 0,
        height: 400,
        x: 0,
        y: 40,
        toJSON: () => ({}),
      }) as DOMRect

    let relativeOffset = 0
    const rowButton = screen.getByTitle('/tmp/DmsMetadataClient.java')
    rowButton.getBoundingClientRect = () => {
      const top = 40 + 170 + relativeOffset - (viewport.scrollTop - 300)
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
    relativeOffset = -60
    vi.runAllTimers()

    expect(viewport.scrollTop).toBe(240)
  })

  it('renders Bash output in a terminal-style block and strips terminal control sequences', () => {
    render(
      <ToolCallInline
        toolCall={{
          id: 'tool-3',
          name: 'Bash',
          input: {
            command: 'git status --short',
            description: 'Check repo status',
          },
          output: 'loading\rready\n\u001b[32msuccess\u001b[0m',
        }}
      />
    )

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Check repo status')).toBeInTheDocument()
    expect(screen.getAllByText('git status --short')).toHaveLength(2)
    expect(
      screen.getByText(
        (_, element) => element?.textContent === 'ready\nsuccess'
      )
    ).toBeInTheDocument()
    expect(screen.queryByText('loading')).not.toBeInTheDocument()
    expect(screen.queryByText('Output:')).not.toBeInTheDocument()
  })

  it('renders spawnAgent calls with structured agent status instead of raw output', () => {
    render(
      <ToolCallInline
        toolCall={{
          id: 'tool-4',
          name: 'spawnAgent',
          input: {
            agents_states: {
              '019ce313-f81b-76a0-ae2e-831ce6cc72f9': {
                message: null,
                status: 'pendingInit',
              },
            },
            prompt:
              'Explore the repository at /Users/ydeng/jean/ml-opt-out/vast-camel.',
            receiver_thread_ids: ['019ce313-f81b-76a0-ae2e-831ce6cc72f9'],
            sender_thread_id: '019ce313-ad50-7ab2-8ec5-60bda25bb737',
            status: 'completed',
            tool: 'spawnAgent',
            type: 'collab_tool_call',
          },
          output: '019ce313-f81b-76a0-ae2e-831ce6cc72f9: pendingInit',
        }}
      />
    )

    expect(screen.getByText('Spawn Agent')).toBeInTheDocument()
    expect(screen.getByText('1 agent')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(
      screen.getByText(
        'Explore the repository at /Users/ydeng/jean/ml-opt-out/vast-camel.'
      )
    ).toBeInTheDocument()
    expect(
      screen.getByText('019ce313-f81b-76a0-ae2e-831ce6cc72f9')
    ).toBeInTheDocument()
    expect(screen.getByText('Starting')).toBeInTheDocument()
    expect(screen.queryByText('Output:')).not.toBeInTheDocument()
    expect(
      screen.queryByText('019ce313-f81b-76a0-ae2e-831ce6cc72f9: pendingInit')
    ).not.toBeInTheDocument()
  })
})
