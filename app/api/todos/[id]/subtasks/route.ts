import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { subtaskDB, todoDB } from '@/lib/db'
import { readLimitedJson } from '@/lib/request-utils'

const createSubtaskSchema = z.object({
  title: z.string().trim().min(1, 'Subtask title is required'),
}).strict()

function parseId(value: string): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const todoId = parseId((await params).id)
  if (todoId === null || !todoDB.findById(todoId, session.userId)) {
    return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
  }

  const body = await readLimitedJson(request)
  if (!body.ok) {
    return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
      status: body.tooLarge ? 413 : 400,
    })
  }
  const parsed = createSubtaskSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Subtask title is required' }, { status: 400 })
  }

  try {
    const subtask = subtaskDB.create(todoId, session.userId, parsed.data)
    if (!subtask) return NextResponse.json({ error: 'Todo not found' }, { status: 404 })
    return NextResponse.json(subtask, { status: 201 })
  } catch {
    return NextResponse.json({ error: 'Unable to create subtask' }, { status: 500 })
  }
}