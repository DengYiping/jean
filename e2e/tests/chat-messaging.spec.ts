import { test, expect, activateWorktree } from '../fixtures/tauri-mock'

test.describe('Chat Messaging', () => {
  test('send a message and receive a streamed response', async ({
    mockPage,
    emitEvent,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    // Find the chat textarea and send a message
    const textarea = mockPage.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 3000 })
    await textarea.fill('Hello Claude')
    await textarea.press('Enter')
    await mockPage.waitForTimeout(500)

    // Get session ID for events
    const sessionId = await mockPage
      .locator('[data-session-id]')
      .first()
      .getAttribute('data-session-id')

    // Simulate streaming response from backend
    await emitEvent('chat:sending', {
      session_id: sessionId,
      worktree_id: 'e2e',
    })
    await mockPage.waitForTimeout(100)

    await emitEvent('chat:chunk', {
      session_id: sessionId,
      content: 'Hello there! How can I help?',
    })
    await mockPage.waitForTimeout(200)

    // Streamed response should be visible while streaming
    await expect(
      mockPage.getByText('Hello there! How can I help?')
    ).toBeVisible({ timeout: 3000 })

    // Complete the stream
    await emitEvent('chat:done', {
      session_id: sessionId,
      worktree_id: 'e2e',
    })
  })

  test('streaming response renders incrementally', async ({
    mockPage,
    emitEvent,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    const textarea = mockPage.locator('textarea').first()
    await expect(textarea).toBeVisible({ timeout: 3000 })
    await textarea.fill('Tell me a joke')
    await textarea.press('Enter')
    await mockPage.waitForTimeout(300)

    const sessionId = await mockPage
      .locator('[data-session-id]')
      .first()
      .getAttribute('data-session-id')

    // Start streaming
    await emitEvent('chat:sending', {
      session_id: sessionId,
      worktree_id: 'e2e',
    })
    await mockPage.waitForTimeout(100)

    // First chunk
    await emitEvent('chat:chunk', {
      session_id: sessionId,
      content: 'Why did the ',
    })
    await mockPage.waitForTimeout(200)

    // Partial text should be visible
    await expect(mockPage.getByText('Why did the')).toBeVisible({
      timeout: 2000,
    })

    // Second chunk
    await emitEvent('chat:chunk', {
      session_id: sessionId,
      content: 'chicken cross the road?',
    })
    await mockPage.waitForTimeout(200)

    // Full text should be visible
    await expect(
      mockPage.getByText('Why did the chicken cross the road?')
    ).toBeVisible({ timeout: 2000 })

    // Complete
    await emitEvent('chat:done', {
      session_id: sessionId,
      worktree_id: 'e2e',
    })
  })

  test('autonomous Codex goal turn renders like a normal stream', async ({
    mockPage,
    emitEvent,
  }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    const sessionId = await mockPage
      .locator('[data-session-id]')
      .first()
      .getAttribute('data-session-id')

    await emitEvent('chat:sending', {
      session_id: sessionId,
      worktree_id: 'e2e',
      user_message: 'Continue working toward the active goal',
    })

    await emitEvent('chat:tool_use', {
      session_id: sessionId,
      worktree_id: 'e2e',
      id: 'todo-1',
      name: 'CodexTodoList',
      input: {
        items: [
          {
            text: 'Inspect goal monitor state',
            activeForm: 'Inspecting goal monitor state',
            status: 'in_progress',
          },
        ],
      },
    })

    await emitEvent('chat:chunk', {
      session_id: sessionId,
      worktree_id: 'e2e',
      content: 'Continuing the active goal now.',
    })

    await expect(
      mockPage.getByText('Continue working toward the active goal')
    ).toBeVisible({ timeout: 3000 })
    const tasksButton = mockPage.getByRole('button', { name: /Tasks 0\/1/ })
    await expect(tasksButton).toBeVisible({ timeout: 3000 })
    await tasksButton.click()
    await expect(
      mockPage.getByText('Inspecting goal monitor state')
    ).toBeVisible({ timeout: 3000 })
    await expect(
      mockPage.getByText('Continuing the active goal now.')
    ).toBeVisible({ timeout: 3000 })

    await emitEvent('chat:done', {
      session_id: sessionId,
      worktree_id: 'e2e',
    })
  })

  test('clearing a Codex goal removes the banner', async ({ mockPage }) => {
    await activateWorktree(mockPage, 'fuzzy-tiger')

    const sessionId = await mockPage
      .locator('[data-session-id]')
      .first()
      .getAttribute('data-session-id')

    const worktreeId = await mockPage.evaluate(() => {
      const mock = (window as any).__JEAN_E2E_MOCK__
      const worktree = mock?.invokeHandlers
        ?.list_worktrees?.()
        ?.find((item: Record<string, unknown>) => item.name === 'fuzzy-tiger')
      return String(worktree?.id ?? 'e2e')
    })

    await mockPage.evaluate(
      ({ sessionId, worktreeId }) => {
        const mock = (window as any).__JEAN_E2E_MOCK__
        const worktree = mock?.invokeHandlers
          ?.list_worktrees?.()
          ?.find((item: Record<string, unknown>) => item.id === worktreeId) as
          | Record<string, unknown>
          | undefined
        const worktreePath = String(worktree?.path ?? '')

        mock?.invokeHandlers?.set_session_backend?.({
          worktreeId,
          worktreePath,
          sessionId,
          backend: 'codex',
        })
        mock?.eventEmitter?.dispatchEvent(
          new CustomEvent('cache:invalidate', {
            detail: { keys: ['sessions'] },
          })
        )
        mock?.eventEmitter?.dispatchEvent(
          new CustomEvent('chat:codex_goal', {
            detail: {
              session_id: sessionId,
              worktree_id: worktreeId,
              goal: 'Ship autonomous progress',
            },
          })
        )
      },
      { sessionId, worktreeId }
    )

    await expect(mockPage.getByText('Ship autonomous progress')).toBeVisible({
      timeout: 3000,
    })

    await mockPage.getByRole('button', { name: 'Clear goal' }).click()

    await expect(mockPage.getByText('Ship autonomous progress')).toBeHidden({
      timeout: 3000,
    })
  })
})
