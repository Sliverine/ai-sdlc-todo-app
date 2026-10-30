import type Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDatabase,
  createTemplateDB,
  createTodoDB,
  type CreateTemplateDto,
} from '../lib/db'

describe('template database operations', () => {
  let database: Database.Database
  let templateDB: ReturnType<typeof createTemplateDB>
  let userId: number
  let otherUserId: number

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T00:00:00.000Z'))
    database = createDatabase(':memory:')
    templateDB = createTemplateDB(database)
    userId = createUser(database, 'alice')
    otherUserId = createUser(database, 'bob')
  })

  afterEach(() => {
    database.close()
    vi.useRealTimers()
  })

  it('creates templates with defaults, serializes subtasks, and permits duplicate names', () => {
    const input: CreateTemplateDto = {
      name: 'Weekly Review',
      title_template: 'Review the week',
      subtasks: [
        { title: 'Summarize', position: 0 },
        { title: 'Plan next week', position: 1 },
      ],
    }

    const first = templateDB.create({ ...input, user_id: userId })
    const duplicate = templateDB.create({ ...input, user_id: userId })

    expect(first).toMatchObject({
      user_id: userId,
      name: 'Weekly Review',
      description: null,
      category: null,
      title_template: 'Review the week',
      priority: 'medium',
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      due_date_offset_minutes: null,
      subtasks_json: JSON.stringify(input.subtasks),
    })
    expect(first.is_recurring).toBe(false)
    expect(templateDB.findAllByUser(userId)).toHaveLength(2)
    expect(templateDB.findAllByUser(otherUserId)).toEqual([])
    expect(templateDB.findById(first.id, otherUserId)).toBeNull()
    expect(duplicate.id).not.toBe(first.id)
    expect(database.prepare('PRAGMA index_list(templates)').all()).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'idx_templates_user_id' })]),
    )
  })

  it('rejects invalid recurrence, reminder, offset, and subtask configuration', () => {
    const invalidTemplates: CreateTemplateDto[] = [
      { name: 'Recurring', title_template: 'Do it', is_recurring: true, recurrence_pattern: 'weekly' },
      { name: 'Pattern only', title_template: 'Do it', recurrence_pattern: 'weekly' },
      { name: 'Reminder', title_template: 'Do it', reminder_minutes: 15 },
      { name: 'Bad offset', title_template: 'Do it', due_date_offset_minutes: 0 },
      { name: 'Fractional offset', title_template: 'Do it', due_date_offset_minutes: 1.5 },
      { name: 'Bad subtask', title_template: 'Do it', subtasks: [{ title: '', position: 0 }] },
    ]

    for (const input of invalidTemplates) {
      expect(() => templateDB.create({ ...input, user_id: userId })).toThrow()
    }
    expect(templateDB.findAllByUser(userId)).toEqual([])
  })

  it('updates only supplied fields and prevents cross-user access', () => {
    const created = templateDB.create({
      user_id: userId,
      name: 'Routine',
      title_template: 'Do routine',
      category: 'Personal',
    })

    expect(templateDB.update(created.id, otherUserId, { name: 'Private' })).toBeNull()
    expect(templateDB.update(created.id, userId, {
      is_recurring: true,
      recurrence_pattern: 'weekly',
      due_date_offset_minutes: 60,
      priority: 'high',
      subtasks: [{ title: 'First', position: 3 }],
    })).toMatchObject({
      name: 'Routine',
      category: 'Personal',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      due_date_offset_minutes: 60,
      subtasks_json: '[{"title":"First","position":3}]',
    })

    expect(() => templateDB.update(created.id, userId, { due_date_offset_minutes: null }))
      .toThrow('Recurring templates require a due date offset and recurrence pattern')
    expect(templateDB.findById(created.id, userId)?.due_date_offset_minutes).toBe(60)
    expect(templateDB.update(999, userId, { name: 'Missing' })).toBeNull()
  })

  it('deletes only the owned template', () => {
    const created = templateDB.create({ user_id: userId, name: 'One', title_template: 'One' })

    expect(templateDB.delete(created.id, otherUserId)).toBe(false)
    expect(templateDB.delete(created.id, userId)).toBe(true)
    expect(templateDB.findById(created.id, userId)).toBeNull()
  })

  it('uses a snapshot to create a due-dated todo and unchecked subtasks without tags', () => {
    const template = templateDB.create({
      user_id: userId,
      name: 'Weekly Review',
      title_template: 'Review the week',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 30,
      due_date_offset_minutes: 90,
      subtasks: [
        { title: 'Second', position: 1 },
        { title: 'First', position: 0 },
      ],
    })

    const created = templateDB.use(template.id, userId)

    expect(created).toMatchObject({
      user_id: userId,
      title: 'Review the week',
      completed: false,
      due_date: '2026-10-30T01:30:00.000Z',
      priority: 'high',
      is_recurring: true,
      recurrence_pattern: 'weekly',
      reminder_minutes: 30,
      subtasks: [
        { title: 'First', position: 0, completed: false },
        { title: 'Second', position: 1, completed: false },
      ],
      tags: [],
    })
    expect(createTodoDB(database).findAllByUser(userId)).toHaveLength(1)
  })

  it('uses no due date for a null offset and returns null for missing or foreign templates', () => {
    const template = templateDB.create({ user_id: userId, name: 'Anytime', title_template: 'Do it' })

    expect(templateDB.use(template.id, otherUserId)).toBeNull()
    expect(templateDB.use(999, userId)).toBeNull()
    expect(templateDB.use(template.id, userId)).toMatchObject({ due_date: null, subtasks: [], tags: [] })
  })

  it('recalculates the offset on every use and keeps created todos independent of edits and deletion', () => {
    const template = templateDB.create({
      user_id: userId, name: 'Snapshot', title_template: 'Original task',
      description: 'Original description', category: 'Work', priority: 'high',
      is_recurring: true, recurrence_pattern: 'weekly', reminder_minutes: 30,
      due_date_offset_minutes: 90,
      subtasks: [{ title: 'First', position: 2 }, { title: 'Second', position: 7 }],
    })
    const first = templateDB.use(template.id, userId)
    if (!first) throw new Error('Expected first template instance')
    vi.setSystemTime(new Date('2026-10-31T16:30:00.000Z'))
    const second = templateDB.use(template.id, userId)
    if (!second) throw new Error('Expected second template instance')

    expect(first.due_date).toBe('2026-10-30T01:30:00.000Z')
    expect(second.due_date).toBe('2026-10-31T18:00:00.000Z')
    expect(second.id).not.toBe(first.id)
    expect(second.subtasks?.map(({ id }) => id)).not.toEqual(first.subtasks?.map(({ id }) => id))
    expect(second.subtasks).toEqual([
      expect.objectContaining({ title: 'First', position: 2, completed: false }),
      expect.objectContaining({ title: 'Second', position: 7, completed: false }),
    ])

    templateDB.update(template.id, userId, {
      name: 'Updated snapshot', title_template: 'Updated task',
      description: 'Updated description', category: 'Personal', priority: 'low',
      is_recurring: false, recurrence_pattern: null, reminder_minutes: null,
      due_date_offset_minutes: null, subtasks: [{ title: 'Replacement', position: 0 }],
    })
    const updatedInstance = templateDB.use(template.id, userId)
    expect(updatedInstance).toMatchObject({
      title: 'Updated task', priority: 'low', due_date: null, is_recurring: false,
      recurrence_pattern: null, reminder_minutes: null,
      subtasks: [{ title: 'Replacement', position: 0, completed: false }],
    })
    expect(createTodoDB(database).findById(first.id, userId)).toEqual(first)
    expect(templateDB.delete(template.id, userId)).toBe(true)
    expect(templateDB.use(template.id, userId)).toBeNull()
    const todos = createTodoDB(database)
    expect(todos.findById(first.id, userId)).toEqual(first)
    expect(todos.findById(second.id, userId)).toEqual(second)
    expect(todos.findAllByUser(userId)).toHaveLength(3)
  })

  it('rolls back both the todo and earlier checklist inserts when a later insert fails', () => {
    const template = templateDB.create({
      user_id: userId, name: 'Atomic checklist', title_template: 'Must not be partly created',
      subtasks: [{ title: 'Allowed', position: 0 }, { title: 'Reject', position: 1 }],
    })
    database.exec(`
      CREATE TRIGGER reject_template_subtask BEFORE INSERT ON subtasks
      WHEN NEW.title = 'Reject'
      BEGIN SELECT RAISE(ABORT, 'Checklist insert failed'); END;
    `)

    expect(() => templateDB.use(template.id, userId)).toThrow('Checklist insert failed')
    expect(database.prepare('SELECT COUNT(*) AS count FROM todos').get()).toEqual({ count: 0 })
    expect(database.prepare('SELECT COUNT(*) AS count FROM subtasks').get()).toEqual({ count: 0 })
    expect(templateDB.findById(template.id, userId)).toEqual(template)
  })

  it.each([
    ['malformed JSON', '{'],
    ['invalid shape', '[{"title":false,"position":0}]'],
  ])('logs invalid stored subtask data and still creates the todo (%s)', (_label, storedValue) => {
    const template = templateDB.create({ user_id: userId, name: 'Broken', title_template: 'Still do it' })
    database.prepare('UPDATE templates SET subtasks_json = ? WHERE id = ?').run(storedValue, template.id)
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const created = templateDB.use(template.id, userId)

    expect(created?.title).toBe('Still do it')
    expect(created?.subtasks).toEqual([])
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('template subtasks'),
      expect.anything(),
    )
    logError.mockRestore()
  })

  it('rolls back the todo if template instantiation violates a todo invariant', () => {
    const template = templateDB.create({ user_id: userId, name: 'Invalid', title_template: 'Must rollback' })
    database.prepare('UPDATE templates SET reminder_minutes = 15 WHERE id = ?').run(template.id)

    expect(() => templateDB.use(template.id, userId)).toThrow('Reminders require a due date')
    expect(database.prepare('SELECT COUNT(*) AS count FROM todos WHERE user_id = ?').get(userId))
      .toEqual({ count: 0 })
  })
})

function createUser(database: Database.Database, username: string): number {
  return Number(database.prepare('INSERT INTO users (username) VALUES (?)').run(username).lastInsertRowid)
}
