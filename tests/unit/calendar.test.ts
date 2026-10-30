import { describe, expect, it } from 'vitest'
import { generateCalendarGrid, getSingaporeDateKey } from '../../lib/calendar'

describe('calendar grid', () => {
  it('generates exactly six weeks and includes leap day', () => {
    const grid = generateCalendarGrid(2028, 2, new Date('2028-02-10T04:00:00.000Z'))

    expect(grid).toHaveLength(42)
    expect(grid.filter((day) => day.isCurrentMonth)).toHaveLength(29)
    expect(grid.find((day) => day.date === '2028-02-29')?.isCurrentMonth).toBe(true)
  })

  it('marks today using the Singapore calendar date', () => {
    const grid = generateCalendarGrid(2026, 3, new Date('2026-02-28T16:30:00.000Z'))

    expect(grid.filter((day) => day.isToday).map((day) => day.date)).toEqual(['2026-03-01'])
    expect(getSingaporeDateKey('2026-03-01T00:30:00+08:00')).toBe('2026-03-01')
  })

  it('marks weekend cells by Sunday and Saturday columns', () => {
    const grid = generateCalendarGrid(2026, 3)

    expect(grid.filter((day) => day.isWeekend)).toHaveLength(12)
    expect(grid.every((day, index) => day.isWeekend === (index % 7 === 0 || index % 7 === 6))).toBe(true)
  })

  it('rejects invalid month values', () => {
    expect(() => generateCalendarGrid(2026, 13)).toThrow(RangeError)
  })
})