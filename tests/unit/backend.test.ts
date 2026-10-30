// @vitest-environment node
import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, todoDB, userDB } from '../../lib/db';
import { formatSingaporeDate, parseSingaporeDate, toSingaporeInput } from '../../lib/timezone';
import { calculateNextDueDate } from '../../lib/recurrence';
import { validateTodo } from '../../lib/validation';

process.env.DATABASE_PATH = ':memory:';

beforeEach(() => {
  closeDatabase();
});
afterAll(() => closeDatabase());

describe('backend prerequisites', () => {
  it('creates all eight tables lazily with foreign keys', () => {
    const tables = getDatabase().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    expect(tables).toHaveLength(8);
    expect(getDatabase().pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('interprets datetime-local in Singapore independent of host timezone', () => {
    expect(parseSingaporeDate('2026-10-30T12:30').toISOString()).toBe('2026-10-30T04:30:00.000Z');
    expect(toSingaporeInput('2026-10-30T04:30:00Z')).toBe('2026-10-30T12:30');
    expect(() => parseSingaporeDate('2026-02-30T12:00')).toThrow();
    expect(() => parseSingaporeDate('not a date')).toThrow();
    expect(() => parseSingaporeDate('2026-01-01T00:00+25:00')).toThrow();
    expect(() => parseSingaporeDate('2026-01-01T00:00+08:99')).toThrow();
    expect(toSingaporeInput(null)).toBe('');
    expect(formatSingaporeDate('2026-10-30T09:00:00Z')).toContain('17:00');
  });

  it('clamps recurrence month/year ends and preserves Singapore time', () => {
    expect(toSingaporeInput(calculateNextDueDate('2028-01-31T12:30+08:00', 'monthly'))).toBe('2028-02-29T12:30');
    expect(toSingaporeInput(calculateNextDueDate('2028-02-29T12:30+08:00', 'yearly'))).toBe('2029-02-28T12:30');
    expect(toSingaporeInput(calculateNextDueDate('2026-12-31T12:30+08:00', 'daily'))).toBe('2027-01-01T12:30');
    expect(toSingaporeInput(calculateNextDueDate('2026-12-31T12:30+08:00', 'weekly'))).toBe('2027-01-07T12:30');
    expect(toSingaporeInput(calculateNextDueDate('2026-12-31T12:30+08:00', 'monthly'))).toBe('2027-01-31T12:30');
  });

  it('validates enums, future dates and recurring/reminder requirements', () => {
    expect(() => validateTodo({ title: '  ' })).toThrow();
    expect(() => validateTodo({ title: 'A', priority: 'urgent' })).toThrow();
    expect(() => validateTodo({ title: 'A', reminder_minutes: 5 })).toThrow();
    expect(() => validateTodo({ title: 'A', reminder_minutes: 15 })).toThrow();
    expect(() => validateTodo({ title: 'A', is_recurring: true })).toThrow();
    expect(() => validateTodo({ title: 'A', due_date: '2020-01-01T12:30+08:00' })).toThrow();
    expect(() => validateTodo({ title: 'A', completed: true })).toThrow();
    expect(validateTodo({ title: 'A', priority: 'low', due_date: '2099-01-01T12:30+08:00', is_recurring: true, recurrence_pattern: 'daily', reminder_minutes: 15 })).toMatchObject({ priority: 'low', recurrence_pattern: 'daily' });
  });

  it('preserves overdue dates on unrelated updates and prevents cross-user access', () => {
    const alice = userDB.create('alice');
    const bob = userDB.create('bob');
    const todo = todoDB.create(alice.id, { title: 'Overdue', due_date: '2020-01-01T00:00:00Z' });
    expect(validateTodo({ priority: 'high' }, todo).due_date).toBe(todo.due_date);
    expect(todoDB.update(todo.id, bob.id, { title: 'Stolen' })).toBeNull();
    expect(todoDB.findById(todo.id, bob.id)).toBeNull();
    expect(todoDB.delete(todo.id, bob.id)).toBe(false);
    expect(() => todoDB.create(alice.id, { title: 'Invalid tags', tag_ids: [999] })).toThrow('Invalid tag');
    expect(todoDB.findAllByUser(alice.id)).toHaveLength(1);
  });

  it('includes late reminders, stamps acknowledgements and resets only changed schedules', () => {
    const user = userDB.create('reminders');
    const todo = todoDB.create(user.id, { title: 'Late', due_date: '2020-01-01T00:00:00Z', reminder_minutes: 15 });
    expect(todoDB.findDueReminders(user.id)).toHaveLength(1);
    const ack = todoDB.update(todo.id, user.id, { last_notification_sent: '2000-01-01T00:00:00Z' })!;
    expect(ack.last_notification_sent).not.toBe('2000-01-01T00:00:00Z');
    expect(todoDB.findDueReminders(user.id)).toHaveLength(0);
    expect(todoDB.update(todo.id, user.id, { due_date: todo.due_date })!.last_notification_sent).toBeTruthy();
    expect(todoDB.update(todo.id, user.id, { reminder_minutes: 30 })!.last_notification_sent).toBeNull();
    expect(todoDB.update(todo.id, user.id, { last_notification_sent: '2026-01-01T00:00:00Z', notification_reminder_minutes: 15 })!.last_notification_sent).toBeNull();
    todoDB.update(todo.id, user.id, { completed: true });
    expect(todoDB.findDueReminders(user.id)).toHaveLength(0);
  });

  it('transactionally completes recurring todos once, cloning metadata and tags', () => {
    const user = userDB.create('recurrence');
    const db = getDatabase();
    const tag = db.prepare('INSERT INTO tags(user_id,name) VALUES (?,?)').run(user.id, 'Work');
    const todo = todoDB.create(user.id, { title: 'Monthly', due_date: '2028-01-31T04:30:00Z', priority: 'high', is_recurring: true, recurrence_pattern: 'monthly', reminder_minutes: 30, tag_ids: [Number(tag.lastInsertRowid)] });
    todoDB.update(todo.id, user.id, { completed: true });
    todoDB.update(todo.id, user.id, { completed: true });
    const all = todoDB.findAllByUser(user.id);
    expect(all).toHaveLength(2);
    const next = all.find((row) => row.id !== todo.id)!;
    expect(next).toMatchObject({ title: 'Monthly', priority: 'high', reminder_minutes: 30, completed: false, last_notification_sent: null });
    expect(toSingaporeInput(next.due_date)).toBe('2028-02-29T12:30');
    expect(next.tags).toHaveLength(1);
    expect(todoDB.delete(todo.id, user.id)).toBe(true);
    expect(db.prepare('SELECT * FROM todo_tags WHERE todo_id=?').all(todo.id)).toHaveLength(0);
  });
});
