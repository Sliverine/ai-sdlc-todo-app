import { z } from 'zod'
import type { Todo, TodoExportItem } from './db'
import { reminderMinutesSchema } from './reminders'

const importTodoSchema = z.object({
  title: z.string().trim().min(1),
  completed: z.boolean(),
  due_date: z.string().nullable(),
  priority: z.enum(['high', 'medium', 'low']),
  is_recurring: z.boolean(),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable(),
  reminder_minutes: reminderMinutesSchema.nullable(),
  created_at: z.string(),
  subtasks: z.array(z.object({
    title: z.string().trim().min(1),
    completed: z.boolean(),
    position: z.number().int().nonnegative(),
  }).strict()),
  tags: z.array(z.object({
    name: z.string().trim().min(1),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  }).strict()),
}).strict().superRefine((todo, context) => {
  if (todo.is_recurring && (!todo.due_date || !todo.recurrence_pattern)) {
    context.addIssue({ code: 'custom', message: 'Recurring todos require a due date and pattern' })
  }
  if (todo.reminder_minutes !== null && !todo.due_date) {
    context.addIssue({ code: 'custom', message: 'Reminders require a due date' })
  }
})

export const todoImportSchema = z.object({
  version: z.literal(1),
  exported_at: z.string(),
  todos: z.array(importTodoSchema),
}).strict()

export function formatSingaporeExportDate(date: Date): string {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map(({ type, value }) => [type, value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

function csvCell(value: string | number | boolean | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function serializeTodosToCsv(todos: Todo[]): string {
  const rows: Array<Array<string | number | boolean | null>> = [
    ['ID', 'Title', 'Completed', 'Due Date', 'Priority', 'Recurring', 'Pattern', 'Reminder'],
    ...todos.map((todo) => [
      todo.id,
      todo.title,
      todo.completed,
      todo.due_date,
      todo.priority,
      todo.is_recurring,
      todo.recurrence_pattern,
      todo.reminder_minutes,
    ]),
  ]
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`
}

export function toTodoExportItem(todo: Todo): TodoExportItem {
  return {
    title: todo.title,
    completed: todo.completed,
    due_date: todo.due_date,
    priority: todo.priority,
    is_recurring: todo.is_recurring,
    recurrence_pattern: todo.recurrence_pattern,
    reminder_minutes: todo.reminder_minutes,
    created_at: todo.created_at,
    subtasks: (todo.subtasks ?? []).map(({ title, completed, position }) => ({ title, completed, position })),
    tags: (todo.tags ?? []).map(({ name, color }) => ({ name, color })),
  }
}
