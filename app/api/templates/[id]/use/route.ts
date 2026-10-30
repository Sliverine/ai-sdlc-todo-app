import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { templateDB } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { readLimitedJson } from '@/lib/request-utils'
import { TemplateValidationError } from '@/lib/template-utils'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }
  if (request.body) {
    const body = await readLimitedJson(request)
    if (!body.ok) {
      return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
        status: body.tooLarge ? 413 : 400,
      })
    }
    return NextResponse.json({ error: 'Request body is not expected' }, { status: 400 })
  }

  const rawId = (await params).id
  const id = Number(rawId)
  if (!Number.isSafeInteger(id) || id <= 0) {
    return NextResponse.json({ error: 'Template not found' }, { status: 404 })
  }

  try {
    const todo = templateDB.use(id, session.userId)
    if (!todo) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    return NextResponse.json(todo, { status: 201 })
  } catch (error) {
    if (error instanceof TemplateValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Unable to use template', error)
    return NextResponse.json({ error: 'Unable to use template' }, { status: 500 })
  }
}
