import { test, expect } from '../fixtures/tauri-mock'

test.describe('App loads', () => {
  test('shows sidebar with project name', async ({ mockPage }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })
  })

  test('shows dashboard empty state', async ({ mockPage }) => {
    await expect(
      mockPage.getByText('Your imagination is the only limit')
    ).toBeVisible({ timeout: 5000 })
  })

  test('shows quick menu actions', async ({ mockPage }) => {
    await mockPage.getByRole('button', { name: 'Quick menu' }).click()
    await expect(
      mockPage.getByRole('menu', { name: 'Quick menu' })
    ).toBeVisible({
      timeout: 5000,
    })
    await expect(
      mockPage.getByRole('menuitem', { name: 'Add Project' })
    ).toBeVisible({
      timeout: 5000,
    })
    await expect(
      mockPage.getByRole('menuitem', { name: 'Archives' })
    ).toBeVisible({
      timeout: 5000,
    })
  })
})
