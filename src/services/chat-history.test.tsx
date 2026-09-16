import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { ReactNode } from 'react'
import { invoke } from '@/lib/transport'
import { useCodexSubAgents, useCodexSubAgentSnapshot, useSession } from './chat'
vi.mock('@/lib/transport', () => ({
  invoke: vi.fn(),
  listen: vi.fn().mockResolvedValue(() => {
    /* no transport listener in this test */
  }),
}))
vi.mock('@/services/projects', async importOriginal => ({
  ...(await importOriginal<object>()),
  isTauri: () => true,
}))
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})
describe('bounded chat reads', () => {
  it('loads the paginated command for normal session reads', async () => {
    ;(invoke as Mock).mockResolvedValue({
      id: 'session',
      messages: [],
      loaded_run_start_index: 20,
    })
    const result = renderHook(
      () => useSession('session', 'worktree', '/tmp/worktree'),
      { wrapper: createWrapper() }
    )
    await waitFor(() => expect(result.result.current.isSuccess).toBe(true))
    expect(invoke).toHaveBeenCalledWith('get_session_history', {
      sessionId: 'session',
      worktreeId: 'worktree',
      worktreePath: '/tmp/worktree',
    })
    result.unmount()
  })
  it('does not poll parent history during streaming', async () => {
    vi.useFakeTimers()
    ;(invoke as Mock).mockResolvedValue({ sessionId: 'session', agents: [] })
    const result = renderHook(
      () =>
        useCodexSubAgents('session', 'worktree', '/tmp', {
          enabled: true,
        }),
      { wrapper: createWrapper() }
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(
      'get_codex_sub_agents',
      expect.objectContaining({ includeThreadSnapshots: false })
    )
    result.unmount()
  })
  it('fetches only the requested agent while its details are open and stops on close', async () => {
    vi.useFakeTimers()
    ;(invoke as Mock).mockResolvedValue({ threadId: 'agent', messages: [] })
    const result = renderHook(
      ({ open }) => useCodexSubAgentSnapshot('agent', open, true),
      { initialProps: { open: false }, wrapper: createWrapper() }
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(invoke).not.toHaveBeenCalled()
    result.rerender({ open: true })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(invoke).toHaveBeenCalledWith('get_codex_sub_agent_snapshot', {
      threadId: 'agent',
    })
    result.rerender({ open: false })
    const count = vi.mocked(invoke).mock.calls.length
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(invoke).toHaveBeenCalledTimes(count)
    result.unmount()
  })
})
