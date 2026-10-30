import { describe, expect, it } from 'vitest'
import type { Todo } from '@/lib/db'
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, type FilterState } from '@/lib/filters'

const task = (id: number, overrides: Partial<Todo> = {}): Todo => ({
  id, user_id: 1, title: 'Team MÉETING', completed: false, due_date: '2030-01-01T16:30:00Z',
  priority: 'high', is_recurring: false, recurrence_pattern: null, reminder_minutes: null,
  last_notification_sent: null, created_at: '2030-01-01T00:00:00Z', updated_at: null, ...overrides,
})
const todos = [
  task(1, { tags: [{ id: 7, user_id: 1, name: 'Work', color: '#ffffff', created_at: '' }] }),
  task(2, { title: 'Shopping', priority: 'low', completed: true, due_date: null,
    subtasks: [{ id: 1, todo_id: 2, title: 'Buy milk', completed: false, position: 0, created_at: '' }] }),
  task(3, { title: 'Report', priority: 'medium', due_date: '2030-01-03T00:00:00+08:00' }),
]
const filter = (overrides: Partial<FilterState>) => ({ ...DEFAULT_FILTER_STATE, ...overrides })
const ids = (overrides: Partial<FilterState>) => applyFilters(todos, filter(overrides)).map(({ id }) => id)

describe('client-side filters', () => {
  it('matches partial Unicode titles and subtasks without case sensitivity', () => {
    expect(ids({ search: ' méet ' })).toEqual([1])
    expect(ids({ search: 'MILK' })).toEqual([2])
    expect(ids({ search: 'absent' })).toEqual([])
    expect(ids({ search: '   ' })).toEqual([1, 2, 3])
  })
  it.each([['high', 1], ['low', 2], ['medium', 3]] as const)('filters %s priority', (priority, id) => {
    expect(ids({ priority })).toEqual([id])
  })
  it('filters tags and completion, including absent optional arrays', () => {
    expect(ids({ tagId: 7 })).toEqual([1])
    expect(ids({ tagId: 99 })).toEqual([])
    expect(ids({ completion: 'completed' })).toEqual([2])
    expect(ids({ completion: 'incomplete' })).toEqual([1, 3])
  })
  it('uses inclusive Singapore calendar bounds, not UTC date prefixes', () => {
    expect(ids({ dueDateFrom: '2030-01-02', dueDateTo: '2030-01-02' })).toEqual([1])
    expect(ids({ dueDateFrom: '2030-01-03' })).toEqual([3])
    expect(ids({ dueDateTo: '2030-01-02' })).toEqual([1])
    expect(ids({ dueDateFrom: '2030-01-04', dueDateTo: '2030-01-01' })).toEqual([])
  })
  it('combines all criteria with AND without changing source order or data', () => {
    const snapshot = structuredClone(todos)
    expect(ids({ search: 'meeting', priority: 'low' })).toEqual([])
    expect(ids({ search: 'méet', priority: 'high', tagId: 7, completion: 'incomplete',
      dueDateFrom: '2030-01-02', dueDateTo: '2030-01-02' })).toEqual([1])
    expect(ids({})).toEqual([1, 2, 3])
    expect(todos).toEqual(snapshot)
  })
  it('recognizes each active dimension and ignores whitespace', () => {
    expect(hasActiveFilters(filter({}))).toBe(false)
    expect(hasActiveFilters(filter({ search: '  ' }))).toBe(false)
    for (const dimension of [{ search: 'a' }, { priority: 'low' as const }, { tagId: 1 },
      { completion: 'completed' as const }, { dueDateFrom: '2030-01-01' }, { dueDateTo: '2030-01-01' }]) {
      expect(hasActiveFilters(filter(dimension))).toBe(true)
    }
  })
  it('filters 1000 dated todos in under 100ms', () => {
    const large = Array.from({ length: 1000 }, (_, id) => task(id))
    const start = performance.now()
    const result = applyFilters(large, filter({ search: 'team', priority: 'high',
      completion: 'incomplete', dueDateFrom: '2030-01-02', dueDateTo: '2030-01-02' }))
    const elapsed = performance.now() - start
    expect(result).toHaveLength(1000)
    expect(elapsed).toBeLessThan(100)
  })
})
