import { describe, expect, it } from 'vitest'
import { calculateNextDueDate } from '@/lib/recurrence'
import type { RecurrencePattern } from '@/lib/db'

const sg = (local: string) => new Date(`${local}:00+08:00`).toISOString()

describe('calculateNextDueDate', () => {
  it.each<[string, RecurrencePattern, string]>([
    ['2025-11-10T14:00', 'daily', '2025-11-11T14:00'],
    ['2025-11-10T14:00', 'weekly', '2025-11-17T14:00'],
    ['2025-06-15T09:00', 'monthly', '2025-07-15T09:00'],
    ['2025-01-31T09:00', 'monthly', '2025-02-28T09:00'],
    ['2024-01-31T09:00', 'monthly', '2024-02-29T09:00'],
    ['2025-12-31T09:00', 'monthly', '2026-01-31T09:00'],
    ['2025-06-15T09:00', 'yearly', '2026-06-15T09:00'],
    ['2024-02-29T09:00', 'yearly', '2025-02-28T09:00'],
    ['2025-03-31T23:45', 'daily', '2025-04-01T23:45'],
    ['2025-03-31T00:15', 'monthly', '2025-04-30T00:15'],
  ])('%s %s -> %s (Singapore time, time-of-day preserved)', (current, pattern, expected) => {
    expect(calculateNextDueDate(sg(current), pattern)).toBe(sg(expected))
  })

  it('rejects unknown patterns', () => {
    expect(() => calculateNextDueDate(sg('2025-06-15T09:00'), 'hourly' as RecurrencePattern)).toThrow('Invalid recurrence pattern')
  })
})
