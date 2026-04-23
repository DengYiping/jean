import { describe, expect, it } from 'vitest'
import { getPrStatusDisplay } from './toolbar-utils'

describe('getPrStatusDisplay', () => {
  it('uses amber styling for draft PRs', () => {
    expect(getPrStatusDisplay('draft')).toEqual({
      label: 'Draft',
      className: 'text-amber-600 dark:text-amber-400',
    })
  })
})
