import { SignJWT, jwtVerify } from 'jose';
import type { Session } from './db';

export const SESSION_COOKIE = 'todo_session';
export const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

export function sessionKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret || new TextEncoder().encode(secret).length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 bytes');
  }
  return new TextEncoder().encode(secret);
}

export async function signSession(session: Session): Promise<string> {
  return new SignJWT({ userId: session.userId, username: session.username })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setExpirationTime('7d').setIssuer('todo-app').setAudience('todo-session')
    .sign(sessionKey());
}

export async function verifySession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), {
      algorithms: ['HS256'], issuer: 'todo-app', audience: 'todo-session',
    });
    if (!Number.isSafeInteger(payload.userId) || Number(payload.userId) <= 0 ||
        typeof payload.username !== 'string' || !payload.username) return null;
    return { userId: payload.userId as number, username: payload.username };
  } catch {
    return null;
  }
}
