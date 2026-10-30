import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { subtaskDB } from '@/lib/db'
import { readLimitedJson } from '@/lib/request-utils'

const updateSubtaskSchema = z.object({
  title: z.string().trim().min(1, 'Subtask title cannot be empty').optional(),
  completed: z.boolean().optional(),
}).strict().refine((value) => value.title !== undefined || value.completed !== undefined)

function parseId(value: string): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
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

  const id = parseId((await params).id)
  if (id === null) return NextResponse.json({ error: 'Subtask not found' }, { status: 404 })

  const body = await readLimitedJson(request)
  if (!body.ok) {
    return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
      status: body.tooLarge ? 413 : 400,
    })
  }
  const parsed = updateSubtaskSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Subtask data is invalid' }, { status: 400 })
  }

  try {
    const subtask = subtaskDB.update(id, session.userId, parsed.data)
    if (!subtask) return NextResponse.json({ error: 'Subtask not found' }, { status: 404 })
    return NextResponse.json(subtask)
  } catch {
    return NextResponse.json({ error: 'Unable to update subtask' }, { status: 500 })
  }
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

  const id = parseId((await params).id)
  if (id === null || !subtaskDB.delete(id, session.userId)) {
    return NextResponse.json({ error: 'Subtask not found' }, { status: 404 })
  }
  return NextResponse.json({ success: true })
}