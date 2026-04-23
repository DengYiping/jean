/**
 * Sound notification utilities for session status events.
 * Plays sounds when sessions complete or need input.
 */

import type { NotificationSound } from '@/types/preferences'

interface NotificationSoundOption {
  value: NotificationSound
  label: string
}

const NONE_SOUND = 'none'
const LEGACY_SOUND_NAMES = new Set(['choochoo'])

const soundModules = import.meta.glob('../assets/sounds/*.mp3', {
  eager: true,
  import: 'default',
  query: '?url',
}) as Record<string, string>

const notificationSoundAssetMap = Object.entries(soundModules)
  .map(([modulePath, assetUrl]) => {
    const filename = modulePath.split('/').pop() ?? ''
    const value = filename.replace(/\.mp3$/i, '')
    return value ? ([value, assetUrl] as const) : null
  })
  .filter(
    (entry): entry is readonly [NotificationSound, string] => entry != null
  )
  .sort(([left], [right]) => left.localeCompare(right))

const notificationSoundUrlMap = new Map(notificationSoundAssetMap)

function formatNotificationSoundLabel(value: string): string {
  return value
    .split(/[-_]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

const notificationSoundOptions: NotificationSoundOption[] = [
  { value: NONE_SOUND, label: 'None' },
  ...notificationSoundAssetMap.map(([value]) => ({
    value,
    label: formatNotificationSoundLabel(value),
  })),
]

// Single audio instance to prevent overlapping sounds
let currentAudio: HTMLAudioElement | null = null

// Audio context for system beep fallback (reused to avoid creating many contexts)
let audioContext: AudioContext | null = null

export function getNotificationSoundOptions(): NotificationSoundOption[] {
  return notificationSoundOptions
}

export function normalizeNotificationSound(
  sound: NotificationSound | null | undefined
): NotificationSound {
  if (!sound || sound === NONE_SOUND || LEGACY_SOUND_NAMES.has(sound)) {
    return NONE_SOUND
  }

  return notificationSoundUrlMap.has(sound) ? sound : NONE_SOUND
}

function getNotificationSoundUrl(
  sound: NotificationSound | null | undefined
): string | null {
  const normalizedSound = normalizeNotificationSound(sound)
  if (normalizedSound === NONE_SOUND) return null
  return notificationSoundUrlMap.get(normalizedSound) ?? null
}

/**
 * Play a notification sound. If a sound is already playing, it will be stopped first.
 * Falls back to a system beep if the audio file is not found or playback fails.
 */
export function playNotificationSound(sound: NotificationSound): void {
  const soundSrc = getNotificationSoundUrl(sound)
  if (!soundSrc) return

  // Stop any currently playing sound to prevent overlap
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.currentTime = 0
    currentAudio = null
  }

  const audio = new Audio(soundSrc)
  currentAudio = audio

  audio.play().catch(() => {
    // File not found or autoplay blocked - fallback to system beep
    playSystemBeep()
  })
}

/**
 * Play a synthesized system beep as fallback when audio files are unavailable.
 * Uses Web Audio API to generate a short tone.
 */
function playSystemBeep(): void {
  try {
    // Reuse or create audio context
    if (!audioContext) {
      audioContext = new AudioContext()
    }

    // Resume context if it's suspended (browser autoplay policy)
    if (audioContext.state === 'suspended') {
      audioContext.resume()
    }

    const oscillator = audioContext.createOscillator()
    const gain = audioContext.createGain()

    oscillator.connect(gain)
    gain.connect(audioContext.destination)

    // Configure a pleasant notification tone
    oscillator.frequency.value = 800
    oscillator.type = 'sine'
    gain.gain.value = 0.1

    // Play for 150ms
    oscillator.start()
    oscillator.stop(audioContext.currentTime + 0.15)
  } catch {
    // Silently fail if Web Audio API is unavailable
  }
}

// Cache for preloaded audio elements
const audioCache = new Map<NotificationSound, HTMLAudioElement>()

/**
 * Preload all sound files to ensure instant playback.
 * Call this on app startup.
 */
export function preloadAllSounds(): void {
  for (const option of notificationSoundOptions) {
    const soundSrc = getNotificationSoundUrl(option.value)
    if (!soundSrc) continue

    const audio = new Audio(soundSrc)
    audio.preload = 'auto'
    audioCache.set(option.value, audio)
  }
}
