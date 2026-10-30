// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { sessionKey, signSession, verifySession } from '../../lib/session';
import { SignJWT } from 'jose';

afterEach(() => {
  delete process.env.JWT_SECRET;
});

describe('signed sessions', () => {
  it('requires an explicitly configured sufficiently long secret', async () => {
    delete process.env.JWT_SECRET;
    await expect(signSession({ userId: 1, username: 'alice' })).rejects.toThrow();
    process.env.JWT_SECRET = 'short';
    await expect(signSession({ userId: 1, username: 'alice' })).rejects.toThrow();
  });

  it('rejects tampered sessions and sessions signed with a different key', async () => {
    process.env.JWT_SECRET = 'a'.repeat(48);
    const token = await signSession({ userId: 1, username: 'alice' });
    expect(await verifySession(token)).toEqual({ userId: 1, username: 'alice' });
    expect(await verifySession(`${token.slice(0, -8)}tampered`)).toBeNull();
    process.env.JWT_SECRET = 'b'.repeat(48);
    expect(await verifySession(token)).toBeNull();
    expect(await verifySession(undefined)).toBeNull();
  });

  it('rejects expired tokens, incorrect audiences and invalid identities', async () => {
    process.env.JWT_SECRET = 'a'.repeat(48);
    const expired = await new SignJWT({ userId: 1, username: 'alice' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('todo-app').setAudience('todo-session')
      .setExpirationTime(1).sign(sessionKey());
    expect(await verifySession(expired)).toBeNull();
    const invalidIdentity = await new SignJWT({ userId: -1, username: 'alice' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('todo-app').setAudience('todo-session')
      .setExpirationTime('1h').sign(sessionKey());
    expect(await verifySession(invalidIdentity)).toBeNull();
    const invalidAudience = await new SignJWT({ userId: 1, username: 'alice' })
      .setProtectedHeader({ alg: 'HS256' }).setIssuer('todo-app').setAudience('something-else')
      .setExpirationTime('1h').sign(sessionKey());
    expect(await verifySession(invalidAudience)).toBeNull();
  });
});
