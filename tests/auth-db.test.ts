import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuthDataDB, createDatabase } from '../lib/db'

describe('authentication database operations', () => {
  const directories: string[] = []
  const databases: Array<{ close: () => void }> = []

  afterEach(() => {
    for (const database of databases.splice(0)) {
      try {
        database.close()
      } catch {
        // A migration test may close the legacy connection before reopening it.
      }
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createStore() {
    const directory = mkdtempSync(join(tmpdir(), 'todo-auth-db-'))
    directories.push(directory)
    const database = createDatabase(join(directory, 'test.db'))
    databases.push(database)
    return { database, authDB: createAuthDataDB(database) }
  }

  it('rolls back user creation when authenticator insertion fails', () => {
    const { database, authDB } = createStore()
    const existing = authDB.users.create('alice')
    authDB.authenticators.create(existing.id, 'existing-credential', Buffer.from([1]), 0)

    expect(() => authDB.createUserWithAuthenticator(
      'bob', 'opaque-bob-handle', 'existing-credential', Buffer.from([2]), 0,
    )).toThrow()
    expect(authDB.users.findByUsername('bob')).toBeNull()
    expect(database.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({ count: 1 })
  })

  it('never rolls a credential counter back when assertions complete out of order', () => {
    const { authDB } = createStore()
    const user = authDB.users.create('alice')
    const authenticator = authDB.authenticators.create(user.id, 'credential', Buffer.from([1]), 4)

    expect(authDB.authenticators.updateCounterMonotonically(authenticator.id, 6)).toBe(true)
    expect(authDB.authenticators.updateCounterMonotonically(authenticator.id, 5)).toBe(false)
    expect(authDB.authenticators.findByCredentialId('credential')?.counter).toBe(6)
  })

  it('accepts authenticators whose counter remains zero', () => {
    const { authDB } = createStore()
    const user = authDB.users.create('alice')
    const authenticator = authDB.authenticators.create(user.id, 'zero-counter', Buffer.from([1]), 0)

    expect(authDB.authenticators.updateCounterMonotonically(authenticator.id, 0)).toBe(true)
    expect(authDB.authenticators.findByCredentialId('zero-counter')?.counter).toBe(0)
  })

  it('backfills opaque user handles when opening an existing database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'todo-auth-migrate-'))
    directories.push(directory)
    const databasePath = join(directory, 'legacy.db')
    const legacyDatabase = new Database(databasePath)
    databases.push(legacyDatabase)
    legacyDatabase.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users (username) VALUES ('legacy-user');
    `)
    legacyDatabase.close()

    const migratedDatabase = createDatabase(databasePath)
    databases.push(migratedDatabase)
    const user = createAuthDataDB(migratedDatabase).users.findByUsername('legacy-user')

    expect(user?.webauthn_user_id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('repairs a missing persisted user handle before authenticator registration', () => {
    const { database, authDB } = createStore()
    const user = authDB.users.create('alice')
    database.prepare('UPDATE users SET webauthn_user_id = NULL WHERE id = ?').run(user.id)

    const handle = authDB.users.ensureWebAuthnUserId(user.id)

    expect(handle).toMatch(/^[0-9a-f-]{36}$/)
    expect(authDB.users.findById(user.id)?.webauthn_user_id).toBe(handle)
  })
})
