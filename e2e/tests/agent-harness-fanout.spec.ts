import { test, expect } from '../fixtures/tauri-mock'

test.describe('Agent harness fan-out', () => {
  test('sends the draft prompt to selected harness worktrees', async ({
    mockPage,
  }) => {
    await expect(mockPage.getByText('Test Project')).toBeVisible({
      timeout: 5000,
    })

    const firstWorktree = await mockPage.evaluate(() => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      const worktree = handlers.list_worktrees()[0]
      handlers.create_session({
        worktreeId: worktree.id,
        worktreePath: worktree.path,
      })
      return worktree
    })

    await mockPage.keyboard.press('Meta+b')
    await expect(mockPage.getByText('PROJECTS')).toBeVisible({ timeout: 3000 })
    await mockPage.getByText(firstWorktree.name).click()

    const textarea = mockPage.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 3000 })
    await textarea.fill('Compare this implementation across harnesses')

    await mockPage
      .getByRole('button', { name: 'Run prompt in multiple harnesses' })
      .click()
    await mockPage.getByRole('menuitem', { name: 'Run in 3 harnesses' }).click()

    await expect
      .poll(async () => {
        return await mockPage.evaluate(() => {
          const calls = (window as any).__JEAN_E2E_MOCK__?.invokeCalls ?? []
          return calls
            .filter((call: any) => call.command === 'send_chat_message')
            .map((call: any) => call.args?.backend)
            .sort()
        })
      })
      .toEqual(['claude', 'codex', 'opencode'])

    const sentMessages = await mockPage.evaluate(() => {
      const calls = (window as any).__JEAN_E2E_MOCK__?.invokeCalls ?? []
      return calls
        .filter((call: any) => call.command === 'send_chat_message')
        .map((call: any) => call.args?.message)
    })
    expect(sentMessages).toEqual([
      'Compare this implementation across harnesses',
      'Compare this implementation across harnesses',
      'Compare this implementation across harnesses',
    ])
  })
})
