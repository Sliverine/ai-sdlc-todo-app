import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getWebAuthnConfig, isSameOriginRequest, isSqliteConstraintError, readValidatedJson, usernameSchema } from '../lib/auth-route-utils'
import { z } from 'zod'

const bodySchema = z.object({ username: usernameSchema })

describe('authentication route utilities', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('accepts a valid JSON body and rejects invalid or malformed bodies', async () => {
    const validRequest = new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice' }),
    })
    const invalidRequest = new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'not valid' }),
    })
    const malformedRequest = new NextRequest('http://localhost/api/auth', {
      method: 'POST',
      body: '{',
    })

    await expect(readValidatedJson(validRequest, bodySchema)).resolves.toEqual({ username: 'alice' })
    await expect(readValidatedJson(invalidRequest, bodySchema)).resolves.toBeNull()
    await expect(readValidatedJson(malformedRequest, bodySchema)).resolves.toBeNull()
  })

  it('only accepts a matching configured origin', () => {
    vi.stubEnv('RP_ORIGIN', 'https://todo.example')
    const validRequest = new NextRequest('https://todo.example/api/auth', {
      method: 'POST',
      headers: { origin: 'https://todo.example' },
    })
    const missingOrigin = new NextRequest('https://todo.example/api/auth', { method: 'POST' })
    const malformedOrigin = new NextRequest('https://todo.example/api/auth', {
      method: 'POST',
      headers: { origin: 'not-an-origin' },
    })

    expect(isSameOriginRequest(validRequest)).toBe(true)
    expect(isSameOriginRequest(missingOrigin)).toBe(false)
    expect(isSameOriginRequest(malformedOrigin)).toBe(false)
  })

  it('requires all WebAuthn environment values', () => {
    vi.stubEnv('RP_ID', 'localhost')
    vi.stubEnv('RP_NAME', 'Todo App')
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000')
    expect(getWebAuthnConfig()).toEqual({ rpID: 'localhost', rpName: 'Todo App', origin: 'http://localhost:3000' })

    vi.stubEnv('RP_NAME', '')
    expect(() => getWebAuthnConfig()).toThrow('WebAuthn environment is not configured')
  })

  it('recognizes SQLite constraint errors without treating unrelated values as constraints', () => {
    expect(isSqliteConstraintError({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true)
    expect(isSqliteConstraintError(new Error('database unavailable'))).toBe(false)
    expect(isSqliteConstraintError(null)).toBe(false)
  })
})
