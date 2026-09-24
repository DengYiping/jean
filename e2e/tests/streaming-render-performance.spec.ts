import { test, expect, activateWorktree } from '../fixtures/tauri-mock'

const WATCHED = [
  'ChatWindow',
  'ChatInput',
  'ChatToolbar',
  'StreamingMessage',
  'VirtualizedMessageList',
]

test('streaming chunks re-render only the live message subtree', async ({
  mockPage,
  emitEvent,
}) => {
  // Count component renders per commit through the DevTools hook, mirroring
  // how React DevTools decides whether a fiber rendered.
  await mockPage.addInitScript(watched => {
    const counts: Record<string, number> = { total: 0 }
    ;(window as any).__renderCounts = counts
    const nameOf = (fiber: any): string | null => {
      const type = fiber.type?.type ?? fiber.type?.render ?? fiber.type
      if (typeof type !== 'function') return null
      // Dev builds may suffix names (e.g. "ChatInput2").
      return (type.displayName || type.name || '').replace(/\d+$/, '')
    }
    const walk = (fiber: any) => {
      while (fiber) {
        const name = nameOf(fiber)
        if (name && fiber.alternate && (fiber.flags & 1) === 1) {
          counts.total += 1
          if (watched.includes(name)) counts[name] = (counts[name] ?? 0) + 1
        }
        // A subtree sharing its child with the previous tree bailed out.
        if (!fiber.alternate || fiber.child !== fiber.alternate.child) {
          walk(fiber.child)
        }
        fiber = fiber.sibling
      }
    }
    ;(window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer: unknown) {
        this.renderers.set(this.renderers.size + 1, renderer)
        return this.renderers.size
      },
      onCommitFiberRoot(_id: number, root: any) {
        walk(root.current.child)
      },
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      checkDCE() {},
    }
  }, WATCHED)
  await mockPage.reload()

  await activateWorktree(mockPage, 'fuzzy-tiger')
  const textarea = mockPage.locator('textarea').first()
  await expect(textarea).toBeVisible({ timeout: 3000 })
  await textarea.fill('Stream a long answer')
  await textarea.press('Enter')
  await mockPage.waitForTimeout(300)

  const sessionId = await mockPage
    .locator('[data-session-id]')
    .first()
    .getAttribute('data-session-id')
  await emitEvent('chat:sending', { session_id: sessionId, worktree_id: 'e2e' })
  await mockPage.waitForTimeout(300)

  const cdp = await mockPage.context().newCDPSession(mockPage)
  await cdp.send('Performance.enable')
  const scriptDuration = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics')
    return metrics.find(m => m.name === 'ScriptDuration')?.value ?? 0
  }

  await mockPage.evaluate(() => {
    const counts = (window as any).__renderCounts
    for (const key of Object.keys(counts)) counts[key] = 0
  })
  const scriptBefore = await scriptDuration()

  // One chunk per animation frame, matching the chunk batching in
  // useStreamingEvents.
  const chunkCount = 200
  await mockPage.evaluate(
    async ({ sessionId, chunkCount }) => {
      const emitter = (window as any).__JEAN_E2E_MOCK__.eventEmitter
      for (let i = 0; i < chunkCount; i++) {
        emitter.dispatchEvent(
          new CustomEvent('chat:chunk', {
            detail: {
              session_id: sessionId,
              content: `word${i} ${i % 12 === 11 ? '\n' : ''}`,
            },
          })
        )
        await new Promise(resolve => requestAnimationFrame(resolve))
      }
    },
    { sessionId, chunkCount }
  )
  await mockPage.waitForTimeout(200)

  const scriptMs = ((await scriptDuration()) - scriptBefore) * 1000
  const counts = await mockPage.evaluate(() => ({
    ...(window as any).__renderCounts,
  }))
  console.info(
    `[measure] ${chunkCount} streamed frames: script ${scriptMs.toFixed(0)}ms, renders ${JSON.stringify(counts)}`
  )

  await emitEvent('chat:done', { session_id: sessionId, worktree_id: 'e2e' })

  expect(counts.StreamingMessage ?? 0).toBeGreaterThan(chunkCount / 4)
  expect(counts.ChatWindow ?? 0).toBeLessThan(10)
  expect(counts.ChatInput ?? 0).toBeLessThan(10)
  expect(counts.ChatToolbar ?? 0).toBeLessThan(10)
  expect(counts.total).toBeLessThan(chunkCount * 20)
})
