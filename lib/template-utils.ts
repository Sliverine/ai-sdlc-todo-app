import { z } from 'zod'
import type { CreateTemplateDto, TemplateSubtask } from './db'
import { PRIORITY_VALUES } from './priority'
import { dateFromTimestamp, getSingaporeNow, parseDueDate } from './timezone'

const RECURRENCE_PATTERNS = ['daily', 'weekly', 'monthly', 'yearly'] as const
const REMINDER_MINUTES = [15, 30, 60, 120, 1440, 2880, 10080] as const
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000

const templateSubtaskSchema = z.object({
  title: z.string().min(1),
  position: z.number().int().refine(Number.isSafeInteger).nonnegative(),
}).strict()

const createTemplateSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  title_template: z.string().trim().min(1),
  priority: z.enum(PRIORITY_VALUES).optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.enum(RECURRENCE_PATTERNS).nullable().optional(),
  reminder_minutes: z.number().int()
    .refine((value) => REMINDER_MINUTES.includes(value as (typeof REMINDER_MINUTES)[number]))
    .nullable()
    .optional(),
  due_date_offset_minutes: z.number().finite().int().min(1).nullable().optional(),
  subtasks: z.array(templateSubtaskSchema).optional(),
}).strict()

const updateTemplateSchema = createTemplateSchema.partial().strict()

export class TemplateValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateValidationError'
  }
}

export function validateCreateTemplateDto(input: unknown, now = getSingaporeNow()): CreateTemplateDto {
  const parsed = createTemplateSchema.safeParse(input)
  if (!parsed.success) throw new TemplateValidationError('Template data is invalid')

  validateOffset(parsed.data.due_date_offset_minutes, now)
  validateTemplateConfiguration(parsed.data, now)
  return parsed.data
}

export function validateTemplateUpdateDto(input: unknown, now = getSingaporeNow()): Partial<CreateTemplateDto> {
  const parsed = updateTemplateSchema.safeParse(input)
  if (!parsed.success) throw new TemplateValidationError('Template data is invalid')

  validateOffset(parsed.data.due_date_offset_minutes, now)
  return parsed.data
}

export function validateTemplateConfiguration(
  input: Pick<CreateTemplateDto, 'is_recurring' | 'recurrence_pattern' | 'reminder_minutes' | 'due_date_offset_minutes'>,
  now = getSingaporeNow(),
): void {
  const isRecurring = input.is_recurring ?? false
  const recurrencePattern = input.recurrence_pattern ?? null
  const offset = input.due_date_offset_minutes ?? null
  const reminderMinutes = input.reminder_minutes ?? null

  validateOffset(offset, now)
  if (isRecurring && (!recurrencePattern || offset === null)) {
    throw new TemplateValidationError('Recurring templates require a due date offset and recurrence pattern')
  }
  if (!isRecurring && recurrencePattern !== null) {
    throw new TemplateValidationError('A recurrence pattern requires a recurring template')
  }
  if (reminderMinutes !== null && offset === null) {
    throw new TemplateValidationError('Template reminders require a due date offset')
  }
}

export function calculateTemplateDueDate(
  offsetMinutes: number | null,
  now = getSingaporeNow(),
): string | null {
  if (offsetMinutes === null) return null
  validateOffset(offsetMinutes, now)

  const dueDate = dateFromTimestamp(now.getTime() + offsetMinutes * 60_000)
  if (!Number.isFinite(dueDate.getTime())) {
    throw new TemplateValidationError('Due date offset exceeds the supported date range')
  }
  const parsedDate = parseDueDate(dueDate.toISOString())
  if (!parsedDate.valid || parsedDate.value === null) {
    throw new TemplateValidationError('Due date offset exceeds the supported date range')
  }
  return parsedDate.value
}

export function parseTemplateSubtasks(raw: string | null): TemplateSubtask[] {
  if (raw === null) return []

  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch (error) {
    console.error('Unable to parse template subtasks; using an empty checklist', error)
    return []
  }

  const parsed = z.array(templateSubtaskSchema).safeParse(value)
  if (!parsed.success) {
    console.error('Invalid template subtasks shape; using an empty checklist', parsed.error)
    return []
  }
  return parsed.data
}

function validateOffset(offset: number | null | undefined, now: Date): void {
  if (offset === undefined || offset === null) return
  if (!Number.isSafeInteger(offset) || offset < 1) {
    throw new TemplateValidationError('Due date offset must be a positive whole number of minutes')
  }
  const nowMilliseconds = now.getTime()
  const dueMilliseconds = nowMilliseconds + offset * 60_000
  if (!Number.isFinite(nowMilliseconds) || !Number.isFinite(dueMilliseconds)
    || dueMilliseconds > MAX_DATE_MILLISECONDS) {
    throw new TemplateValidationError('Due date offset exceeds the supported date range')
  }
  const parsedDate = parseDueDate(dateFromTimestamp(dueMilliseconds).toISOString())
  if (!parsedDate.valid) {
    throw new TemplateValidationError('Due date offset exceeds the supported date range')
  }
}
