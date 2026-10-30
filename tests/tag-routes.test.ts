import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findAllByUser: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  attachToTodo: vi.fn(),
  detachFromTodo: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db', () => ({
  tagDB: {
    findAllByUser: mocks.findAllByUser,
    create: mocks.create,
    findById: mocks.findById,
    update: mocks.update,
    delete: mocks.delete,
    attachToTodo: mocks.attachToTodo,
    detachFromTodo: mocks.detachFromTodo,
  },
}))

import { GET as listTags, POST as createTag } from '../app/api/tags/route'
import { DELETE as deleteTag, PUT as updateTag } from '../app/api/tags/[id]/route'
import { DELETE as detachTodoTag, POST as attachTodoTag } from '../app/api/todos/[id]/tags/route'

const session = { userId: 9, username: 'alice' }
const existingTag = {
  id: 42,
  user_id: 9,
  name: 'Work',
  color: '#3B82F6',
  created_at: '2026-10-29T00:00:00.000Z',
}

function request(method: string, body?: unknown, origin = 'http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/tags', {
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

describe('tag API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000')
    mocks.getSession.mockResolvedValue(session)
    mocks.findAllByUser.mockReturnValue([existingTag])
    mocks.create.mockReturnValue(existingTag)
    mocks.findById.mockReturnValue(existingTag)
    mocks.update.mockReturnValue(existingTag)
    mocks.delete.mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('lists only the authenticated user’s tags', async () => {
    const response = await listTags()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([existingTag])
    expect(mocks.findAllByUser).toHaveBeenCalledWith(session.userId)
  })

  it('trims names and applies the default color on creation', async () => {
    const response = await createTag(request('POST', { name: '  Team Work  ' }))

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(session.userId, { name: 'Team Work', color: '#3B82F6' })
  })

  it('rejects cross-origin tag mutations before changing data', async () => {
    const origin = 'https://attacker.example'
    const responses = await Promise.all([
      createTag(request('POST', { name: 'Injected' }, origin)),
      updateTag(request('PUT', { name: 'Injected' }, origin), routeContext('42')),
      deleteTag(request('DELETE', undefined, origin), routeContext('42')),
      attachTodoTag(request('POST', { tag_id: 7 }, origin), routeContext('12')),
      detachTodoTag(request('DELETE', { tag_id: 7 }, origin), routeContext('12')),
    ])

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403, 403, 403])
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.findById).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.delete).not.toHaveBeenCalled()
    expect(mocks.attachToTodo).not.toHaveBeenCalled()
    expect(mocks.detachFromTodo).not.toHaveBeenCalled()
  })

  it('rejects invalid colors and duplicate names cleanly', async () => {
    const badColorResponse = await createTag(request('POST', { name: 'Work', color: 'red' }))
    const badUpdateColorResponse = await updateTag(request('PUT', { color: 'red' }), routeContext('42'))
    mocks.create.mockImplementationOnce(() => {
      throw new Error('A tag with this name already exists')
    })
    const duplicateResponse = await createTag(request('POST', { name: 'Work' }))

    expect(badColorResponse.status).toBe(400)
    expect(await badColorResponse.json()).toEqual({ error: 'Color must be a valid hex code' })
    expect(badUpdateColorResponse.status).toBe(400)
    expect(await badUpdateColorResponse.json()).toEqual({ error: 'Color must be a valid hex code' })
    expect(duplicateResponse.status).toBe(409)
    expect(await duplicateResponse.json()).toEqual({ error: 'A tag with this name already exists' })
  })

  it('updates only the tag owned by the authenticated user', async () => {
    mocks.findById.mockReturnValueOnce(null)
    const missingResponse = await updateTag(request('PUT', { name: 'Private' }), routeContext('99'))
    const successResponse = await updateTag(request('PUT', { name: 'Planning' }), routeContext('42'))

    expect(missingResponse.status).toBe(404)
    expect(successResponse.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(42, session.userId, { name: 'Planning' })
  })

  it('removes only the user-owned tag and reports not found for foreign ownership', async () => {
    mocks.delete.mockReturnValueOnce(false)
    const missingResponse = await deleteTag(request('DELETE'), routeContext('99'))
    const successResponse = await deleteTag(request('DELETE'), routeContext('42'))

    expect(missingResponse.status).toBe(404)
    expect(successResponse.status).toBe(200)
    expect(mocks.delete).toHaveBeenCalledWith(42, session.userId)
  })
})
