import { fireEvent, render, screen } from '@/test/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolCallInline } from './ToolCallInline'

vi.mock('@/services/preferences', () => ({
  usePreferences: () => ({ data: undefined }),
}))

describe('ToolCallInline', () => {
  afterEach(() => {
    vi.restoreAllMocks()
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

  it('renders Codex file changes with the upstream inline diff view', () => {
    render(
      <ToolCallInline
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
    expect(screen.getByText('2 files')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('GenerateViewRequestIF.java')).toBeInTheDocument()
    expect(screen.getByText('DmsMetadataClient.java')).toBeInTheDocument()
    expect(screen.getByText('delete')).toBeInTheDocument()
    expect(screen.getByText('update')).toBeInTheDocument()
    expect(screen.queryByText(/"diff":/)).not.toBeInTheDocument()
  })

  it('renders a single Codex file-change detail using the filename', () => {
    render(
      <ToolCallInline
        worktreePath="/tmp/worktree"
        toolCall={{
          id: 'tool-relative-file-change',
          name: 'FileChange',
          input: [
            {
              path: '/tmp/worktree/src/DmsMetadataClient.java',
              kind: { type: 'update' },
              diff: '@@ -1,2 +1,2 @@\n line 1\n-line 2\n+line 3\n',
            },
          ],
        }}
      />
    )

    expect(screen.getByText('1 file')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /File Change/i }))

    expect(screen.getByText('DmsMetadataClient.java')).toBeInTheDocument()
    expect(screen.getByText('update')).toBeInTheDocument()
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
