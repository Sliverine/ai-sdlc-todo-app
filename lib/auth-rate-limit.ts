import { createHmac } from 'node:crypto'
import { isIP } from 'node:net'
import { NextRequest, NextResponse } from 'next/server'
import * as dbModule from '@/lib/db'
import type { AuthRateLimitDecision } from '@/lib/db'

export type AuthRateLimitFlow = 'login' | 'registration'

interface RateLimitPolicy {
  windowMs: number
  clientLimit: number
  usernameLimit: number
}

interface MemoryBucket {
  windowStart: number
  requestCount: number
  expiresAt: number
}

const memoryBuckets = new Map<string, MemoryBucket>()

const policies: Record<AuthRateLimitFlow, RateLimitPolicy> = {
  login: { windowMs: 15 * 60 * 1000, clientLimit: 60, usernameLimit: 10 },
  registration: { windowMs: 60 * 60 * 1000, clientLimit: 20, usernameLimit: 12 },
}

function clientAddress(request: NextRequest): string {
  const realIp = request.headers.get('x-real-ip')?.trim()
  const forwardedIp = request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()
  const candidate = realIp || forwardedIp || 'unknown'
  return isIP(candidate) ? candidate.toLowerCase() : 'unknown'
}

function bucketKey(flow: AuthRateLimitFlow, kind: 'client' | 'username', identifier: string): string {
  const secret = process.env.JWT_SECRET
  if (!secret || secret.length < 32) throw new Error('JWT_SECRET is not configured')
  return createHmac('sha256', secret).update(`${flow}:${kind}:${identifier}`).digest('hex')
}

function consumeMemoryBucket(
  key: string,
  now: number,
  windowMs: number,
  maximumRequests: number,
): AuthRateLimitDecision {
  for (const [storedKey, bucket] of memoryBuckets) {
    if (bucket.expiresAt <= now) memoryBuckets.delete(storedKey)
  }

  const windowStart = Math.floor(now / windowMs) * windowMs
  const current = memoryBuckets.get(key)
  if (!current || current.windowStart !== windowStart) {
    memoryBuckets.set(key, { windowStart, requestCount: 1, expiresAt: windowStart + windowMs })
    return { allowed: true, retryAfterSeconds: 0 }
  }
  if (current.requestCount >= maximumRequests) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.expiresAt - now) / 1000)) }
  }

  current.requestCount += 1
  return { allowed: true, retryAfterSeconds: 0 }
}

function consumeBucket(key: string, policy: RateLimitPolicy, maximumRequests: number): AuthRateLimitDecision {
  if (process.env.NODE_ENV !== 'production') {
    return consumeMemoryBucket(key, Date.now(), policy.windowMs, maximumRequests)
  }

  const store = (dbModule as typeof dbModule & {
    authRateLimitDB?: { consume: (bucketKey: string, now: number, windowMs: number, limit: number) => AuthRateLimitDecision }
  }).authRateLimitDB
  if (store) return store.consume(key, Date.now(), policy.windowMs, maximumRequests)

  throw new Error('Authentication rate-limit store is unavailable')
}

function enforce(key: string, policy: RateLimitPolicy, maximumRequests: number): NextResponse | null {
  try {
    const decision = consumeBucket(key, policy, maximumRequests)
    if (decision.allowed) return null
    return NextResponse.json(
      { error: 'Too many authentication attempts. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(decision.retryAfterSeconds), 'Cache-Control': 'no-store' },
      },
    )
  } catch {
    return NextResponse.json(
      { error: 'Authentication service is temporarily unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}

export function checkAuthClientRateLimit(request: NextRequest, flow: AuthRateLimitFlow): NextResponse | null {
  const policy = policies[flow]
  return enforce(bucketKey(flow, 'client', clientAddress(request)), policy, policy.clientLimit)
}

export function checkAuthUsernameRateLimit(flow: AuthRateLimitFlow, username: string): NextResponse | null {
  const policy = policies[flow]
  return enforce(bucketKey(flow, 'username', username.trim().toLowerCase()), policy, policy.usernameLimit)
}