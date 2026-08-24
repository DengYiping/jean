import { fireEvent, render, screen } from '@/test/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskCallInline, ToolCallInline } from './ToolCallInline'

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

  it('renders Claude code-review findings without the unhandled fallback', () => {
    render(
      <ToolCallInline
        toolCall={{
          id: 'tool-report-findings-1',
          name: 'ReportFindings',
          input: {
            findings: [
              {
                file: 'src/example.ts',
                line: 42,
                category: 'correctness',
                summary: 'The request can fail silently.',
              },
              {
                file: 'src/other.ts',
                line: 10,
                category: 'testing',
                summary: 'The failure path has no test.',
              },
            ],
          },
        }}
      />
    )

    expect(screen.getByText('Report Findings')).toBeInTheDocument()
    expect(screen.getByText('2 findings')).toBeInTheDocument()
    expect(screen.queryByText(/unhandled tool/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(
      screen.getByText(/The request can fail silently/)
    ).toBeInTheDocument()
    expect(screen.getByText(/The failure path has no test/)).toBeInTheDocument()
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

describe('TaskCallInline', () => {
  it('shows a subagent final report when expanded', () => {
    render(
      <TaskCallInline
        taskToolCall={{
          id: 'task-1',
          name: 'Task',
          input: {
            description: 'Explore auth',
            prompt: 'Find how auth works',
            subagent_type: 'Explore',
          },
          output: 'Findings: auth uses JWT middleware.',
        }}
        subToolCalls={[]}
      />
    )

    expect(screen.getByText('Task (Explore)')).toBeInTheDocument()
    expect(screen.queryByText('Report:')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button'))

    expect(screen.getByText('Report:')).toBeInTheDocument()
    expect(
      screen.getByText('Findings: auth uses JWT middleware.')
    ).toBeInTheDocument()
  })

  it('renders Agent calls and nests child agents as task containers', () => {
    render(
      <TaskCallInline
        taskToolCall={{
          id: 'agent-1',
          name: 'Agent',
          input: {
            description: 'Nested agent',
            prompt: 'Delegate work',
            subagent_type: 'general-purpose',
          },
          output: 'Nested agent finished.',
        }}
        subToolCalls={[
          {
            id: 'agent-2',
            name: 'Agent',
            input: { description: 'Child agent', prompt: 'Child work' },
            parent_tool_use_id: 'agent-1',
          },
        ]}
        allToolCalls={[
          {
            id: 'agent-2',
            name: 'Agent',
            input: { description: 'Child agent', prompt: 'Child work' },
            parent_tool_use_id: 'agent-1',
          },
        ]}
      />
    )

    fireEvent.click(screen.getByText('Agent (general-purpose)'))

    expect(screen.getByText('Report:')).toBeInTheDocument()
    expect(screen.getByText('Nested agent finished.')).toBeInTheDocument()
    expect(screen.getByText('Agent')).toBeInTheDocument()
    expect(screen.getByText('Child agent')).toBeInTheDocument()
  })
})
