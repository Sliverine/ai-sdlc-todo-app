import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { todoDB, type Priority } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { readLimitedJson } from '@/lib/request-utils'
import { normalizeDueDate, parseDueDate } from '@/lib/timezone'
import { TodoValidationError } from '@/lib/todo-errors'
import { validatePriority } from '@/lib/todo-utils'

const todoUpdateSchema = z.object({
	title: z.string().trim().min(1, 'Title cannot be empty').optional(),
	due_date: z.string().nullable().optional(),
	priority: z.unknown().optional(),
	completed: z.boolean().optional(),
	is_recurring: z.boolean().optional(),
	recurrence_pattern: z.enum(['daily', 'weekly', 'monthly', 'yearly']).nullable().optional(),
	reminder_minutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120), z.literal(1440), z.literal(2880), z.literal(10080)]).nullable().optional(),
	tag_ids: z.array(z.number().int().positive()).optional(),
  last_notification_sent: z.iso.datetime({ offset: true }).optional(),
  notification_due_date: z.iso.datetime({ offset: true }).optional(),
  notification_reminder_minutes: z.union([z.literal(15), z.literal(30), z.literal(60), z.literal(120), z.literal(1440), z.literal(2880), z.literal(10080)]).optional(),
}).strict()

function parseTodoId(value: string): number | null {
	const id = Number(value)
	return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function GET(
	_request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await getSession()
	if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

	const id = parseTodoId((await params).id)
	const todo = id === null ? null : todoDB.findById(id, session.userId)
	if (!todo) return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
	return NextResponse.json(todo)
}

export async function PUT(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await getSession()
	if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
	if (!isSameOriginRequest(request)) {
		return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
	}

	const id = parseTodoId((await params).id)
	if (id === null) return NextResponse.json({ error: 'Todo not found' }, { status: 404 })

	const body = await readLimitedJson(request)
	if (!body.ok) {
		return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
			status: body.tooLarge ? 413 : 400,
		})
	}
	const parsed = todoUpdateSchema.safeParse(body.value)
	if (!parsed.success) return NextResponse.json({ error: 'Todo data is invalid' }, { status: 400 })

	const input = parsed.data
	const existing = todoDB.findById(id, session.userId)
	if (!existing) return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
	const { priority: priorityValue, ...updateFields } = input
	const update: Parameters<typeof todoDB.update>[2] = updateFields

	if (priorityValue !== undefined) {
		let priority: Priority
		try {
			priority = validatePriority(priorityValue, 'update')
		} catch (error) {
			return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid priority' }, { status: 400 })
		}
		update.priority = priority
	}

	if (input.due_date !== undefined) {
		const parsedDate = parseDueDate(input.due_date)
		if (!parsedDate.valid) return NextResponse.json({ error: parsedDate.error }, { status: 400 })
		if (parsedDate.value !== existing.due_date && parsedDate.value !== null) {
			const dueDate = normalizeDueDate(input.due_date)
			if (!dueDate.valid) return NextResponse.json({ error: dueDate.error }, { status: 400 })
			update.due_date = dueDate.value
		} else {
			update.due_date = parsedDate.value
		}
	}

	const nextDueDate = update.due_date === undefined ? existing.due_date : update.due_date
	const nextRecurring = input.is_recurring ?? existing.is_recurring
	const nextPattern = input.recurrence_pattern === undefined ? existing.recurrence_pattern : input.recurrence_pattern
	const nextReminder = input.reminder_minutes === undefined ? existing.reminder_minutes : input.reminder_minutes
	if (nextRecurring && !nextDueDate) {
		return NextResponse.json({ error: 'Recurring todos require a due date' }, { status: 400 })
	}
	if (nextRecurring && !nextPattern) {
		return NextResponse.json({ error: 'Invalid recurrence pattern' }, { status: 400 })
	}
	if (nextReminder != null && !nextDueDate) {
		return NextResponse.json({ error: 'Reminders require a due date' }, { status: 400 })
	}
	if (input.is_recurring === false && input.recurrence_pattern === undefined) update.recurrence_pattern = null

	let updated
	try {
		updated = todoDB.update(id, session.userId, update)
	} catch (error) {
		if (error instanceof TodoValidationError) {
			return NextResponse.json({ error: error.message }, { status: error.message === 'Reminder schedule changed' ? 409 : 400 })
		}
		return NextResponse.json({ error: 'Unable to update todo' }, { status: 500 })
	}
	if (!updated) return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
	return NextResponse.json(updated)
}

export async function DELETE(
	request: NextRequest,
	{ params }: { params: Promise<{ id: string }> },
) {
	const session = await getSession()
	if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
	if (!isSameOriginRequest(request)) {
		return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
	}

	const id = parseTodoId((await params).id)
	if (id === null || !todoDB.delete(id, session.userId)) {
		return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
	}
	return NextResponse.json({ success: true })
}
