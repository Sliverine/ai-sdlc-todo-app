import { createHash, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { authenticatorDB, getDatabase, userDB, type Session, type User } from './db';
import { SESSION_COOKIE, SESSION_MAX_AGE, sessionKey, signSession, verifySession } from './session';
import { getSingaporeNow } from './timezone';

export async function createSession(user: Pick<User, 'id' | 'username'>): Promise<void> {
  const token = await signSession({ userId: user.id, username: user.username });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production' || process.env.APP_ORIGIN?.startsWith('https://'),
    sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE,
  });
}

export async function getSession(): Promise<Session | null> {
  const session = await verifySession((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = userDB.findById(session.userId);
  return user && user.username === session.username ? session : null;
}

export async function deleteSession(): Promise<void> {
  const token = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, sessionKey(), {
        algorithms: ['HS256'], issuer: 'todo-app', audience: 'todo-webauthn',
      });
      if (typeof payload.id === 'string') challenges.delete(payload.id);
    } catch { /* Invalid challenge cookies are discarded on logout. */ }
  }
  (await cookies()).delete(SESSION_COOKIE);
  (await cookies()).set(CHALLENGE_COOKIE, '', { path: '/api/auth', maxAge: 0, httpOnly: true, sameSite: 'strict' });
}

const CHALLENGE_COOKIE = 'todo_webauthn_challenge';
const CHALLENGE_SECONDS = 300;
// Route bundles and development reloads must share one single-use challenge registry.
const authGlobal = globalThis as typeof globalThis & { __todoChallenges?: Map<string, number> };
const challenges = authGlobal.__todoChallenges ?? new Map<string, number>();
authGlobal.__todoChallenges = challenges;
export interface AuthChallenge {
  challenge: string; username: string; flow: 'register' | 'login'; userId?: number; id: string;
}

export async function saveChallenge(input: Omit<AuthChallenge, 'id'>): Promise<void> {
  const now = getSingaporeNow().getTime();
  for (const [id, expiry] of challenges) if (expiry <= now) challenges.delete(id);
  if (challenges.size >= 5000) throw new Error('Challenge capacity exceeded');
  const id = randomUUID();
  const token = await new SignJWT({ ...input, id })
    .setProtectedHeader({ alg: 'HS256' }).setIssuer('todo-app').setAudience('todo-webauthn')
    .setIssuedAt().setExpirationTime(`${CHALLENGE_SECONDS}s`).sign(sessionKey());
  const jar = await cookies();
  const previous = jar.get(CHALLENGE_COOKIE)?.value;
  if (previous) {
    try {
      const { payload } = await jwtVerify(previous, sessionKey(), { algorithms: ['HS256'], issuer: 'todo-app', audience: 'todo-webauthn' });
      if (typeof payload.id === 'string') challenges.delete(payload.id);
    } catch { /* An expired challenge can simply be replaced. */ }
  }
  challenges.set(id, now + CHALLENGE_SECONDS * 1000);
  jar.set(CHALLENGE_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production' || process.env.APP_ORIGIN?.startsWith('https://'),
    sameSite: 'strict', path: '/api/auth', maxAge: CHALLENGE_SECONDS,
  });
}

export async function consumeChallenge(flow: AuthChallenge['flow'], username: string): Promise<AuthChallenge | null> {
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  jar.set(CHALLENGE_COOKIE, '', { path: '/api/auth', maxAge: 0, httpOnly: true, sameSite: 'strict' });
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionKey(), {
      algorithms: ['HS256'], issuer: 'todo-app', audience: 'todo-webauthn',
    });
    if (typeof payload.id !== 'string') return null;
    const expiry = challenges.get(payload.id);
    challenges.delete(payload.id);
    if (!expiry || expiry <= getSingaporeNow().getTime() || payload.flow !== flow || payload.username !== username ||
        typeof payload.challenge !== 'string' ||
        (payload.userId !== undefined && (!Number.isSafeInteger(payload.userId) || Number(payload.userId) < 1))) return null;
    return { id: payload.id, flow, username, challenge: payload.challenge, userId: payload.userId as number | undefined };
  } catch { return null; }
}

export function registerCredential(
  username: string,
  credential: { id: string; publicKey: Uint8Array; counter?: number },
  existingUserId?: number,
): User {
  return getDatabase().transaction(() => {
    const user = existingUserId === undefined ? userDB.create(username) : userDB.findById(existingUserId);
    if (!user || user.username !== username) throw new Error('Invalid user');
    authenticatorDB.create(user.id, credential.id, credential.publicKey, credential.counter ?? 0);
    return user;
  })();
}

export function webauthnSettings() {
  const rpID = process.env.RP_ID;
  const rpName = process.env.RP_NAME;
  const origin = process.env.APP_ORIGIN;
  if (!rpID || !rpName || !origin) throw new Error('WebAuthn environment is not configured');
  const hostname = new URL(origin).hostname;
  if (hostname !== rpID && !hostname.endsWith(`.${rpID}`)) throw new Error('RP_ID does not match APP_ORIGIN');
  return { rpID, rpName, origin };
}

export function webauthnUserID(username: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(createHash('sha256').update(`${process.env.RP_ID}:${username}`).digest());
}
