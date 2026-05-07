import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KEYBINDINGS,
  KEYBINDING_DEFINITIONS,
  eventToShortcutString,
} from '@/types/keybindings'

describe('eventToShortcutString', () => {
  it('maps alt-modified letter keys using physical key code', () => {
    const modelEvent = new KeyboardEvent('keydown', {
      key: 'µ',
      code: 'KeyM',
      altKey: true,
    })
    const thinkingEvent = new KeyboardEvent('keydown', {
      key: 'Dead',
      code: 'KeyE',
      altKey: true,
    })

    expect(eventToShortcutString(modelEvent)).toBe('alt+m')
    expect(eventToShortcutString(thinkingEvent)).toBe('alt+e')
  })

  it('normalizes shifted punctuation via key code', () => {
    const slashEvent = new KeyboardEvent('keydown', {
      key: '?',
      code: 'Slash',
      shiftKey: true,
    })

    expect(eventToShortcutString(slashEvent)).toBe('shift+slash')
  })

  it('falls back to key when code is not in the mapping', () => {
    const f5Event = new KeyboardEvent('keydown', {
      key: 'F5',
      code: 'F5',
    })

    expect(eventToShortcutString(f5Event)).toBe('f5')
  })

  it('normalizes delete keys to backspace for shortcut matching', () => {
    const deleteEvent = new KeyboardEvent('keydown', {
      key: 'Delete',
      code: 'Delete',
      metaKey: true,
      altKey: true,
    })

    expect(eventToShortcutString(deleteEvent)).toBe('mod+alt+backspace')
  })

  it('ignores modifier-only keys', () => {
    const altOnlyEvent = new KeyboardEvent('keydown', {
      key: 'Alt',
      code: 'AltLeft',
      altKey: true,
    })

    expect(eventToShortcutString(altOnlyEvent)).toBeNull()
  })

  it('registers the parallel execution prompting shortcut in defaults and settings metadata', () => {
    expect(DEFAULT_KEYBINDINGS.toggle_parallel_execution_prompting).toBe(
      'mod+alt+p'
    )
    expect(
      KEYBINDING_DEFINITIONS.find(
        definition =>
          definition.action === 'toggle_parallel_execution_prompting'
      )
    ).toMatchObject({
      label: 'Toggle parallel prompting',
      default_shortcut: 'mod+alt+p',
      category: 'chat',
    })
  })

  it('registers the new project dialog shortcut in defaults and settings metadata', () => {
    expect(DEFAULT_KEYBINDINGS.open_new_project_dialog).toBe('mod+shift+n')
    expect(
      KEYBINDING_DEFINITIONS.find(
        definition => definition.action === 'open_new_project_dialog'
      )
    ).toMatchObject({
      label: 'New project',
      default_shortcut: 'mod+shift+n',
      category: 'navigation',
    })
  })

  it('registers agent board shortcuts in defaults and settings metadata', () => {
    expect(DEFAULT_KEYBINDINGS.open_agent_board).toBe('mod+shift+a')
    expect(DEFAULT_KEYBINDINGS.new_agent_todo).toBe('mod+alt+a')

    expect(
      KEYBINDING_DEFINITIONS.find(
        definition => definition.action === 'open_agent_board'
      )
    ).toMatchObject({
      label: 'Agent Board',
      default_shortcut: 'mod+shift+a',
      category: 'navigation',
    })
    expect(
      KEYBINDING_DEFINITIONS.find(
        definition => definition.action === 'new_agent_todo'
      )
    ).toMatchObject({
      label: 'New agent todo',
      default_shortcut: 'mod+alt+a',
      category: 'navigation',
    })
  })
})
