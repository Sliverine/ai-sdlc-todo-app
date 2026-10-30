import { NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { userDB } from '@/lib/db'

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const user = userDB.findById(session.userId)
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  return NextResponse.json({ user: { id: user.id, username: user.username } })
}
