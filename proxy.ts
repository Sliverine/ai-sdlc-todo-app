import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth'

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const session = token ? await verifySessionToken(token) : null

  if (pathname === '/login' && session) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  if ((pathname === '/' || pathname === '/calendar') && !session) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/', '/calendar', '/login'],
}