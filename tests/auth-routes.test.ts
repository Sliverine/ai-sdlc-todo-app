import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  challengeSave: vi.fn(),
  challengeConsume: vi.fn(),
  challengeDeleteExpired: vi.fn(),
  userFindById: vi.fn(),
  userFindByUsername: vi.fn(),
  userEnsureWebAuthnUserId: vi.fn(),
  userCreate: vi.fn(),
  authDataCreateUserWithAuthenticator: vi.fn(),
  authenticatorCreate: vi.fn(),
  authenticatorFindByCredentialId: vi.fn(),
  authenticatorListByUserId: vi.fn(),
  authenticatorUpdateCounterMonotonically: vi.fn(),
  createSession: vi.fn(),
  getSession: vi.fn(),
  deleteSession: vi.fn(),
}))

vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}))

vi.mock('@/lib/db', () => ({
  authChallengeDB: {
    save: mocks.challengeSave,
    consume: mocks.challengeConsume,
    deleteExpired: mocks.challengeDeleteExpired,
  },
  db: { transaction: (callback: () => unknown) => () => callback() },
  authDataDB: { createUserWithAuthenticator: mocks.authDataCreateUserWithAuthenticator },
  userDB: {
    findById: mocks.userFindById,
    findByUsername: mocks.userFindByUsername,
    ensureWebAuthnUserId: mocks.userEnsureWebAuthnUserId,
    create: mocks.userCreate,
  },
  authenticatorDB: {
    create: mocks.authenticatorCreate,
    findByCredentialId: mocks.authenticatorFindByCredentialId,
    listByUserId: mocks.authenticatorListByUserId,
    updateCounterMonotonically: mocks.authenticatorUpdateCounterMonotonically,
  },
}))

vi.mock('@/lib/auth', () => ({
  createSession: mocks.createSession,
  getSession: mocks.getSession,
  deleteSession: mocks.deleteSession,
}))

import { POST as registerOptions } from '../app/api/auth/register-options/route'
import { POST as registerVerify } from '../app/api/auth/register-verify/route'
import { POST as loginOptions } from '../app/api/auth/login-options/route'
import { POST as loginVerify } from '../app/api/auth/login-verify/route'
import { POST as logout } from '../app/api/auth/logout/route'
import { GET as me } from '../app/api/auth/me/route'

const alice = { id: 7, username: 'alice', webauthn_user_id: 'opaque-user-handle', created_at: '2026-10-30 00:00:00' }

function postRequest(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: 'POST',
    headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('authentication API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RP_ID', 'localhost')
    vi.stubEnv('RP_NAME', 'Todo App')
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000')
    vi.stubEnv('JWT_SECRET', 'test-secret-with-at-least-32-characters')
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: 'registration-challenge' })
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: { id: 'credential-id', publicKey: new Uint8Array([1, 2]), counter: 0 },
      },
    })
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: 'login-challenge' })
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 4 } })
    mocks.getSession.mockResolvedValue(null)
    mocks.challengeConsume.mockReturnValue({
      challenge: 'login-challenge', purpose: 'login', username: 'alice', userId: 7, expiresAt: Date.now() + 10_000,
    })
    mocks.userFindById.mockReturnValue(alice)
    mocks.userFindByUsername.mockReturnValue(null)
    mocks.userEnsureWebAuthnUserId.mockReturnValue('opaque-user-handle')
    mocks.userCreate.mockReturnValue(alice)
    mocks.authDataCreateUserWithAuthenticator.mockReturnValue(alice)
    mocks.authenticatorUpdateCounterMonotonically.mockReturnValue(true)
    mocks.authenticatorCreate.mockReturnValue({ id: 1 })
    mocks.authenticatorFindByCredentialId.mockReturnValue({
      id: 1, user_id: 7, credential_id: 'credential-id', credential_public_key: Buffer.from([1, 2]), counter: 3,
    })
    mocks.authenticatorListByUserId.mockReturnValue([
      { credential_id: 'credential-one' },
      { credential_id: 'credential-two' },
    ])
  })

  afterEach(() => vi.unstubAllEnvs())

  it('rejects duplicate usernames before generating registration options', async () => {
    mocks.userFindByUsername.mockReturnValue(alice)

    const response = await registerOptions(postRequest('/api/auth/register-options', { username: 'alice' }))

    expect(response.status).toBe(409)
    expect(mocks.generateRegistrationOptions).not.toHaveBeenCalled()
  })

  it('rejects registration options from a different origin', async () => {
    const request = new NextRequest('http://localhost:3000/api/auth/register-options', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'alice' }),
    })

    const response = await registerOptions(request)

    expect(response.status).toBe(403)
    expect(mocks.generateRegistrationOptions).not.toHaveBeenCalled()
  })

  it('stores a registration challenge for the requested username', async () => {
    const response = await registerOptions(postRequest('/api/auth/register-options', { username: 'alice' }))

    expect(response.status).toBe(200)
    expect(mocks.challengeSave).toHaveBeenCalledWith(expect.objectContaining({
      challenge: 'registration-challenge', purpose: 'registration', username: 'alice', userId: null,
      userHandle: expect.any(String),
    }))
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      userID: expect.any(Uint8Array),
    }))
  })

  it('lets a signed-in user register an additional authenticator', async () => {
    mocks.getSession.mockResolvedValue({ userId: 7, username: 'alice' })
    mocks.userFindByUsername.mockReturnValue(alice)
    mocks.authenticatorListByUserId.mockReturnValue([{ credential_id: 'credential-one' }])

    const response = await registerOptions(postRequest('/api/auth/register-options', { username: 'alice' }))

    expect(response.status).toBe(200)
    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
      excludeCredentials: [{ id: 'credential-one' }],
      userID: expect.any(Uint8Array),
    }))
    expect(mocks.userEnsureWebAuthnUserId).toHaveBeenCalledWith(7)
    expect(mocks.challengeSave).toHaveBeenCalledWith(expect.objectContaining({ userId: 7 }))
  })

  it('creates the user and authenticator atomically after registration verification', async () => {
    mocks.challengeConsume.mockReturnValue({
      challenge: 'registration-challenge', purpose: 'registration', username: 'alice', userId: null,
      userHandle: 'opaque-user-handle', expiresAt: Date.now() + 10_000,
    })

    const response = await registerVerify(postRequest('/api/auth/register-verify', {
      username: 'alice', challenge: 'registration-challenge', response: { id: 'credential-id' },
    }))

    expect(await response.json()).toEqual({ success: true })
    expect(response.status).toBe(200)
    expect(mocks.authDataCreateUserWithAuthenticator).toHaveBeenCalledWith(
      'alice', 'opaque-user-handle', 'credential-id', expect.any(Buffer), 0,
    )
    expect(mocks.createSession).toHaveBeenCalledWith(alice)
  })

  it('adds a verified authenticator without creating a second user', async () => {
    mocks.challengeConsume.mockReturnValue({
      challenge: 'registration-challenge', purpose: 'registration', username: 'alice', userId: 7, expiresAt: Date.now() + 10_000,
    })
    mocks.getSession.mockResolvedValue({ userId: 7, username: 'alice' })

    const response = await registerVerify(postRequest('/api/auth/register-verify', {
      username: 'alice', challenge: 'registration-challenge', response: { id: 'credential-id' },
    }))

    expect(response.status).toBe(200)
    expect(mocks.userCreate).not.toHaveBeenCalled()
    expect(mocks.authenticatorCreate).toHaveBeenCalledWith(7, 'credential-id', expect.any(Buffer), 0)
    expect(mocks.createSession).toHaveBeenCalledWith(alice)
  })

  it('rejects adding an authenticator if the session ended after options were issued', async () => {
    mocks.challengeConsume.mockReturnValue({
      challenge: 'registration-challenge', purpose: 'registration', username: 'alice', userId: 7, expiresAt: Date.now() + 10_000,
    })

    const response = await registerVerify(postRequest('/api/auth/register-verify', {
      username: 'alice', challenge: 'registration-challenge', response: { id: 'credential-id' },
    }))

    expect(response.status).toBe(401)
    expect(mocks.authenticatorCreate).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('returns the same generic login failure for unknown usernames', async () => {
    const response = await loginOptions(postRequest('/api/auth/login-options', { username: 'unknown' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unable to authenticate with those credentials' })
  })

  it('offers every registered authenticator for login', async () => {
    mocks.userFindByUsername.mockReturnValue(alice)

    const response = await loginOptions(postRequest('/api/auth/login-options', { username: 'alice' }))

    expect(response.status).toBe(200)
    expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({
      allowCredentials: [{ id: 'credential-one' }, { id: 'credential-two' }],
    }))
  })

  it('rejects a credential owned by a different user', async () => {
    mocks.authenticatorFindByCredentialId.mockReturnValue({ id: 2, user_id: 8, counter: 0 })

    const response = await loginVerify(postRequest('/api/auth/login-verify', {
      username: 'alice', challenge: 'login-challenge', response: { id: 'credential-id' },
    }))

    expect(response.status).toBe(401)
    expect(mocks.verifyAuthenticationResponse).not.toHaveBeenCalled()
  })

  it('does not verify a replayed login challenge', async () => {
    mocks.challengeConsume.mockReturnValue(null)

    const response = await loginVerify(postRequest('/api/auth/login-verify', {
      username: 'alice', challenge: 'login-challenge', response: { id: 'credential-id' },
    }))

    expect(response.status).toBe(401)
    expect(mocks.verifyAuthenticationResponse).not.toHaveBeenCalled()
  })

  it('rejects stale counters even if a verifier result is marked verified', async () => {
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 3 } })

    const response = await loginVerify(postRequest('/api/auth/login-verify', {
      username: 'alice', challenge: 'login-challenge', response: { id: 'credential-id' },
    }))

    expect(response.status).toBe(401)
    expect(mocks.authenticatorUpdateCounterMonotonically).not.toHaveBeenCalled()
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('does not create a session when a concurrent assertion wins the counter update', async () => {
    mocks.authenticatorUpdateCounterMonotonically.mockReturnValue(false)

    const response = await loginVerify(postRequest('/api/auth/login-verify', {
      username: 'alice', challenge: 'login-challenge', response: { id: 'credential-id' },
    }))

    expect(response.status).toBe(401)
    expect(mocks.createSession).not.toHaveBeenCalled()
  })

  it('updates the counter and creates a session after a valid assertion', async () => {
    const response = await loginVerify(postRequest('/api/auth/login-verify', {
      username: 'alice', challenge: 'login-challenge', response: { id: 'credential-id' },
    }))

    expect(response.status).toBe(200)
    expect(mocks.authenticatorUpdateCounterMonotonically).toHaveBeenCalledWith(1, 4)
    expect(mocks.createSession).toHaveBeenCalledWith(alice)
  })

  it('reports a server error if session creation fails after registration persists', async () => {
    mocks.challengeConsume.mockReturnValue({
      challenge: 'registration-challenge', purpose: 'registration', username: 'alice', userId: null,
      userHandle: 'opaque-user-handle', expiresAt: Date.now() + 10_000,
    })
    mocks.createSession.mockRejectedValue(new Error('cookie store unavailable'))

    const response = await registerVerify(postRequest('/api/auth/register-verify', {
      username: 'alice', challenge: 'registration-challenge', response: { id: 'credential-id' },
    }))

    expect(response.status).toBe(500)
    expect(mocks.authDataCreateUserWithAuthenticator).toHaveBeenCalledOnce()
  })

  it('returns the current user from the session', async () => {
    mocks.getSession.mockResolvedValue({ userId: 7, username: 'alice' })

    const response = await me()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ user: { id: 7, username: 'alice' } })
  })

  it('returns 401 when no session exists', async () => {
    mocks.getSession.mockResolvedValue(null)

    const response = await me()

    expect(response.status).toBe(401)
  })

  it('clears the session on logout', async () => {
    const response = await logout(postRequest('/api/auth/logout', {}))

    expect(response.status).toBe(200)
    expect(mocks.deleteSession).toHaveBeenCalledOnce()
  })
})
