import Database from 'better-sqlite3';
import { calculateNextDueDate } from './recurrence';
import { getSingaporeNow, parseSingaporeDate } from './timezone';
import { validateTodo } from './validation';

export type Priority = 'high' | 'medium' | 'low';
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type ReminderMinutes = 15 | 30 | 60 | 120 | 1440 | 2880 | 10080;
export interface User { id: number; username: string; created_at: string }
export interface Session { userId: number; username: string }
export interface Authenticator {
  id: number; user_id: number; credential_id: string; credential_public_key: Buffer;
  counter: number; created_at: string;
}
export interface Todo {
  id: number; user_id: number; title: string; completed: boolean;
  due_date: string | null; priority: Priority; is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null; reminder_minutes: ReminderMinutes | null;
  last_notification_sent: string | null; created_at: string; updated_at: string | null;
  subtasks?: Subtask[]; tags?: Tag[];
}
export interface Subtask {
  id: number; todo_id: number; title: string; completed: boolean; position: number; created_at: string;
}
export interface Tag { id: number; user_id: number; name: string; color: string; created_at: string }
export interface Template {
  id: number; user_id: number; name: string; description: string | null; category: string | null;
  title_template: string; priority: Priority; is_recurring: boolean;
  recurrence_pattern: RecurrencePattern | null; reminder_minutes: number | null;
  due_date_offset_minutes: number | null; subtasks_json: string | null; created_at: string;
}
export interface Holiday { id: number; date: string; name: string }
export interface CreateTodoInput {
  title: string; due_date?: string | null; priority?: Priority; is_recurring?: boolean;
  recurrence_pattern?: RecurrencePattern | null; reminder_minutes?: number | null; tag_ids?: number[];
}
export interface UpdateTodoInput extends Partial<CreateTodoInput> {
  completed?: boolean; last_notification_sent?: string;
  notification_due_date?: string; notification_reminder_minutes?: number;
}

let connection: Database.Database | undefined;

export function getDatabase(): Database.Database {
  if (connection) return connection;
  const db = new Database(process.env.DATABASE_PATH || 'todos.db');
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS authenticators (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL, credential_public_key BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);
    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
      due_date TEXT, priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('high','medium','low')),
      is_recurring INTEGER NOT NULL DEFAULT 0,
      recurrence_pattern TEXT CHECK(recurrence_pattern IN ('daily','weekly','monthly','yearly')),
      reminder_minutes INTEGER CHECK(reminder_minutes IN (15,30,60,120,1440,2880,10080)),
      last_notification_sent TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
    CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
    CREATE TABLE IF NOT EXISTS subtasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      title TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0, position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);
    CREATE TABLE IF NOT EXISTS tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#3B82F6',
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(user_id,name)
    );
    CREATE TABLE IF NOT EXISTS todo_tags (
      todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
      tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(todo_id,tag_id)
    );
    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT, category TEXT, title_template TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium', is_recurring INTEGER NOT NULL DEFAULT 0,
      recurrence_pattern TEXT, reminder_minutes INTEGER, due_date_offset_minutes INTEGER, subtasks_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS holidays (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
  `);
  connection = db;
  return db;
}

export function closeDatabase(): void {
  connection?.close();
  connection = undefined;
}

export const userDB = {
  findById(id: number): User | undefined {
    return getDatabase().prepare('SELECT * FROM users WHERE id=?').get(id) as User | undefined;
  },
  findByUsername(username: string): User | undefined {
    return getDatabase().prepare('SELECT * FROM users WHERE username=?').get(username) as User | undefined;
  },
  create(username: string): User {
    const result = getDatabase().prepare('INSERT INTO users(username,created_at) VALUES (?,?)').run(username, getSingaporeNow().toISOString());
    return this.findById(Number(result.lastInsertRowid))!;
  },
};

export const authenticatorDB = {
  findByCredentialId(credentialId: string): Authenticator | undefined {
    return getDatabase().prepare('SELECT * FROM authenticators WHERE credential_id=?').get(credentialId) as Authenticator | undefined;
  },
  findAllByUser(userId: number): Authenticator[] {
    return getDatabase().prepare('SELECT * FROM authenticators WHERE user_id=?').all(userId) as Authenticator[];
  },
  create(userId: number, credentialId: string, publicKey: Uint8Array, counter?: number): void {
    getDatabase().prepare('INSERT INTO authenticators(user_id,credential_id,credential_public_key,counter,created_at) VALUES (?,?,?,?,?)')
      .run(userId, credentialId, Buffer.from(publicKey), counter ?? 0, getSingaporeNow().toISOString());
  },
  updateCounter(id: number, counter?: number): void {
    getDatabase().prepare('UPDATE authenticators SET counter=? WHERE id=?').run(counter ?? 0, id);
  },
};

type TodoRow = Omit<Todo, 'completed' | 'is_recurring'> & { completed: number; is_recurring: number };

function hydrate(row: TodoRow): Todo {
  const db = getDatabase();
  return {
    ...row, completed: Boolean(row.completed), is_recurring: Boolean(row.is_recurring),
    subtasks: (db.prepare('SELECT * FROM subtasks WHERE todo_id=? ORDER BY position,id').all(row.id) as (Omit<Subtask, 'completed'> & { completed: number })[])
      .map((subtask) => ({ ...subtask, completed: Boolean(subtask.completed) })),
    tags: db.prepare('SELECT tags.* FROM tags JOIN todo_tags ON tags.id=todo_tags.tag_id WHERE todo_tags.todo_id=? AND tags.user_id=? ORDER BY tags.name')
      .all(row.id, row.user_id) as Tag[],
  };
}

function setTags(todoId: number, userId: number, tagIds: number[]): void {
  const db = getDatabase();
  for (const id of tagIds) {
    if (!db.prepare('SELECT id FROM tags WHERE id=? AND user_id=?').get(id, userId)) {
      throw new Error('Invalid tag');
    }
  }
  db.prepare('DELETE FROM todo_tags WHERE todo_id=?').run(todoId);
  for (const id of new Set(tagIds)) db.prepare('INSERT INTO todo_tags(todo_id,tag_id) VALUES (?,?)').run(todoId, id);
}

function insertTodo(userId: number, input: CreateTodoInput): Todo {
  const result = getDatabase().prepare(`
    INSERT INTO todos(user_id,title,due_date,priority,is_recurring,recurrence_pattern,reminder_minutes,created_at)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(userId, input.title, input.due_date ? parseSingaporeDate(input.due_date).toISOString() : null,
    input.priority ?? 'medium', Number(input.is_recurring ?? false),
    input.recurrence_pattern ?? null, input.reminder_minutes ?? null, getSingaporeNow().toISOString());
  const id = Number(result.lastInsertRowid);
  if (input.tag_ids) setTags(id, userId, input.tag_ids);
  return todoDB.findById(id, userId)!;
}

export const todoDB = {
  create(userId: number, input: CreateTodoInput): Todo {
    return getDatabase().transaction(() => insertTodo(userId, input))();
  },
  findById(id: number, userId: number): Todo | null {
    const row = getDatabase().prepare('SELECT * FROM todos WHERE id=? AND user_id=?').get(id, userId) as TodoRow | undefined;
    return row ? hydrate(row) : null;
  },
  findAllByUser(userId: number): Todo[] {
    return (getDatabase().prepare('SELECT * FROM todos WHERE user_id=? ORDER BY created_at DESC,id DESC').all(userId) as TodoRow[]).map(hydrate);
  },
  findDueReminders(userId: number): Todo[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM todos WHERE user_id=? AND completed=0 AND due_date IS NOT NULL
      AND reminder_minutes IS NOT NULL AND last_notification_sent IS NULL
      AND julianday(due_date) - reminder_minutes / 1440.0 <= julianday(?)
      ORDER BY due_date,id
    `).all(userId, getSingaporeNow().toISOString()) as TodoRow[];
    return rows.map(hydrate);
  },
  update(id: number, userId: number, patch: UpdateTodoInput): Todo | null {
    return getDatabase().transaction(() => {
      const existing = this.findById(id, userId);
      if (!existing) return null;
      const input = validateTodo(patch, existing);
      const dueDate = input.due_date === undefined ? existing.due_date :
        input.due_date ? parseSingaporeDate(input.due_date).toISOString() : null;
      const reminder = input.reminder_minutes === undefined ? existing.reminder_minutes : input.reminder_minutes;
      const scheduleChanged = dueDate !== existing.due_date || reminder !== existing.reminder_minutes;
      const now = getSingaporeNow().toISOString();
      const guardMatches = (input.notification_due_date === undefined ||
        parseSingaporeDate(input.notification_due_date).toISOString() === dueDate) &&
        (input.notification_reminder_minutes === undefined || input.notification_reminder_minutes === reminder);
      const completed = input.completed ?? existing.completed;
      const canAcknowledge = input.last_notification_sent !== undefined && !scheduleChanged && guardMatches &&
        !completed && dueDate !== null && reminder !== null &&
        parseSingaporeDate(dueDate).getTime() - reminder * 60_000 <= parseSingaporeDate(now).getTime();
      const next = {
        ...existing, ...input, due_date: dueDate, reminder_minutes: reminder, completed,
        last_notification_sent: scheduleChanged ? null :
          canAcknowledge ? now : existing.last_notification_sent,
      };
      getDatabase().prepare(`
        UPDATE todos SET title=?,completed=?,due_date=?,priority=?,is_recurring=?,recurrence_pattern=?,
        reminder_minutes=?,last_notification_sent=?,updated_at=? WHERE id=? AND user_id=?
      `).run(next.title, Number(next.completed), next.due_date, next.priority,
        Number(next.is_recurring), next.is_recurring ? next.recurrence_pattern : null,
        next.reminder_minutes, next.last_notification_sent, now, id, userId);
      if (input.tag_ids !== undefined) setTags(id, userId, input.tag_ids);
      const updated = this.findById(id, userId)!;
      if (!existing.completed && updated.completed && updated.is_recurring && updated.due_date && updated.recurrence_pattern) {
        insertTodo(userId, {
          title: updated.title, priority: updated.priority, is_recurring: true,
          recurrence_pattern: updated.recurrence_pattern, reminder_minutes: updated.reminder_minutes,
          due_date: calculateNextDueDate(updated.due_date, updated.recurrence_pattern),
          tag_ids: updated.tags?.map((tag) => tag.id),
        });
      }
      return updated;
    })();
  },
  delete(id: number, userId: number): boolean {
    return getDatabase().prepare('DELETE FROM todos WHERE id=? AND user_id=?').run(id, userId).changes > 0;
  },
};
