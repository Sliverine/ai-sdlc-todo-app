import { describe, expect, it } from 'vitest'
import { PRIORITY_ORDER, PRIORITY_VALUES, type Todo } from '../lib/db'
import { calculateProgress, sectionTodos, sortTodos, validatePriority } from '../lib/todo-utils'
import { formatSingaporeDate, normalizeDueDate, parseDueDate, toSingaporeDateTimeInput } from '../lib/timezone'

const now = new Date('2026-10-30T00:00:00.000Z')

describe('priority contract', () => {
  it('exports the canonical priority values and ordering', () => {
    expect(PRIORITY_VALUES).toEqual(['high', 'medium', 'low'])
    expect(PRIORITY_ORDER).toEqual({ high: 0, medium: 1, low: 2 })
  })

  it('defaults omitted and null create priorities to medium', () => {
    expect(validatePriority(undefined)).toBe('medium')
    expect(validatePriority(null)).toBe('medium')
  })

  it.each(['high', 'medium', 'low'] as const)('accepts %s priority', (priority) => {
    expect(validatePriority(priority)).toBe(priority)
  })

  it.each(['urgent', 'HIGH', ''])('rejects invalid priority %j with a descriptive error', (priority) => {
    expect(() => validatePriority(priority)).toThrow(
      `Invalid priority: ${priority}. Must be 'high', 'medium', or 'low'.`,
    )
  })

  it('rejects null priority when validating an update', () => {
    expect(() => validatePriority(null, 'update')).toThrow(
      "Invalid priority: null. Must be 'high', 'medium', or 'low'.",
    )
  })
})

function todo(overrides: Partial<Todo> & Pick<Todo, 'id' | 'title'>): Todo {
  return {
    user_id: 1,
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    last_notification_sent: null,
    created_at: '2026-10-29T00:00:00.000Z',
    updated_at: null,
    ...overrides,
  }
}

describe('normalizeDueDate', () => {
  it('converts Singapore-local date-time input to a canonical UTC instant', () => {
    expect(normalizeDueDate('2026-10-30T09:00', now)).toEqual({
      valid: true,
      value: '2026-10-30T01:00:00.000Z',
    })
  })

  it('accepts an offset-bearing ISO instant and normalizes it to UTC', () => {
    expect(normalizeDueDate('2026-10-30T10:00:00+09:00', now)).toEqual({
      valid: true,
      value: '2026-10-30T01:00:00.000Z',
    })
  })

  it('accepts a deadline exactly one minute ahead and rejects an earlier one', () => {
    expect(normalizeDueDate('2026-10-30T00:01:00.000Z', now)).toEqual({
      valid: true,
      value: '2026-10-30T00:01:00.000Z',
    })
    expect(normalizeDueDate('2026-10-30T00:00:59.999Z', now)).toEqual({
      valid: false,
      error: 'Due date must be at least 1 minute in the future',
    })
  })

  it('allows an omitted deadline and rejects malformed or calendar-invalid values', () => {
    expect(normalizeDueDate(null, now)).toEqual({ valid: true, value: null })
    expect(normalizeDueDate('not-a-date', now).valid).toBe(false)
    expect(normalizeDueDate('2026-02-30T12:00', now).valid).toBe(false)
  })

  it('parses an unchanged historical deadline without relaxing future-date validation', () => {
    expect(parseDueDate('2026-10-29T09:00')).toEqual({
      valid: true,
      value: '2026-10-29T01:00:00.000Z',
    })
    expect(normalizeDueDate('2026-10-29T09:00', now).valid).toBe(false)
  })

  it('formats a UTC instant for a Singapore-local datetime input', () => {
    expect(toSingaporeDateTimeInput('2026-10-30T00:00:00.000Z')).toBe('2026-10-30T08:00')
    expect(toSingaporeDateTimeInput(null)).toBe('')
    expect(toSingaporeDateTimeInput('invalid')).toBe('')
  })

  it('formats a Date instance in Singapore and rejects unsupported offsets', () => {
    expect(formatSingaporeDate(new Date('2026-10-30T00:00:00.000Z'))).toContain('30 Oct 2026')
    expect(parseDueDate('2026-10-30T12:00+15:00')).toEqual({
      valid: false,
      error: 'Due date must be a valid date',
    })
    expect(parseDueDate({})).toEqual({ valid: false, error: 'Due date must be a valid date' })
  })

  it('returns empty sections for an empty list', () => {
    expect(sectionTodos([], now)).toEqual({ overdue: [], pending: [], completed: [] })
  })
})

describe('todo sorting and sections', () => {
  it('sorts without mutating by priority, due date, then newest creation time', () => {
    const todos = [
      todo({ id: 1, title: 'later high', priority: 'high', due_date: '2026-10-31T00:00:00.000Z' }),
      todo({ id: 2, title: 'older medium', priority: 'medium', created_at: '2026-10-28T00:00:00.000Z' }),
      todo({ id: 3, title: 'newer medium', priority: 'medium', created_at: '2026-10-29T12:00:00.000Z' }),
      todo({ id: 4, title: 'earlier high', priority: 'high', due_date: '2026-10-30T12:00:00.000Z' }),
    ]
    const original = [...todos]

    expect(sortTodos(todos).map(({ id }) => id)).toEqual([4, 1, 3, 2])
    expect(todos).toEqual(original)
  })

  it('sorts same-priority dated todos before undated todos', () => {
    const todos = [
      todo({ id: 1, title: 'Undated', priority: 'low', created_at: '2026-10-30T12:00:00.000Z' }),
      todo({ id: 2, title: 'Dated', priority: 'low', due_date: '2026-11-01T12:00:00.000Z' }),
    ]

    expect(sortTodos(todos).map(({ id }) => id)).toEqual([2, 1])
  })

  it('places past-due incomplete todos in overdue, exact-now and undated todos in pending', () => {
    const sections = sectionTodos([
      todo({ id: 1, title: 'overdue', due_date: '2026-10-29T23:59:59.999Z' }),
      todo({ id: 2, title: 'due now', due_date: now.toISOString() }),
      todo({ id: 3, title: 'undated' }),
      todo({ id: 4, title: 'completed overdue', completed: true, due_date: '2026-10-29T00:00:00.000Z' }),
    ], now)

    expect(sections.overdue.map(({ id }) => id)).toEqual([1])
    expect(sections.pending.map(({ id }) => id)).toEqual([2, 3])
    expect(sections.completed.map(({ id }) => id)).toEqual([4])
  })

  it('orders completed todos by most recently updated, falling back to creation time', () => {
    const sections = sectionTodos([
      todo({ id: 2, title: 'updated latest', completed: true, created_at: '2026-10-29T00:00:00.000Z', updated_at: '2026-10-29T23:30:00.000Z' }),
      todo({ id: 1, title: 'created latest', completed: true, created_at: '2026-10-29T23:00:00.000Z' }),
      todo({ id: 3, title: 'created earlier', completed: true, created_at: '2026-10-29T22:00:00.000Z' }),
    ], now)

    expect(sections.completed.map(({ id }) => id)).toEqual([2, 1, 3])
  })
})

describe('subtask progress', () => {
  it('calculates empty, incomplete, partial, and complete progress with rounding', () => {
    expect(calculateProgress([])).toEqual({ completed: 0, total: 0, percent: 0 })
    expect(calculateProgress([
      { id: 1, todo_id: 1, title: 'First', completed: false, position: 0, created_at: '' },
      { id: 2, todo_id: 1, title: 'Second', completed: false, position: 1, created_at: '' },
    ])).toEqual({ completed: 0, total: 2, percent: 0 })
    expect(calculateProgress([
      { id: 1, todo_id: 1, title: 'First', completed: true, position: 0, created_at: '' },
      { id: 2, todo_id: 1, title: 'Second', completed: false, position: 1, created_at: '' },
      { id: 3, todo_id: 1, title: 'Third', completed: false, position: 2, created_at: '' },
    ])).toEqual({ completed: 1, total: 3, percent: 33 })
    expect(calculateProgress([
      { id: 1, todo_id: 1, title: 'First', completed: true, position: 0, created_at: '' },
      { id: 2, todo_id: 1, title: 'Second', completed: true, position: 1, created_at: '' },
      { id: 3, todo_id: 1, title: 'Third', completed: false, position: 2, created_at: '' },
    ])).toEqual({ completed: 2, total: 3, percent: 67 })
    expect(calculateProgress([
      { id: 1, todo_id: 1, title: 'First', completed: true, position: 0, created_at: '' },
    ])).toEqual({ completed: 1, total: 1, percent: 100 })
  })
})