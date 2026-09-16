import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildProjectDestination,
  getLastProjectDestination,
  getParentDirectory,
  rememberProjectDestination,
} from './project-destination'

describe('project destinations', () => {
  const storage = new Map<string, string>()

  beforeEach(() => {
    storage.clear()
    vi.mocked(localStorage.getItem).mockImplementation(
      key => storage.get(key) ?? null
    )
    vi.mocked(localStorage.setItem).mockImplementation((key, value) => {
      storage.set(key, value)
    })
  })

  it('preserves parent directories on POSIX and Windows paths', () => {
    expect(getParentDirectory('/Users/me/code/project')).toBe('/Users/me/code')
    expect(getParentDirectory('C:\\code\\project')).toBe('C:\\code')
    expect(buildProjectDestination('/Users/me/code/', 'new-project')).toBe(
      '/Users/me/code/new-project'
    )
  })

  it('remembers the parent of the most recently selected destination', () => {
    rememberProjectDestination('/Users/me/code/project')
    expect(getLastProjectDestination()).toBe('/Users/me/code')
  })
})
