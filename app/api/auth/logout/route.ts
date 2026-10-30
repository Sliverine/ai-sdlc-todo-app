import { NextRequest, NextResponse } from 'next/server'
import { deleteSession } from '@/lib/auth'
import { isSameOriginRequest } from '@/lib/auth-route-utils'

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }
  await deleteSession()
  return NextResponse.json({ success: true })
}
