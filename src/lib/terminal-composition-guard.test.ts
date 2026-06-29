import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { attachOrphanCompositionEndGuard } from './terminal-composition-guard'

const NBSP = '\u00a0'
const DEL = '\x7f'

describe('attachOrphanCompositionEndGuard', () => {
  let root: HTMLDivElement
  let textarea: HTMLTextAreaElement
  let received: string[]

  const dispatch = (type: string) => {
    textarea.dispatchEvent(new Event(type, { bubbles: true }))
  }

  beforeEach(() => {
    root = document.createElement('div')
    textarea = document.createElement('textarea')
    root.appendChild(textarea)
    document.body.replaceChildren(root)
    received = []
    for (const type of ['compositionstart', 'compositionend']) {
      textarea.addEventListener(type, () => received.push(type))
    }
  })

  it('swallows a compositionend that has no matching compositionstart', () => {
    attachOrphanCompositionEndGuard(root)

    dispatch('compositionend')

    expect(received).toEqual([])
  })

  it('lets balanced compositionstart/compositionend pairs through', () => {
    attachOrphanCompositionEndGuard(root)

    dispatch('compositionstart')
    dispatch('compositionend')

    expect(received).toEqual(['compositionstart', 'compositionend'])
  })

  it('swallows an orphan end following a balanced pair', () => {
    attachOrphanCompositionEndGuard(root)

    dispatch('compositionstart')
    dispatch('compositionend')
    dispatch('compositionend')

    expect(received).toEqual(['compositionstart', 'compositionend'])
  })

  it('swallows an end whose target differs from the open composition', () => {
    const sibling = document.createElement('input')
    root.appendChild(sibling)
    attachOrphanCompositionEndGuard(root)

    sibling.dispatchEvent(new Event('compositionstart', { bubbles: true }))
    dispatch('compositionend')

    expect(received).toEqual([])
  })

  it('stops guarding after cleanup', () => {
    const cleanup = attachOrphanCompositionEndGuard(root)
    cleanup()

    dispatch('compositionend')

    expect(received).toEqual(['compositionend'])
  })
})

describe('attachOrphanCompositionEndGuard textarea delivery', () => {
  let root: HTMLDivElement
  let textarea: HTMLTextAreaElement
  let delivered: string[]
  let diffSent: string[]

  beforeEach(() => {
    vi.useFakeTimers()
    root = document.createElement('div')
    textarea = document.createElement('textarea')
    root.appendChild(textarea)
    document.body.replaceChildren(root)
    delivered = []
    diffSent = []

    textarea.addEventListener('keydown', event => {
      if ((event as KeyboardEvent).keyCode !== 229) return
      const oldValue = textarea.value
      setTimeout(() => {
        const newValue = textarea.value
        const diff = newValue.replace(oldValue, '')
        if (newValue.length > oldValue.length) {
          diffSent.push(diff)
        } else if (newValue.length < oldValue.length) {
          diffSent.push(DEL)
        } else if (newValue !== oldValue) {
          diffSent.push(newValue)
        }
      }, 0)
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const deliver = (data: string) => delivered.push(data)

  const keydown = (keyCode: number) => {
    const event = new KeyboardEvent('keydown', { bubbles: true })
    Object.defineProperty(event, 'keyCode', { value: keyCode })
    textarea.dispatchEvent(event)
  }

  const fireInput = (
    type: 'beforeinput' | 'input',
    inputType: string,
    data: string
  ) => {
    textarea.dispatchEvent(
      new InputEvent(type, { bubbles: true, data, inputType })
    )
  }

  const commitComposedChar = (
    char: string,
    mutate: () => void = () => {
      textarea.value += char
    }
  ) => {
    keydown(229)
    fireInput('beforeinput', 'insertFromComposition', char)
    mutate()
    fireInput('input', 'insertFromComposition', char)
    textarea.dispatchEvent(
      new CompositionEvent('compositionend', { bubbles: true, data: char })
    )
  }

  const echoDirectKey = (keyCode: number, data: string, inserted = data) => {
    keydown(keyCode)
    fireInput('beforeinput', 'insertText', data)
    textarea.value += inserted
    fireInput('input', 'insertText', data)
  }

  it('delivers each composed char exactly once when keystrokes arrive in one burst', () => {
    attachOrphanCompositionEndGuard(root, deliver)

    commitComposedChar('e')
    commitComposedChar('e')
    vi.runAllTimers()

    expect(delivered).toEqual(['e', 'e'])
    expect(diffSent).toEqual([])
    expect(textarea.value).toBe('')
  })

  it('restores the textarea when WebKit normalizes a trailing NBSP during the commit', () => {
    attachOrphanCompositionEndGuard(root, deliver)

    textarea.value = `${NBSP}${NBSP}`
    commitComposedChar('e', () => {
      textarea.value = `${NBSP} e`
    })
    vi.runAllTimers()

    expect(delivered).toEqual(['e'])
    expect(diffSent).toEqual([])
    expect(textarea.value).toBe(`${NBSP}${NBSP}`)
  })

  it('restores the textarea when the commit replaces a char instead of appending', () => {
    attachOrphanCompositionEndGuard(root, deliver)

    textarea.value = '    '
    commitComposedChar('e', () => {
      textarea.value = '   e'
    })
    vi.runAllTimers()

    expect(delivered).toEqual(['e'])
    expect(diffSent).toEqual([])
    expect(textarea.value).toBe('    ')
  })

  it('drains insertText echoes of keys xterm already delivered directly', () => {
    attachOrphanCompositionEndGuard(root, deliver)

    echoDirectKey(32, ' ', NBSP)
    echoDirectKey(77, 'M')
    echoDirectKey(32, ' ', NBSP)
    vi.runAllTimers()

    expect(delivered).toEqual([])
    expect(diffSent).toEqual([])
    expect(textarea.value).toBe('')
  })

  it('keeps insertText after keydown(229) on the xterm diff path', () => {
    attachOrphanCompositionEndGuard(root, deliver)

    keydown(229)
    fireInput('beforeinput', 'insertText', '2')
    textarea.value += '2'
    fireInput('input', 'insertText', '2')
    vi.runAllTimers()

    expect(delivered).toEqual([])
    expect(diffSent).toEqual(['2'])
    expect(textarea.value).toBe('2')
  })

  it('leaves keydown-less insertText alone', () => {
    attachOrphanCompositionEndGuard(root, deliver)

    fireInput('beforeinput', 'insertText', 'emoji')
    textarea.value += 'emoji'
    fireInput('input', 'insertText', 'emoji')
    vi.runAllTimers()

    expect(delivered).toEqual([])
    expect(textarea.value).toBe('emoji')
  })

  it('leaves commits of a real balanced composition to xterm', () => {
    attachOrphanCompositionEndGuard(root, deliver)

    textarea.dispatchEvent(
      new CompositionEvent('compositionstart', { bubbles: true })
    )
    fireInput('beforeinput', 'insertFromComposition', 'fu')
    textarea.value += 'fu'
    fireInput('input', 'insertFromComposition', 'fu')

    expect(delivered).toEqual([])
    expect(textarea.value).toBe('fu')
  })

  it('keeps the legacy swallow-only behavior when no delivery callback is given', () => {
    attachOrphanCompositionEndGuard(root)

    commitComposedChar('e')
    vi.runAllTimers()

    expect(diffSent).toEqual(['e'])
    expect(textarea.value).toBe('e')
  })

  it('stops delivering and draining after cleanup', () => {
    const cleanup = attachOrphanCompositionEndGuard(root, deliver)
    cleanup()

    fireInput('beforeinput', 'insertFromComposition', 'e')
    textarea.value += 'e'
    fireInput('input', 'insertFromComposition', 'e')

    expect(delivered).toEqual([])
    expect(textarea.value).toBe('e')
  })
})
