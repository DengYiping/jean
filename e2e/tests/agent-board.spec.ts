import { test, expect } from '../fixtures/tauri-mock'
import type { Page } from '@playwright/test'

async function createTodo(mockPage: Page) {
  await mockPage.getByRole('button', { name: 'Add todo' }).click()
  await mockPage.getByPlaceholder('Title (optional)').fill('Fix board flow')
  await mockPage
    .getByPlaceholder('Describe the work...')
    .fill('Plan and implement the board flow')
  await mockPage.getByRole('button', { name: 'Create' }).click()
  await expect(mockPage.getByText('Fix board flow')).toBeVisible({
    timeout: 3000,
  })
}

test.describe('Agent board', () => {
  test('opens from nav rail and shortcut', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.getByRole('button', { name: 'Agent Board' }).click()
    await expect(mockPage.getByText('Global Board')).toBeVisible()

    await mockPage.getByRole('button', { name: 'Workspace' }).click()
    await mockPage.keyboard.press('ControlOrMeta+Shift+K')
    await expect(mockPage.getByText('Global Board')).toBeVisible()
  })

  test('opens todo dialog from board button and creates a Todo card', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    await mockPage.getByRole('button', { name: 'Agent Board' }).click()
    await mockPage.getByRole('button', { name: 'Add todo' }).click()
    await expect(mockPage.getByRole('dialog')).toBeVisible()
    await mockPage.getByPlaceholder('Title (optional)').fill('Fix board flow')
    await mockPage
      .getByPlaceholder('Describe the work...')
      .fill('Plan and implement the board flow')
    await mockPage.getByRole('button', { name: 'Create' }).click()

    const todoLane = mockPage.locator('section').filter({ hasText: 'Todo' })
    await expect(todoLane.getByText('Fix board flow')).toBeVisible()
  })

  test('drags Todo to Planning and opens the created session', async ({
    mockPage,
  }) => {
    await mockPage.getByRole('button', { name: 'Agent Board' }).click()
    await createTodo(mockPage)

    const card = mockPage
      .locator('article')
      .filter({ hasText: 'Fix board flow' })
    const planningLane = mockPage.locator('section').filter({
      has: mockPage.getByRole('heading', { name: 'Planning' }),
    })

    await card.dragTo(planningLane)
    await expect(planningLane.getByText('Fix board flow')).toBeVisible({
      timeout: 3000,
    })

    await planningLane.getByRole('button', { name: 'Open' }).click()
    await expect(
      mockPage.getByPlaceholder('Planning: Plan a task, @mention files...')
    ).toBeVisible({ timeout: 3000 })
  })
})
