import { test, expect, activateWorktree } from '../fixtures/tauri-mock'

test.describe('Model Selection', () => {
  test('model selector shows current model in chat toolbar', async ({
    mockPage,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    await expect(
      mockPage.getByRole('button', { name: 'Sonnet 4.6' })
    ).toBeVisible({ timeout: 3000 })
  })

  test('changing model updates the selector value', async ({ mockPage }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    const modelButton = mockPage.getByRole('button', { name: 'Sonnet 4.6' })
    await expect(modelButton).toBeVisible({ timeout: 3000 })
    await modelButton.click()
    await mockPage.waitForTimeout(200)

    // Select "Opus 4.7". The model row now includes extra favorite/fast controls,
    // so target the row by its visible label instead of the full accessible name.
    await mockPage
      .getByRole('menuitemradio')
      .filter({ hasText: /^Opus 4\.7$/ })
      .click()
    await mockPage.waitForTimeout(500)

    await expect(
      mockPage.getByRole('button', { name: 'Opus 4.7' })
    ).toBeVisible({ timeout: 3000 })
  })
})
