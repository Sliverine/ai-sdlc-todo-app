import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createDatabase, createHolidayDB } from '../../lib/db'

describe('holiday database operations', () => {
  const directories: string[] = []
  const databases: Database.Database[] = []

  afterEach(() => {
    for (const database of databases.splice(0)) database.close()
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  it('returns holidays within the visible six-week calendar range', () => {
    const directory = mkdtempSync(join(tmpdir(), 'holiday-db-'))
    directories.push(directory)
    const database = createDatabase(join(directory, 'test.db'))
    databases.push(database)
    const holidayDB = createHolidayDB(database)
    const insert = database.prepare('INSERT INTO holidays (date, name) VALUES (?, ?)')
    insert.run('2026-03-29', 'Visible leading day')
    insert.run('2026-04-15', 'In month')
    insert.run('2026-05-09', 'Visible trailing day')
    insert.run('2026-05-10', 'Outside grid')

    expect(holidayDB.findByMonth(2026, 4).map(({ name }) => name)).toEqual([
      'Visible leading day',
      'In month',
      'Visible trailing day',
    ])

    holidayDB.upsert('2026-04-15', 'Updated name')
    expect(holidayDB.findAll().find(({ date }) => date === '2026-04-15')?.name).toBe('Updated name')
  })
})