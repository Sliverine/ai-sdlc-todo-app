const SINGAPORE_OFFSET_MS = 8 * 60 * 60 * 1000
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})?$/

export type DueDateResult =
  | { valid: true; value: string | null }
  | { valid: false; error: string }

export function getSingaporeNow(): Date {
  return new Date()
}

export function formatSingaporeDate(value: string | Date): string {
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(typeof value === 'string' ? new Date(value) : value)
}

export function toSingaporeDateTimeInput(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''

  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const fields = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]))
  return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`
}

export function parseDueDate(value: unknown): DueDateResult {
  if (value === null || value === undefined || value === '') {
    return { valid: true, value: null }
  }
  if (typeof value !== 'string') {
    return { valid: false, error: 'Due date must be a valid date' }
  }

  const match = DATE_TIME_PATTERN.exec(value)
  if (!match) return { valid: false, error: 'Due date must be a valid date' }

  const [, yearText, monthText, dayText, hourText, minuteText, secondText = '0', fractionText = '', zone = ''] = match
  const parts = {
    year: Number(yearText),
    month: Number(monthText),
    day: Number(dayText),
    hour: Number(hourText),
    minute: Number(minuteText),
    second: Number(secondText),
    millisecond: Number(fractionText.padEnd(3, '0')),
  }
  const localMilliseconds = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  )
  const localDate = new Date(localMilliseconds)
  const hasValidCalendarDate = localDate.getUTCFullYear() === parts.year
    && localDate.getUTCMonth() === parts.month - 1
    && localDate.getUTCDate() === parts.day
    && parts.hour <= 23
    && parts.minute <= 59
    && parts.second <= 59
  if (!hasValidCalendarDate) return { valid: false, error: 'Due date must be a valid date' }

  let dueMilliseconds = localMilliseconds
  if (zone === '') {
    dueMilliseconds -= SINGAPORE_OFFSET_MS
  } else if (zone !== 'Z') {
    const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(zone)
    if (!offsetMatch) return { valid: false, error: 'Due date must be a valid date' }
    const [, sign, offsetHoursText, offsetMinutesText] = offsetMatch
    const offsetHours = Number(offsetHoursText)
    const offsetMinutes = Number(offsetMinutesText)
    if (offsetHours > 14 || offsetMinutes > 59 || (offsetHours === 14 && offsetMinutes !== 0)) {
      return { valid: false, error: 'Due date must be a valid date' }
    }
    const offset = (offsetHours * 60 + offsetMinutes) * 60 * 1000
    dueMilliseconds += sign === '+' ? -offset : offset
  }

  if (!Number.isFinite(dueMilliseconds)) return { valid: false, error: 'Due date must be a valid date' }

  return { valid: true, value: new Date(dueMilliseconds).toISOString() }
}

export function normalizeDueDate(value: unknown, now = getSingaporeNow()): DueDateResult {
  const parsed = parseDueDate(value)
  if (!parsed.valid || parsed.value === null) return parsed

  if (Date.parse(parsed.value) < now.getTime() + 60_000) {
    return { valid: false, error: 'Due date must be at least 1 minute in the future' }
  }
  return parsed
}

export function parseSingaporeDate(value: string): Date {
  const parsed = parseDueDate(value)
  if (!parsed.valid || parsed.value === null) throw new Error('Invalid date')
  return new Date(parsed.value)
}

export const toSingaporeInput = toSingaporeDateTimeInput

export function dateFromTimestamp(timestamp: number): Date {
  return new Date(timestamp)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function toSingaporeParts(value: string | Date) {
  const date = typeof value === 'string' ? parseSingaporeDate(value) : value
  const local = new Date(date.getTime() + SINGAPORE_OFFSET_MS)
  return {
    year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
    hour: local.getUTCHours(), minute: local.getUTCMinutes(), second: local.getUTCSeconds(),
    millisecond: local.getUTCMilliseconds(),
  }
}

export function fromSingaporeParts(
  parts: { year: number; month: number; day: number },
  hour = 0, minute = 0, second = 0, millisecond = 0,
): string {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 8, minute, second, millisecond)).toISOString()
}