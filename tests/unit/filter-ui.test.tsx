// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import TodoPage from '@/app/page'
import { DEFAULT_FILTER_STATE } from '@/lib/filters'
import { PRESETS_KEY } from '@/lib/filter-presets'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/lib/hooks/useNotifications', () => ({
  useNotifications: () => ({ permission: 'default', supported: true, error: null, requestPermission: vi.fn() }),
}))
const todos = [
  { id: 1, title: 'Team meeting', user_id: 1, completed: false, priority: 'high',
    due_date: '2030-01-01T16:30:00Z', is_recurring: false, recurrence_pattern: null,
    reminder_minutes: null, subtasks: [], tags: [{ id: 7, name: 'Work', color: '#ffffff' }] },
  { id: 2, title: 'Shopping', user_id: 1, completed: true, priority: 'low',
    due_date: null, is_recurring: false, recurrence_pattern: null, reminder_minutes: null,
    subtasks: [{ id: 1, title: 'Buy milk', completed: false }], tags: [] },
]
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) =>
    Promise.resolve(Response.json(url === '/api/auth/me' ? { user: { username: 'test' } }
      : url === '/api/tags' ? [{ id: 7, name: 'Work', color: '#ffffff' }] : todos))))
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })
const rows = () => document.querySelectorAll('.todo-row')
async function load() {
  render(<TodoPage />)
  await screen.findByText('Team meeting')
}

it('debounces subtask search and clears immediately, with distinct no-match state', async () => {
  await load()
  fireEvent.change(screen.getByPlaceholderText('Search todos and subtasks...'), { target: { value: 'MILK' } })
  expect(rows()).toHaveLength(2)
  await waitFor(() => expect(rows()).toHaveLength(1))
  expect(screen.queryByText('Team meeting')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(rows()).toHaveLength(2)
  fireEvent.change(screen.getByPlaceholderText('Search todos and subtasks...'), { target: { value: 'missing' } })
  expect(await screen.findByText('No todos match your filters')).toBeInTheDocument()
  expect(document.querySelectorAll('.todo-section')).toHaveLength(0)
  fireEvent.click(screen.getByRole('button', { name: 'Clear All' }))
  expect(rows()).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Clear All' })).not.toBeInTheDocument()
})

it('combines tag, priority, completion and Singapore-date bounds and hides empty sections', async () => {
  await load()
  fireEvent.change(screen.getByLabelText('Filter by priority'), { target: { value: 'high' } })
  fireEvent.change(screen.getByLabelText('Filter by tag'), { target: { value: '7' } })
  fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
  fireEvent.change(screen.getByLabelText('Completion status'), { target: { value: 'incomplete' } })
  fireEvent.change(screen.getByLabelText('Due Date From'), { target: { value: '2030-01-02' } })
  fireEvent.change(screen.getByLabelText('Due Date To'), { target: { value: '2030-01-02' } })
  expect(rows()).toHaveLength(1)
  expect(document.querySelectorAll('.todo-section')).toHaveLength(1)
  expect(document.querySelector('.todo-section-heading')).toHaveTextContent('Pending1')
  fireEvent.change(screen.getByLabelText('Due Date From'), { target: { value: '2030-01-03' } })
  expect(screen.getByText('From date is after To date')).toBeInTheDocument()
  expect(screen.getByText('No todos match your filters')).toBeInTheDocument()
})

it('previews, saves, applies and deletes complete presets, resetting stale dimensions', async () => {
  await load()
  fireEvent.change(screen.getByLabelText('Filter by priority'), { target: { value: 'high' } })
  fireEvent.click(screen.getByRole('button', { name: /Save Filter/ }))
  const dialog = screen.getByRole('dialog', { name: 'Save filter preset' })
  expect(within(dialog).getByText(/Priority: High/)).toBeInTheDocument()
  fireEvent.change(within(dialog).getByLabelText('Preset name'), { target: { value: 'Morning' } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
  expect(JSON.parse(localStorage.getItem(PRESETS_KEY)!)).toHaveLength(1)
  fireEvent.click(screen.getByRole('button', { name: 'Clear All' }))
  fireEvent.change(screen.getByPlaceholderText('Search todos and subtasks...'), { target: { value: 'stale' } })
  fireEvent.click(screen.getByRole('button', { name: 'Morning' }))
  expect(rows()).toHaveLength(1)
  expect(screen.getByPlaceholderText('Search todos and subtasks...')).toHaveValue('')
  vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
  fireEvent.click(screen.getByRole('button', { name: 'Delete preset Morning' }))
  expect(screen.getByRole('button', { name: 'Morning' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Delete preset Morning' }))
  expect(screen.queryByRole('button', { name: 'Morning' })).not.toBeInTheDocument()
})

it('falls back from a deleted preset tag and surfaces storage write failures', async () => {
  localStorage.setItem(PRESETS_KEY, JSON.stringify([{
    id: 'one', name: 'Old tag', createdAt: '2030-01-01T00:00:00Z',
    filters: { ...DEFAULT_FILTER_STATE, tagId: 99, priority: 'high' },
  }]))
  await load()
  fireEvent.click(screen.getByRole('button', { name: /Advanced/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Old tag' }))
  expect(rows()).toHaveLength(1)
  expect(screen.getByLabelText('Filter by tag')).toHaveValue('all')
  expect(screen.getByRole('status')).toHaveTextContent(/no longer available/)
  fireEvent.click(screen.getByRole('button', { name: /Save Filter/ }))
  fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'New' } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/storage full/)
  expect(screen.getByRole('dialog')).toBeVisible()
})

it('shows a genuine empty state and no tag selector when there are no todos', async () => {
  vi.mocked(fetch).mockImplementation((url) => Promise.resolve(Response.json(
    url === '/api/auth/me' ? { user: { username: 'test' } } : [],
  )))
  render(<TodoPage />)
  expect(await screen.findByText('You have no todos yet')).toBeInTheDocument()
  expect(screen.queryByLabelText('Filter by tag')).not.toBeInTheDocument()
})
