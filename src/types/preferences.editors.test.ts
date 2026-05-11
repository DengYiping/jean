import { describe, expect, it } from 'vitest'
import {
  getDetectedEditorOptions,
  getEditorOptions,
  type EditorApp,
  getEditorLabel,
} from './preferences'

describe('getDetectedEditorOptions', () => {
  it('keeps the preferred editor first and deduplicates detected editors', () => {
    const options = getDetectedEditorOptions('cursor', [
      'zed',
      'cursor',
      'vscode',
    ])

    expect(options).toEqual([
      { value: 'cursor', label: getEditorLabel('cursor'), isDefault: true },
      { value: 'zed', label: getEditorLabel('zed'), isDefault: false },
      { value: 'vscode', label: getEditorLabel('vscode'), isDefault: false },
    ])
  })

  it('preserves the supported editor order for detected editors', () => {
    const options = getDetectedEditorOptions(undefined, [
      'intellij',
      'zed',
      'cursor',
    ])

    expect(options.map(option => option.value)).toEqual([
      'zed',
      'cursor',
      'intellij',
    ])
  })

  it('ignores unsupported editor ids', () => {
    const options = getDetectedEditorOptions('cursor', [
      'cursor',
      'not-real' as EditorApp,
      'vscode',
    ])

    expect(options.map(option => option.value)).toEqual(['cursor', 'vscode'])
  })

  it('appends custom editors and resolves their labels', () => {
    const customEditors = [
      {
        id: 'custom:helix',
        name: 'Helix',
        command: 'hx',
        args: ['{path}'],
        supports_line_number: false,
      },
    ]

    const options = getDetectedEditorOptions(
      'custom:helix',
      ['cursor'],
      customEditors
    )

    expect(options).toEqual([
      { value: 'custom:helix', label: 'Helix', isDefault: true },
      { value: 'cursor', label: getEditorLabel('cursor'), isDefault: false },
    ])
    expect(getEditorLabel('custom:helix', customEditors)).toBe('Helix')
    expect(getEditorOptions(customEditors).at(-1)).toEqual({
      value: 'custom:helix',
      label: 'Helix',
    })
  })
})
