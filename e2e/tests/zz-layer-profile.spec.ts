import { test, activateWorktree } from '../fixtures/tauri-mock'

test.use({ viewport: { width: 1728, height: 1080 }, deviceScaleFactor: 2 })

test('layer profile', async ({ mockPage }) => {
  const cdp = await mockPage.context().newCDPSession(mockPage)
  await cdp.send('DOM.enable')
  await cdp.send('LayerTree.enable')
  let layers: any[] = []
  cdp.on('LayerTree.layerTreeDidChange', e => {
    if (e.layers) layers = e.layers
  })
  const dump = async (label: string) => {
    await mockPage.waitForTimeout(1500)
    const rows = []
    for (const l of layers) {
      if (!l.drawsContent) continue
      let reasons: string[] = []
      try {
        const r = await cdp.send('LayerTree.compositingReasons', {
          layerId: l.layerId,
        })
        reasons = r.compositingReasonIds ?? []
      } catch {}
      let node = ''
      if (l.backendNodeId) {
        try {
          const d = await cdp.send('DOM.describeNode', {
            backendNodeId: l.backendNodeId,
          })
          const attrs = d.node.attributes ?? []
          const cls = attrs[attrs.indexOf('class') + 1] ?? ''
          node = `${d.node.localName}.${cls.slice(0, 90)}`
        } catch {}
      }
      rows.push({
        mb: (l.width * l.height * 4 * 4) / 1048576,
        w: l.width,
        h: l.height,
        reasons: reasons.join(','),
        node,
      })
    }
    rows.sort((a, b) => b.mb - a.mb)
    const total = rows.reduce((s, r) => s + r.mb, 0)
    console.info(
      `[layers] ${label}: ${rows.length} layers, ${total.toFixed(0)} MB`
    )
    for (const r of rows.slice(0, 15))
      console.info(
        `  ${r.mb.toFixed(1)}MB ${r.w}x${r.h} [${r.reasons}] ${r.node}`
      )
  }
  await mockPage.waitForTimeout(2000)
  await dump('canvas')
  await activateWorktree(mockPage, 'fuzzy-tiger')
  await dump('session modal')
})
