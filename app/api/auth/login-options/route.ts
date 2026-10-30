import { generateAuthenticationOptions } from '@simplewebauthn/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { checkAuthClientRateLimit, checkAuthUsernameRateLimit } from '@/lib/auth-rate-limit'
import { authChallengeDB, authenticatorDB, userDB } from '@/lib/db'
import { getWebAuthnConfig, isSameOriginRequest, readValidatedJson, usernameSchema } from '@/lib/auth-route-utils'

export const runtime = 'nodejs'

const bodySchema = z.object({ username: usernameSchema })
const challengeLifetimeMs = 5 * 60 * 1000
const genericLoginError = { error: 'Unable to authenticate with those credentials' }

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }
  const clientRateLimit = checkAuthClientRateLimit(request, 'login')
  if (clientRateLimit) return clientRateLimit

  const body = await readValidatedJson(request, bodySchema)
  if (!body) return NextResponse.json({ error: 'Invalid username' }, { status: 400 })
  const usernameRateLimit = checkAuthUsernameRateLimit('login', body.username)
  if (usernameRateLimit) return usernameRateLimit

  const user = userDB.findByUsername(body.username)
  const authenticators = user ? authenticatorDB.listByUserId(user.id) : []
  if (!user || authenticators.length === 0) {
    return NextResponse.json(genericLoginError, { status: 401 })
  }

  try {
    const { rpID } = getWebAuthnConfig()
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: authenticators.map((authenticator) => ({ id: authenticator.credential_id })),
      userVerification: 'preferred',
    })
    const now = Date.now()
    authChallengeDB.deleteExpired(now)
    authChallengeDB.save({
      challenge: options.challenge,
      purpose: 'login',
      username: user.username,
      userId: user.id,
      expiresAt: now + challengeLifetimeMs,
    })
    return NextResponse.json(options)
  } catch {
    return NextResponse.json({ error: 'Unable to start authentication' }, { status: 500 })
  }
}
