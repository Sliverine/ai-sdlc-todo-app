import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { tagDB } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { readLimitedJson } from '@/lib/request-utils'

const tagSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
}).strict()

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  return NextResponse.json(tagDB.findAllByUser(session.userId))
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

  const parsed = tagSchema.safeParse(body.value)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
  }

  const name = parsed.data.name?.trim() ?? ''
  if (!name) {
    return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
  }

  if (parsed.data.color !== undefined && !/^#[0-9A-Fa-f]{6}$/.test(parsed.data.color)) {
    return NextResponse.json({ error: 'Color must be a valid hex code' }, { status: 400 })
  }

  try {
    const tag = tagDB.create(session.userId, {
      name,
      color: parsed.data.color ?? '#3B82F6',
    })
    return NextResponse.json(tag, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'A tag with this name already exists') {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    return NextResponse.json({ error: 'Unable to create tag' }, { status: 500 })
  }
}
