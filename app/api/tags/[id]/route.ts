import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { tagDB } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { readLimitedJson } from '@/lib/request-utils'

const tagUpdateSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
}).strict()

function parseTagId(value: string): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const id = parseTagId((await params).id)
  const tag = id === null ? null : tagDB.findById(id, session.userId)
  if (!tag) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
  return NextResponse.json(tag)
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

  const id = parseTagId((await params).id)
  if (id === null) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })

  const body = await readLimitedJson(request)
  if (!body.ok) {
    return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
      status: body.tooLarge ? 413 : 400,
    })
  }

  const parsed = tagUpdateSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Tag data is invalid' }, { status: 400 })
  }

  const input = parsed.data
  if (input.name !== undefined && input.name.trim().length === 0) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
  }
  if (input.color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(input.color)) {
    return NextResponse.json({ error: 'Color must be a valid hex code' }, { status: 400 })
  }

  const existing = tagDB.findById(id, session.userId)
  if (!existing) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })

  try {
    const updated = tagDB.update(id, session.userId, {
      name: input.name?.trim(),
      color: input.color,
    })
    if (!updated) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    return NextResponse.json(updated)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'A tag with this name already exists') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (message === 'Tag name is required' || message === 'Color must be a valid hex code') {
      return NextResponse.json({ error: message }, { status: 400 })
    }
    return NextResponse.json({ error: 'Unable to update tag' }, { status: 500 })
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isSameOriginRequest(_request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const id = parseTagId((await params).id)
  if (id === null || !tagDB.delete(id, session.userId)) {
    return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
  }

  return NextResponse.json({ success: true })
}
