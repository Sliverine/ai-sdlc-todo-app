import { z } from 'zod';
import type { CreateTodoInput, Todo, UpdateTodoInput } from './db';
import { getSingaporeNow, parseSingaporeDate } from './timezone';

export const usernameSchema = z.string().trim().min(1).max(64).regex(/^[\p{L}\p{N}_. -]+$/u, 'Invalid username');
export const prioritySchema = z.enum(['high', 'medium', 'low']);
export const recurrenceSchema = z.enum(['daily', 'weekly', 'monthly', 'yearly']);
const dateSchema = z.string().refine((value) => {
  try { parseSingaporeDate(value); return true; } catch { return false; }
}, 'Invalid date');
const reminderSchema = z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120), z.literal(1440), z.literal(2880), z.literal(10080)]);
export const todoUpdateSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').optional(),
  due_date: dateSchema.nullable().optional(),
  priority: prioritySchema.optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: recurrenceSchema.nullable().optional(),
  reminder_minutes: reminderSchema.nullable().optional(),
  tag_ids: z.array(z.number().int().positive()).max(100).optional(),
  completed: z.boolean().optional(),
  last_notification_sent: dateSchema.optional(),
  notification_due_date: dateSchema.optional(),
  notification_reminder_minutes: reminderSchema.optional(),
}).strict();

export function validateTodo(input: unknown, existing?: Todo): CreateTodoInput & UpdateTodoInput {
  const parsed = todoUpdateSchema.parse(input);
  if (!existing && (parsed.completed !== undefined || parsed.last_notification_sent !== undefined ||
      parsed.notification_due_date !== undefined || parsed.notification_reminder_minutes !== undefined)) {
    throw new Error('Notification acknowledgements and completion require an existing todo');
  }
  const due = parsed.due_date === undefined ? existing?.due_date ?? null :
    parsed.due_date === null ? null : parseSingaporeDate(parsed.due_date).toISOString();
  const result = {
    title: existing?.title ?? '',
    priority: existing?.priority ?? 'medium' as const,
    is_recurring: existing?.is_recurring ?? false,
    recurrence_pattern: existing?.recurrence_pattern ?? null,
    reminder_minutes: existing?.reminder_minutes ?? null,
    ...parsed,
    due_date: due,
  };
  if (!result.title) throw new Error('Title is required');
  if (due && (!existing || due !== existing.due_date) &&
      parseSingaporeDate(due).getTime() < getSingaporeNow().getTime() + 60_000) {
    throw new Error('Due date must be at least 1 minute in the future');
  }
  if (result.is_recurring && (!due || !result.recurrence_pattern)) {
    throw new Error('Recurring todos require a due date and recurrence pattern');
  }
  if (result.reminder_minutes !== null && !due) throw new Error('Reminders require a due date');
  return { ...result, recurrence_pattern: result.is_recurring ? result.recurrence_pattern : null };
}
