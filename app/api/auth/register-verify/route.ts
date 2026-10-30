import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { NextRequest, NextResponse } from 'next/server'
import { createSession, getSession } from '@/lib/auth'
import { challengeSchema, getWebAuthnConfig, isSameOriginRequest, isSqliteConstraintError, readValidatedJson, usernameSchema } from '@/lib/auth-route-utils'
import { authChallengeDB, authDataDB, authenticatorDB, userDB } from '@/lib/db'
import type { User } from '@/lib/db'
import { z } from 'zod'

export const runtime = 'nodejs'

const bodySchema = z.object({
  username: usernameSchema,
  challenge: challengeSchema,
  response: z.record(z.string(), z.unknown()),
})

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const body = await readValidatedJson(request, bodySchema)
  if (!body) return NextResponse.json({ error: 'Invalid registration response' }, { status: 400 })

  const challenge = authChallengeDB.consume(body.challenge, 'registration', Date.now(), body.username)
  if (!challenge) return NextResponse.json({ error: 'Registration challenge expired or invalid' }, { status: 401 })

  if (challenge.userId !== null) {
    const session = await getSession()
    const existingUser = userDB.findById(challenge.userId)
    if (!session || session.userId !== challenge.userId || !existingUser || existingUser.username !== body.username) {
      return NextResponse.json({ error: 'Registration verification failed' }, { status: 401 })
    }
  }

  let config: ReturnType<typeof getWebAuthnConfig>
  try {
    config = getWebAuthnConfig()
  } catch {
    return NextResponse.json({ error: 'Authentication service is not configured' }, { status: 500 })
  }

  let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as unknown as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
    })
  } catch {
    return NextResponse.json({ error: 'Registration verification failed' }, { status: 401 })
  }
  const credential = verification.registrationInfo?.credential
  if (!verification.verified || !credential) {
    return NextResponse.json({ error: 'Registration verification failed' }, { status: 401 })
  }

  let registeredUser: User
  try {
    if (challenge.userId !== null) {
      const existingUser = userDB.findById(challenge.userId)
      if (!existingUser || existingUser.username !== body.username) {
        return NextResponse.json({ error: 'Registration verification failed' }, { status: 401 })
      }
      authenticatorDB.create(existingUser.id, credential.id, Buffer.from(credential.publicKey), credential.counter ?? 0)
      registeredUser = existingUser
    } else {
      if (!challenge.userHandle) {
        return NextResponse.json({ error: 'Registration verification failed' }, { status: 401 })
      }
      registeredUser = authDataDB.createUserWithAuthenticator(
        body.username,
        challenge.userHandle,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter ?? 0,
      )
    }
  } catch (error) {
    if (isSqliteConstraintError(error)) {
      return NextResponse.json({ error: 'Username or authenticator is already registered' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Unable to save authenticator' }, { status: 500 })
  }

  try {
    await createSession(registeredUser)
  } catch {
    return NextResponse.json({ error: 'Registration succeeded, but a session could not be established. Sign in to continue.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
