import { getSingaporeNow, toSingaporeParts } from './timezone'

export interface CalendarDay {
  date: string
  isCurrentMonth: boolean
  isToday: boolean
  isPast: boolean
  isWeekend: boolean
}

export function getSingaporeDateKey(value: string | Date): string {
  const { year, month, day } = toSingaporeParts(value)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function generateCalendarGrid(year: number, month: number, now = getSingaporeNow()): CalendarDay[] {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError('Calendar year and month are out of range')
  }

  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
  const startWeekday = firstOfMonth.getUTCDay()
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const today = getSingaporeDateKey(now)

  return Array.from({ length: 42 }, (_, index) => {
    const dayOffset = index - startWeekday + 1
    const cellDate = new Date(Date.UTC(year, month - 1, dayOffset))
    const date = cellDate.toISOString().slice(0, 10)

    return {
      date,
      isCurrentMonth: dayOffset >= 1 && dayOffset <= daysInMonth,
      isToday: date === today,
      isPast: date < today,
      isWeekend: cellDate.getUTCDay() === 0 || cellDate.getUTCDay() === 6,
    }
  })
}