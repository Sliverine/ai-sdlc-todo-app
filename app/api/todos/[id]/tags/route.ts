import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { tagDB } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { readLimitedJson } from '@/lib/request-utils'

const tagAssignmentSchema = z.object({
  tag_id: z.number().int().positive(),
}).strict()

function parseTodoId(value: string): number | null {
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

  const todoId = parseTodoId((await params).id)
  if (todoId === null) return NextResponse.json({ error: 'Todo not found' }, { status: 404 })

  const body = await readLimitedJson(request)
  if (!body.ok) {
    return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
      status: body.tooLarge ? 413 : 400,
    })
  }

  const parsed = tagAssignmentSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Tag id is invalid' }, { status: 400 })
  }

  const attached = tagDB.attachToTodo(todoId, parsed.data.tag_id, session.userId)
  if (!attached) return NextResponse.json({ error: 'Tag or todo not found' }, { status: 404 })

  return NextResponse.json({ success: true })
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

  const todoId = parseTodoId((await params).id)
  if (todoId === null) return NextResponse.json({ error: 'Todo not found' }, { status: 404 })

  const body = await readLimitedJson(request)
  if (!body.ok) {
    return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
      status: body.tooLarge ? 413 : 400,
    })
  }

  const parsed = tagAssignmentSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Tag id is invalid' }, { status: 400 })
  }

  const detached = tagDB.detachFromTodo(todoId, parsed.data.tag_id, session.userId)
  if (!detached) return NextResponse.json({ error: 'Tag or todo not found' }, { status: 404 })

  return NextResponse.json({ success: true })
}
