import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  findAllByUser: vi.fn(),
  create: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  use: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db', () => ({
  templateDB: {
    findAllByUser: mocks.findAllByUser,
    create: mocks.create,
    findById: mocks.findById,
    update: mocks.update,
    delete: mocks.delete,
    use: mocks.use,
  },
}))

import { GET as listTemplates, POST as createTemplate } from '../app/api/templates/route'
import { DELETE as deleteTemplate, GET as getTemplate, PUT as updateTemplate } from '../app/api/templates/[id]/route'
import { POST as useTemplate } from '../app/api/templates/[id]/use/route'
import { TemplateValidationError } from '../lib/template-utils'

const session = { userId: 9, username: 'alice' }
const existingTemplate = {
  id: 42,
  user_id: 9,
  name: 'Weekly Review',
  description: null,
  category: null,
  title_template: 'Review the week',
  priority: 'medium',
  is_recurring: false,
  recurrence_pattern: null,
  reminder_minutes: null,
  due_date_offset_minutes: null,
  subtasks_json: null,
  created_at: '2026-10-29T00:00:00.000Z',
}
const existingTodo = {
  id: 88,
  user_id: 9,
  title: 'Review the week',
  completed: false,
  due_date: null,
  priority: 'medium',
  is_recurring: false,
  recurrence_pattern: null,
  reminder_minutes: null,
  last_notification_sent: null,
  created_at: '2026-10-29T00:00:00.000Z',
  updated_at: null,
  subtasks: [],
  tags: [],
}

function request(method: string, body?: unknown, origin = 'http://localhost:3000') {
  return new NextRequest('http://localhost:3000/api/templates', {
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

describe('template API routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RP_ORIGIN', 'http://localhost:3000')
    mocks.getSession.mockResolvedValue(session)
    mocks.findAllByUser.mockReturnValue([existingTemplate])
    mocks.create.mockReturnValue(existingTemplate)
    mocks.findById.mockReturnValue(existingTemplate)
    mocks.update.mockReturnValue(existingTemplate)
    mocks.delete.mockReturnValue(true)
    mocks.use.mockReturnValue(existingTodo)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('authenticates before parsing a create request body', async () => {
    mocks.getSession.mockResolvedValue(null)
    const malformed = new NextRequest('http://localhost:3000/api/templates', {
      method: 'POST',
      headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
      body: '{',
    })

    const response = await createTemplate(malformed)

    expect(response.status).toBe(401)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('lists only the authenticated user’s templates', async () => {
    const response = await listTemplates()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([existingTemplate])
    expect(mocks.findAllByUser).toHaveBeenCalledWith(session.userId)
  })

  it('requires a session for every template read and mutation', async () => {
    mocks.getSession.mockResolvedValue(null)
    const responses = await Promise.all([
      listTemplates(),
      getTemplate(request('GET'), routeContext('42')),
      createTemplate(request('POST', { name: 'Private', title_template: 'Task' })),
      updateTemplate(request('PUT', { name: 'Private' }), routeContext('42')),
      deleteTemplate(request('DELETE'), routeContext('42')),
      useTemplate(request('POST'), routeContext('42')),
    ])
    expect(responses.map(({ status }) => status)).toEqual([401, 401, 401, 401, 401, 401])
    for (const operation of [mocks.findAllByUser, mocks.findById, mocks.create, mocks.update, mocks.delete, mocks.use]) {
      expect(operation).not.toHaveBeenCalled()
    }
  })

  it('retrieves only an owned template and returns 404 for missing or invalid IDs', async () => {
    const response = await getTemplate(request('GET'), routeContext('42'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(existingTemplate)
    expect(mocks.findById).toHaveBeenCalledWith(42, session.userId)
    mocks.findById.mockReturnValueOnce(null)
    expect((await getTemplate(request('GET'), routeContext('99'))).status).toBe(404)
    expect((await getTemplate(request('GET'), routeContext('-1'))).status).toBe(404)
    expect((await deleteTemplate(request('DELETE'), routeContext('0'))).status).toBe(404)
    expect((await useTemplate(request('POST'), routeContext('invalid'))).status).toBe(404)
  })

  it('rejects foreign-origin deletion without touching the database', async () => {
    const response = await deleteTemplate(request('DELETE', undefined, 'https://attacker.example'), routeContext('42'))
    expect(response.status).toBe(403)
    expect(mocks.delete).not.toHaveBeenCalled()
  })

  it('creates a validated, trimmed template for the session user', async () => {
    const response = await createTemplate(request('POST', {
      name: '  Review  ',
      title_template: '  Review the week  ',
      priority: 'high',
      subtasks: [{ title: 'Plan', position: 0 }],
    }))

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith({
      user_id: session.userId,
      name: 'Review',
      title_template: 'Review the week',
      priority: 'high',
      subtasks: [{ title: 'Plan', position: 0 }],
    })
  })

  it('rejects cross-origin mutations and oversized or invalid request bodies', async () => {
    const denied = await createTemplate(request('POST', { name: 'No', title_template: 'No' }, 'https://attacker.example'))
    const oversized = await createTemplate(request('POST', { name: 'x'.repeat(65 * 1024), title_template: 'No' }))
    const invalid = await createTemplate(request('POST', { name: 'Missing title', extra: true }))
    const badOffset = await createTemplate(request('POST', {
      name: 'Bad offset',
      title_template: 'Task',
      due_date_offset_minutes: 0,
    }))
    const badRecurrence = await createTemplate(request('POST', {
      name: 'Bad recurrence',
      title_template: 'Task',
      is_recurring: true,
      recurrence_pattern: 'weekly',
    }))

    expect([denied.status, oversized.status, invalid.status, badOffset.status, badRecurrence.status])
      .toEqual([403, 413, 400, 400, 400])
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('updates and deletes only templates owned by the session user', async () => {
    mocks.update.mockReturnValueOnce(null)
    const missing = await updateTemplate(request('PUT', { name: 'Private' }), routeContext('100'))
    const updated = await updateTemplate(request('PUT', { category: 'Work' }), routeContext('42'))
    mocks.delete.mockReturnValueOnce(false)
    const missingDelete = await deleteTemplate(request('DELETE'), routeContext('100'))
    const deleted = await deleteTemplate(request('DELETE'), routeContext('42'))

    expect(missing.status).toBe(404)
    expect(updated.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(42, session.userId, { category: 'Work' })
    expect(missingDelete.status).toBe(404)
    expect(deleted.status).toBe(200)
    expect(mocks.delete).toHaveBeenCalledWith(42, session.userId)
  })

  it('rejects malformed IDs and validates updates before touching the database', async () => {
    const badId = await updateTemplate(request('PUT', { name: 'No' }), routeContext('1.5'))
    const invalid = await updateTemplate(request('PUT', { is_recurring: true, extra: true }), routeContext('42'))
    const badOrigin = await updateTemplate(
      request('PUT', { name: 'No' }, 'https://attacker.example'),
      routeContext('42'),
    )

    expect([badId.status, invalid.status, badOrigin.status]).toEqual([404, 400, 403])
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('creates todos from an owned template and returns 404 for foreign or missing templates', async () => {
    const response = await useTemplate(request('POST'), routeContext('42'))
    mocks.use.mockReturnValueOnce(null)
    const missing = await useTemplate(request('POST'), routeContext('99'))
    const badOrigin = await useTemplate(request('POST', undefined, 'https://attacker.example'), routeContext('42'))
    const bodyTooLarge = await useTemplate(
      request('POST', { extra: 'x'.repeat(65 * 1024) }),
      routeContext('42'),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual(existingTodo)
    expect(mocks.use).toHaveBeenCalledWith(42, session.userId)
    expect(missing.status).toBe(404)
    expect(badOrigin.status).toBe(403)
    expect(bodyTooLarge.status).toBe(413)
    expect(mocks.use).toHaveBeenCalledTimes(2)
  })

  it('returns explicit server errors and logs unexpected database failures', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.create.mockImplementationOnce(() => { throw new Error('disk unavailable') })

    const response = await createTemplate(request('POST', { name: 'Error', title_template: 'Task' }))

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Unable to create template' })
    expect(logError).toHaveBeenCalledWith('Unable to create template', expect.any(Error))
    logError.mockRestore()
  })

  it('reports database failures on listing, reading, updating, deleting and using templates', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    for (const operation of [mocks.findAllByUser, mocks.findById, mocks.update, mocks.delete, mocks.use]) {
      operation.mockImplementationOnce(() => { throw new Error('disk unavailable') })
    }
    const responses = await Promise.all([
      listTemplates(),
      getTemplate(request('GET'), routeContext('42')),
      updateTemplate(request('PUT', { name: 'New name' }), routeContext('42')),
      deleteTemplate(request('DELETE'), routeContext('42')),
      useTemplate(request('POST'), routeContext('42')),
    ])
    expect(responses.map(({ status }) => status)).toEqual([500, 500, 500, 500, 500])
    for (const response of responses) {
      expect(JSON.stringify(await response.json())).not.toContain('disk unavailable')
    }
    expect(logError).toHaveBeenCalledTimes(5)
  })

  it('returns validation errors rather than server errors for invalid effective configurations', async () => {
    mocks.create.mockImplementationOnce(() => { throw new TemplateValidationError('Invalid template configuration') })
    mocks.update.mockImplementationOnce(() => { throw new TemplateValidationError('Recurring templates require a due date offset and recurrence pattern') })
    mocks.use.mockImplementationOnce(() => { throw new TemplateValidationError('Due date offset exceeds the supported date range') })
    const created = await createTemplate(request('POST', { name: 'Invalid', title_template: 'Task' }))
    const updated = await updateTemplate(request('PUT', { due_date_offset_minutes: null }), routeContext('42'))
    const used = await useTemplate(request('POST'), routeContext('42'))
    expect([created.status, updated.status, used.status]).toEqual([400, 400, 400])
    expect(await updated.json()).toEqual({ error: 'Recurring templates require a due date offset and recurrence pattern' })
  })
})
