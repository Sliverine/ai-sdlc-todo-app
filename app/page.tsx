'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'
import { AddPasskeyButton } from './AddPasskeyButton'
import { LogoutButton } from './LogoutButton'
import type { Priority, RecurrencePattern, ReminderMinutes, Todo } from '@/lib/db'
import { sectionTodos } from '@/lib/todo-utils'
import { formatSingaporeDate, getSingaporeNow, normalizeDueDate, toSingaporeDateTimeInput } from '@/lib/timezone'

interface TodoForm {
  title: string
  due_date: string
  priority: Priority
  is_recurring: boolean
  recurrence_pattern: RecurrencePattern
  reminder_minutes: string
}

const emptyForm: TodoForm = {
  title: '',
  due_date: '',
  priority: 'medium',
  is_recurring: false,
  recurrence_pattern: 'daily',
  reminder_minutes: '',
}

const reminderOptions: Array<{ value: ReminderMinutes; label: string }> = [
  { value: 15, label: '15 minutes before' },
  { value: 30, label: '30 minutes before' },
  { value: 60, label: '1 hour before' },
  { value: 120, label: '2 hours before' },
  { value: 1440, label: '1 day before' },
  { value: 2880, label: '2 days before' },
  { value: 10080, label: '1 week before' },
]

async function readResponse<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && 'error' in body && typeof body.error === 'string'
      ? body.error
      : 'The request could not be completed.'
    throw new Error(message)
  }
  return body as T
}

export default function HomePage() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [now, setNow] = useState(getSingaporeNow)
  const [username, setUsername] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [pendingTodoIds, setPendingTodoIds] = useState<number[]>([])
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [form, setForm] = useState<TodoForm>(emptyForm)
  const [formError, setFormError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const editDialogRef = useRef<HTMLElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const focusTodoIdRef = useRef<number | null>(null)

  useEffect(() => {
    let active = true
    async function loadWorkspace() {
      try {
        const [todoResponse, userResponse] = await Promise.all([
          fetch('/api/todos', { cache: 'no-store' }),
          fetch('/api/auth/me', { cache: 'no-store' }),
        ])
        const [savedTodos, userData] = await Promise.all([
          readResponse<Todo[]>(todoResponse),
          readResponse<{ user: { username: string } }>(userResponse),
        ])
        if (active) {
          setTodos(savedTodos)
          setUsername(userData.user.username)
          setLoadFailed(false)
          setPageError(null)
        }
      } catch {
        if (active) {
          setLoadFailed(true)
          setPageError('Your tasks could not be loaded.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadWorkspace()
    const clock = window.setInterval(() => setNow(getSingaporeNow()), 30_000)
    return () => {
      active = false
      window.clearInterval(clock)
    }
  }, [loadAttempt])

  useEffect(() => {
    if (!editingTodo) {
      returnFocusRef.current?.focus()
      return
    }

    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    editDialogRef.current?.querySelector<HTMLInputElement>('.todo-title-field input')?.focus()

    return () => {
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    }
  }, [editingTodo])

  useEffect(() => {
    const todoId = focusTodoIdRef.current
    if (todoId === null || pendingTodoIds.includes(todoId)) return
    document.getElementById(`todo-completion-${todoId}`)?.focus()
    focusTodoIdRef.current = null
  }, [pendingTodoIds])

  const sections = sectionTodos(todos, now)

  function startEditing(todo: Todo) {
    setEditingTodo(todo)
    setForm({
      title: todo.title,
      due_date: toSingaporeDateTimeInput(todo.due_date),
      priority: todo.priority,
      is_recurring: todo.is_recurring,
      recurrence_pattern: todo.recurrence_pattern ?? 'daily',
      reminder_minutes: todo.reminder_minutes?.toString() ?? '',
    })
    setFormError(null)
  }

  function cancelEditing() {
    setEditingTodo(null)
    setForm(emptyForm)
    setFormError(null)
  }

  function buildPayload() {
    const title = form.title.trim()
    if (!title) throw new Error('Title is required')

    let dueDate: string | null = null
    if (form.due_date) {
      const unchangedDate = editingTodo
        && form.due_date === toSingaporeDateTimeInput(editingTodo.due_date)
      if (unchangedDate) {
        dueDate = editingTodo.due_date
      } else {
        const normalized = normalizeDueDate(form.due_date, now)
        if (!normalized.valid) throw new Error(normalized.error)
        dueDate = normalized.value
      }
    }

    const reminder = form.reminder_minutes ? Number(form.reminder_minutes) as ReminderMinutes : null
    if (form.is_recurring && !dueDate) throw new Error('Recurring todos require a due date')
    if (reminder !== null && !dueDate) throw new Error('Reminders require a due date')

    return {
      title,
      completed: editingTodo?.completed ?? false,
      due_date: dueDate,
      priority: form.priority,
      is_recurring: form.is_recurring,
      recurrence_pattern: form.is_recurring ? form.recurrence_pattern : null,
      reminder_minutes: reminder,
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading || loadFailed) return
    setFormError(null)
    setPageError(null)
    let payload: ReturnType<typeof buildPayload>
    try {
      payload = buildPayload()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Check the todo details and try again.')
      return
    }

    setSaving(true)
    if (editingTodo) {
      const original = editingTodo
      const optimistic = { ...original, ...payload, updated_at: getSingaporeNow().toISOString() }
      setTodos((current) => current.map((todo) => todo.id === original.id ? optimistic : todo))
      try {
        const response = await fetch(`/api/todos/${original.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const saved = await readResponse<Todo>(response)
        setTodos((current) => current.map((todo) => todo.id === original.id ? saved : todo))
        cancelEditing()
      } catch (error) {
        setTodos((current) => current.map((todo) => todo.id === original.id ? original : todo))
        setFormError(error instanceof Error ? error.message : 'Could not update this todo. Please try again.')
      } finally {
        setSaving(false)
      }
      return
    }

    const optimisticId = -Date.now()
    const optimistic: Todo = {
      ...payload,
      id: optimisticId,
      user_id: 0,
      created_at: getSingaporeNow().toISOString(),
      updated_at: null,
      last_notification_sent: null,
      subtasks: [],
      tags: [],
    }
    setTodos((current) => [...current, optimistic])
    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const saved = await readResponse<Todo>(response)
      setTodos((current) => current.map((todo) => todo.id === optimisticId ? saved : todo))
      setForm(emptyForm)
    } catch (error) {
      setTodos((current) => current.filter((todo) => todo.id !== optimisticId))
      setFormError(error instanceof Error ? error.message : 'Could not create this todo. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleTodo(todo: Todo, completed: boolean) {
    if (pendingTodoIds.includes(todo.id)) return
    setPageError(null)
    const optimistic = { ...todo, completed, updated_at: getSingaporeNow().toISOString() }
    focusTodoIdRef.current = todo.id
    setPendingTodoIds((current) => [...current, todo.id])
    setTodos((current) => current.map((item) => item.id === todo.id ? optimistic : item))
    try {
      const response = await fetch(`/api/todos/${todo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed }),
      })
      const saved = await readResponse<Todo>(response)
      setTodos((current) => current.map((item) => item.id === todo.id ? saved : item))
    } catch {
      setTodos((current) => current.map((item) => item.id === todo.id ? todo : item))
      setPageError('Could not update completion. Please try again.')
    } finally {
      setPendingTodoIds((current) => current.filter((id) => id !== todo.id))
    }
  }

  async function removeTodo(todo: Todo) {
    setPageError(null)
    setTodos((current) => current.filter((item) => item.id !== todo.id))
    try {
      const response = await fetch(`/api/todos/${todo.id}`, { method: 'DELETE' })
      await readResponse<{ success: boolean }>(response)
    } catch {
      setTodos((current) => current.some((item) => item.id === todo.id) ? current : [...current, todo])
      setPageError('Could not delete this todo. Please try again.')
    }
  }

  function retryWorkspaceLoad() {
    setLoadFailed(false)
    setLoading(true)
    setPageError(null)
    setLoadAttempt((current) => current + 1)
  }

  function containDialogFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      cancelEditing()
      return
    }
    if (event.key !== 'Tab') return

    const focusable = editDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]',
    )
    const first = focusable?.item(0)
    const last = focusable?.item((focusable.length ?? 1) - 1)
    if (!first || !last) {
      event.preventDefault()
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function renderTodoForm() {
    return (
      <form className="todo-create-form" onSubmit={(event) => void handleSubmit(event)}>
        <div className="todo-form-heading">
          <h2>{editingTodo ? 'Edit todo' : 'Add a todo'}</h2>
          {editingTodo && <button className="quiet-button" type="button" onClick={cancelEditing}>Cancel</button>}
        </div>
        <label className="todo-field todo-title-field">
          <span>Task</span>
          <input
            autoComplete="off"
            onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
            placeholder="What needs your attention?"
            value={form.title}
          />
        </label>
        <div className="todo-form-grid">
          <label className="todo-field">
            <span>Due date and time (Singapore)</span>
            <input
              onChange={(event) => setForm((current) => ({
                ...current,
                due_date: event.target.value,
                reminder_minutes: event.target.value ? current.reminder_minutes : '',
              }))}
              type="datetime-local"
              value={form.due_date}
            />
          </label>
          <label className="todo-field">
            <span>Priority</span>
            <select onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as Priority }))} value={form.priority}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </label>
          <label className="todo-field">
            <span>Reminder</span>
            <select
              disabled={!form.due_date}
              onChange={(event) => setForm((current) => ({ ...current, reminder_minutes: event.target.value }))}
              value={form.reminder_minutes}
            >
              <option value="">No reminder</option>
              {reminderOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="todo-form-footer">
          <label className="recurring-control">
            <input
              checked={form.is_recurring}
              onChange={(event) => setForm((current) => ({ ...current, is_recurring: event.target.checked }))}
              type="checkbox"
            />
            <span>Repeat this todo</span>
          </label>
          {form.is_recurring && (
            <label className="todo-field recurrence-select">
              <span>Repeat</span>
              <select
                onChange={(event) => setForm((current) => ({ ...current, recurrence_pattern: event.target.value as RecurrencePattern }))}
                value={form.recurrence_pattern}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          )}
          <button className="primary-button todo-submit" disabled={saving || loading || loadFailed} type="submit">
            {loadFailed ? 'Tasks unavailable' : loading ? 'Loading tasks...' : saving ? 'Saving...' : editingTodo ? 'Save changes' : 'Add todo'}
          </button>
        </div>
        {formError && <p className="todo-error" role="alert">{formError}</p>}
      </form>
    )
  }

  function renderSection(title: string, items: Todo[], className: string) {
    return (
      <section className={`todo-section ${className}`} aria-labelledby={`${className}-title`}>
        <div className="todo-section-heading">
          <h2 id={`${className}-title`}>{title}</h2>
          <span>{items.length}</span>
        </div>
        {items.length > 0 ? (
          <ul className="todo-list">
            {items.map((todo) => (
              <li className="todo-row" key={todo.id}>
                <input
                  id={`todo-completion-${todo.id}`}
                  aria-label={`Mark ${todo.title} ${todo.completed ? 'incomplete' : 'complete'}`}
                  checked={todo.completed}
                  disabled={pendingTodoIds.includes(todo.id)}
                  onChange={(event) => void toggleTodo(todo, event.target.checked)}
                  type="checkbox"
                />
                <div className="todo-copy">
                  <p className={todo.completed ? 'todo-title is-complete' : 'todo-title'}>{todo.title}</p>
                  <div className="todo-metadata">
                    <span className={`priority-label priority-${todo.priority}`}>{todo.priority}</span>
                    {todo.due_date && <span>{formatSingaporeDate(todo.due_date)}</span>}
                    {todo.is_recurring && todo.recurrence_pattern && <span>Repeats {todo.recurrence_pattern}</span>}
                    {todo.reminder_minutes !== null && <span>Reminder set</span>}
                    {todo.tags?.map((tag) => <span className="todo-tag" key={tag.id}>{tag.name}</span>)}
                  </div>
                  {todo.subtasks && todo.subtasks.length > 0 && (
                    <p className="todo-subtask-count">
                      {todo.subtasks.filter((subtask) => subtask.completed).length}/{todo.subtasks.length} subtasks
                    </p>
                  )}
                </div>
                <div className="todo-actions">
                  <button disabled={pendingTodoIds.includes(todo.id)} type="button" onClick={() => startEditing(todo)}>Edit</button>
                  <button className="delete-action" disabled={pendingTodoIds.includes(todo.id)} type="button" onClick={() => void removeTodo(todo)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="section-empty">Nothing here.</p>}
      </section>
    )
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <Link className="wordmark" href="/">Daymark</Link>
        <nav className="workspace-nav" aria-label="Workspace">
          <Link className="text-link" href="/calendar">Calendar</Link>
          {username && <AddPasskeyButton username={username} />}
          <LogoutButton />
        </nav>
      </header>
      <div className="todo-workspace">
        <section className="todo-intro" aria-labelledby="todo-heading">
          <p className="eyebrow">Personal workspace{username ? ` / ${username}` : ''}</p>
          <div className="todo-title-row">
            <div>
              <h1 id="todo-heading">Today, in focus.</h1>
              <p className="workspace-note">{todos.length} {todos.length === 1 ? 'task' : 'tasks'} across your list</p>
            </div>
            <p className="todo-current-date">{new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'full' }).format(now)}</p>
          </div>
        </section>

        {!editingTodo && renderTodoForm()}
        <div className="todo-list-heading">
          <h2>Your tasks</h2>
          <span>{new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' }).format(now)} SGT</span>
        </div>
        {pageError && <p className="todo-page-error" role="alert">{pageError}</p>}
        {loadFailed && <button className="quiet-button retry-load-button" onClick={retryWorkspaceLoad} type="button">Retry loading tasks</button>}
        {loading ? <p className="loading-state" role="status">Loading your tasks...</p> : !loadFailed && (
          <div className="todo-sections">
            {renderSection('Overdue', sections.overdue, 'overdue-section')}
            {renderSection('Pending', sections.pending, 'pending-section')}
            {renderSection('Completed', sections.completed, 'completed-section')}
          </div>
        )}
      </div>

      {editingTodo && (
        <div
          className="todo-dialog-backdrop"
          onClick={(event) => { if (event.target === event.currentTarget) cancelEditing() }}
        >
          <section
            ref={editDialogRef}
            aria-labelledby="edit-dialog-title"
            aria-modal="true"
            className="todo-edit-dialog"
            onKeyDown={containDialogFocus}
            role="dialog"
            tabIndex={-1}
          >
            <div className="todo-dialog-heading">
              <h2 id="edit-dialog-title">Edit todo</h2>
              <button aria-label="Close edit dialog" className="dialog-close" onClick={cancelEditing} type="button">×</button>
            </div>
            {renderTodoForm()}
          </section>
        </div>
      )}
    </main>
  )
}
