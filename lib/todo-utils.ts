import type { Priority, Todo } from './db'

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 }

export interface TodoSections {
  overdue: Todo[]
  pending: Todo[]
  completed: Todo[]
}

export function sortTodos(todos: Todo[]): Todo[] {
  return [...todos].sort((first, second) => {
    const priorityDifference = PRIORITY_ORDER[first.priority] - PRIORITY_ORDER[second.priority]
    if (priorityDifference !== 0) return priorityDifference

    const firstDue = first.due_date ? Date.parse(first.due_date) : Number.POSITIVE_INFINITY
    const secondDue = second.due_date ? Date.parse(second.due_date) : Number.POSITIVE_INFINITY
    if (firstDue !== secondDue) return firstDue - secondDue

    return Date.parse(second.created_at) - Date.parse(first.created_at)
  })
}

export function sectionTodos(todos: Todo[], now: Date): TodoSections {
  const overdue: Todo[] = []
  const pending: Todo[] = []
  const completed = todos.filter((todo) => todo.completed).sort((first, second) => {
    const firstUpdated = Date.parse(first.updated_at ?? first.created_at)
    const secondUpdated = Date.parse(second.updated_at ?? second.created_at)
    return secondUpdated - firstUpdated
  })

  for (const todo of todos) {
    if (todo.completed) continue
    if (todo.due_date && Date.parse(todo.due_date) < now.getTime()) {
      overdue.push(todo)
    } else {
      pending.push(todo)
    }
  }

  return {
    overdue: sortTodos(overdue),
    pending: sortTodos(pending),
    completed,
  }
}