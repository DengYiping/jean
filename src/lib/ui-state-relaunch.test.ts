import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerUIStateRelaunchSaver,
  relaunchAfterUIStateSave,
} from './ui-state-relaunch'

describe('UI state persistence before relaunch', () => {
  beforeEach(() => registerUIStateRelaunchSaver(null))

  it('waits for the latest UI state to save before relaunching', async () => {
    const order: string[] = []
    registerUIStateRelaunchSaver(async () => {
      order.push('saved')
    })
    const relaunch = vi.fn(async () => {
      order.push('relaunched')
    })

    await relaunchAfterUIStateSave(relaunch)

    expect(order).toEqual(['saved', 'relaunched'])
  })

  it('still relaunches when persistence fails', async () => {
    registerUIStateRelaunchSaver(() => Promise.reject(new Error('save failed')))
    const relaunch = vi.fn().mockResolvedValue(undefined)

    await expect(relaunchAfterUIStateSave(relaunch)).rejects.toThrow(
      'save failed'
    )
    expect(relaunch).toHaveBeenCalledOnce()
  })
})
