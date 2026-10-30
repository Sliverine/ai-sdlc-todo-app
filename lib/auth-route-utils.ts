import type { NextRequest } from 'next/server'
import { z } from 'zod'

export const usernameSchema = z.string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9._-]+$/)

export const challengeSchema = z.string().min(1).max(256)

export async function readValidatedJson<T extends z.ZodType>(request: NextRequest, schema: T): Promise<z.infer<T> | null> {
  try {
    const result = schema.safeParse(await request.json())
    return result.success ? result.data : null
  } catch {
    return null
  }
}

export function isSameOriginRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  const configuredOrigin = process.env.RP_ORIGIN
  if (!origin || !configuredOrigin) return false

  try {
    return new URL(origin).origin === new URL(configuredOrigin).origin
  } catch {
    return false
  }
}

export function getWebAuthnConfig() {
  const rpID = process.env.RP_ID
  const rpName = process.env.RP_NAME
  const origin = process.env.RP_ORIGIN
  if (!rpID || !rpName || !origin) {
    throw new Error('WebAuthn environment is not configured')
  }
  return { rpID, rpName, origin }
}

export function isSqliteConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && typeof error.code === 'string'
    && error.code.startsWith('SQLITE_CONSTRAINT')
}
