import { test, expect, activateWorktree } from '../fixtures/tauri-mock'
import { mockPreferences } from '../fixtures/mock-data'

const history = Array.from({ length: 80 }, (_, index) => [
  {
    id: `user-${index}`,
    session_id: 'history',
    role: 'user',
    content: `History prompt ${index}`,
    timestamp: index * 2,
    tool_calls: [],
  },
  {
    id: `assistant-${index}`,
    session_id: 'history',
    role: 'assistant',
    content: `History answer ${index}\n\n${'A paragraph of older session content. '.repeat(30)}`,
    timestamp: index * 2 + 1,
    tool_calls: [],
  },
]).flat()

for (const compact of [false, true])
  test.describe(compact ? 'compact history' : 'standard history', () => {
    test.use({
      responseOverrides: {
        load_preferences: {
          ...mockPreferences,
          compact_chat_view_enabled: compact,
        },
        get_session: {
          id: 'history',
          name: 'History',
          order: 0,
          created_at: 0,
          updated_at: 160,
          messages: history,
        },
      },
    })

    test('loads history in pages and bounds mounted messages through navigation', async ({
      mockPage,
    }) => {
      await activateWorktree(mockPage, 'fuzzy-tiger')
      const rows = mockPage.locator('[data-message-anchor-id]')
      await expect(rows.first()).toBeAttached()
      await expect.poll(() => rows.count()).toBeLessThan(25)
      const older = mockPage.getByRole('button', {
        name: /Load (older messages|old prompts)/,
      })
      await expect(older).toBeAttached()
      await older.scrollIntoViewIfNeeded()
      await older.click()
      await expect(older).not.toHaveText(/Loading/)
      await expect.poll(() => rows.count()).toBeLessThan(25)
      // Search runs against loaded data, including rows that are currently unmounted.
      // The command shortcut owns opening the search UI.
      await mockPage.keyboard.press('Meta+f')
      const search = mockPage.getByPlaceholder('Find in chat...')
      await expect(search).toBeVisible()
      await search.fill('History prompt 79')
      await expect(mockPage.getByText('1/1', { exact: true })).toBeVisible()
      await expect(
        mockPage.getByText('History prompt 79', { exact: true })
      ).toBeVisible()
      await expect.poll(() => rows.count()).toBeLessThan(25)
    })
  })
