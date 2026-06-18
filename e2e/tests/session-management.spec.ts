import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import { mockPreferences } from '../fixtures/mock-data'

test.describe('Session Management', () => {
  test('create new session via + button', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await activateWorktree(mockPage, 'fuzzy-tiger')

    const existingTabs = mockPage.locator('[data-session-id]')
    await expect(existingTabs).toHaveCount(1, { timeout: 3000 })

    // Click new session button
    await mockPage.getByRole('button', { name: 'New session' }).click()
    await mockPage.getByRole('button', { name: /Jean Chat/ }).click()
    await mockPage.waitForTimeout(500)

    // The session modal should now show two session tabs
    const sessionTabs = mockPage.locator('[data-session-id]')
    await expect(sessionTabs).toHaveCount(2, { timeout: 3000 })

    await expect(sessionTabs.first()).toContainText('Session')
  })

  test('switch between sessions', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await activateWorktree(mockPage, 'fuzzy-tiger')

    // Create a second session inside the modal
    await mockPage.getByRole('button', { name: 'New session' }).click()
    await mockPage.getByRole('button', { name: /Jean Chat/ }).click()
    await mockPage.waitForTimeout(500)

    // Should have 2 session tabs
    const tabs = mockPage.locator('[data-session-id]')
    await expect(tabs).toHaveCount(2, { timeout: 3000 })

    // Click the older session tab and verify it becomes the active tab
    const secondTab = tabs.nth(1)
    await secondTab.click()
    await mockPage.waitForTimeout(500)

    await expect(secondTab).toHaveClass(/bg-muted/, { timeout: 2000 })
  })

  test('rename session via double-click', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await activateWorktree(mockPage, 'fuzzy-tiger')

    const sessionTab = mockPage.locator('[data-session-id]').first()
    await expect(sessionTab).toBeVisible({ timeout: 3000 })

    // Double-click to enter edit mode
    await sessionTab.dblclick()
    await mockPage.waitForTimeout(300)

    // An input should appear
    const input = sessionTab.locator('input[type="text"]')
    await expect(input).toBeVisible({ timeout: 2000 })

    // Clear and type new name (force click to bypass DnD sortable disabled state)
    await input.click({ force: true })
    await mockPage.keyboard.press('Meta+a')
    await mockPage.keyboard.type('My Renamed Session')
    await mockPage.keyboard.press('Enter')
    await mockPage.waitForTimeout(300)

    // Tab should show the new name
    await expect(sessionTab).toContainText('My Renamed Session')
  })

  test.describe('default new session execution mode', () => {
    test.use({
      responseOverrides: {
        load_preferences: {
          ...mockPreferences,
          default_execution_mode: 'build',
          default_new_session_kind: 'chat',
        },
      },
    })

    test('Cmd+T creates a chat in the configured mode', async ({
      mockPage,
    }) => {
      await activateWorktree(mockPage, 'fuzzy-tiger')

      await mockPage.keyboard.press('Meta+t')

      await expect(
        mockPage
          .getByTestId('chat-toolbar-pinned-actions')
          .getByRole('button', { name: 'Build' })
      ).toBeVisible({ timeout: 3000 })
    })
  })

  test.describe('persisted session execution mode', () => {
    test.use({
      responseOverrides: {
        load_preferences: {
          ...mockPreferences,
          default_execution_mode: 'build',
          default_new_session_kind: 'chat',
        },
      },
    })

    test('keeps the saved mode instead of applying the global default', async ({
      mockPage,
    }) => {
      await mockPage.evaluate(() => {
        const handlers = (
          window as Window & {
            __JEAN_E2E_MOCK__?: {
              invokeHandlers?: Record<
                string,
                (args?: Record<string, unknown>) => unknown
              >
            }
          }
        ).__JEAN_E2E_MOCK__?.invokeHandlers
        const worktree = handlers?.list_worktrees?.()?.[0]
        if (!worktree) throw new Error('Missing worktree fixture')
        const session = handlers?.create_session?.({
          worktreeId: worktree.id,
          worktreePath: worktree.path,
        })
        if (!session) throw new Error('Failed to seed session fixture')
        handlers?.update_session_state?.({
          worktreeId: worktree.id,
          worktreePath: worktree.path,
          sessionId: session.id,
          selectedExecutionMode: 'plan',
        })
      })

      await activateWorktree(mockPage, 'fuzzy-tiger')

      await expect(
        mockPage
          .getByTestId('chat-toolbar-pinned-actions')
          .getByRole('button', { name: 'Plan' })
      ).toBeVisible({ timeout: 3000 })
    })
  })
})
