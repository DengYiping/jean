import { describe, expect, it } from 'vitest'
import {
  getDetectedEditorOptions,
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
})
