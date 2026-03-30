import { expect } from '@playwright/test'
import { defaultResponses } from '../fixtures/invoke-handlers'
import { test, activateWorktree } from '../fixtures/tauri-mock'

test.use({
  responseOverrides: {
    load_preferences: {
      ...(defaultResponses.load_preferences as Record<string, unknown>),
      parallel_execution_prompt_enabled: false,
    },
  },
})

test.describe('Parallel Execution Session Toggle Global Off', () => {
  test('defaults off when the global preference is disabled', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })
    await activateWorktree(mockPage, 'fuzzy-tiger')
    await mockPage.locator('button[aria-label="New session"]').click()
    await mockPage.waitForTimeout(500)

    const toggle = mockPage.getByRole('switch', {
      name: 'Toggle parallel execution prompting for this session',
    })
    await expect(toggle).toHaveAttribute('data-state', 'unchecked')
  })
})
