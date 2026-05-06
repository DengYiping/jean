import { test as base, expect, type Page } from '@playwright/test'
import { defaultResponses } from '../fixtures/invoke-handlers'
import { activateWorktree } from '../fixtures/tauri-mock'

const mockMcpServers = [
  { name: 'test-server-1', scope: 'user', disabled: false, config: {} },
  { name: 'test-server-2', scope: 'project', disabled: false, config: {} },
]

/**
 * Extended fixture with a stateful session store that persists across
 * simulated reloads. update_session_state writes enabled_mcp_servers
 * into the store so get_session returns it after reload.
 */
const test = base.extend<{ mockPage: Page }>({
  mockPage: async ({ page, baseURL }, use) => {
    const responses: Record<string, unknown> = {
      ...defaultResponses,
      load_preferences: {
        ...(defaultResponses.load_preferences as Record<string, unknown>),
        default_enabled_mcp_servers: mockMcpServers.map(server => server.name),
        known_mcp_servers: mockMcpServers.map(server => server.name),
      },
      get_mcp_servers: mockMcpServers,
      check_mcp_health: { statuses: {} },
    }

    // Persist session state across navigations via sessionStorage.
    await page.addInitScript(
      ({ responseMap }: { responseMap: Record<string, unknown> }) => {
        // Restore persisted session store from sessionStorage (survives reload)
        const saved = sessionStorage.getItem('__e2e_session_store__')
        const sessionStore: Record<
          string,
          {
            sessions: Array<Record<string, unknown>>
            active_session_id: string | null
          }
        > = saved ? JSON.parse(saved) : {}

        function getWorktreeStore(worktreeId: string) {
          if (!sessionStore[worktreeId]) {
            sessionStore[worktreeId] = {
              sessions: [],
              active_session_id: null,
            }
          }
          return sessionStore[worktreeId]
        }

        function persistStore() {
          sessionStorage.setItem(
            '__e2e_session_store__',
            JSON.stringify(sessionStore)
          )
        }

        // Track update_session_state calls for assertions
        ;(window as any).__updateSessionStateCalls = []

        const dynamicHandlers: Record<
          string,
          (args?: Record<string, unknown>) => unknown
        > = {
          get_sessions: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            return {
              worktree_id: wid,
              sessions: store.sessions,
              active_session_id: store.active_session_id,
              version: 2,
            }
          },
          create_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const name =
              (args?.name as string) || `Session ${store.sessions.length + 1}`
            const session = {
              id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name,
              order: store.sessions.length,
              created_at: Date.now() / 1000,
              messages: [],
            }
            store.sessions.unshift(session)
            store.active_session_id = session.id
            persistStore()
            return session
          },
          set_active_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            store.active_session_id = (args?.sessionId as string) ?? null
            persistStore()
            return null
          },
          get_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            return session
              ? structuredClone(session)
              : {
                  id: args?.sessionId ?? 'unknown',
                  name: 'Session',
                  order: 0,
                  created_at: Date.now() / 1000,
                  messages: [],
                }
          },
          rename_session: args => {
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session) session.name = args?.newName as string
            persistStore()
            return null
          },
          update_session_state: args => {
            // Record for test assertions
            ;(window as any).__updateSessionStateCalls.push(
              structuredClone(args)
            )
            // Persist enabled_mcp_servers into the session store
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session && args?.enabledMcpServers !== undefined) {
              session.enabled_mcp_servers = args.enabledMcpServers
            }
            persistStore()
            return null
          },
        }

        const handlers: Record<string, (args?: any) => unknown> = {}
        for (const [cmd, data] of Object.entries(responseMap)) {
          if (dynamicHandlers[cmd]) {
            handlers[cmd] = dynamicHandlers[cmd]
          } else {
            handlers[cmd] = () => structuredClone(data)
          }
        }
        for (const [cmd, handler] of Object.entries(dynamicHandlers)) {
          if (!handlers[cmd]) handlers[cmd] = handler
        }

        ;(window as any).__JEAN_E2E_MOCK__ = {
          invokeHandlers: handlers,
          eventEmitter: new EventTarget(),
        }
      },
      { responseMap: responses }
    )

    await page.goto(baseURL ?? 'http://localhost:1421')
    await use(page)
  },
})

function mcpButton(page: Page) {
  return page
    .locator('button')
    .filter({
      has: page.locator('svg.lucide-plug, svg[data-lucide="plug"]'),
    })
    .first()
}

async function openMcpMenu(page: Page) {
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.waitForTimeout(300)

  const trigger = mcpButton(page)
  await expect(trigger).toBeVisible({ timeout: 5000 })
  await trigger.click()

  await expect(page.getByText('MCP Servers')).toBeVisible({ timeout: 5000 })
}

async function getActiveSessionRef(page: Page) {
  return page.evaluate(() => {
    const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
    const worktrees = handlers?.list_worktrees?.()
    const worktree = Array.isArray(worktrees)
      ? worktrees.find(
          (item: Record<string, unknown>) => item.name === 'fuzzy-tiger'
        )
      : null

    if (!worktree) {
      throw new Error('Missing fuzzy-tiger worktree in E2E mock')
    }

    const sessions = handlers?.get_sessions?.({
      worktreeId: worktree.id,
      worktreePath: worktree.path,
    })
    const sessionId =
      sessions?.active_session_id ?? sessions?.sessions?.[0]?.id ?? null

    if (!sessionId) {
      throw new Error('Missing active session in E2E mock')
    }

    return {
      worktreeId: worktree.id,
      worktreePath: worktree.path,
      sessionId,
    }
  })
}

async function persistEnabledMcpServers(
  page: Page,
  enabledMcpServers: string[]
) {
  const sessionRef = await getActiveSessionRef(page)
  await page.evaluate(
    ({ sessionRef, enabledMcpServers }) => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      handlers?.update_session_state?.({
        ...sessionRef,
        enabledMcpServers,
      })
    },
    { sessionRef, enabledMcpServers }
  )
  await page.waitForTimeout(100)
}

test.describe('MCP Server Session Persistence', () => {
  test('session MCP selection is saved via update_session_state', async ({
    mockPage,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    await openMcpMenu(mockPage)

    const server1 = mockPage.getByRole('menuitemcheckbox', {
      name: /test-server-1/,
    })
    const server2 = mockPage.getByRole('menuitemcheckbox', {
      name: /test-server-2/,
    })
    await expect(server1).toBeVisible({ timeout: 5000 })
    await expect(server2).toBeVisible({ timeout: 5000 })

    await persistEnabledMcpServers(mockPage, ['test-server-2'])

    const calls = await mockPage.evaluate(
      () => (window as any).__updateSessionStateCalls
    )
    expect(calls.length).toBeGreaterThan(0)
    const mcpCall = calls.find(
      (call: any) =>
        Array.isArray(call.enabledMcpServers) &&
        call.enabledMcpServers.includes('test-server-2')
    )
    expect(mcpCall).toBeDefined()
    expect(mcpCall.enabledMcpServers).not.toContain('test-server-1')
    expect(mcpCall.enabledMcpServers).toContain('test-server-2')
  })

  test('MCP server state persists in session store across reload', async ({
    mockPage,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    await openMcpMenu(mockPage)
    const server1 = mockPage.getByRole('menuitemcheckbox', {
      name: /test-server-1/,
    })
    const server2 = mockPage.getByRole('menuitemcheckbox', {
      name: /test-server-2/,
    })
    await expect(server1).toBeVisible({ timeout: 5000 })
    await expect(server2).toBeVisible({ timeout: 5000 })

    await persistEnabledMcpServers(mockPage, ['test-server-2'])
    await mockPage.keyboard.press('Escape')

    // --- RELOAD ---
    await mockPage.reload()
    await mockPage.waitForTimeout(1000)
    await activateWorktree(mockPage, 'fuzzy-tiger')
    await openMcpMenu(mockPage)

    await expect(server1).toHaveAttribute('aria-checked', 'false')
    await expect(server2).toHaveAttribute('aria-checked', 'true')

    const storeAfterReload = await mockPage.evaluate(() => {
      const saved = sessionStorage.getItem('__e2e_session_store__')
      return saved ? JSON.parse(saved) : {}
    })

    // Find the worktree store that has sessions
    const worktreeStores = Object.values(storeAfterReload) as Array<{
      sessions: Array<Record<string, unknown>>
      active_session_id: string | null
    }>
    const storeWithSessions = worktreeStores.find(s => s.sessions.length > 0)
    expect(storeWithSessions).toBeDefined()

    const session = storeWithSessions!.sessions[0]
    expect(session.enabled_mcp_servers).toBeDefined()
    expect(session.enabled_mcp_servers).not.toContain('test-server-1')
    expect(session.enabled_mcp_servers).toContain('test-server-2')

    expect(storeWithSessions!.active_session_id).toBe(session.id)
  })
})
