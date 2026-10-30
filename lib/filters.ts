import { z } from 'zod'
import type { Todo } from './db'
import { toSingaporeParts } from './timezone'

export const filterStateSchema = z.object({
  search: z.string(),
  priority: z.enum(['all', 'high', 'medium', 'low']),
  tagId: z.union([z.literal('all'), z.number().int().positive()]),
  completion: z.enum(['all', 'incomplete', 'completed']),
  dueDateFrom: z.iso.date().nullable(),
  dueDateTo: z.iso.date().nullable(),
})

export type FilterState = z.infer<typeof filterStateSchema>

export const DEFAULT_FILTER_STATE: FilterState = {
  search: '', priority: 'all', tagId: 'all', completion: 'all',
  dueDateFrom: null, dueDateTo: null,
}

export function hasActiveFilters(filters: FilterState): boolean {
  return filters.search.trim() !== '' || filters.priority !== 'all' || filters.tagId !== 'all'
    || filters.completion !== 'all' || filters.dueDateFrom !== null || filters.dueDateTo !== null
}

export function applyFilters(todos: Todo[], filters: FilterState): Todo[] {
  let result = todos
  const query = filters.search.trim().toLowerCase()
  if (query) {
    result = result.filter((todo) => todo.title.toLowerCase().includes(query)
      || (todo.subtasks ?? []).some((subtask) => subtask.title.toLowerCase().includes(query)))
  }
  if (filters.priority !== 'all') result = result.filter((todo) => todo.priority === filters.priority)
  if (filters.tagId !== 'all') {
    result = result.filter((todo) => (todo.tags ?? []).some((tag) => tag.id === filters.tagId))
  }
  if (filters.completion !== 'all') {
    result = result.filter((todo) => todo.completed === (filters.completion === 'completed'))
  }
  if (filters.dueDateFrom || filters.dueDateTo) {
    result = result.filter((todo) => {
      if (!todo.due_date) return false
      // API dates are UTC instants; bounds describe Singapore calendar days.
      const { year, month, day } = toSingaporeParts(todo.due_date)
      const due = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
      return (!filters.dueDateFrom || due >= filters.dueDateFrom)
        && (!filters.dueDateTo || due <= filters.dueDateTo)
    })
  }
  return result
}
