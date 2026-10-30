import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { getSingaporeNow, parseDueDate } from './timezone'
import type { Priority } from './priority'
import { TodoValidationError } from './todo-errors'
import { calculateNextDueDate } from './recurrence'

export { PRIORITY_ORDER, PRIORITY_VALUES } from './priority'
export type { Priority } from './priority'
export type RecurrencePattern = 'daily' | 'weekly' | 'monthly' | 'yearly'
export type ReminderMinutes = 15 | 30 | 60 | 120 | 1440 | 2880 | 10080
export type AuthChallengePurpose = 'registration' | 'login'

export interface User {
  id: number
  username: string
  webauthn_user_id: string | null
  created_at: string
}

export interface Authenticator {
  id: number
  user_id: number
  credential_id: string
  credential_public_key: Buffer
  counter: number
  created_at: string
}

export interface Session {
  userId: number
  username: string
}

export interface Todo {
  id: number
  user_id: number
  title: string
  completed: boolean
  due_date: string | null
  priority: Priority
  is_recurring: boolean
  recurrence_pattern: RecurrencePattern | null
  reminder_minutes: ReminderMinutes | null
  last_notification_sent: string | null
  created_at: string
  updated_at: string | null
  subtasks?: Subtask[]
  tags?: Tag[]
}

export interface CreateTodoInput {
  user_id: number
  title: string
  due_date?: string | null
  priority?: Priority
  completed?: boolean
  is_recurring?: boolean
  recurrence_pattern?: RecurrencePattern | null
  reminder_minutes?: number | null
  tag_ids?: number[]
}

export interface UpdateTodoInput {
  title?: string
  due_date?: string | null
  priority?: Priority
  completed?: boolean
  is_recurring?: boolean
  recurrence_pattern?: RecurrencePattern | null
  reminder_minutes?: number | null
  tag_ids?: number[]
  last_notification_sent?: string
  notification_due_date?: string
  notification_reminder_minutes?: ReminderMinutes
}

export interface Subtask {
  id: number
  todo_id: number
  title: string
  completed: boolean
  position: number
  created_at: string
}

export interface CreateSubtaskDto {
  title: string
}

export interface UpdateSubtaskDto {
  title?: string
  completed?: boolean
}

export interface Tag {
  id: number
  user_id: number
  name: string
  color: string
  created_at: string
}

export interface CreateTagInput {
  name: string
  color?: string
}

export interface UpdateTagInput {
  name?: string
  color?: string
}

export interface Template {
  id: number
  user_id: number
  name: string
  description: string | null
  category: string | null
  title_template: string
  priority: Priority
  is_recurring: boolean
  recurrence_pattern: RecurrencePattern | null
  reminder_minutes: number | null
  due_date_offset_minutes: number | null
  subtasks_json: string | null
  created_at: string
}

export interface Holiday {
  id: number
  date: string
  name: string
}

export interface AuthChallenge {
  challenge: string
  purpose: AuthChallengePurpose
  username: string
  userId: number | null
  expiresAt: number
  userHandle?: string | null
}

interface AuthChallengeRow {
  challenge: string
  purpose: AuthChallengePurpose
  username: string
  user_id: number | null
  expires_at: number
  user_handle: string | null
}

const schema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    webauthn_user_id TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS authenticators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    credential_public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_authenticators_user_id ON authenticators(user_id);

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    priority TEXT NOT NULL DEFAULT 'medium',
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_pattern TEXT,
    reminder_minutes INTEGER,
    last_notification_sent TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_todos_user_id ON todos(user_id);
  CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

  CREATE TABLE IF NOT EXISTS subtasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    UNIQUE(user_id, name)
  );

  CREATE TABLE IF NOT EXISTS todo_tags (
    todo_id INTEGER NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (todo_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    title_template TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'medium',
    is_recurring INTEGER NOT NULL DEFAULT 0,
    recurrence_pattern TEXT,
    reminder_minutes INTEGER,
    due_date_offset_minutes INTEGER,
    subtasks_json TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);

  CREATE TABLE IF NOT EXISTS auth_challenges (
    challenge TEXT PRIMARY KEY,
    purpose TEXT NOT NULL CHECK (purpose IN ('registration', 'login')),
    username TEXT NOT NULL,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    user_handle TEXT,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires_at ON auth_challenges(expires_at);

  CREATE TABLE IF NOT EXISTS auth_rate_limits (
    bucket_key TEXT PRIMARY KEY,
    window_start INTEGER NOT NULL,
    request_count INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expires_at ON auth_rate_limits(expires_at);
`

export function createDatabase(filePath: string): Database.Database {
  const database = new Database(filePath)
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  ensureColumn(database, 'users', 'webauthn_user_id', 'TEXT')
  ensureColumn(database, 'auth_challenges', 'user_handle', 'TEXT')
  for (const table of ['users', 'authenticators', 'todos', 'subtasks', 'tags', 'templates', 'holidays']) {
    database.prepare(`
      UPDATE ${table}
      SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at)
      WHERE created_at NOT LIKE '%Z'
    `).run()
  }
  database.prepare(`
    UPDATE todos
    SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', updated_at)
    WHERE updated_at IS NOT NULL AND updated_at NOT LIKE '%Z'
  `).run()
  migrateLegacyDueDates(database)
  const usersWithoutHandle = database.prepare('SELECT id FROM users WHERE webauthn_user_id IS NULL').all() as Array<{ id: number }>
  const updateUserHandle = database.prepare('UPDATE users SET webauthn_user_id = ? WHERE id = ?')
  for (const user of usersWithoutHandle) {
    updateUserHandle.run(randomUUID(), user.id)
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_webauthn_user_id ON users(webauthn_user_id)')
  return database
}

export function createHolidayDB(database: Database.Database) {
  return {
    findAll(): Holiday[] {
      return database.prepare('SELECT id, date, name FROM holidays ORDER BY date, name').all() as Holiday[]
    },

    upsert(date: string, name: string): void {
      database.prepare(`
        INSERT INTO holidays (date, name) VALUES (?, ?)
        ON CONFLICT(date) DO UPDATE SET name = excluded.name
      `).run(date, name)
    },

    findByMonth(year: number, month: number): Holiday[] {
      const firstOfMonth = new Date(Date.UTC(year, month - 1, 1))
      const firstVisibleDate = new Date(Date.UTC(year, month - 1, 1 - firstOfMonth.getUTCDay()))
      const lastVisibleDate = new Date(firstVisibleDate.getTime() + 41 * 24 * 60 * 60 * 1000)
      const startDate = firstVisibleDate.toISOString().slice(0, 10)
      const endDate = lastVisibleDate.toISOString().slice(0, 10)

      return database.prepare(`
        SELECT id, date, name FROM holidays
        WHERE date BETWEEN ? AND ?
        ORDER BY date, name
      `).all(startDate, endDate) as Holiday[]
    },
  }
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (!columns.some((entry) => entry.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function migrateLegacyDueDates(database: Database.Database): void {
  const migrate = database.transaction(() => {
    const rows = database.prepare('SELECT id, due_date FROM todos WHERE due_date IS NOT NULL').all() as Array<{ id: number; due_date: string }>
    const updateDueDate = database.prepare('UPDATE todos SET due_date = ? WHERE id = ?')

    for (const row of rows) {
      const value = row.due_date.trim()
      const localInput = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? `${value}T00:00`
        : value.replace(/^(\d{4}-\d{2}-\d{2})\s+/, '$1T')
      const parsed = parseDueDate(localInput)
      if (!parsed.valid) {
        throw new Error('Unable to migrate a legacy todo due date')
      }
      if (parsed.value !== row.due_date) updateDueDate.run(parsed.value, row.id)
    }
  })

  migrate()
}

interface TodoRow extends Omit<Todo, 'completed' | 'is_recurring'> {
  completed: number
  is_recurring: number
}

interface SubtaskRow extends Omit<Subtask, 'completed'> {
  completed: number
}

function mapTodoRow(row: TodoRow): Todo {
  return { ...row, completed: Boolean(row.completed), is_recurring: Boolean(row.is_recurring) }
}

function assertTodoConfiguration(
  dueDate: string | null,
  isRecurring: boolean,
  recurrencePattern: RecurrencePattern | null,
  reminderMinutes: number | null,
): void {
  if (isRecurring && (!dueDate || !recurrencePattern)) {
    throw new TodoValidationError('Recurring todos require a due date and pattern')
  }
  if (reminderMinutes !== null && !dueDate) {
    throw new TodoValidationError('Reminders require a due date')
  }
}

export function createTodoDB(database: Database.Database) {
  function withRelations(rows: TodoRow[]): Todo[] {
    if (rows.length === 0) return []

    const todoIds = rows.map(({ id }) => id)
    const placeholders = todoIds.map(() => '?').join(', ')
    const subtasks = database.prepare(`
      SELECT id, todo_id, title, completed, position, created_at
      FROM subtasks WHERE todo_id IN (${placeholders})
      ORDER BY position, id
    `).all(...todoIds) as SubtaskRow[]
    const tags = database.prepare(`
      SELECT tags.id, tags.user_id, tags.name, tags.color, tags.created_at, todo_tags.todo_id
      FROM tags INNER JOIN todo_tags ON todo_tags.tag_id = tags.id
      WHERE todo_tags.todo_id IN (${placeholders})
      ORDER BY tags.name COLLATE NOCASE
    `).all(...todoIds) as Array<Tag & { todo_id: number }>
    const subtasksByTodo = new Map<number, Subtask[]>()
    const tagsByTodo = new Map<number, Tag[]>()

    for (const subtask of subtasks) {
      const current = subtasksByTodo.get(subtask.todo_id) ?? []
      current.push({ ...subtask, completed: Boolean(subtask.completed) })
      subtasksByTodo.set(subtask.todo_id, current)
    }
    for (const { todo_id, ...tag } of tags) {
      const current = tagsByTodo.get(todo_id) ?? []
      current.push(tag)
      tagsByTodo.set(todo_id, current)
    }

    return rows.map((row) => ({
      ...mapTodoRow(row),
      subtasks: subtasksByTodo.get(row.id) ?? [],
      tags: tagsByTodo.get(row.id) ?? [],
    }))
  }

  function findById(id: number, userId: number): Todo | null {
    const row = database.prepare('SELECT * FROM todos WHERE id = ? AND user_id = ?').get(id, userId) as TodoRow | undefined
    return row ? withRelations([row])[0] : null
  }

  function replaceTags(todoId: number, userId: number, tagIds: number[]): void {
    const uniqueIds = [...new Set(tagIds)]
    if (uniqueIds.length > 0) {
      const placeholders = uniqueIds.map(() => '?').join(', ')
      const result = database.prepare(`
        SELECT COUNT(*) AS count FROM tags WHERE user_id = ? AND id IN (${placeholders})
      `).get(userId, ...uniqueIds) as { count: number }
      if (result.count !== uniqueIds.length) throw new TodoValidationError('One or more tags are not available')
    }

    database.prepare('DELETE FROM todo_tags WHERE todo_id = ?').run(todoId)
    const insertTag = database.prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)')
    for (const tagId of uniqueIds) insertTag.run(todoId, tagId)
  }

  return {
    create(input: CreateTodoInput): Todo {
      const createTransaction = database.transaction(() => {
        const dueDate = input.due_date ?? null
        const isRecurring = input.is_recurring ?? false
        const recurrencePattern = input.recurrence_pattern ?? null
        const reminderMinutes = input.reminder_minutes ?? null
        assertTodoConfiguration(dueDate, isRecurring, recurrencePattern, reminderMinutes)
        const result = database.prepare(`
          INSERT INTO todos (
            user_id, title, completed, due_date, priority, is_recurring,
            recurrence_pattern, reminder_minutes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          input.user_id,
          input.title,
          input.completed ? 1 : 0,
          dueDate,
          input.priority ?? 'medium',
          isRecurring ? 1 : 0,
          recurrencePattern,
          reminderMinutes,
          getSingaporeNow().toISOString(),
        )
        const id = Number(result.lastInsertRowid)
        if (input.tag_ids) replaceTags(id, input.user_id, input.tag_ids)
        return findById(id, input.user_id)!
      })
      return createTransaction()
    },

    findAllByUser(userId: number): Todo[] {
      const rows = database.prepare('SELECT * FROM todos WHERE user_id = ? ORDER BY created_at DESC, id DESC').all(userId) as TodoRow[]
      return withRelations(rows)
    },

    findById,

    findDueReminders(userId: number, now = getSingaporeNow()): Todo[] {
      const rows = database.prepare(`
        SELECT * FROM todos
        WHERE user_id = ? AND completed = 0
          AND due_date IS NOT NULL AND reminder_minutes IS NOT NULL
          AND last_notification_sent IS NULL
          AND julianday(due_date) - reminder_minutes / 1440.0 <= julianday(?)
        ORDER BY due_date, id
      `).all(userId, now.toISOString()) as TodoRow[]
      return withRelations(rows)
    },

    update(id: number, userId: number, input: UpdateTodoInput): Todo | null {
      const assignments: string[] = []
      const values: unknown[] = []
      const addField = (column: string, value: unknown) => {
        assignments.push(`${column} = ?`)
        values.push(value)
      }

      if (input.title !== undefined) addField('title', input.title)
      if (input.completed !== undefined) addField('completed', input.completed ? 1 : 0)
      if (input.due_date !== undefined) addField('due_date', input.due_date)
      if (input.priority !== undefined) addField('priority', input.priority)
      if (input.is_recurring !== undefined) addField('is_recurring', input.is_recurring ? 1 : 0)
      if (input.recurrence_pattern !== undefined) addField('recurrence_pattern', input.recurrence_pattern)
      if (input.reminder_minutes !== undefined) addField('reminder_minutes', input.reminder_minutes)

      const updateTransaction = database.transaction(() => {
        const current = findById(id, userId)
        if (!current) return null
        const scheduleChanged = (input.due_date !== undefined && input.due_date !== current.due_date)
          || (input.reminder_minutes !== undefined && input.reminder_minutes !== current.reminder_minutes)
        if (input.last_notification_sent !== undefined) {
          if (scheduleChanged
            || (input.notification_due_date !== undefined && input.notification_due_date !== current.due_date)
            || (input.notification_reminder_minutes !== undefined && input.notification_reminder_minutes !== current.reminder_minutes)) {
            throw new TodoValidationError('Reminder schedule changed')
          }
          if (current.completed || !current.due_date || current.reminder_minutes === null
            || Date.parse(current.due_date) - current.reminder_minutes * 60_000 > getSingaporeNow().getTime()) {
            throw new TodoValidationError('Reminder is not eligible for acknowledgement')
          }
          addField('last_notification_sent', getSingaporeNow().toISOString())
        } else if (scheduleChanged) {
          addField('last_notification_sent', null)
        }
        assertTodoConfiguration(
          input.due_date === undefined ? current.due_date : input.due_date,
          input.is_recurring === undefined ? current.is_recurring : input.is_recurring,
          input.recurrence_pattern === undefined ? current.recurrence_pattern : input.recurrence_pattern,
          input.reminder_minutes === undefined ? current.reminder_minutes : input.reminder_minutes,
        )
        const hasTagChanges = input.tag_ids !== undefined
        if (assignments.length > 0 || hasTagChanges) {
          addField('updated_at', getSingaporeNow().toISOString())
          database.prepare(`
            UPDATE todos SET ${assignments.join(', ')} WHERE id = ? AND user_id = ?
          `).run(...values, id, userId)
          if (hasTagChanges) replaceTags(id, userId, input.tag_ids ?? [])
        }
        const updated = findById(id, userId)!
        if (!current.completed && updated.completed && updated.is_recurring && updated.due_date && updated.recurrence_pattern) {
          const result = database.prepare(`
            INSERT INTO todos (user_id, title, due_date, priority, is_recurring, recurrence_pattern, reminder_minutes, created_at)
            VALUES (?, ?, ?, ?, 1, ?, ?, ?)
          `).run(
            userId, updated.title, calculateNextDueDate(updated.due_date, updated.recurrence_pattern),
            updated.priority, updated.recurrence_pattern, updated.reminder_minutes, getSingaporeNow().toISOString(),
          )
          database.prepare('INSERT INTO todo_tags (todo_id, tag_id) SELECT ?, tag_id FROM todo_tags WHERE todo_id = ?')
            .run(Number(result.lastInsertRowid), id)
        }
        return findById(id, userId)
      })
      return updateTransaction()
    },

    delete(id: number, userId: number): boolean {
      const result = database.prepare('DELETE FROM todos WHERE id = ? AND user_id = ?').run(id, userId)
      return result.changes === 1
    },
  }
}

export function createSubtaskDB(database: Database.Database) {
  function findById(id: number, userId: number): Subtask | null {
    const row = database.prepare(`
      SELECT subtasks.id, subtasks.todo_id, subtasks.title, subtasks.completed,
        subtasks.position, subtasks.created_at
      FROM subtasks INNER JOIN todos ON todos.id = subtasks.todo_id
      WHERE subtasks.id = ? AND todos.user_id = ?
    `).get(id, userId) as SubtaskRow | undefined
    return row ? { ...row, completed: Boolean(row.completed) } : null
  }

  return {
    findByTodoId(todoId: number, userId: number): Subtask[] {
      const rows = database.prepare(`
        SELECT subtasks.id, subtasks.todo_id, subtasks.title, subtasks.completed,
          subtasks.position, subtasks.created_at
        FROM subtasks INNER JOIN todos ON todos.id = subtasks.todo_id
        WHERE subtasks.todo_id = ? AND todos.user_id = ?
        ORDER BY subtasks.position, subtasks.id
      `).all(todoId, userId) as SubtaskRow[]
      return rows.map((row) => ({ ...row, completed: Boolean(row.completed) }))
    },

    create(todoId: number, userId: number, input: CreateSubtaskDto): Subtask | null {
      const result = database.prepare(`
        INSERT INTO subtasks (todo_id, title, position, created_at)
        SELECT todos.id, ?,
          (SELECT COALESCE(MAX(position) + 1, 0) FROM subtasks WHERE todo_id = todos.id),
          ?
        FROM todos WHERE todos.id = ? AND todos.user_id = ?
      `).run(input.title, getSingaporeNow().toISOString(), todoId, userId)
      return result.changes === 1 ? findById(Number(result.lastInsertRowid), userId) : null
    },

    update(id: number, userId: number, input: UpdateSubtaskDto): Subtask | null {
      const assignments: string[] = []
      const values: unknown[] = []
      if (input.title !== undefined) {
        assignments.push('title = ?')
        values.push(input.title)
      }
      if (input.completed !== undefined) {
        assignments.push('completed = ?')
        values.push(input.completed ? 1 : 0)
      }
      if (assignments.length === 0) return findById(id, userId)

      const result = database.prepare(`
        UPDATE subtasks SET ${assignments.join(', ')}
        WHERE id = ? AND EXISTS (
          SELECT 1 FROM todos WHERE todos.id = subtasks.todo_id AND todos.user_id = ?
        )
      `).run(...values, id, userId)
      return result.changes === 1 ? findById(id, userId) : null
    },

    delete(id: number, userId: number): boolean {
      const result = database.prepare(`
        DELETE FROM subtasks WHERE id = ? AND EXISTS (
          SELECT 1 FROM todos WHERE todos.id = subtasks.todo_id AND todos.user_id = ?
        )
      `).run(id, userId)
      return result.changes === 1
    },
  }
}

export const db = createDatabase(process.env.DATABASE_PATH ?? join(process.cwd(), 'todos.db'))
export const todoDB = createTodoDB(db)
export const subtaskDB = createSubtaskDB(db)
export const holidayDB = createHolidayDB(db)

export function createTagDB(database: Database.Database) {
  function normalizeName(value: string | undefined): string {
    const trimmed = value?.trim() ?? ''
    if (!trimmed) throw new Error('Tag name is required')
    return trimmed
  }

  function normalizeColor(value: string | undefined, fallback = '#3B82F6'): string {
    const resolved = value ?? fallback
    if (!/^#[0-9A-Fa-f]{6}$/.test(resolved)) {
      throw new Error('Color must be a valid hex code')
    }
    return resolved
  }

  return {
    findAllByUser(userId: number): Tag[] {
      return database.prepare('SELECT * FROM tags WHERE user_id = ? ORDER BY name COLLATE NOCASE').all(userId) as Tag[]
    },

    findById(id: number, userId: number): Tag | null {
      const row = database.prepare('SELECT * FROM tags WHERE id = ? AND user_id = ?').get(id, userId) as Tag | undefined
      return row ?? null
    },

    create(userId: number, input: CreateTagInput): Tag {
      const name = normalizeName(input.name)
      const color = normalizeColor(input.color, '#3B82F6')
      try {
        const result = database.prepare('INSERT INTO tags (user_id, name, color, created_at) VALUES (?, ?, ?, ?)')
          .run(userId, name, color, getSingaporeNow().toISOString())
        const created = database.prepare('SELECT * FROM tags WHERE id = ?').get(Number(result.lastInsertRowid)) as Tag | undefined
        if (!created) throw new Error('Unable to create tag')
        return created
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('UNIQUE') || message.includes('already exists')) {
          throw new Error('A tag with this name already exists')
        }
        throw error
      }
    },

    update(id: number, userId: number, input: UpdateTagInput): Tag | null {
      const existing = this.findById(id, userId)
      if (!existing) return null

      const name = input.name === undefined ? existing.name : normalizeName(input.name)
      const color = input.color === undefined ? existing.color : normalizeColor(input.color)

      try {
        database.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ? AND user_id = ?').run(name, color, id, userId)
        return this.findById(id, userId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('UNIQUE') || message.includes('already exists')) {
          throw new Error('A tag with this name already exists')
        }
        throw error
      }
    },

    delete(id: number, userId: number): boolean {
      const result = database.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(id, userId)
      return result.changes === 1
    },

    attachToTodo(todoId: number, tagId: number, userId: number): boolean {
      const todo = database.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(todoId, userId)
      const tag = database.prepare('SELECT id FROM tags WHERE id = ? AND user_id = ?').get(tagId, userId)
      if (!todo || !tag) return false

      database.prepare('INSERT OR IGNORE INTO todo_tags (todo_id, tag_id) VALUES (?, ?)').run(todoId, tagId)
      return true
    },

    detachFromTodo(todoId: number, tagId: number, userId: number): boolean {
      const todo = database.prepare('SELECT id FROM todos WHERE id = ? AND user_id = ?').get(todoId, userId)
      const tag = database.prepare('SELECT id FROM tags WHERE id = ? AND user_id = ?').get(tagId, userId)
      if (!todo || !tag) return false

      database.prepare('DELETE FROM todo_tags WHERE todo_id = ? AND tag_id = ?').run(todoId, tagId)
      return true
    },

    findByTodoId(todoId: number): Tag[] {
      return database.prepare(`
        SELECT tags.*
        FROM tags
        INNER JOIN todo_tags ON todo_tags.tag_id = tags.id
        WHERE todo_tags.todo_id = ?
        ORDER BY tags.name COLLATE NOCASE
      `).all(todoId) as Tag[]
    },
  }
}

export const tagDB = createTagDB(db)

export function createAuthDataDB(database: Database.Database) {
  const users = {
    create(username: string, userHandle: string = randomUUID()): User {
      const result = database.prepare(`
        INSERT INTO users (username, webauthn_user_id, created_at) VALUES (?, ?, ?)
      `).run(username, userHandle, getSingaporeNow().toISOString())
      return users.findById(Number(result.lastInsertRowid))!
    },

    findById(id: number): User | null {
      return database.prepare('SELECT id, username, webauthn_user_id, created_at FROM users WHERE id = ?').get(id) as User | undefined ?? null
    },

    findByUsername(username: string): User | null {
      return database.prepare('SELECT id, username, webauthn_user_id, created_at FROM users WHERE username = ?').get(username) as User | undefined ?? null
    },

    ensureWebAuthnUserId(id: number): string {
      const current = users.findById(id)
      if (!current) throw new Error('User not found')
      if (current.webauthn_user_id) return current.webauthn_user_id

      database.prepare('UPDATE users SET webauthn_user_id = ? WHERE id = ? AND webauthn_user_id IS NULL').run(randomUUID(), id)
      const updated = users.findById(id)
      if (!updated?.webauthn_user_id) throw new Error('Unable to assign WebAuthn user handle')
      return updated.webauthn_user_id
    },
  }

  const authenticators = {
    create(userId: number, credentialId: string, credentialPublicKey: Buffer, counter: number): Authenticator {
      const result = database.prepare(`
        INSERT INTO authenticators (user_id, credential_id, credential_public_key, counter, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(userId, credentialId, credentialPublicKey, counter ?? 0, getSingaporeNow().toISOString())
      return database.prepare('SELECT * FROM authenticators WHERE id = ?').get(Number(result.lastInsertRowid)) as Authenticator
    },

    findByCredentialId(credentialId: string): Authenticator | null {
      return database.prepare('SELECT * FROM authenticators WHERE credential_id = ?').get(credentialId) as Authenticator | undefined ?? null
    },

    listByUserId(userId: number): Authenticator[] {
      return database.prepare('SELECT * FROM authenticators WHERE user_id = ? ORDER BY id').all(userId) as Authenticator[]
    },

    updateCounterMonotonically(id: number, counter: number): boolean {
      const normalizedCounter = counter ?? 0
      const result = database.prepare(`
        UPDATE authenticators SET counter = ?
        WHERE id = ? AND ((counter = 0 AND ? = 0) OR counter < ?)
      `).run(normalizedCounter, id, normalizedCounter, normalizedCounter)
      return result.changes === 1
    },
  }

  return {
    users,
    authenticators,
    createUserWithAuthenticator(username: string, userHandle: string, credentialId: string, publicKey: Buffer, counter: number): User {
      return database.transaction(() => {
        const user = users.create(username, userHandle)
        authenticators.create(user.id, credentialId, publicKey, counter ?? 0)
        return user
      })()
    },
  }
}

export const authDataDB = createAuthDataDB(db)
export const userDB = authDataDB.users
export const authenticatorDB = authDataDB.authenticators

export function createAuthChallengeDB(database: Database.Database) {
  const insert = database.prepare(`
    INSERT INTO auth_challenges (challenge, purpose, username, user_id, user_handle, expires_at)
    VALUES (@challenge, @purpose, @username, @userId, @userHandle, @expiresAt)
  `)
  const selectMatching = database.prepare(`
    SELECT challenge, purpose, username, user_id, user_handle, expires_at
    FROM auth_challenges
    WHERE challenge = ? AND purpose = ? AND expires_at > ?
      AND (? IS NULL OR username = ?)
  `)
  const deleteMatching = database.prepare(`
    DELETE FROM auth_challenges
    WHERE challenge = ? AND purpose = ? AND expires_at > ?
      AND (? IS NULL OR username = ?)
  `)
  const consumeTransaction = database.transaction((
    challenge: string,
    purpose: AuthChallengePurpose,
    now: number,
    username?: string,
  ): AuthChallenge | null => {
    const row = selectMatching.get(challenge, purpose, now, username ?? null, username ?? null) as AuthChallengeRow | undefined
    if (!row) return null

    const result = deleteMatching.run(challenge, purpose, now, username ?? null, username ?? null)
    if (result.changes !== 1) return null

    return {
      challenge: row.challenge,
      purpose: row.purpose,
      username: row.username,
      userId: row.user_id,
      expiresAt: row.expires_at,
      ...(row.user_handle ? { userHandle: row.user_handle } : {}),
    }
  })

  return {
    save(challenge: AuthChallenge): void {
      insert.run({
        challenge: challenge.challenge,
        purpose: challenge.purpose,
        username: challenge.username,
        userId: challenge.userId,
        userHandle: challenge.userHandle ?? null,
        expiresAt: challenge.expiresAt,
      })
    },

    consume(
      challenge: string,
      purpose: AuthChallengePurpose,
      now = Date.now(),
      username?: string,
    ): AuthChallenge | null {
      return consumeTransaction(challenge, purpose, now, username)
    },

    deleteExpired(now = Date.now()): number {
      return database.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(now).changes
    },
  }
}

export const authChallengeDB = createAuthChallengeDB(db)

export interface AuthRateLimitDecision {
  allowed: boolean
  retryAfterSeconds: number
}

interface AuthRateLimitRow {
  window_start: number
  request_count: number
  expires_at: number
}

export function createAuthRateLimitDB(database: Database.Database) {
  const deleteExpired = database.prepare('DELETE FROM auth_rate_limits WHERE expires_at <= ?')
  const selectBucket = database.prepare('SELECT window_start, request_count, expires_at FROM auth_rate_limits WHERE bucket_key = ?')
  const insertBucket = database.prepare(`
    INSERT INTO auth_rate_limits (bucket_key, window_start, request_count, expires_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(bucket_key) DO UPDATE SET
      window_start = excluded.window_start,
      request_count = 1,
      expires_at = excluded.expires_at
  `)
  const incrementBucket = database.prepare(`
    UPDATE auth_rate_limits SET request_count = request_count + 1 WHERE bucket_key = ?
  `)
  const consumeTransaction = database.transaction((
    bucketKey: string,
    now: number,
    windowMs: number,
    maximumRequests: number,
  ): AuthRateLimitDecision => {
    deleteExpired.run(now)
    const windowStart = Math.floor(now / windowMs) * windowMs
    const expiresAt = windowStart + windowMs
    const current = selectBucket.get(bucketKey) as AuthRateLimitRow | undefined

    if (!current || current.window_start !== windowStart) {
      insertBucket.run(bucketKey, windowStart, expiresAt)
      return { allowed: true, retryAfterSeconds: 0 }
    }
    if (current.request_count >= maximumRequests) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now) / 1000)) }
    }

    incrementBucket.run(bucketKey)
    return { allowed: true, retryAfterSeconds: 0 }
  })

  return {
    consume(bucketKey: string, now: number, windowMs: number, maximumRequests: number): AuthRateLimitDecision {
      return consumeTransaction.immediate(bucketKey, now, windowMs, maximumRequests)
    },
  }
}

export const authRateLimitDB = createAuthRateLimitDB(db)
