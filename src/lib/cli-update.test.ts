import { describe, expect, it } from 'vitest'
import {
  CLI_DISPLAY_NAMES,
  CLI_SELF_UPDATE_ARGS,
  resolveCliPathUpdateAction,
} from './cli-update'

describe('cli-update', () => {
  it('supports CodeRabbit self updates through the shared PATH updater', () => {
    expect(CLI_DISPLAY_NAMES.coderabbit).toBe('CodeRabbit CLI')
    expect(CLI_SELF_UPDATE_ARGS.coderabbit).toEqual(['update'])
    expect(
      resolveCliPathUpdateAction(
        'coderabbit',
        '/usr/local/bin/coderabbit',
        null,
        null
      )
    ).toEqual(['/usr/local/bin/coderabbit', ['update']])
  })
})
