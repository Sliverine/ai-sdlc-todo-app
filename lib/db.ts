import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

export type Priority = 'high' | 'medium' | 'low'
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
  reminder_minutes: number | null
  last_notification_sent: string | null
  created_at: string
  updated_at: string | null
  subtasks?: Subtask[]
  tags?: Tag[]
}

export interface Subtask {
  id: number
  todo_id: number
  title: string
  completed: boolean
  position: number
  created_at: string
}

export interface Tag {
  id: number
  user_id: number
  name: string
  color: string
  created_at: string
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS authenticators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id TEXT UNIQUE NOT NULL,
    credential_public_key BLOB NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_subtasks_todo_id ON subtasks(todo_id);

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#3B82F6',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS holidays (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
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
`

export function createDatabase(filePath: string): Database.Database {
  const database = new Database(filePath)
  database.pragma('foreign_keys = ON')
  database.exec(schema)
  ensureColumn(database, 'users', 'webauthn_user_id', 'TEXT')
  ensureColumn(database, 'auth_challenges', 'user_handle', 'TEXT')
  const usersWithoutHandle = database.prepare('SELECT id FROM users WHERE webauthn_user_id IS NULL').all() as Array<{ id: number }>
  const updateUserHandle = database.prepare('UPDATE users SET webauthn_user_id = ? WHERE id = ?')
  for (const user of usersWithoutHandle) {
    updateUserHandle.run(randomUUID(), user.id)
  }
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_webauthn_user_id ON users(webauthn_user_id)')
  return database
}

function ensureColumn(database: Database.Database, table: string, column: string, definition: string): void {
  const columns = database.pragma(`table_info(${table})`) as Array<{ name: string }>
  if (!columns.some((entry) => entry.name === column)) {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

export const db = createDatabase(process.env.DATABASE_PATH ?? join(process.cwd(), 'todos.db'))

export function createAuthDataDB(database: Database.Database) {
  const users = {
    create(username: string, userHandle: string = randomUUID()): User {
      const result = database.prepare('INSERT INTO users (username, webauthn_user_id) VALUES (?, ?)').run(username, userHandle)
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
        INSERT INTO authenticators (user_id, credential_id, credential_public_key, counter)
        VALUES (?, ?, ?, ?)
      `).run(userId, credentialId, credentialPublicKey, counter ?? 0)
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
