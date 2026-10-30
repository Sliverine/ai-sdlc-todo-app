import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, createTodoDB } from '../lib/db'

describe('todo database operations', () => {
  const directories: string[] = []
  const databases: Array<{ close: () => void }> = []

  afterEach(() => {
    for (const database of databases.splice(0)) {
      try {
        database.close()
      } catch {
        // A migration test may close a connection before reopening it.
      }
    }
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function createStore() {
    const directory = mkdtempSync(join(tmpdir(), 'todo-db-'))
    directories.push(directory)
    const database = createDatabase(join(directory, 'test.db'))
    databases.push(database)
    return { database, todoDB: createTodoDB(database) }
  }

  it('creates todos with defaults and lists only the requested user’s todos', () => {
    const { database, todoDB } = createStore()
    const firstUser = createTodoUser(database, 'alice')
    const secondUser = createTodoUser(database, 'bob')
    const created = todoDB.create({ user_id: firstUser, title: '  Plan the week  ' })
    todoDB.create({ user_id: secondUser, title: 'Private task' })

    expect(created).toMatchObject({
      user_id: firstUser,
      title: '  Plan the week  ',
      completed: false,
      due_date: null,
      priority: 'medium',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
    })
    expect(created.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(todoDB.findAllByUser(firstUser).map(({ title }) => title)).toEqual(['  Plan the week  '])
    expect(todoDB.findAllByUser(999)).toEqual([])
  })

  it('deduplicates assigned tags and rolls back creation for another user’s tag', () => {
    const { database, todoDB } = createStore()
    const ownerId = createTodoUser(database, 'owner')
    const otherId = createTodoUser(database, 'other')
    const ownerTagId = Number(database.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)').run(ownerId, 'Planning').lastInsertRowid)
    const otherTagId = Number(database.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)').run(otherId, 'Private').lastInsertRowid)

    const created = todoDB.create({ user_id: ownerId, title: 'Tagged task', tag_ids: [ownerTagId, ownerTagId] })
    expect(created.tags?.map(({ id }) => id)).toEqual([ownerTagId])
    expect(() => todoDB.create({ user_id: ownerId, title: 'Invalid tag task', tag_ids: [otherTagId] })).toThrow()
    expect(todoDB.findAllByUser(ownerId)).toHaveLength(1)
  })

  it('returns no cross-user item and prevents cross-user update or deletion', () => {
    const { database, todoDB } = createStore()
    const ownerId = createTodoUser(database, 'owner')
    const otherId = createTodoUser(database, 'other')
    const created = todoDB.create({ user_id: ownerId, title: 'Owned task' })

    expect(todoDB.findById(created.id, otherId)).toBeNull()
    expect(todoDB.update(created.id, otherId, { title: 'Changed' })).toBeNull()
    expect(todoDB.delete(created.id, otherId)).toBe(false)
    expect(todoDB.findById(created.id, ownerId)?.title).toBe('Owned task')
  })

  it('updates only supplied fields and refreshes the update timestamp', () => {
    const { database, todoDB } = createStore()
    const userId = createTodoUser(database, 'alice')
    const created = todoDB.create({ user_id: userId, title: 'Original', priority: 'low' })

    const updated = todoDB.update(created.id, userId, { title: 'Renamed' })

    expect(updated).toMatchObject({ title: 'Renamed', priority: 'low', completed: false })
    expect(updated?.updated_at).toBeTruthy()

    const fullyUpdated = todoDB.update(created.id, userId, {
      completed: true,
      due_date: '2026-12-01T10:00:00.000Z',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 30,
      tag_ids: [],
    })
    expect(fullyUpdated).toMatchObject({
      completed: true,
      due_date: '2026-12-01T10:00:00.000Z',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 30,
    })
  })

  it('leaves updated_at unchanged for an empty update and clears tags explicitly', () => {
    const { database, todoDB } = createStore()
    const userId = createTodoUser(database, 'alice')
    const todo = todoDB.create({ user_id: userId, title: 'Keep task' })
    const tagId = Number(database.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)').run(userId, 'Keep').lastInsertRowid)
    database.prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)').run(todo.id, tagId)

    expect(todoDB.update(todo.id, userId, {})).toMatchObject({ updated_at: null })
    expect(todoDB.update(todo.id, userId, { tag_ids: [] })?.tags).toEqual([])
  })

  it('rejects updates that would leave recurrence or reminders without a due date', () => {
    const { database, todoDB } = createStore()
    const userId = createTodoUser(database, 'alice')
    const todo = todoDB.create({
      user_id: userId,
      title: 'Recurring task',
      due_date: '2026-12-01T10:00:00.000Z',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 15,
    })

    expect(() => todoDB.update(todo.id, userId, { due_date: null })).toThrow('Recurring todos require a due date and pattern')
    expect(todoDB.findById(todo.id, userId)).toMatchObject({
      due_date: '2026-12-01T10:00:00.000Z',
      is_recurring: true,
      reminder_minutes: 15,
    })
  })

  it('creates one next occurrence with current metadata and tags when a recurring todo is completed', () => {
    const { database, todoDB } = createStore()
    const userId = createTodoUser(database, 'alice')
    const tagId = Number(database.prepare(
      'INSERT INTO tags (user_id, name) VALUES (?, ?)',
    ).run(userId, 'Habits').lastInsertRowid)
    const todo = todoDB.create({
      user_id: userId,
      title: 'Weekly review',
      due_date: '2026-12-01T10:00:00.000Z',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 30,
      tag_ids: [tagId],
    })

    todoDB.update(todo.id, userId, { completed: true })
    todoDB.update(todo.id, userId, { completed: true })

    const instances = todoDB.findAllByUser(userId).filter((instance) => instance.title === todo.title)
    expect(instances).toHaveLength(2)
    expect(instances.find((instance) => instance.id === todo.id)).toMatchObject({ completed: true })
    expect(instances.find((instance) => instance.id !== todo.id)).toMatchObject({
      completed: false,
      due_date: '2026-12-08T10:00:00.000Z',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 30,
      tags: [{ id: tagId, name: 'Habits' }],
    })
  })

  it('does not create another occurrence for non-recurring todos or when deleting an uncompleted recurring todo', () => {
    const { database, todoDB } = createStore()
    const userId = createTodoUser(database, 'alice')
    const regular = todoDB.create({ user_id: userId, title: 'One-off' })
    todoDB.update(regular.id, userId, { completed: true })

    const recurring = todoDB.create({
      user_id: userId,
      title: 'Stop before completion',
      due_date: '2026-12-01T10:00:00.000Z',
      is_recurring: true,
      recurrence_pattern: 'daily',
    })
    expect(todoDB.delete(recurring.id, userId)).toBe(true)

    expect(todoDB.findAllByUser(userId).map((todo) => todo.title)).toEqual(['One-off'])
    expect(todoDB.findById(regular.id, userId)?.completed).toBe(true)
  })

  it('returns subtasks and tags with a todo and cascades dependent rows on delete', () => {
    const { database, todoDB } = createStore()
    const userId = createTodoUser(database, 'alice')
    const todo = todoDB.create({ user_id: userId, title: 'Plan release' })
    const tagId = Number(database.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)').run(userId, 'Work').lastInsertRowid)
    database.prepare('INSERT INTO todo_tags (todo_id, tag_id) VALUES (?, ?)').run(todo.id, tagId)
    database.prepare('INSERT INTO subtasks (todo_id, title, position) VALUES (?, ?, ?)').run(todo.id, 'Draft notes', 0)

    expect(todoDB.findById(todo.id, userId)).toMatchObject({
      subtasks: [{ title: 'Draft notes', completed: false, position: 0 }],
      tags: [{ id: tagId, name: 'Work' }],
    })

    expect(todoDB.delete(todo.id, userId)).toBe(true)
    expect(database.prepare('SELECT COUNT(*) AS count FROM subtasks WHERE todo_id = ?').get(todo.id)).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM todo_tags WHERE todo_id = ?').get(todo.id)).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM tags WHERE id = ?').get(tagId)).toEqual({ count: 1 })
  })

  it('normalizes todo timestamps when opening a legacy SQLite database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'todo-legacy-'))
    directories.push(directory)
    const path = join(directory, 'legacy.db')
    const legacyDatabase = new Database(path)
    databases.push(legacyDatabase)
    legacyDatabase.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users (username) VALUES ('legacy-user');
      CREATE TABLE todos (
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
      INSERT INTO todos (user_id, title) VALUES (1, 'Legacy task');
    `)
    legacyDatabase.close()

    const migratedDatabase = createDatabase(path)
    databases.push(migratedDatabase)
    const migratedTodo = createTodoDB(migratedDatabase).findById(1, 1)
    const migratedUser = migratedDatabase.prepare('SELECT created_at FROM users WHERE id = 1').get() as { created_at: string }

    expect(migratedTodo?.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
    expect(migratedUser.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

function createTodoUser(database: Database.Database, username: string): number {
  return Number(database.prepare('INSERT INTO users (username) VALUES (?)').run(username).lastInsertRowid)
}