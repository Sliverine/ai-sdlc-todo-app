import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { templateDB } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { readLimitedJson } from '@/lib/request-utils'
import { TemplateValidationError, validateTemplateUpdateDto } from '@/lib/template-utils'

type RouteContext = { params: Promise<{ id: string }> }

function parseTemplateId(value: string): number | null {
  const id = Number(value)
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const id = parseTemplateId((await params).id)
    const template = id === null ? null : templateDB.findById(id, session.userId)
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    return NextResponse.json(template)
  } catch (error) {
    console.error('Unable to get template', error)
    return NextResponse.json({ error: 'Unable to get template' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const id = parseTemplateId((await params).id)
  if (id === null) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const body = await readLimitedJson(request)
  if (!body.ok) {
    return NextResponse.json({ error: body.tooLarge ? 'Request body is too large' : 'Invalid JSON body' }, {
      status: body.tooLarge ? 413 : 400,
    })
  }

  let input
  try {
    input = validateTemplateUpdateDto(body.value)
  } catch (error) {
    if (error instanceof TemplateValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Unable to validate template data', error)
    return NextResponse.json({ error: 'Template data is invalid' }, { status: 400 })
  }

  try {
    const template = templateDB.update(id, session.userId, input)
    if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    return NextResponse.json(template)
  } catch (error) {
    if (error instanceof TemplateValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Unable to update template', error)
    return NextResponse.json({ error: 'Unable to update template' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  try {
    const id = parseTemplateId((await params).id)
    if (id === null || !templateDB.delete(id, session.userId)) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 })
    }
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Unable to delete template', error)
    return NextResponse.json({ error: 'Unable to delete template' }, { status: 500 })
  }
}
