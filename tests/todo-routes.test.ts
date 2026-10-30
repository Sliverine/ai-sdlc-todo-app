import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TodoValidationError } from '../lib/todo-errors'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findAllByUser: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db', () => ({
  PRIORITY_VALUES: ['high', 'medium', 'low'],
  todoDB: {
    findAllByUser: mocks.findAllByUser,
    create: mocks.create,
    findById: mocks.findById,
    update: mocks.update,
    delete: mocks.delete,
  },
}))

import { GET as listTodos, POST as createTodo } from '../app/api/todos/route'
import {
  DELETE as deleteTodo,
  GET as getTodo,
  PUT as updateTodo,
} from '../app/api/todos/[id]/route'

const session = { userId: 7, username: 'alice' }
const existingTodo = {
  id: 12,
  user_id: 7,
  title: 'Existing task',
  completed: false,
  due_date: null,
  priority: 'medium',
  is_recurring: false,
  recurrence_pattern: null,
  reminder_minutes: null,
  last_notification_sent: null,
  created_at: '2026-10-29T00:00:00.000Z',
  updated_at: null,
}

function request(method: string, body?: unknown, origin = 'http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/todos', {
    method,
    headers: {
      origin,
      'content-type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('todo API routes', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-30T00:00:00.000Z'))
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000')
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(session)
    mocks.findAllByUser.mockReturnValue([existingTodo])
    mocks.create.mockReturnValue(existingTodo)
    mocks.findById.mockReturnValue(existingTodo)
    mocks.update.mockReturnValue(existingTodo)
    mocks.delete.mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('authenticates before parsing a create request body', async () => {
    mocks.getSession.mockResolvedValue(null)
    const malformedRequest = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: '{',
    })

    const response = await createTodo(malformedRequest)

    expect(response.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('trims and creates a todo with default fields', async () => {
    const response = await createTodo(request('POST', { title: '  Draft release notes  ' }))

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith({
      user_id: session.userId,
      title: 'Draft release notes',
      due_date: null,
      priority: 'medium',
      completed: false,
      is_recurring: false,
      recurrence_pattern: null,
      reminder_minutes: null,
      tag_ids: [],
    })
  })

  it('creates each explicit priority and defaults an explicit null to medium', async () => {
    for (const priority of ['high', 'medium', 'low'] as const) {
      const response = await createTodo(request('POST', { title: `Task ${priority}`, priority }))
      expect(response.status).toBe(201)
      expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ priority }))
    }

    const nullResponse = await createTodo(request('POST', { title: 'Default task', priority: null }))
    expect(nullResponse.status).toBe(201)
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ priority: 'medium' }))
  })

  it.each(['urgent', 'HIGH', ''])('rejects invalid create priority %j with a descriptive 400', async (priority) => {
    const response = await createTodo(request('POST', { title: 'Invalid priority', priority }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: `Invalid priority: ${priority}. Must be 'high', 'medium', or 'low'.`,
    })
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('leaves priority unchanged when a todo update omits it', async () => {
    const response = await updateTodo(request('PUT', { title: 'Renamed task' }), routeContext('12'))

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(12, session.userId, { title: 'Renamed task' })
  })

  it('updates valid priorities and rejects invalid or null values without writing', async () => {
    const validResponse = await updateTodo(request('PUT', { priority: 'high' }), routeContext('12'))
    expect(validResponse.status).toBe(200)
    expect(mocks.update).toHaveBeenLastCalledWith(12, session.userId, { priority: 'high' })

    for (const priority of ['urgent', 'HIGH', '', null]) {
      mocks.update.mockClear()
      const response = await updateTodo(request('PUT', { priority }), routeContext('12'))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: `Invalid priority: ${String(priority)}. Must be 'high', 'medium', or 'low'.`,
      })
      expect(mocks.update).not.toHaveBeenCalled()
    }
  })

  it('filters direct todo-list queries by priority and rejects invalid filters', async () => {
    const high = { ...existingTodo, id: 20, title: 'High todo', priority: 'high' }
    const low = { ...existingTodo, id: 21, title: 'Low todo', priority: 'low' }
    mocks.findAllByUser.mockReturnValue([high, existingTodo, low])

    const filteredResponse = await listTodos(new NextRequest('http://localhost:3000/api/todos?priority=high'))
    expect(filteredResponse.status).toBe(200)
    expect(await filteredResponse.json()).toEqual([high])

    const invalidResponse = await listTodos(new NextRequest('http://localhost:3000/api/todos?priority=urgent'))
    expect(invalidResponse.status).toBe(400)
  })

  it('distinguishes invalid todo associations from database failures', async () => {
    mocks.create.mockImplementationOnce(() => { throw new TodoValidationError('One or more tags are not available') })
    const validationResponse = await createTodo(request('POST', { title: 'Invalid tag' }))
    mocks.create.mockImplementationOnce(() => { throw new Error('disk unavailable') })
    const databaseResponse = await createTodo(request('POST', { title: 'Database failure' }))

    expect(validationResponse.status).toBe(400)
    expect(await validationResponse.json()).toEqual({ error: 'One or more tags are not available' })
    expect(databaseResponse.status).toBe(500)
  })

  it('returns a client error for database-level update invariant failures', async () => {
    mocks.update.mockImplementationOnce(() => { throw new TodoValidationError('Reminders require a due date') })

    const response = await updateTodo(request('PUT', { due_date: null }), routeContext('12'))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Reminders require a due date' })
  })

  it('rejects oversized JSON requests before database writes', async () => {
    const oversizedRequest = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(65 * 1024) }),
    })

    const response = await createTodo(oversizedRequest)

    expect(response.status).toBe(413)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects malformed or missing JSON bodies after authentication', async () => {
    const malformedRequest = new NextRequest('http://localhost:3000/api/todos', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: '{',
    })

    const malformedResponse = await createTodo(malformedRequest)
    const emptyResponse = await createTodo(request('POST'))

    expect(malformedResponse.status).toBe(400)
    expect(emptyResponse.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('rejects whitespace-only titles and deadlines less than one minute ahead', async () => {
    const blankResponse = await createTodo(request('POST', { title: '   ' }))
    const pastResponse = await createTodo(request('POST', { title: 'Too late', due_date: '2026-10-30T00:00:59.999Z' }))

    expect(blankResponse.status).toBe(400)
    expect(pastResponse.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('accepts a deadline exactly one minute ahead and stores the UTC instant', async () => {
    const response = await createTodo(request('POST', { title: 'Boundary task', due_date: '2026-10-30T08:01' }))

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      due_date: '2026-10-30T00:01:00.000Z',
    }))
  })

  it('lists only the authenticated user’s todos', async () => {
    const response = await listTodos(new NextRequest('http://localhost:3000/api/todos'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([existingTodo])
    expect(mocks.findAllByUser).toHaveBeenCalledWith(session.userId)
  })

  it('returns 404 when a todo is not owned by the authenticated user', async () => {
    mocks.findById.mockReturnValue(null)

    const response = await getTodo(request('GET'), routeContext('12'))

    expect(response.status).toBe(404)
  })

  it('returns 404 for foreign-owned todos across read, update, and delete', async () => {
    mocks.findById.mockReturnValue(null)
    mocks.delete.mockReturnValue(false)

    const readResponse = await getTodo(request('GET'), routeContext('12'))
    const updateResponse = await updateTodo(request('PUT', { title: 'Steal task' }), routeContext('12'))
    const deleteResponse = await deleteTodo(request('DELETE'), routeContext('12'))

    expect(readResponse.status).toBe(404)
    expect(updateResponse.status).toBe(404)
    expect(deleteResponse.status).toBe(404)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.delete).toHaveBeenCalledWith(12, session.userId)
  })

  it('updates only supplied fields and permits an unchanged overdue deadline', async () => {
    const overdueTodo = { ...existingTodo, due_date: '2026-10-29T01:00:00.000Z' }
    mocks.findById.mockReturnValue(overdueTodo)
    mocks.update.mockReturnValue({ ...overdueTodo, title: 'Renamed' })

    const response = await updateTodo(request('PUT', {
      title: '  Renamed  ',
      due_date: '2026-10-29T09:00',
    }), routeContext('12'))

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(12, session.userId, {
      title: 'Renamed',
      due_date: overdueTodo.due_date,
    })
  })

  it('rejects cross-origin mutations', async () => {
    const response = await createTodo(request('POST', { title: 'No CSRF' }, 'https://attacker.example'))

    expect(response.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('deletes an owned todo immediately', async () => {
    const response = await deleteTodo(request('DELETE'), routeContext('12'))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(mocks.delete).toHaveBeenCalledWith(12, session.userId)
  })
})