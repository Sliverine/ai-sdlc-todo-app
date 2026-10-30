import { describe, expect, it } from 'vitest'
import { formatSingaporeExportDate, serializeTodosToCsv, todoImportSchema } from '../lib/export-utils'
import type { Todo } from '../lib/db'

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
    subtasks: [],
    tags: [],
    ...overrides,
  }
}

describe('export utilities', () => {
  it('formats the export filename date in Singapore time', () => {
    expect(formatSingaporeExportDate(new Date('2026-10-29T16:30:00.000Z'))).toBe('2026-10-30')
  })

  it('serializes fixed CSV columns and escapes commas, quotes, and newlines', () => {
    const csv = serializeTodosToCsv([todo({ id: 8, title: 'Milk, "eggs"\nbread' })])

    expect(csv).toBe([
      'ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder',
      '8,"Milk, ""eggs""\nbread",false,,medium,false,,',
      '',
    ].join('\r\n'))
  })

  it('accepts a complete versioned export and rejects invalid import fields', () => {
    const payload = {
      version: 1,
      exported_at: '2026-10-30T00:00:00.000Z',
      todos: [{
        title: 'Prepare release',
        completed: false,
        due_date: null,
        priority: 'high',
        is_recurring: false,
        recurrence_pattern: null,
        reminder_minutes: null,
        created_at: '2026-10-29T00:00:00.000Z',
        subtasks: [{ title: 'Draft notes', completed: true, position: 4 }],
        tags: [{ name: 'Work', color: '#1166AA' }],
      }],
    }

    expect(todoImportSchema.safeParse(payload).success).toBe(true)
    expect(todoImportSchema.safeParse({ ...payload, version: 2 }).success).toBe(false)
    expect(todoImportSchema.safeParse({ ...payload, todos: [{ ...payload.todos[0], priority: 'urgent' }] }).success).toBe(false)
    expect(todoImportSchema.safeParse({ ...payload, todos: [{ ...payload.todos[0], subtasks: [{ title: ' ', completed: false, position: 0 }] }] }).success).toBe(false)
  })
})
