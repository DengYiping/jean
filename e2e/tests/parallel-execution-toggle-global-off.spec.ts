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
    await activateWorktree(mockPage, 'fuzzy-tiger')

    await expect(
      mockPage.getByRole('button', {
        name: 'Parallel execution prompting',
      })
    ).toHaveAttribute('aria-pressed', 'false')
  })
})
