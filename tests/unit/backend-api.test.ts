// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { closeDatabase, todoDB, userDB } from '../../lib/db';
import { signSession, SESSION_COOKIE } from '../../lib/session';

const cookieJar = new Map<string, string>();
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => cookieJar.has(name) ? { value: cookieJar.get(name) } : undefined,
    set: (name: string, value: string) => cookieJar.set(name, value),
    delete: (name: string) => cookieJar.delete(name),
  }),
}));

import { GET as list, POST as create } from '../../app/api/todos/route';
import { GET as reminders } from '../../app/api/notifications/check/route';
import { GET as getTodo, PUT as update, DELETE as deleteTodo } from '../../app/api/todos/[id]/route';
import { apiHandler, readJson } from '../../lib/api';
import { NextResponse } from 'next/server';

function request(path: string, method = 'GET', body?: unknown, origin = 'http://localhost:3000') {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  closeDatabase();
  cookieJar.clear();
  process.env.DATABASE_PATH = ':memory:';
  process.env.JWT_SECRET = 'test-secret-with-at-least-thirty-two-characters';
  process.env.APP_ORIGIN = 'http://localhost:3000';
});

async function login() {
  const user = userDB.create('alice');
  cookieJar.set(SESSION_COOKIE, await signSession({ userId: user.id, username: user.username }));
  return user;
}

describe('backend API integration', () => {
  it('requires authentication before parsing protected input', async () => {
    expect((await list(request('/api/todos'))).status).toBe(401);
    expect((await create(request('/api/todos', 'POST', {}))).status).toBe(401);
    expect((await reminders(request('/api/notifications/check'))).status).toBe(401);
  });

  it('rejects cross-origin writes, invalid input and creates normalized todos', async () => {
    await login();
    expect((await create(request('/api/todos', 'POST', { title: 'X' }, 'https://evil.example'))).status).toBe(403);
    expect((await create(request('/api/todos', 'POST', { title: '', reminder_minutes: 4 }))).status).toBe(400);
    const response = await create(request('/api/todos', 'POST', { title: '  Test  ' }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ title: 'Test', completed: false, priority: 'medium' });
    expect(await (await list(request('/api/todos'))).json()).toHaveLength(1);
  });

  it('returns late reminders and ignores stale acknowledgements without leaking other users', async () => {
    const user = await login();
    const todo = todoDB.create(user.id, { title: 'Late', due_date: '2020-01-01T00:00:00Z', reminder_minutes: 15 });
    const other = userDB.create('bob');
    todoDB.create(other.id, { title: 'Private', due_date: '2020-01-01T00:00:00Z', reminder_minutes: 15 });
    expect(await (await reminders(request('/api/notifications/check'))).json()).toMatchObject({ success: true, data: [{ id: todo.id }] });
    const context = { params: Promise.resolve({ id: String(todo.id) }) };
    const response = await update(request(`/api/todos/${todo.id}`, 'PUT', {
      last_notification_sent: '2026-01-01T00:00:00Z',
      notification_reminder_minutes: 30,
    }), context);
    expect((await response.json()).last_notification_sent).toBeNull();
    const ack = await update(request(`/api/todos/${todo.id}`, 'PUT', {
      last_notification_sent: '2026-01-01T00:00:00Z',
      notification_reminder_minutes: 15,
      notification_due_date: todo.due_date,
    }), context);
    expect((await ack.json()).last_notification_sent).toBeTruthy();
    expect((await (await reminders(request('/api/notifications/check'))).json()).data).toEqual([]);
  });

  it('handles malformed IDs, ownership, edits, deletes and priority filtering', async () => {
    const user = await login();
    const todo = todoDB.create(user.id, { title: 'Existing', priority: 'high' });
    const context = (id: string) => ({ params: Promise.resolve({ id }) });
    expect((await getTodo(request('/api/todos/0'), context('0'))).status).toBe(404);
    expect((await getTodo(request('/api/todos/999'), context('999'))).status).toBe(404);
    expect((await getTodo(request(`/api/todos/${todo.id}`), context(String(todo.id)))).status).toBe(200);
    expect((await update(request(`/api/todos/${todo.id}`, 'PUT', { title: '' }), context(String(todo.id)))).status).toBe(400);
    expect((await update(request('/api/todos/999', 'PUT', { title: 'X' }), context('999'))).status).toBe(404);
    const updated = await update(request(`/api/todos/${todo.id}`, 'PUT', { title: 'Changed', completed: true }), context(String(todo.id)));
    expect(await updated.json()).toMatchObject({ title: 'Changed', completed: true });
    expect(await (await list(request('/api/todos?priority=low'))).json()).toEqual([]);
    expect((await list(request('/api/todos?priority=urgent'))).status).toBe(400);
    expect((await deleteTodo(request(`/api/todos/${todo.id}`, 'DELETE'), context(String(todo.id)))).status).toBe(200);
    expect((await deleteTodo(request(`/api/todos/${todo.id}`, 'DELETE'), context(String(todo.id)))).status).toBe(404);
  });

  it('bounds JSON parsing and requires same-origin requests', async () => {
    await login();
    const invalidJson = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST', headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: '{',
    });
    expect((await create(invalidJson)).status).toBe(400);
    const plain = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST', headers: { origin: 'http://localhost:3000' }, body: 'hello',
    });
    expect((await create(plain)).status).toBe(415);
    await expect(readJson(request('/api/todos', 'POST', { title: 'a'.repeat(66000) }))).rejects.toMatchObject({ status: 413 });
    const noBody = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST', headers: { 'content-type': 'application/json' },
    });
    await expect(readJson(noBody)).rejects.toMatchObject({ status: 400 });
    const crossSite = request('/api/todos', 'POST', { title: 'Cross-site' });
    crossSite.headers.set('sec-fetch-site', 'cross-site');
    expect((await create(crossSite)).status).toBe(403);
    const failure = await apiHandler(request('/api/todos'), () => { throw new Error('SECRET INTERNAL DETAIL'); });
    expect(failure.status).toBe(500);
    expect(await failure.json()).toEqual({ error: 'An unexpected error occurred' });
  });

  it('rate limits authenticated endpoints without a test-only authentication bypass', async () => {
    const user = await login();
    // A distinct persisted user prevents this stress case affecting earlier test buckets.
    const id = user.id + 1000;
    const { getDatabase } = await import('../../lib/db');
    getDatabase().prepare('INSERT INTO users(id,username) VALUES (?,?)').run(id, 'rate-limit');
    cookieJar.set(SESSION_COOKIE, await signSession({ userId: id, username: 'rate-limit' }));
    let response: NextResponse | undefined;
    for (let count = 0; count <= 240; count++) response = await list(request('/api/todos'));
    expect(response!.status).toBe(429);
    expect(response!.headers.get('Retry-After')).toBe('60');
  });
});
