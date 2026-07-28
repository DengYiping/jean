import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mcpKey,
  resolveEnabledMcpServers,
  resolveMcpConfigForSend,
} from './mcp'
import type { McpServerInfo } from '@/types/chat'

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock('@/lib/transport', () => ({ invoke: invokeMock }))

const jean: McpServerInfo = {
  name: 'jean',
  backend: 'claude',
  scope: 'user',
  disabled: false,
  config: { type: 'stdio', command: 'jean' },
}

describe('resolveEnabledMcpServers', () => {
  it('uses project settings and auto-enables only newly discovered servers', () => {
    expect(
      resolveEnabledMcpServers({
        availableServers: [jean],
        projectEnabled: [],
        knownServers: [],
      })
    ).toEqual([mcpKey('claude', 'jean')])

    expect(
      resolveEnabledMcpServers({
        availableServers: [jean],
        globalEnabled: [],
        knownServers: [mcpKey('claude', 'jean')],
      })
    ).toEqual([])
  })
})

describe('resolveMcpConfigForSend', () => {
  beforeEach(() => invokeMock.mockReset())

  it('discovers enabled servers for the first magic send', async () => {
    invokeMock.mockResolvedValue([jean])

    await expect(
      resolveMcpConfigForSend({
        worktreePath: '/repo',
        backend: 'claude',
        globalEnabled: [],
        knownServers: [],
      })
    ).resolves.toEqual({
      enabledServers: [mcpKey('claude', 'jean')],
      mcpConfig: JSON.stringify({ mcpServers: { jean: jean.config } }),
    })
  })
})
