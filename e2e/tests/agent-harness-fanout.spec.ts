import { test, expect, activateWorktree } from '../fixtures/tauri-mock'

test.describe('Agent harness fan-out', () => {
  test('sends the draft prompt to selected harness worktrees', async ({
    mockPage,
  }) => {
    const firstWorktree = await mockPage.evaluate(() => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      return handlers.list_worktrees()[0]
    })
    await mockPage.evaluate(projectId => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      handlers.update_project_settings({
        projectId,
        stableWorktreeSlotsEnabled: true,
      })
    }, firstWorktree.project_id)

    await activateWorktree(mockPage, firstWorktree.name)

    const textarea = mockPage.locator('textarea').first()
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

    const slots = await mockPage.evaluate(projectId => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      return handlers.list_worktree_slots({ projectId })
    }, firstWorktree.project_id)
    expect(slots).toHaveLength(3)
    expect(new Set(slots.map((slot: any) => slot.id)).size).toBe(3)
    expect(new Set(slots.map((slot: any) => slot.worktree_id)).size).toBe(3)
    expect(slots.map((slot: any) => slot.state)).toEqual([
      'active',
      'active',
      'active',
    ])
  })
})
