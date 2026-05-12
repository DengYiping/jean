import { describe, expect, it } from 'vitest'
import {
  buildScheduleRRule,
  getRunWindowPayload,
  parseSchedule,
} from './automation-schedule'

describe('automation schedule helpers', () => {
  it('parses hourly schedules with a run window', () => {
    const schedule = parseSchedule('FREQ=HOURLY;INTERVAL=2;BYMINUTE=0', 9, 17)

    expect(schedule.frequency).toBe('hourly')
    expect(schedule.interval).toBe(2)
    expect(schedule.time).toBe('00:00')
    expect(schedule.runWindowEnabled).toBe(true)
    expect(schedule.runWindowStartHour).toBe(9)
    expect(schedule.runWindowEndHour).toBe(17)
  })

  it('builds hourly schedules without encoding the run window into the rrule', () => {
    const schedule = parseSchedule('FREQ=HOURLY;INTERVAL=1;BYMINUTE=30', 9, 17)

    expect(buildScheduleRRule(schedule)).toBe(
      'FREQ=HOURLY;INTERVAL=1;BYMINUTE=30'
    )
    expect(getRunWindowPayload(schedule)).toEqual({
      run_window_start_hour: 9,
      run_window_end_hour: 17,
    })
  })

  it('drops the run window payload for non-hourly schedules', () => {
    const schedule = parseSchedule(
      'FREQ=DAILY;INTERVAL=1;BYHOUR=9;BYMINUTE=0',
      9,
      17
    )

    expect(schedule.frequency).toBe('daily')
    expect(schedule.runWindowEnabled).toBe(false)
    expect(getRunWindowPayload(schedule)).toEqual({
      run_window_start_hour: null,
      run_window_end_hour: null,
    })
  })

  it('parses minutely schedules with a run window', () => {
    const schedule = parseSchedule('FREQ=MINUTELY;INTERVAL=10', 9, 17)

    expect(schedule.frequency).toBe('minutely')
    expect(schedule.interval).toBe(10)
    expect(schedule.runWindowEnabled).toBe(true)
    expect(schedule.runWindowStartHour).toBe(9)
    expect(schedule.runWindowEndHour).toBe(17)
  })

  it('builds minutely schedules and keeps run window payload separate', () => {
    const schedule = parseSchedule('FREQ=MINUTELY;INTERVAL=20', 9, 17)

    expect(buildScheduleRRule(schedule)).toBe('FREQ=MINUTELY;INTERVAL=20')
    expect(getRunWindowPayload(schedule)).toEqual({
      run_window_start_hour: 9,
      run_window_end_hour: 17,
    })
  })
})
