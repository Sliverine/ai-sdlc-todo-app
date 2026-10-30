import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findAllByUser: vi.fn(),
  importAll: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db', () => ({
  todoDB: { findAllByUser: mocks.findAllByUser, importAll: mocks.importAll },
}))

import { GET as exportTodos } from '../app/api/todos/export/route'
import { POST as importTodos } from '../app/api/todos/import/route'

const session = { userId: 7, username: 'alice' }
const existingTodo = {
  id: 12,
  user_id: 7,
  title: 'Prepare release',
  completed: false,
  due_date: null,
  priority: 'high',
  is_recurring: false,
  recurrence_pattern: null,
  reminder_minutes: null,
  last_notification_sent: null,
  created_at: '2026-10-29T00:00:00.000Z',
  updated_at: null,
  subtasks: [{ id: 3, todo_id: 12, title: 'Draft notes', completed: true, position: 0, created_at: '2026-10-29T00:00:00.000Z' }],
  tags: [{ id: 4, user_id: 7, name: 'Work', color: '#1166AA', created_at: '2026-10-29T00:00:00.000Z' }],
}
const importPayload = {
  version: 1,
  exported_at: '2026-10-30T00:00:00.000Z',
  todos: [{
    title: 'Imported task',
    completed: false,
    due_date: null,
    priority: 'medium',
    is_recurring: false,
    recurrence_pattern: null,
    reminder_minutes: null,
    created_at: '2026-10-29T00:00:00.000Z',
    subtasks: [],
    tags: [],
  }],
}

function request(path: string, method: string, body?: string, origin = 'http://localhost:3000') {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body }),
  })
}

describe('todo export and import routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000')
    mocks.getSession.mockResolvedValue(session)
    mocks.findAllByUser.mockReturnValue([existingTodo])
    mocks.importAll.mockReturnValue({ imported: 1, tagsCreated: 0, tagsReused: 0 })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('exports versioned JSON with related data and a Singapore-dated filename', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-29T16:30:00.000Z'))
    const response = await exportTodos(request('/api/todos/export?format=json', 'GET'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('todos-2026-10-30.json')
    expect(payload).toMatchObject({
      version: 1,
      todos: [{
        title: 'Prepare release',
        subtasks: [{ title: 'Draft notes', completed: true, position: 0 }],
        tags: [{ name: 'Work', color: '#1166AA' }],
      }],
    })
    expect(payload.todos[0]).not.toHaveProperty('id')
    expect(mocks.findAllByUser).toHaveBeenCalledWith(session.userId)
  })

  it('exports RFC 4180 CSV with the required column order', async () => {
    const response = await exportTodos(request('/api/todos/export?format=csv', 'GET'))

    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toMatch(/todos-\d{4}-\d{2}-\d{2}\.csv/)
    expect((await response.text()).split('\r\n')[0]).toBe('ID,Title,Completed,Due Date,Priority,Recurring,Pattern,Reminder')
  })

  it('requires authentication and rejects unsupported export formats', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const unauthenticated = await exportTodos(request('/api/todos/export', 'GET'))
    const unsupported = await exportTodos(request('/api/todos/export?format=xml', 'GET'))

    expect(unauthenticated.status).toBe(401)
    expect(unsupported.status).toBe(400)
  })

  it('validates import JSON and imports only the authenticated user’s payload', async () => {
    const invalidJson = await importTodos(request('/api/todos/import', 'POST', '{'))
    const invalidStructure = await importTodos(request('/api/todos/import', 'POST', JSON.stringify({ version: 1 })))
    const imported = await importTodos(request('/api/todos/import', 'POST', JSON.stringify(importPayload)))

    expect(invalidJson.status).toBe(400)
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON format' })
    expect(invalidStructure.status).toBe(400)
    expect(await invalidStructure.json()).toEqual({
      error: 'Failed to import todos. Please check the file format.',
    })
    expect(imported.status).toBe(200)
    expect(await imported.json()).toEqual({ success: true, imported: 1, tagsCreated: 0, tagsReused: 0 })
    expect(mocks.importAll).toHaveBeenCalledWith(session.userId, importPayload.todos)
  })

  it('authenticates before parsing and rejects cross-origin import requests', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const unauthenticated = await importTodos(request('/api/todos/import', 'POST', '{'))
    const crossOrigin = await importTodos(request(
      '/api/todos/import', 'POST', JSON.stringify(importPayload), 'https://attacker.example',
    ))

    expect(unauthenticated.status).toBe(401)
    expect(crossOrigin.status).toBe(403)
    expect(mocks.importAll).not.toHaveBeenCalled()
  })
})
