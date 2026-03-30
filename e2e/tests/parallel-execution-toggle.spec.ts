import { test as base, expect, type Page } from '@playwright/test'
import { defaultResponses } from '../fixtures/invoke-handlers'
import { activateWorktree } from '../fixtures/tauri-mock'

const test = base.extend<{ mockPage: Page }>({
  mockPage: async ({ page, baseURL }, use) => {
    const responses: Record<string, unknown> = {
      ...defaultResponses,
      load_preferences: {
        ...(defaultResponses.load_preferences as Record<string, unknown>),
        parallel_execution_prompt_enabled: true,
      },
    }

    await page.addInitScript(
      ({ responseMap }: { responseMap: Record<string, unknown> }) => {
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
            const session = {
              id: `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              name: `Session ${store.sessions.length + 1}`,
              order: store.sessions.length,
              created_at: Date.now() / 1000,
              updated_at: Date.now() / 1000,
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
                  updated_at: Date.now() / 1000,
                  messages: [],
                }
          },
          update_session_state: args => {
            ;(window as any).__updateSessionStateCalls.push(
              structuredClone(args)
            )
            const wid = (args?.worktreeId as string) ?? 'unknown'
            const store = getWorktreeStore(wid)
            const session = store.sessions.find(s => s.id === args?.sessionId)
            if (session && args?.parallelExecutionPromptEnabled !== undefined) {
              session.parallel_execution_prompt_enabled =
                args.parallelExecutionPromptEnabled
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

async function createSession(page: Page) {
  await expect(page.getByText('Test Project')).toBeVisible({ timeout: 5000 })
  await activateWorktree(page, 'fuzzy-tiger')
  await page.locator('button[aria-label="New session"]').click()
  await page.waitForTimeout(500)
}

test.describe('Parallel Execution Session Toggle', () => {
  test('defaults on when the global preference is enabled', async ({
    mockPage,
  }) => {
    await createSession(mockPage)

    const toggle = mockPage.getByRole('switch', {
      name: 'Toggle parallel execution prompting for this session',
    })
    await expect(toggle).toHaveAttribute('data-state', 'checked')
  })

  test('persists a session-specific disable across reload', async ({
    mockPage,
  }) => {
    await createSession(mockPage)

    const toggle = mockPage.getByRole('switch', {
      name: 'Toggle parallel execution prompting for this session',
    })
    await expect(toggle).toHaveAttribute('data-state', 'checked')

    await toggle.click()
    await mockPage.waitForTimeout(1000)

    const calls = await mockPage.evaluate(
      () => (window as any).__updateSessionStateCalls
    )
    const toggleCall = calls.find(
      (call: any) => call.parallelExecutionPromptEnabled !== undefined
    )
    expect(toggleCall?.parallelExecutionPromptEnabled).toBe(false)

    await mockPage.reload()
    await mockPage.waitForTimeout(1000)

    await expect(toggle).toHaveAttribute('data-state', 'unchecked')
  })
})
