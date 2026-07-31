import { describe, expect, it } from 'vitest'
import { getProviderChangeBeforeMessage } from './message-settings-labels'

describe('getProviderChangeBeforeMessage', () => {
  it('separates user prompts when their providers change', () => {
    const messages = [
      { id: '1', role: 'user', model: 'claude-sonnet-4', content: '' },
      { id: '2', role: 'assistant', content: '' },
      { id: '3', role: 'user', model: 'codex-mini', content: '' },
    ] as never

    expect(getProviderChangeBeforeMessage(messages, 2)).toMatchObject({
      from: 'claude',
      to: 'codex',
      fromLabel: 'Claude',
      toLabel: 'Codex',
    })
  })

  it('skips assistant messages and unchanged providers', () => {
    const messages = [
      { id: '1', role: 'user', model: 'codex-mini', content: '' },
      { id: '2', role: 'assistant', content: '' },
      { id: '3', role: 'user', model: 'codex-max', content: '' },
    ] as never

    expect(getProviderChangeBeforeMessage(messages, 1)).toBeNull()
    expect(getProviderChangeBeforeMessage(messages, 2)).toBeNull()
  })
})
