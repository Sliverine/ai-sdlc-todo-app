// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { authenticatorDB, closeDatabase, userDB } from '../../lib/db';
import { consumeChallenge, createSession, saveChallenge } from '../../lib/auth';

const mocks = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  registerVerify: vi.fn(),
  loginVerify: vi.fn(),
}));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => mocks.jar.has(name) ? { value: mocks.jar.get(name) } : undefined,
    set: (name: string, value: string) => mocks.jar.set(name, value),
    delete: (name: string) => mocks.jar.delete(name),
  }),
}));
vi.mock('@simplewebauthn/server', () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'random-register-challenge' })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'random-login-challenge' })),
  verifyRegistrationResponse: mocks.registerVerify,
  verifyAuthenticationResponse: mocks.loginVerify,
}));

import { POST as registerOptions } from '../../app/api/auth/register-options/route';
import { POST as registerVerify } from '../../app/api/auth/register-verify/route';
import { POST as loginOptions } from '../../app/api/auth/login-options/route';
import { POST as loginVerify } from '../../app/api/auth/login-verify/route';
import { POST as logout } from '../../app/api/auth/logout/route';
import { GET as me } from '../../app/api/auth/me/route';

function request(path: string, body: unknown) {
  return new NextRequest(`http://localhost:3000/api/auth/${path}`, {
    method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  closeDatabase();
  mocks.jar.clear();
  mocks.registerVerify.mockReset();
  mocks.loginVerify.mockReset();
  process.env.DATABASE_PATH = ':memory:';
  process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  process.env.APP_ORIGIN = 'http://localhost:3000';
  process.env.RP_ID = 'localhost';
  process.env.RP_NAME = 'Todo App';
});

describe('WebAuthn boundary and sessions', () => {
  it('creates a session only after a browser-bound single-use registration challenge', async () => {
    mocks.registerVerify.mockResolvedValue({
      verified: true, registrationInfo: { credential: { id: 'Y3JlZGVudGlhbA', publicKey: new Uint8Array([1, 2]), counter: 0 } },
    });
    const body = { username: 'alice', response: { id: 'Y3JlZGVudGlhbA' } };
    expect((await registerVerify(request('register-verify', body))).status).toBe(400);
    expect((await registerOptions(request('register-options', { username: 'alice' }))).status).toBe(200);
    const challenge = mocks.jar.get('todo_webauthn_challenge')!;
    expect((await registerVerify(request('register-verify', body))).status).toBe(200);
    expect(userDB.findByUsername('alice')).toBeTruthy();
    expect(await (await me(new NextRequest('http://localhost:3000/api/auth/me'))).json()).toMatchObject({ username: 'alice' });
    mocks.jar.set('todo_webauthn_challenge', challenge);
    expect((await registerVerify(request('register-verify', body))).status).toBe(400);
    expect(mocks.registerVerify).toHaveBeenCalledTimes(1);
    expect((await logout(request('logout', {}))).status).toBe(200);
    expect((await me(new NextRequest('http://localhost:3000/api/auth/me'))).status).toBe(401);
  });

  it('refuses duplicate registrations unless the session owns that identity', async () => {
    const alice = userDB.create('alice');
    userDB.create('bob');
    expect((await registerOptions(request('register-options', { username: 'alice' }))).status).toBe(409);
    await createSession(alice);
    expect((await registerOptions(request('register-options', { username: 'bob' }))).status).toBe(403);
    expect((await registerOptions(request('register-options', { username: 'alice' }))).status).toBe(200);
  });

  it('binds login credentials to the challenged user, coalesces counters and rejects replay', async () => {
    const alice = userDB.create('alice');
    const bob = userDB.create('bob');
    authenticatorDB.create(alice.id, 'YWxpY2U', new Uint8Array([1]), undefined);
    authenticatorDB.create(bob.id, 'Ym9i', new Uint8Array([2]), 0);
    mocks.loginVerify.mockResolvedValue({ verified: true, authenticationInfo: { newCounter: 1 } });
    await loginOptions(request('login-options', { username: 'alice' }));
    expect((await loginVerify(request('login-verify', { username: 'alice', response: { id: 'Ym9i' } }))).status).toBe(401);
    expect(mocks.loginVerify).not.toHaveBeenCalled();
    await loginOptions(request('login-options', { username: 'alice' }));
    expect((await loginVerify(request('login-verify', { username: 'alice', response: { id: 'YWxpY2U' } }))).status).toBe(200);
    expect(mocks.loginVerify.mock.calls[0][0]).toMatchObject({ credential: { counter: 0 }, requireUserVerification: true });
    expect(authenticatorDB.findByCredentialId('YWxpY2U')!.counter).toBe(1);
  });

  it('enrolls an additional passkey only while the original identity remains authenticated', async () => {
    const alice = userDB.create('alice');
    authenticatorDB.create(alice.id, 'b2xk', new Uint8Array([1]), 0);
    await createSession(alice);
    mocks.registerVerify.mockResolvedValue({
      verified: true, registrationInfo: { credential: { id: 'bmV3', publicKey: new Uint8Array([2]) } },
    });
    await registerOptions(request('register-options', { username: 'alice' }));
    expect((await registerVerify(request('register-verify', { username: 'alice', response: { id: 'bmV3' } }))).status).toBe(200);
    expect(authenticatorDB.findAllByUser(alice.id)).toHaveLength(2);
    await registerOptions(request('register-options', { username: 'alice' }));
    mocks.jar.delete('todo_session');
    expect((await registerVerify(request('register-verify', { username: 'alice', response: { id: 'bmV3' } }))).status).toBe(401);
  });

  it('rejects verification failures and never creates sessions for invalid passkeys', async () => {
    mocks.registerVerify.mockRejectedValue(new Error('Invalid signature'));
    await registerOptions(request('register-options', { username: 'alice' }));
    expect((await registerVerify(request('register-verify', { username: 'alice', response: { id: 'bmV3' } }))).status).toBe(401);
    expect(userDB.findByUsername('alice')).toBeUndefined();
    mocks.registerVerify.mockResolvedValue({ verified: false });
    await registerOptions(request('register-options', { username: 'alice' }));
    expect((await registerVerify(request('register-verify', { username: 'alice', response: { id: 'bmV3' } }))).status).toBe(401);
    const alice = userDB.create('alice');
    authenticatorDB.create(alice.id, 'bmV3', new Uint8Array([1]), 0);
    expect((await loginOptions(request('login-options', { username: 'missing' }))).status).toBe(400);
    expect((await loginVerify(request('login-verify', { username: 'alice', response: { id: 'bmV3' } }))).status).toBe(400);
    mocks.loginVerify.mockRejectedValue(new Error('Counter regression'));
    await loginOptions(request('login-options', { username: 'alice' }));
    expect((await loginVerify(request('login-verify', { username: 'alice', response: { id: 'bmV3' } }))).status).toBe(401);
    mocks.loginVerify.mockResolvedValue({ verified: false });
    await loginOptions(request('login-options', { username: 'alice' }));
    expect((await loginVerify(request('login-verify', { username: 'alice', response: { id: 'bmV3' } }))).status).toBe(401);
    expect(mocks.jar.get('todo_session')).toBeUndefined();
  });

  it('replaces browser challenges, rejects tampering and consumes mismatched attempts', async () => {
    await saveChallenge({ username: 'alice', flow: 'login', challenge: 'first', userId: 1 });
    const first = mocks.jar.get('todo_webauthn_challenge')!;
    await saveChallenge({ username: 'alice', flow: 'login', challenge: 'second', userId: 1 });
    const second = mocks.jar.get('todo_webauthn_challenge')!;
    mocks.jar.set('todo_webauthn_challenge', first);
    expect(await consumeChallenge('login', 'alice')).toBeNull();
    mocks.jar.set('todo_webauthn_challenge', second);
    expect(await consumeChallenge('register', 'alice')).toBeNull();
    mocks.jar.set('todo_webauthn_challenge', second);
    expect(await consumeChallenge('login', 'alice')).toBeNull();
    mocks.jar.set('todo_webauthn_challenge', 'tampered-token');
    expect(await consumeChallenge('login', 'alice')).toBeNull();
    await saveChallenge({ username: 'alice', flow: 'login', challenge: 'new', userId: 1 });
    const pending = mocks.jar.get('todo_webauthn_challenge')!;
    await logout(request('logout', {}));
    mocks.jar.set('todo_webauthn_challenge', pending);
    expect(await consumeChallenge('login', 'alice')).toBeNull();
  });
});
