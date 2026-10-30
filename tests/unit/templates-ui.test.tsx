// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import HomePage from '@/app/page'
import type { Template, Todo } from '@/lib/db'

vi.mock('@/app/AddPasskeyButton', () => ({ AddPasskeyButton: () => null }))
vi.mock('@/app/LogoutButton', () => ({ LogoutButton: () => null }))
vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({ permission: 'default', supported: true, error: null, requestPermission: vi.fn() }),
}))

const template: Template = {
  id: 8, user_id: 1, name: 'Weekly review', description: 'Plan the week', category: 'Work',
  title_template: 'Review tasks', priority: 'high', is_recurring: true, recurrence_pattern: 'weekly',
  reminder_minutes: 30, due_date_offset_minutes: 60,
  subtasks_json: JSON.stringify([{ title: 'Review notes', position: 2 }]), created_at: '2030-01-01T00:00:00Z',
}
const todo: Todo = {
  id: 4, user_id: 1, title: 'Review tasks', completed: false, due_date: '2030-01-01T01:00:00Z',
  priority: 'high', is_recurring: true, recurrence_pattern: 'weekly', reminder_minutes: 30,
  last_notification_sent: null, created_at: '2030-01-01T00:00:00Z', updated_at: null,
  subtasks: [{ id: 5, todo_id: 4, title: 'Review notes', completed: true, position: 2, created_at: '2030-01-01T00:00:00Z' }],
  tags: [{ id: 2, user_id: 1, name: 'Not copied', color: '#3B82F6', created_at: '2030-01-01T00:00:00Z' }],
}

function installFetch(todos: Todo[] = [], templates: Template[] = [template]) {
  const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
    if (url === '/api/auth/me') return Response.json({ user: { username: 'alice' } })
    if (url === '/api/tags') return Response.json([])
    if (url === '/api/todos') return Response.json(todos)
    if (url === '/api/templates' && options?.method === 'POST') return Response.json(template, { status: 201 })
    if (url === '/api/templates') return Response.json(templates)
    if (url === '/api/templates/8' && options?.method === 'PUT') return Response.json({ ...template, ...JSON.parse(String(options.body)) })
    if (url === '/api/templates/8/use') return Response.json({ ...todo, subtasks: todo.subtasks?.map((s) => ({ ...s, completed: false })), tags: [] }, { status: 201 })
    if (url === '/api/templates/8' && options?.method === 'DELETE') return Response.json({ success: true })
    throw new Error(`Unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('template controls', () => {
  it('saves the current form as a named template without tags or a concrete date', async () => {
    const fetchMock = installFetch()
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Plan tomorrow' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as Template' }))
    const dialog = screen.getByRole('dialog', { name: 'Save as Template' })
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Planning' } })
    fireEvent.change(within(dialog).getByLabelText('Template subtasks (one per line)'), { target: { value: 'Read notes\nWrite plan' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Template' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const call = fetchMock.mock.calls.find(([url, options]) => url === '/api/templates' && options?.method === 'POST')
    const payload = JSON.parse(String(call?.[1]?.body))
    expect(payload).toMatchObject({
      name: 'Planning', title_template: 'Plan tomorrow',
      subtasks: [{ title: 'Read notes', position: 0 }, { title: 'Write plan', position: 1 }],
    })
    expect(payload).not.toHaveProperty('tag_ids')
    expect(payload).not.toHaveProperty('due_date')
  })

  it('captures existing subtasks as an independent snapshot when saving an existing todo', async () => {
    const source: Todo = {
      ...todo,
      subtasks: [
        ...(todo.subtasks ?? []),
        { id: 6, todo_id: 4, title: 'Write plan', completed: false, position: 5, created_at: todo.created_at },
      ],
    }
    const fetchMock = installFetch([source])
    render(<HomePage />)
    await screen.findByText('Review tasks')
    fireEvent.click(screen.getByRole('button', { name: 'Save Review tasks as template' }))
    const dialog = screen.getByRole('dialog', { name: 'Save as Template' })
    expect(within(dialog).getByLabelText('Template subtasks (one per line)')).toHaveValue('Review notes\nWrite plan')
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Review snapshot' } })
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'Saved checklist' } })
    fireEvent.change(within(dialog).getByLabelText('Category'), { target: { value: 'Work' } })
    fetchMock.mockImplementationOnce(async (_url, options) => {
      const { subtasks, ...fields } = JSON.parse(String(options?.body))
      return Response.json({ ...template, ...fields, subtasks_json: JSON.stringify(subtasks) }, { status: 201 })
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Template' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const call = fetchMock.mock.calls.find(([url, options]) => url === '/api/templates' && options?.method === 'POST')
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      priority: 'high', is_recurring: true, recurrence_pattern: 'weekly', reminder_minutes: 30,
      description: 'Saved checklist', category: 'Work',
      subtasks: [{ title: 'Review notes', position: 2 }, { title: 'Write plan', position: 5 }],
    })
    expect(screen.getByRole('option', { name: 'Review snapshot (Work)' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const card = within(screen.getByRole('dialog', { name: 'Templates' })).getByRole('article', { name: 'Review snapshot' })
    expect(within(card).getByText('Saved checklist')).toBeInTheDocument()
    expect(within(card).getByText('high')).toBeInTheDocument()
    expect(within(card).getByText(/weekly/)).toBeInTheDocument()
    expect(within(card).getByLabelText('Reminder 30m')).toBeInTheDocument()
    expect(within(card).getByRole('list', { name: 'Template checklist' })).toHaveTextContent('Review notesWrite plan')
  })

  it('creates a todo in one action from the quick dropdown', async () => {
    const fetchMock = installFetch()
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fetchMock.mockImplementationOnce(async () => Response.json({
      ...todo,
      tags: [],
      subtasks: [
        { ...todo.subtasks?.[0], completed: false },
        { id: 6, todo_id: 4, title: 'Write plan', completed: false, position: 5, created_at: todo.created_at },
      ],
    }, { status: 201 }))
    fireEvent.change(screen.getByLabelText('Use Template'), { target: { value: '8' } })
    expect(await screen.findByText('Review tasks')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith('/api/templates/8/use', expect.objectContaining({ method: 'POST' }))
    const row = screen.getByText('Review tasks').closest('li')
    if (!row) throw new Error('Missing created todo row')
    expect(within(row).getByLabelText('high priority')).toBeInTheDocument()
    expect(within(row).getByLabelText('Repeats weekly')).toBeInTheDocument()
    expect(within(row).getByLabelText('Reminder 30m')).toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: 'Show subtasks' }))
    expect(within(row).getByRole('checkbox', { name: 'Mark subtask Review notes complete' })).not.toBeChecked()
    expect(within(row).getByRole('checkbox', { name: 'Mark subtask Write plan complete' })).not.toBeChecked()
    expect(within(row).queryByText('Not copied')).not.toBeInTheDocument()
  })

  it('shows template metadata and closes the manager after use', async () => {
    installFetch()
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const dialog = screen.getByRole('dialog', { name: 'Templates' })
    expect(within(dialog).getByText('Plan the week')).toBeInTheDocument()
    expect(within(dialog).getByRole('article', { name: 'Weekly review' })).toHaveTextContent('Work')
    expect(within(dialog).getByLabelText('Reminder 30m')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('Review tasks')).toBeInTheDocument()
  })

  it('confirms deletion, removes the template from both controls and preserves existing todos', async () => {
    installFetch([todo])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    const dialog = screen.getByRole('dialog', { name: 'Templates' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(within(dialog).queryByText('Weekly review')).not.toBeInTheDocument())
    expect(screen.queryByRole('option', { name: 'Weekly review (Work)' })).not.toBeInTheDocument()
    expect(screen.getByText('Review tasks')).toBeInTheDocument()
  })

  it('surfaces template failures without inserting a fake todo', async () => {
    const fetchMock = installFetch()
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fetchMock.mockImplementationOnce(async () => Response.json({ error: 'Unable to use template' }, { status: 500 }))
    fireEvent.change(screen.getByLabelText('Use Template'), { target: { value: '8' } })
    expect(await screen.findByText('Unable to use template')).toBeInTheDocument()
    expect(screen.queryByText('Review tasks')).not.toBeInTheDocument()
  })

  it('updates a template and filters the manager without changing existing todos', async () => {
    const fetchMock = installFetch([todo], [template, { ...template, id: 9, name: 'Personal review', category: 'Personal' }])
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    let dialog = screen.getByRole('dialog', { name: 'Templates' })
    fireEvent.change(within(dialog).getByLabelText('Filter templates by category'), { target: { value: 'Work' } })
    expect(within(dialog).queryByRole('article', { name: 'Personal review' })).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Edit' }))
    dialog = screen.getByRole('dialog', { name: 'Edit Template' })
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Updated review' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Template' }))
    await screen.findByRole('dialog', { name: 'Templates' })
    expect(fetchMock).toHaveBeenCalledWith('/api/templates/8', expect.objectContaining({ method: 'PUT' }))
    expect(screen.getByRole('option', { name: 'Updated review (Work)' })).toBeInTheDocument()
    expect(screen.getByText('Review tasks', { selector: '.todo-title' })).toBeInTheDocument()
  })

  it('does not delete a template if confirmation is cancelled', async () => {
    const fetchMock = installFetch()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fireEvent.click(screen.getByRole('button', { name: 'Templates' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Templates' })).getByRole('button', { name: 'Delete' }))
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'DELETE')).toBe(false)
    expect(screen.getByRole('option', { name: 'Weekly review (Work)' })).toBeInTheDocument()
  })

  it('rejects a recurring template with no relative due-date offset', async () => {
    const fetchMock = installFetch()
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Daily habit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as Template' }))
    const dialog = screen.getByRole('dialog', { name: 'Save as Template' })
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'Habit' } })
    fireEvent.click(within(dialog).getByLabelText('Repeat template'))
    const form = within(dialog).getByRole('button', { name: 'Save Template' }).closest('form')
    if (!form) throw new Error('Missing template form')
    fireEvent.submit(form)
    expect(within(dialog).getByRole('alert')).toHaveTextContent('require a due-date offset')
    expect(fetchMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  it('reports a library loading failure without hiding existing tasks', async () => {
    const fetchMock = installFetch([todo])
    const implementation = fetchMock.getMockImplementation()
    if (!implementation) throw new Error('Missing fetch mock')
    fetchMock.mockImplementation(async (url, options) => url === '/api/templates'
      ? Response.json({ error: 'Template library unavailable' }, { status: 500 })
      : implementation(url, options))
    render(<HomePage />)
    expect(await screen.findByText('Review tasks')).toBeInTheDocument()
    expect(await screen.findByText('Template library unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry loading templates' })).toBeInTheDocument()
  })

  it('prevents duplicate uses while a template request is pending', async () => {
    const fetchMock = installFetch()
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    const select = screen.getByLabelText('Use Template')
    fireEvent.change(select, { target: { value: '8' } })
    fireEvent.change(select, { target: { value: '8' } })
    await screen.findByText('Review tasks')
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/templates/8/use')).toHaveLength(1)
  })

  it('keeps a failed template save open with the draft and server error', async () => {
    const fetchMock = installFetch()
    render(<HomePage />)
    await screen.findByRole('option', { name: 'Weekly review (Work)' })
    fireEvent.change(screen.getByLabelText('Task'), { target: { value: 'Planning' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as Template' }))
    const dialog = screen.getByRole('dialog', { name: 'Save as Template' })
    fireEvent.change(within(dialog).getByLabelText('Template name'), { target: { value: 'My draft' } })
    fetchMock.mockImplementationOnce(async () => Response.json({ error: 'Could not save template' }, { status: 500 }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save Template' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not save template')
    expect(within(dialog).getByLabelText('Template name')).toHaveValue('My draft')
    expect(within(dialog).getByLabelText('Template title')).toHaveValue('Planning')
  })
})
