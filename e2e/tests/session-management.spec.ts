import { test, expect, activateWorktree } from '../fixtures/tauri-mock'

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
})
