export type Frequency = 'minutely' | 'hourly' | 'daily' | 'weekly'
export type WeekdayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export interface AutomationScheduleFields {
  frequency: Frequency
  interval: number
  time: string
  weekdays: WeekdayCode[]
  excludedWeekdays: WeekdayCode[]
  runWindowEnabled: boolean
  runWindowStartHour: number
  runWindowEndHour: number
}

export const WEEKDAYS: { code: WeekdayCode; label: string }[] = [
  { code: 'MO', label: 'Mon' },
  { code: 'TU', label: 'Tue' },
  { code: 'WE', label: 'Wed' },
  { code: 'TH', label: 'Thu' },
  { code: 'FR', label: 'Fri' },
  { code: 'SA', label: 'Sat' },
  { code: 'SU', label: 'Sun' },
]

export const MINUTE_INTERVAL_OPTIONS = [10, 20, 30] as const

export function defaultScheduleFields(): AutomationScheduleFields {
  return {
    frequency: 'daily',
    interval: 1,
    time: '09:00',
    weekdays: ['MO'],
    excludedWeekdays: [],
    runWindowEnabled: false,
    runWindowStartHour: 9,
    runWindowEndHour: 17,
  }
}

export function parseSchedule(
  rrule: string,
  runWindowStartHour?: number | null,
  runWindowEndHour?: number | null
): AutomationScheduleFields {
  const defaults = defaultScheduleFields()
  if (!rrule) return defaults

  const parts = new Map(
    rrule.split(';').map(part => {
      const [key, value] = part.split('=', 2)
      return [key?.toUpperCase() ?? '', value ?? '']
    })
  )

  const rawFrequency = parts.get('FREQ')?.toLowerCase()
  const frequency: Frequency =
    rawFrequency === 'minutely' ||
    rawFrequency === 'hourly' ||
    rawFrequency === 'daily' ||
    rawFrequency === 'weekly'
      ? rawFrequency
      : defaults.frequency
  const interval = Math.max(1, Number(parts.get('INTERVAL') ?? '1') || 1)
  const hour = Number(
    parts.get('BYHOUR') ??
      (frequency === 'hourly' || frequency === 'minutely' ? '0' : '9')
  )
  const minute = Number(parts.get('BYMINUTE') ?? '0')
  const weekdays = (parts.get('BYDAY') ?? 'MO')
    .split(',')
    .map(day => day.trim().toUpperCase())
    .filter((day): day is WeekdayCode =>
      WEEKDAYS.some(option => option.code === day)
    )
  const excludedWeekdays = (parts.get('EXDAY') ?? '')
    .split(',')
    .map(day => day.trim().toUpperCase())
    .filter((day): day is WeekdayCode =>
      WEEKDAYS.some(option => option.code === day)
    )

  return {
    frequency,
    interval,
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    weekdays: weekdays.length > 0 ? weekdays : defaults.weekdays,
    excludedWeekdays,
    runWindowEnabled:
      (frequency === 'hourly' || frequency === 'minutely') &&
      runWindowStartHour != null &&
      runWindowEndHour != null,
    runWindowStartHour: runWindowStartHour ?? defaults.runWindowStartHour,
    runWindowEndHour: runWindowEndHour ?? defaults.runWindowEndHour,
  }
}

export function buildScheduleRRule(schedule: AutomationScheduleFields): string {
  const [hour, minute] = schedule.time.split(':').map(Number)

  let rrule: string
  if (schedule.frequency === 'minutely') {
    rrule = `FREQ=MINUTELY;INTERVAL=${schedule.interval}`
  } else if (schedule.frequency === 'hourly') {
    rrule = `FREQ=HOURLY;INTERVAL=${schedule.interval};BYMINUTE=${minute || 0}`
  } else if (schedule.frequency === 'daily') {
    rrule = `FREQ=DAILY;INTERVAL=${schedule.interval};BYHOUR=${hour || 0};BYMINUTE=${minute || 0}`
  } else {
    const weekdays =
      schedule.weekdays.length > 0 ? schedule.weekdays.join(',') : 'MO'
    rrule = `FREQ=WEEKLY;INTERVAL=${schedule.interval};BYDAY=${weekdays};BYHOUR=${hour || 0};BYMINUTE=${minute || 0}`
  }

  return schedule.excludedWeekdays.length > 0
    ? `${rrule};EXDAY=${schedule.excludedWeekdays.join(',')}`
    : rrule
}

export function getRunWindowPayload(schedule: AutomationScheduleFields): {
  run_window_start_hour: number | null
  run_window_end_hour: number | null
} {
  if (
    (schedule.frequency !== 'hourly' && schedule.frequency !== 'minutely') ||
    !schedule.runWindowEnabled
  ) {
    return {
      run_window_start_hour: null,
      run_window_end_hour: null,
    }
  }

  return {
    run_window_start_hour: schedule.runWindowStartHour,
    run_window_end_hour: schedule.runWindowEndHour,
  }
}

export function formatHourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}
