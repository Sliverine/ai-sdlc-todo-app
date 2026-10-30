import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { templateDB } from '@/lib/db'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { readLimitedJson } from '@/lib/request-utils'
import { TemplateValidationError, validateCreateTemplateDto } from '@/lib/template-utils'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    return NextResponse.json(templateDB.findAllByUser(session.userId))
  } catch (error) {
    console.error('Unable to list templates', error)
    return NextResponse.json({ error: 'Unable to list templates' }, { status: 500 })
  }
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

  let input
  try {
    input = validateCreateTemplateDto(body.value)
  } catch (error) {
    if (error instanceof TemplateValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Unable to validate template data', error)
    return NextResponse.json({ error: 'Template data is invalid' }, { status: 400 })
  }

  try {
    const template = templateDB.create({ ...input, user_id: session.userId })
    return NextResponse.json(template, { status: 201 })
  } catch (error) {
    if (error instanceof TemplateValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Unable to create template', error)
    return NextResponse.json({ error: 'Unable to create template' }, { status: 500 })
  }
}
