import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getNotificationSoundOptions,
  normalizeNotificationSound,
  playNotificationSound,
  preloadAllSounds,
} from './sounds'

const { mockPlay, mockPause, audioInstances } = vi.hoisted(() => {
  const mockPlay = vi.fn().mockResolvedValue(undefined)
  const mockPause = vi.fn()
  const audioInstances: {
    src: string
    preload: string
    currentTime: number
    play: typeof mockPlay
    pause: typeof mockPause
  }[] = []

  return { mockPlay, mockPause, audioInstances }
})

class MockAudio {
  preload = ''
  currentTime = 0
  play = mockPlay
  pause = mockPause

  constructor(public src: string) {
    audioInstances.push(this)
  }
}

describe('sounds', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    audioInstances.length = 0
    vi.stubGlobal('Audio', MockAudio)
  })

  it('discovers sound options from asset filenames', () => {
    expect(getNotificationSoundOptions()).toEqual([
      { value: 'none', label: 'None' },
      { value: 'jobs-done', label: 'Jobs Done' },
      { value: 'work-work', label: 'Work Work' },
    ])
  })

  it('normalizes legacy and invalid sound values to none', () => {
    expect(normalizeNotificationSound('choochoo')).toBe('none')
    expect(normalizeNotificationSound('missing-sound')).toBe('none')
    expect(normalizeNotificationSound('work-work')).toBe('work-work')
    expect(normalizeNotificationSound(undefined)).toBe('none')
  })

  it('plays discovered sounds by normalized asset name', () => {
    playNotificationSound('work-work')

    expect(audioInstances).toHaveLength(1)
    expect(audioInstances[0]?.src).toMatch(/work-work\.mp3$/)
    expect(mockPlay).toHaveBeenCalledTimes(1)
  })

  it('preloads all discovered sound assets', () => {
    preloadAllSounds()

    expect(audioInstances).toHaveLength(2)
    expect(audioInstances.map(audio => audio.src)).toEqual([
      expect.stringMatching(/jobs-done\.mp3$/),
      expect.stringMatching(/work-work\.mp3$/),
    ])
    expect(audioInstances.every(audio => audio.preload === 'auto')).toBe(true)
  })
})
