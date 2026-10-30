import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { isSameOriginRequest } from '@/lib/auth-route-utils'
import { todoDB } from '@/lib/db'
import { todoImportSchema } from '@/lib/export-utils'

export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON format' }, { status: 400 })
  }

  const parsed = todoImportSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({
      error: 'Failed to import todos. Please check the file format.',
    }, { status: 400 })
  }

  try {
    const result = todoDB.importAll(session.userId, parsed.data.todos)
    return NextResponse.json({ success: true, ...result })
  } catch {
    return NextResponse.json({ error: 'Failed to import todos' }, { status: 500 })
  }
}
