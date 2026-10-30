import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { NextRequest, NextResponse } from 'next/server'
import { createSession } from '@/lib/auth'
import { checkAuthClientRateLimit, checkAuthUsernameRateLimit } from '@/lib/auth-rate-limit'
import { getWebAuthnConfig, isSameOriginRequest, readValidatedJson, usernameSchema, challengeSchema } from '@/lib/auth-route-utils'
import { authChallengeDB, authenticatorDB, userDB } from '@/lib/db'
import { isCounterValid } from '@/lib/webauthn-policy'
import { z } from 'zod'

export const runtime = 'nodejs'

const bodySchema = z.object({
  username: usernameSchema,
  challenge: challengeSchema,
  response: z.object({ id: z.string().min(1) }).passthrough(),
})
const genericLoginError = { error: 'Unable to authenticate with those credentials' }

export async function POST(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: 'Invalid request origin' }, { status: 403 })
  }
  const clientRateLimit = checkAuthClientRateLimit(request, 'login')
  if (clientRateLimit) return clientRateLimit

  const body = await readValidatedJson(request, bodySchema)
  if (!body) return NextResponse.json(genericLoginError, { status: 401 })
  const usernameRateLimit = checkAuthUsernameRateLimit('login', body.username)
  if (usernameRateLimit) return usernameRateLimit

  const challenge = authChallengeDB.consume(body.challenge, 'login', Date.now(), body.username)
  if (!challenge || challenge.userId === null) {
    return NextResponse.json(genericLoginError, { status: 401 })
  }

  const authenticator = authenticatorDB.findByCredentialId(body.response.id)
  if (!authenticator || authenticator.user_id !== challenge.userId) {
    return NextResponse.json(genericLoginError, { status: 401 })
  }

  const user = userDB.findById(challenge.userId)
  if (!user) return NextResponse.json(genericLoginError, { status: 401 })

  let config: ReturnType<typeof getWebAuthnConfig>
  try {
    config = getWebAuthnConfig()
  } catch {
    return NextResponse.json({ error: 'Authentication service is not configured' }, { status: 500 })
  }

  let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response as unknown as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge: challenge.challenge,
      expectedOrigin: config.origin,
      expectedRPID: config.rpID,
      credential: {
        id: authenticator.credential_id,
        publicKey: new Uint8Array(authenticator.credential_public_key),
        counter: authenticator.counter ?? 0,
      },
    })
  } catch {
    return NextResponse.json(genericLoginError, { status: 401 })
  }

  const newCounter = verification.authenticationInfo?.newCounter ?? 0
  if (!verification.verified || !isCounterValid(authenticator.counter ?? 0, newCounter)) {
    return NextResponse.json(genericLoginError, { status: 401 })
  }

  if (!authenticatorDB.updateCounterMonotonically(authenticator.id, newCounter ?? 0)) {
    return NextResponse.json(genericLoginError, { status: 401 })
  }

  try {
    await createSession(user)
  } catch {
    return NextResponse.json({ error: 'Authentication succeeded, but a session could not be established. Retry sign in.' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}
