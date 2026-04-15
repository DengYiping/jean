import { expect } from '@playwright/test'
import { activateWorktree, test } from '../fixtures/tauri-mock'

test.describe('Open in detected editors', () => {
  test.use({
    responseOverrides: {
      list_available_editors: ['cursor', 'zed', 'vscode'],
    },
  })

  test('shows detected editors in the open dropdown and Cmd+O modal', async ({
    mockPage,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    const openButton = mockPage.getByRole('button', { name: /Open in Cursor/i })
    const buttonGroup = openButton.locator('xpath=..')
    await buttonGroup.getByRole('button').nth(1).click()

    await expect(mockPage.getByRole('menuitem', { name: 'Zed' })).toBeVisible()
    await expect(
      mockPage.getByRole('menuitem', { name: 'VS Code' })
    ).toBeVisible()

    await mockPage.keyboard.press('Meta+o')

    await expect(
      mockPage.getByRole('dialog', { name: /Open in/i })
    ).toBeVisible()
    await expect(mockPage.getByRole('button', { name: 'Zed' })).toBeVisible()
    await expect(
      mockPage.getByRole('button', { name: 'VS Code' })
    ).toBeVisible()
  })
})
