import { cookies } from 'next/headers'
import { SignJWT, jwtVerify } from 'jose'
import type { Session, User } from './db'

export const SESSION_COOKIE = 'todo_session'
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60
const SESSION_ISSUER = 'todo-app'

function getSigningKey(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters')
  }
  return new TextEncoder().encode(secret)
}

export async function createSession(user: User): Promise<void> {
  const token = await new SignJWT({ username: user.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(SESSION_ISSUER)
    .setAudience(SESSION_ISSUER)
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSigningKey())

  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  })
}

export async function getSession(): Promise<Session | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE)?.value
  if (!token) return null
  return verifySessionToken(token)
}

export async function verifySessionToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: SESSION_ISSUER,
      audience: SESSION_ISSUER,
    })
    const userId = Number(payload.sub)
    if (!Number.isSafeInteger(userId) || userId < 1 || typeof payload.username !== 'string') {
      return null
    }
    return { userId, username: payload.username }
  } catch {
    return null
  }
}

export async function deleteSession(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}
