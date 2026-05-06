import { test, expect, activateWorktree } from '../fixtures/tauri-mock'

test.describe('Supervisor action', () => {
  test('backend runs magic action before enqueueing and starting the configured prompt after a turn completes', async ({
    mockPage,
    emitEvent,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    const sessionId = await mockPage
      .locator('[data-session-id]')
      .first()
      .getAttribute('data-session-id')
    expect(sessionId).toBeTruthy()

    const worktree = await mockPage.evaluate(() => {
      const handlers = (window as any).__JEAN_E2E_MOCK__?.invokeHandlers
      return handlers.list_worktrees()[0]
    })

    await mockPage.getByRole('button', { name: 'Supervisor action' }).click()
    await mockPage
      .getByRole('switch', { name: 'Enable supervisor action' })
      .click()
    await mockPage.getByRole('checkbox', { name: 'Create commit' }).click()
    await mockPage
      .locator('#supervisor-prompt')
      .fill('Run the next verification step')
    await mockPage.locator('#supervisor-max-turns').fill('1')

    await expect
      .poll(async () => {
        return await mockPage.evaluate(() => {
          const calls = (window as any).__JEAN_E2E_MOCK__?.invokeCalls ?? []
          return calls
            .filter((call: any) => call.command === 'update_session_state')
            .at(-1)?.args?.supervisorAction
        })
      })
      .toMatchObject({
        enabled: true,
        magic_actions: ['commit'],
        prompt: 'Run the next verification step',
        max_supervisor_created_turns: 1,
      })

    await emitEvent('chat:done', {
      session_id: sessionId,
      worktree_id: worktree.id,
    })

    await expect
      .poll(async () => {
        return await mockPage.evaluate(() => {
          const calls = (window as any).__JEAN_E2E_MOCK__?.invokeCalls ?? []
          return {
            commitCount: calls.filter(
              (call: any) => call.command === 'create_commit_with_ai'
            ).length,
            enqueueCount: calls.filter(
              (call: any) => call.command === 'enqueue_message'
            ).length,
          }
        })
      })
      .toEqual({ commitCount: 1, enqueueCount: 1 })

    const callSummary = await mockPage.evaluate(() => {
      const calls = (window as any).__JEAN_E2E_MOCK__?.invokeCalls ?? []
      const commitIndex = calls.findIndex(
        (call: any) => call.command === 'create_commit_with_ai'
      )
      const enqueueIndex = calls.findIndex(
        (call: any) => call.command === 'enqueue_message'
      )
      const sendIndex = calls.findIndex(
        (call: any) => call.command === 'send_chat_message'
      )
      const enqueueCall = calls[enqueueIndex]
      return {
        commitIndex,
        enqueueIndex,
        sendIndex,
        commitArgs: calls[commitIndex]?.args,
        queuedMessage: enqueueCall?.args?.message,
        queuedSessionId: enqueueCall?.args?.sessionId,
        sendArgs: calls[sendIndex]?.args,
      }
    })

    expect(callSummary.commitIndex).toBeGreaterThanOrEqual(0)
    expect(callSummary.enqueueIndex).toBeGreaterThan(callSummary.commitIndex)
    expect(callSummary.sendIndex).toBeGreaterThan(callSummary.enqueueIndex)
    expect(callSummary.commitArgs).toMatchObject({
      worktreePath: worktree.path,
      push: false,
    })
    expect(callSummary.queuedSessionId).toBe(sessionId)
    expect(callSummary.queuedMessage).toMatchObject({
      message: 'Run the next verification step',
      executionMode: 'plan',
    })
    expect(callSummary.sendArgs).toMatchObject({
      message: 'Run the next verification step',
      executionMode: 'plan',
    })

    await emitEvent('chat:done', {
      session_id: sessionId,
      worktree_id: worktree.id,
    })
    await mockPage.waitForTimeout(300)

    const countsAfterStopCondition = await mockPage.evaluate(() => {
      const calls = (window as any).__JEAN_E2E_MOCK__?.invokeCalls ?? []
      return {
        commitCount: calls.filter(
          (call: any) => call.command === 'create_commit_with_ai'
        ).length,
        enqueueCount: calls.filter(
          (call: any) => call.command === 'enqueue_message'
        ).length,
      }
    })
    expect(countsAfterStopCondition).toEqual({
      commitCount: 1,
      enqueueCount: 1,
    })
  })
})
