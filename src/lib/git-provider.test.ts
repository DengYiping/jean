import { describe, expect, it } from 'vitest'
import { buildCloneUrl } from './git-provider'

describe('buildCloneUrl', () => {
  it.each([
    ['github', 'user/repository', 'https://github.com/user/repository'],
    [
      'gitlab',
      '/team/repository.git',
      'https://gitlab.com/team/repository.git',
    ],
    [
      'custom',
      ' git@host:team/repository.git ',
      'git@host:team/repository.git',
    ],
  ] as const)('builds %s clone URLs', (provider, value, expected) => {
    expect(buildCloneUrl(provider, value)).toBe(expected)
  })
})
