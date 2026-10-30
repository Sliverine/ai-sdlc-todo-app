import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  todoFindById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db', () => ({
  todoDB: { findById: mocks.todoFindById },
  subtaskDB: { create: mocks.create, update: mocks.update, delete: mocks.delete },
}))

import { POST as createSubtask } from '../app/api/todos/[id]/subtasks/route'
import { DELETE as deleteSubtask, PUT as updateSubtask } from '../app/api/subtasks/[id]/route'

const session = { userId: 7, username: 'alice' }
const existingTodo = { id: 12, user_id: 7, title: 'Parent task' }
const existingSubtask = {
  id: 31, todo_id: 12, title: 'Draft outline', completed: false, position: 0,
  created_at: '2026-10-30T00:00:00.000Z',
}

function request(path: string, method: string, body?: unknown, origin = 'http://localhost:3000') {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: { origin, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

describe('subtask API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000')
    mocks.getSession.mockResolvedValue(session)
    mocks.todoFindById.mockReturnValue(existingTodo)
    mocks.create.mockReturnValue(existingSubtask)
    mocks.update.mockReturnValue(existingSubtask)
    mocks.delete.mockReturnValue(true)
  })

  afterEach(() => vi.unstubAllEnvs())

  it('authenticates before parsing, validates titles, and creates a trimmed subtask', async () => {
    mocks.getSession.mockResolvedValueOnce(null)
    const unauthenticated = await createSubtask(
      request('/api/todos/12/subtasks', 'POST', undefined), routeContext('12'),
    )
    const blankTitle = await createSubtask(
      request('/api/todos/12/subtasks', 'POST', { title: '   ' }), routeContext('12'),
    )
    const created = await createSubtask(
      request('/api/todos/12/subtasks', 'POST', { title: '  Draft outline  ' }), routeContext('12'),
    )

    expect(unauthenticated.status).toBe(401)
    expect(blankTitle.status).toBe(400)
    expect(created.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(12, session.userId, { title: 'Draft outline' })
  })

  it('rejects invalid IDs, foreign-owned parent todos, and cross-origin creation', async () => {
    mocks.todoFindById.mockReturnValue(null)
    const foreignTodo = await createSubtask(
      request('/api/todos/12/subtasks', 'POST', { title: 'Private step' }), routeContext('12'),
    )
    const invalidId = await createSubtask(
      request('/api/todos/12/subtasks', 'POST', { title: 'Step' }), routeContext('0'),
    )
    const crossOrigin = await createSubtask(
      request('/api/todos/12/subtasks', 'POST', { title: 'Step' }, 'https://attacker.example'), routeContext('12'),
    )

    expect(foreignTodo.status).toBe(404)
    expect(invalidId.status).toBe(404)
    expect(crossOrigin.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('updates only the validated subtask fields and hides foreign-owned subtasks', async () => {
    const updated = await updateSubtask(
      request('/api/subtasks/31', 'PUT', { title: '  Final outline  ', completed: true }), routeContext('31'),
    )
    mocks.update.mockReturnValueOnce(null)
    const foreignSubtask = await updateSubtask(
      request('/api/subtasks/31', 'PUT', { completed: true }), routeContext('31'),
    )

    expect(updated.status).toBe(200)
    expect(mocks.update).toHaveBeenNthCalledWith(1, 31, session.userId, { title: 'Final outline', completed: true })
    expect(foreignSubtask.status).toBe(404)
  })

  it('deletes only an owned subtask and rejects malformed update data', async () => {
    const malformedUpdate = await updateSubtask(
      request('/api/subtasks/31', 'PUT', { completed: 'yes' }), routeContext('31'),
    )
    mocks.delete.mockReturnValueOnce(false)
    const foreignSubtask = await deleteSubtask(request('/api/subtasks/31', 'DELETE'), routeContext('31'))
    const deleted = await deleteSubtask(request('/api/subtasks/31', 'DELETE'), routeContext('31'))

    expect(malformedUpdate.status).toBe(400)
    expect(foreignSubtask.status).toBe(404)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ success: true })
    expect(mocks.delete).toHaveBeenNthCalledWith(1, 31, session.userId)
  })
})
