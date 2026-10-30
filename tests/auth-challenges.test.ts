import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createAuthChallengeDB, createDatabase } from '../lib/db'

describe('auth challenge persistence', () => {
  const directories: string[] = []
  const databases: Array<{ close: () => void }> = []

  afterEach(() => {
    for (const database of databases.splice(0)) {
      try {
        database.close()
      } catch {
        // A test may have closed a database before reopening it.
      }
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createStore() {
    const directory = mkdtempSync(join(tmpdir(), 'todo-auth-'))
    directories.push(directory)
    const databasePath = join(directory, 'test.db')
    const database = createDatabase(databasePath)
    databases.push(database)
    database.prepare('INSERT INTO users (id, username) VALUES (7, ?)').run('alice')
    return { database, store: createAuthChallengeDB(database), databasePath }
  }

  it('consumes a matching challenge only once', () => {
    const { database, store } = createStore()
    const challenge = {
      challenge: 'registration-challenge',
      purpose: 'registration' as const,
      username: 'alice',
      userId: null,
      expiresAt: 2_000,
    }

    store.save(challenge)

    expect(store.consume(challenge.challenge, 'registration', 1_000)).toEqual(challenge)
    expect(store.consume(challenge.challenge, 'registration', 1_000)).toBeNull()
    database.close()
  })

  it('does not consume a challenge for a different purpose or username', () => {
    const { database, store } = createStore()
    const challenge = {
      challenge: 'login-challenge',
      purpose: 'login' as const,
      username: 'alice',
      userId: 7,
      expiresAt: 2_000,
    }

    store.save(challenge)

    expect(store.consume(challenge.challenge, 'registration', 1_000)).toBeNull()
    expect(store.consume(challenge.challenge, 'login', 1_000, 'bob')).toBeNull()
    expect(store.consume(challenge.challenge, 'login', 1_000, 'alice')).toEqual(challenge)
    database.close()
  })

  it('rejects expired challenges', () => {
    const { database, store } = createStore()
    const challenge = {
      challenge: 'expired-challenge',
      purpose: 'login' as const,
      username: 'alice',
      userId: 7,
      expiresAt: 1_000,
    }

    store.save(challenge)

    expect(store.consume(challenge.challenge, 'login', 1_000, 'alice')).toBeNull()
    database.close()
  })

  it('keeps challenges available after reopening the database', () => {
    const { database, store, databasePath } = createStore()
    const challenge = {
      challenge: 'persistent-challenge',
      purpose: 'registration' as const,
      username: 'alice',
      userId: null,
      expiresAt: 2_000,
    }

    store.save(challenge)
    database.close()

    const reopenedDatabase = createDatabase(databasePath)
    databases.push(reopenedDatabase)
    const reopenedStore = createAuthChallengeDB(reopenedDatabase)

    expect(reopenedStore.consume(challenge.challenge, 'registration', 1_000, 'alice')).toEqual(challenge)
    reopenedDatabase.close()
  })

  it('allows independent outstanding challenges for the same username', () => {
    const { database, store } = createStore()
    const first = {
      challenge: 'first-challenge',
      purpose: 'login' as const,
      username: 'alice',
      userId: 7,
      expiresAt: 2_000,
    }
    const second = { ...first, challenge: 'second-challenge' }

    store.save(first)
    store.save(second)

    expect(store.consume(first.challenge, 'login', 1_000, 'alice')).toEqual(first)
    expect(store.consume(second.challenge, 'login', 1_000, 'alice')).toEqual(second)
    database.close()
  })

  it('deletes expired challenges without removing live challenges', () => {
    const { database, store } = createStore()
    store.save({ challenge: 'expired', purpose: 'registration', username: 'alice', userId: null, expiresAt: 1_000 })
    store.save({ challenge: 'live', purpose: 'registration', username: 'alice', userId: null, expiresAt: 2_000 })

    expect(store.deleteExpired(1_000)).toBe(1)
    expect(store.consume('expired', 'registration', 1_000, 'alice')).toBeNull()
    expect(store.consume('live', 'registration', 1_000, 'alice')?.challenge).toBe('live')
    database.close()
  })

  it('persists opaque WebAuthn user handles with registration challenges', () => {
    const { database, store } = createStore()
    const challenge = {
      challenge: 'opaque-handle-challenge',
      purpose: 'registration' as const,
      username: 'alice',
      userId: null,
      userHandle: 'random-opaque-handle',
      expiresAt: 2_000,
    }

    store.save(challenge)

    expect(store.consume(challenge.challenge, 'registration', 1_000, 'alice')).toEqual(challenge)
    database.close()
  })
})
