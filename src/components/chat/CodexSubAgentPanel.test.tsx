import { fireEvent, render, screen } from '@/test/test-utils'
import { describe, expect, it } from 'vitest'
import { CodexSubAgentPanel } from './CodexSubAgentPanel'

describe('CodexSubAgentPanel', () => {
  it('renders rich sub-agent details from introspection data', () => {
    render(
      <CodexSubAgentPanel
        defaultOpen
        agents={[
          {
            id: 'agent-1',
            name: 'auth scout',
            prompt: 'Investigate auth timeout in CI',
            status: 'completed',
            latestMessage: 'Found flaky assertion',
            senderThreadId: 'parent-thread',
            receiverThreadIds: ['agent-1'],
            snapshot: {
              threadId: 'agent-1',
              turnCount: 2,
              messages: [
                {
                  role: 'user',
                  text: 'Investigate auth timeout in CI',
                },
                {
                  role: 'assistant',
                  text: 'The auth timeout comes from retry backoff.',
                },
              ],
            },
            events: [
              {
                toolCallId: 'spawn-1',
                toolName: 'SpawnAgent',
                status: 'running',
                message: 'Inspecting failing tests',
                rawInput: {},
              },
              {
                toolCallId: 'wait-1',
                toolName: 'WaitForAgents',
                status: 'completed',
                message: 'Found flaky assertion',
                rawInput: {},
              },
            ],
          },
        ]}
      />
    )

    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText('1/1')).toBeInTheDocument()
    expect(screen.getByText('auth scout')).toBeInTheDocument()
    expect(screen.getByText('Found flaky assertion')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /expand auth scout/i }))

    expect(
      screen.getByText('Investigate auth timeout in CI')
    ).toBeInTheDocument()
    expect(screen.getByText('from parent-thread')).toBeInTheDocument()
    expect(screen.getByText('to agent-1')).toBeInTheDocument()
    expect(screen.getByText('2 turns recorded')).toBeInTheDocument()
    expect(screen.getByText('SpawnAgent')).toBeInTheDocument()
    expect(screen.getByText('WaitForAgents')).toBeInTheDocument()
  })

  it('opens a sub-agent session dialog when clicking an agent row', () => {
    render(
      <CodexSubAgentPanel
        defaultOpen
        agents={[
          {
            id: 'agent-1',
            name: 'auth scout',
            status: 'completed',
            receiverThreadIds: ['agent-1'],
            events: [],
            snapshot: {
              threadId: 'agent-1',
              turnCount: 1,
              messages: [
                {
                  role: 'user',
                  text: 'Inspect auth',
                },
                {
                  role: 'assistant',
                  text: 'The timeout comes from retry backoff.',
                },
              ],
            },
          },
        ]}
      />
    )

    fireEvent.click(
      screen.getByRole('button', { name: /open auth scout session/i })
    )

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Inspect auth')).toBeInTheDocument()
    expect(
      screen.getByText('The timeout comes from retry backoff.')
    ).toBeInTheDocument()
  })

  it('falls back to live streaming agent summaries before introspection loads', () => {
    render(
      <CodexSubAgentPanel
        defaultOpen
        agents={[]}
        fallbackAgents={[
          {
            id: 'spawn-1',
            name: 'Agent spawn-1',
            prompt: 'Look at the migration failure',
            status: 'in_progress',
            message: 'Starting',
          },
        ]}
        isStreaming
      />
    )

    expect(screen.getByText('0/1')).toBeInTheDocument()
    expect(screen.getByText('1 running')).toBeInTheDocument()
    expect(screen.getByText('Agent spawn-1')).toBeInTheDocument()
    expect(screen.getByText('Starting')).toBeInTheDocument()
  })

  it('renders interrupted agents without an active spinner', () => {
    render(
      <CodexSubAgentPanel
        defaultOpen
        agents={[
          {
            id: 'agent-1',
            name: 'auth scout',
            status: 'interrupted',
            latestMessage: 'Stopped by user',
            receiverThreadIds: ['agent-1'],
            events: [],
          },
        ]}
      />
    )

    expect(screen.getByText('Interrupted')).toBeInTheDocument()
    expect(screen.getByText('Stopped by user')).toBeInTheDocument()
    expect(document.querySelector('.animate-spin')).not.toBeInTheDocument()
  })
})
