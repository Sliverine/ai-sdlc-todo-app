import { generateRegistrationOptions } from '@simplewebauthn/server'
import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession } from '@/lib/auth'
import { authChallengeDB, userDB } from '@/lib/db'
import { authenticatorDB } from '@/lib/db'
import { getWebAuthnConfig, isSameOriginRequest, readValidatedJson, usernameSchema } from '@/lib/auth-route-utils'

export const runtime = 'nodejs'

const bodySchema = z.object({ username: usernameSchema })
const challengeLifetimeMs = 5 * 60 * 1000

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }

  const body = await readValidatedJson(request, bodySchema)
  if (!body) return NextResponse.json({ error: 'Invalid username' }, { status: 400 })
  const session = await getSession()
  const existingUser = userDB.findByUsername(body.username)
  if (existingUser && session?.userId !== existingUser.id) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
  }
  if (session && (!existingUser || session.userId !== existingUser.id)) {
    return NextResponse.json({ error: 'Sign out before registering another account' }, { status: 409 })
  }

  try {
    const { rpID, rpName } = getWebAuthnConfig()
    const authenticators = existingUser ? authenticatorDB.listByUserId(existingUser.id) : []
    const userHandle = existingUser
      ? userDB.ensureWebAuthnUserId(existingUser.id)
      : randomUUID()
    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userID: new TextEncoder().encode(userHandle),
      userName: body.username,
      attestationType: 'none',
      excludeCredentials: authenticators.map((authenticator) => ({ id: authenticator.credential_id })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    })
    const now = Date.now()
    authChallengeDB.deleteExpired(now)
    authChallengeDB.save({
      challenge: options.challenge,
      purpose: 'registration',
      username: body.username,
      userId: existingUser?.id ?? null,
      userHandle,
      expiresAt: now + challengeLifetimeMs,
    })
    return NextResponse.json(options)
  } catch {
    return NextResponse.json({ error: 'Unable to start registration' }, { status: 500 })
  }
}
