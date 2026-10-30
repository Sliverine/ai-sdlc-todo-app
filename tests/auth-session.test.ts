import { SignJWT } from 'jose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cookieJar = new Map<string, { value: string; options?: Record<string, unknown> }>()
const cookieSet = vi.fn((name: string, value: string, options?: Record<string, unknown>) => {
  cookieJar.set(name, { value, options })
})
const cookieGet = vi.fn((name: string) => {
  const cookie = cookieJar.get(name)
  return cookie ? { value: cookie.value } : undefined
})

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: cookieGet, set: cookieSet })),
}))

import { createSession, deleteSession, getSession, SESSION_COOKIE, verifySessionToken } from '../lib/auth'

const secret = new TextEncoder().encode('test-secret-with-at-least-32-characters')

describe('JWT sessions', () => {
  beforeEach(() => {
    cookieJar.clear()
    cookieSet.mockClear()
    cookieGet.mockClear()
    process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters'
    vi.stubEnv('NODE_ENV', 'test')
  })

  afterEach(() => vi.unstubAllEnvs())

  it('creates a seven-day HTTP-only lax cookie and reads the session back', async () => {
    await createSession({ id: 12, username: 'alice', webauthn_user_id: 'test-handle', created_at: '2026-10-30 00:00:00' })

    const cookie = cookieJar.get(SESSION_COOKIE)
    expect(cookie?.options).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })
    await expect(getSession()).resolves.toEqual({ userId: 12, username: 'alice' })
  })

  it('sets the Secure attribute in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    await createSession({ id: 12, username: 'alice', webauthn_user_id: 'test-handle', created_at: '2026-10-30 00:00:00' })

    expect(cookieJar.get(SESSION_COOKIE)?.options?.secure).toBe(true)
  })

  it('rejects a weak or missing session secret', async () => {
    vi.stubEnv('JWT_SECRET', 'short')

    await expect(createSession({ id: 12, username: 'alice', webauthn_user_id: 'test-handle', created_at: '2026-10-30 00:00:00' }))
      .rejects.toThrow('JWT_SECRET must contain at least 32 characters')
    await expect(verifySessionToken('not-a-jwt')).resolves.toBeNull()
  })

  it('fails closed for tampered or expired tokens', async () => {
    const validToken = await new SignJWT({ username: 'alice' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('12')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret)
    const expiredToken = await new SignJWT({ username: 'alice' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('12')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 60)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1)
      .sign(secret)

    await expect(verifySessionToken(`${validToken}tampered`)).resolves.toBeNull()
    await expect(verifySessionToken(expiredToken)).resolves.toBeNull()
    await expect(verifySessionToken('not-a-jwt')).resolves.toBeNull()
  })

  it('rejects JWTs with invalid session claims', async () => {
    const invalidSubjectToken = await new SignJWT({ username: 'alice' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('todo-app')
      .setAudience('todo-app')
      .setSubject('not-a-user-id')
      .setIssuedAt()
      .setExpirationTime('7d')
      .sign(secret)

    await expect(verifySessionToken(invalidSubjectToken)).resolves.toBeNull()
  })

  it('clears the session cookie immediately', async () => {
    await deleteSession()

    expect(cookieSet).toHaveBeenCalledWith(SESSION_COOKIE, '', expect.objectContaining({ maxAge: 0 }))
    await expect(getSession()).resolves.toBeNull()
  })
})
