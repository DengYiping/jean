import { expect } from '@playwright/test'
import { activateWorktree, test } from '../fixtures/tauri-mock'

test.describe('Open in modal', () => {
  test.use({
    responseOverrides: {
      list_available_editors: ['cursor', 'zed', 'vscode'],
    },
  })

  test('browser mode keeps native editor launchers hidden but still opens Cmd+O modal', async ({
    mockPage,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    await expect(
      mockPage.getByRole('button', { name: /Open in/i })
    ).toHaveCount(0)

    await mockPage.keyboard.press('Meta+o')

    await expect(
      mockPage.getByRole('dialog', { name: /Open in/i })
    ).toBeVisible()
    await expect(mockPage.getByRole('button', { name: 'GitHub' })).toBeVisible()
    await expect(mockPage.getByRole('button', { name: 'Zed' })).toHaveCount(0)
    await expect(mockPage.getByRole('button', { name: 'VS Code' })).toHaveCount(
      0
    )
  })
})
