import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { todoDB } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { readLimitedJson } from '@/lib/request-utils'
import { normalizeDueDate } from '@/lib/timezone'
import { TodoValidationError } from '@/lib/todo-errors'

const todoInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required'),
  due_date: z.string().nullable().optional(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
  completed: z.boolean().optional(),
  is_recurring: z.boolean().optional(),
  recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
  reminder_minutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120), z.literal(1440), z.literal(2880), z.literal(10080)]).nullable().optional(),
  tag_ids: z.array(z.number().int().positive()).optional(),
}).strict()

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  return NextResponse.json(todoDB.findAllByUser(session.userId))
}

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const body = await readLimitedJson(request)
  if (!body.ok) {
    return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
      status: body.tooLarge ? 413 : 400,
    })
  }
  const parsed = todoInputSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Title is required or todo data is invalid' }, { status: 400 })
  }

  const input = parsed.data
  const dueDate = normalizeDueDate(input.due_date)
  if (!dueDate.valid) return NextResponse.json({ error: dueDate.error }, { status: 400 })
  if (input.is_recurring && (!dueDate.value || !input.recurrence_pattern)) {
    return NextResponse.json({ error: 'Recurring todos require a due date and pattern' }, { status: 400 })
  }
  if (input.reminder_minutes != null && !dueDate.value) {
    return NextResponse.json({ error: 'Reminders require a due date' }, { status: 400 })
  }

  try {
    const todo = todoDB.create({
      user_id: session.userId,
      title: input.title,
      due_date: dueDate.value,
      priority: input.priority ?? 'medium',
      completed: input.completed ?? false,
      is_recurring: input.is_recurring ?? false,
      recurrence_pattern: input.recurrence_pattern ?? null,
      reminder_minutes: input.reminder_minutes ?? null,
      tag_ids: input.tag_ids ?? [],
    })
    return NextResponse.json(todo, { status: 201 })
  } catch (error) {
    if (error instanceof TodoValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Unable to create todo' }, { status: 500 })
  }
}