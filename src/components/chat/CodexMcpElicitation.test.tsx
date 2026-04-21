import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  CodexMcpElicitation,
  type CodexMcpElicitationProps,
} from './CodexMcpElicitation'
import type { CodexMcpElicitation as CodexMcpElicitationType } from '@/types/chat'
import { defaultPreferences } from '@/types/preferences'
import { preferencesQueryKeys } from '@/services/preferences'

function createElicitation(
  overrides: Partial<CodexMcpElicitationType> = {}
): CodexMcpElicitationType {
  return {
    rpc_id: 42,
    thread_id: 'thread-1',
    turn_id: 'turn-1',
    server_name: 'devex-mcp-server',
    message:
      'Allow the devex-mcp-server MCP server to run tool "list_ij_projects"?',
    requested_schema: {
      type: 'object',
      properties: {},
    },
    ...overrides,
  }
}

describe('CodexMcpElicitation', () => {
  function renderWithQueryClient(
    elicitation: CodexMcpElicitationType,
    onRespond: CodexMcpElicitationProps['onRespond']
  ) {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })
    queryClient.setQueryData(
      preferencesQueryKeys.preferences(),
      defaultPreferences
    )

    return render(
      <QueryClientProvider client={queryClient}>
        <CodexMcpElicitation
          sessionId="session-1"
          elicitation={elicitation}
          onRespond={onRespond}
        />
      </QueryClientProvider>
    )
  }

  it('approves empty-form elicitations with an empty object payload', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn()

    renderWithQueryClient(createElicitation(), onRespond)

    await user.click(screen.getByRole('button', { name: 'Approve' }))

    expect(onRespond).toHaveBeenCalledWith('session-1', 42, 'accept', {})
  })

  it('requires mandatory fields before approving', async () => {
    const user = userEvent.setup()
    const onRespond = vi.fn()

    renderWithQueryClient(
      createElicitation({
        requested_schema: {
          type: 'object',
          required: ['keyword'],
          properties: {
            keyword: {
              type: 'string',
              title: 'Keyword',
            },
          },
        },
      }),
      onRespond
    )

    const approveButton = screen.getByRole('button', { name: 'Approve' })
    expect(approveButton).toBeDisabled()

    await user.type(screen.getByRole('textbox'), 'acceptance-tests')

    expect(approveButton).toBeEnabled()
    await user.click(approveButton)

    expect(onRespond).toHaveBeenCalledWith('session-1', 42, 'accept', {
      keyword: 'acceptance-tests',
    })
  })
})
