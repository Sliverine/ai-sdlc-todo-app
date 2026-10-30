'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent, KeyboardEvent } from 'react'
import { AddPasskeyButton } from './AddPasskeyButton'
import { LogoutButton } from './LogoutButton'
import type { Priority, RecurrencePattern, Subtask, Tag, Template, TemplateSubtask, Todo } from '@/lib/db'
import { parseTemplateSubtasks } from '@/lib/template-utils'
import { calculateProgress, sectionTodos } from '@/lib/todo-utils'
import { useNotifications } from '@/lib/hooks/useNotifications'
import { REMINDER_OPTIONS, reminderLabel, reminderMinutesSchema } from '@/lib/reminders'
import { formatSingaporeDate, getSingaporeNow, normalizeDueDate, parseDueDate, toSingaporeDateTimeInput } from '@/lib/timezone'
import { applyFilters, DEFAULT_FILTER_STATE, hasActiveFilters, type FilterState } from '@/lib/filters'
import { deletePreset, loadPresets, savePreset, type FilterPreset } from '@/lib/filter-presets'
import { useDebounce } from '@/lib/hooks/useDebounce'

interface TodoForm {
  title: string
  due_date: string
  priority: Priority
  is_recurring: boolean
  recurrence_pattern: RecurrencePattern
  reminder_minutes: string
  tag_ids: number[]
}

const emptyForm: TodoForm = {
  title: '',
  due_date: '',
  priority: 'medium',
  is_recurring: false,
  recurrence_pattern: 'daily',
  reminder_minutes: '',
  tag_ids: [],
}

interface TemplateEditor {
  id: number | null
  name: string
  description: string
  category: string
  title_template: string
  priority: Priority
  is_recurring: boolean
  recurrence_pattern: RecurrencePattern
  reminder_minutes: string
  offset: string
  subtasks: TemplateSubtask[]
  checklist: string
}

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

function getTagForegroundColor(color: string): string {
  const channels = color.slice(1).match(/.{2}/g)?.map((channel) => Number.parseInt(channel, 16) / 255) ?? [0, 0, 0]
  const luminance = channels
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const blackContrast = (luminance + 0.05) / 0.05
  const whiteContrast = 1.05 / (luminance + 0.05)
  return blackContrast >= whiteContrast ? '#000000' : '#FFFFFF'
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
  const [expandedSubtaskTodoIds, setExpandedSubtaskTodoIds] = useState<number[]>([])
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<number, string>>({})
  const [pendingSubtaskKeys, setPendingSubtaskKeys] = useState<string[]>([])
  const [editingTodo, setEditingTodo] = useState<Todo | null>(null)
  const [form, setForm] = useState<TodoForm>(emptyForm)
  const [availableTags, setAvailableTags] = useState<Tag[]>([])
  const [tagModalOpen, setTagModalOpen] = useState(false)
  const [tagDraftName, setTagDraftName] = useState('')
  const [tagDraftColor, setTagDraftColor] = useState('#3B82F6')
  const [tagDraftEditingId, setTagDraftEditingId] = useState<number | null>(null)
  const [tagModalError, setTagModalError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const editDialogRef = useRef<HTMLElement | null>(null)
  const importFileRef = useRef<HTMLInputElement | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const focusTodoIdRef = useRef<number | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(true)
  const [templateLoadError, setTemplateLoadError] = useState<string | null>(null)
  const [templateLoadAttempt, setTemplateLoadAttempt] = useState(0)
  const [templateDialog, setTemplateDialog] = useState<'save' | 'manage' | null>(null)
  const [templateEditor, setTemplateEditor] = useState<TemplateEditor | null>(null)
  const [templateCategory, setTemplateCategory] = useState('')
  const [templateError, setTemplateError] = useState<string | null>(null)
  const [templateBusy, setTemplateBusy] = useState(false)
  const templateActionRef = useRef(false)
  const templateDialogRef = useRef<HTMLElement | null>(null)
  const [filters, setFilters] = useState<FilterState>({ ...DEFAULT_FILTER_STATE })
  const [advancedExpanded, setAdvancedExpanded] = useState(false)
  const [presets, setPresets] = useState<FilterPreset[]>([])
  const [presetName, setPresetName] = useState('')
  const [presetError, setPresetError] = useState<string | null>(null)
  const [filterNotice, setFilterNotice] = useState<string | null>(null)
  const presetDialogRef = useRef<HTMLDialogElement | null>(null)
  const { value: debouncedSearch, flush: flushSearch } = useDebounce(filters.search)
  const selectedTagId = filters.tagId === 'all' || availableTags.some((tag) => tag.id === filters.tagId)
    ? filters.tagId : 'all'
  const activeFilters = { ...filters, tagId: selectedTagId }
  const filtersActive = hasActiveFilters(activeFilters)
  const { priority, completion, dueDateFrom, dueDateTo } = filters
  const filteredTodos = useMemo(() => applyFilters(todos, {
    priority, completion, dueDateFrom, dueDateTo, search: debouncedSearch, tagId: selectedTagId,
  }), [todos, priority, completion, dueDateFrom, dueDateTo, selectedTagId, debouncedSearch])
  const notifications = useNotifications(!loading && !loadFailed)

  function replaceFilters(next: FilterState) {
    setFilters({ ...next })
    flushSearch(next.search)
    setFilterNotice(null)
  }

  function applyPreset(preset: FilterPreset) {
    const missingTag = preset.filters.tagId !== 'all'
      && !availableTags.some((tag) => tag.id === preset.filters.tagId)
    replaceFilters({ ...preset.filters, tagId: missingTag ? 'all' : preset.filters.tagId })
    if (missingTag) setFilterNotice('The preset tag is no longer available. Showing all tags instead.')
  }

  function handleSavePreset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const name = presetName.trim()
    if (!name) {
      setPresetError('Enter a name for this preset.')
      return
    }
    try {
      setPresets(savePreset({
        id: crypto.randomUUID(), name, filters: { ...activeFilters }, createdAt: getSingaporeNow().toISOString(),
      }))
      setAdvancedExpanded(true)
      presetDialogRef.current?.close()
    } catch (error) {
      setPresetError(error instanceof Error ? error.message : 'Could not save this filter preset.')
    }
  }

  function handleDeletePreset(preset: FilterPreset) {
    if (!window.confirm(`Delete preset "${preset.name}"?`)) return
    setFilterNotice(null)
    try {
      setPresets(deletePreset(preset.id))
    } catch (error) {
      setFilterNotice(error instanceof Error ? error.message : 'Could not delete this filter preset.')
    }
  }

  const filterPreview = [
    activeFilters.search.trim() && `Search: "${activeFilters.search.trim()}"`,
    activeFilters.priority !== 'all' && `Priority: ${activeFilters.priority[0].toUpperCase()}${activeFilters.priority.slice(1)}`,
    activeFilters.tagId !== 'all' && `Tag: ${availableTags.find((tag) => tag.id === activeFilters.tagId)?.name}`,
    activeFilters.completion !== 'all' && `Completion: ${activeFilters.completion === 'completed' ? 'Completed' : 'Incomplete'}`,
    (activeFilters.dueDateFrom || activeFilters.dueDateTo)
      && `Date: ${activeFilters.dueDateFrom ?? 'Any'} to ${activeFilters.dueDateTo ?? 'Any'} (Singapore)`,
  ].filter(Boolean).join(' · ')

  useEffect(() => {
    let active = true
    async function loadTemplates() {
      setTemplatesLoading(true)
      try {
        const saved = await readResponse<Template[]>(await fetch('/api/templates', { cache: 'no-store' }))
        if (active) {
          setTemplates(saved)
          setTemplateLoadError(null)
        }
      } catch (error) {
        if (active) setTemplateLoadError(error instanceof Error ? error.message : 'Templates could not be loaded.')
      } finally {
        if (active) setTemplatesLoading(false)
      }
    }
    void loadTemplates()
    return () => { active = false }
  }, [templateLoadAttempt])

  useEffect(() => {
    if (!templateDialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    templateDialogRef.current?.querySelector<HTMLElement>('input, select, button')?.focus()
    return () => { if (previousFocus?.isConnected) previousFocus.focus() }
  }, [templateDialog])

  useEffect(() => {
    let active = true
    async function loadWorkspace() {
      try {
        const [todoResponse, tagResponse, userResponse] = await Promise.all([
          fetch('/api/todos', { cache: 'no-store' }),
          fetch('/api/tags', { cache: 'no-store' }),
          fetch('/api/auth/me', { cache: 'no-store' }),
        ])
        const [savedTodos, savedTags, userData] = await Promise.all([
          readResponse<Todo[]>(todoResponse),
          readResponse<Tag[]>(tagResponse),
          readResponse<{ user: { username: string } }>(userResponse),
        ])
        if (active) {
          setTodos(savedTodos)
          setAvailableTags(savedTags)
          setPresets(loadPresets())
          setFilters((current) => current.tagId === 'all' || savedTags.some((tag) => tag.id === current.tagId)
            ? current : { ...current, tagId: 'all' })
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

  const sections = sectionTodos(filteredTodos, now)
  function cancelEditing() {
    setEditingTodo(null)
    setForm(emptyForm)
    setFormError(null)
  }

  async function refreshTags() {
    const response = await fetch('/api/tags', { cache: 'no-store' })
    const tags = await readResponse<Tag[]>(response)
    setAvailableTags(tags)
    setFilters((current) => current.tagId === 'all' || tags.some((tag) => tag.id === current.tagId)
      ? current : { ...current, tagId: 'all' })
    return tags
  }

  function downloadTodos(format: 'json' | 'csv') {
    window.location.assign(`/api/todos/export?format=${format}`)
  }

  async function importTodos(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return

    const isLargeImport = file.size > 10 * 1024 * 1024
    setImporting(true)
    setImportMessage(isLargeImport
      ? { type: 'info', text: 'This large file may take a while to import.' }
      : null)

    try {
      let payload: unknown
      try {
        payload = JSON.parse(await file.text()) as unknown
      } catch {
        throw new SyntaxError('Invalid JSON format')
      }

      const response = await fetch('/api/todos/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await readResponse<{ imported: number }>(response)
      const notice = isLargeImport ? 'This large file may take a while to import. ' : ''
      setImportMessage({ type: 'success', text: `${notice}Successfully imported ${result.imported} todos` })
      setLoadAttempt((current) => current + 1)
    } catch (error) {
      setImportMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to import todos',
      })
    } finally {
      setImporting(false)
      input.value = ''
    }
  }

  function startEditing(todo: Todo) {
    setEditingTodo(todo)
    setForm({
      title: todo.title,
      due_date: toSingaporeDateTimeInput(todo.due_date),
      priority: todo.priority,
      is_recurring: todo.is_recurring,
      recurrence_pattern: todo.recurrence_pattern ?? 'daily',
      reminder_minutes: todo.reminder_minutes?.toString() ?? '',
      tag_ids: todo.tags?.map((tag) => tag.id) ?? [],
    })
    setFormError(null)
  }

  function buildPayload() {
    const title = form.title.trim()
    if (!title) throw new Error('Title is required')

    let dueDate: string | null = null
    if (form.due_date) {
      const unchangedDate = editingTodo && form.due_date === toSingaporeDateTimeInput(editingTodo.due_date)
      if (unchangedDate) {
        dueDate = editingTodo.due_date
      } else {
        const normalized = normalizeDueDate(form.due_date, now)
        if (!normalized.valid) throw new Error(normalized.error)
        dueDate = normalized.value
      }
    }

    const reminder = form.reminder_minutes ? reminderMinutesSchema.parse(Number(form.reminder_minutes)) : null
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
      tag_ids: form.tag_ids,
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

		const optimisticId = -getSingaporeNow().getTime()
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
      if (completed && todo.is_recurring) {
        try {
          const refreshed = await readResponse<Todo[]>(await fetch('/api/todos', { cache: 'no-store' }))
          setTodos(refreshed)
        } catch {
          setPageError('Completion saved, but the next occurrence could not be loaded. Reload to see it.')
        }
      }
    } catch {
      setTodos((current) => current.map((item) => item.id === todo.id ? todo : item))
      setPageError('Could not update completion. Please try again.')
    } finally {
      setPendingTodoIds((current) => current.filter((id) => id !== todo.id))
    }
  }

  function replaceSubtaskInTodo(todoId: number, subtaskId: number, replacement: Subtask | null) {
    setTodos((current) => current.map((todo) => {
      if (todo.id !== todoId) return todo
      const remaining = (todo.subtasks ?? []).filter((subtask) => subtask.id !== subtaskId)
      const subtasks = replacement
        ? [...remaining, replacement].sort((first, second) => first.position - second.position || first.id - second.id)
        : remaining
      return { ...todo, subtasks }
    }))
  }

  function setSubtaskPending(key: string, pending: boolean) {
    setPendingSubtaskKeys((current) => pending
      ? [...current, key]
      : current.filter((entry) => entry !== key))
  }

  async function addSubtask(todo: Todo) {
    const title = (subtaskDrafts[todo.id] ?? '').trim()
    const pendingKey = `todo:${todo.id}`
    if (!title || pendingSubtaskKeys.includes(pendingKey)) return

    setPageError(null)
    setSubtaskPending(pendingKey, true)
    const currentSubtasks = todo.subtasks ?? []
    const optimisticId = -getSingaporeNow().getTime()
    const optimistic: Subtask = {
      id: optimisticId,
      todo_id: todo.id,
      title,
      completed: false,
      position: Math.max(-1, ...currentSubtasks.map((subtask) => subtask.position)) + 1,
      created_at: getSingaporeNow().toISOString(),
    }
    replaceSubtaskInTodo(todo.id, optimisticId, optimistic)
    setSubtaskDrafts((current) => ({ ...current, [todo.id]: '' }))

    try {
      const response = await fetch(`/api/todos/${todo.id}/subtasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const saved = await readResponse<Subtask>(response)
      replaceSubtaskInTodo(todo.id, optimisticId, saved)
    } catch (error) {
      replaceSubtaskInTodo(todo.id, optimisticId, null)
      setSubtaskDrafts((current) => ({ ...current, [todo.id]: title }))
      setPageError(error instanceof Error ? error.message : 'Could not add this subtask. Please try again.')
    } finally {
      setSubtaskPending(pendingKey, false)
    }
  }

  async function toggleSubtask(todoId: number, subtask: Subtask) {
    const pendingKey = `subtask:${subtask.id}`
    if (pendingSubtaskKeys.includes(pendingKey)) return

    setPageError(null)
    setSubtaskPending(pendingKey, true)
    const optimistic = { ...subtask, completed: !subtask.completed }
    replaceSubtaskInTodo(todoId, subtask.id, optimistic)
    try {
      const response = await fetch(`/api/subtasks/${subtask.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: optimistic.completed }),
      })
      replaceSubtaskInTodo(todoId, subtask.id, await readResponse<Subtask>(response))
    } catch {
      replaceSubtaskInTodo(todoId, subtask.id, subtask)
      setPageError('Could not update this subtask. Please try again.')
    } finally {
      setSubtaskPending(pendingKey, false)
    }
  }

  async function removeSubtask(todoId: number, subtask: Subtask) {
    const pendingKey = `subtask:${subtask.id}`
    if (pendingSubtaskKeys.includes(pendingKey)) return

    setPageError(null)
    setSubtaskPending(pendingKey, true)
    replaceSubtaskInTodo(todoId, subtask.id, null)
    try {
      const response = await fetch(`/api/subtasks/${subtask.id}`, { method: 'DELETE' })
      await readResponse<{ success: boolean }>(response)
    } catch {
      replaceSubtaskInTodo(todoId, subtask.id, subtask)
      setPageError('Could not delete this subtask. Please try again.')
    } finally {
      setSubtaskPending(pendingKey, false)
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

  async function handleCreateTag() {
    const trimmedName = tagDraftName.trim()
    if (!trimmedName) {
      setTagModalError('Tag name is required')
      return
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(tagDraftColor)) {
      setTagModalError('Color must be a valid hex code')
      return
    }

    try {
      const response = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, color: tagDraftColor }),
      })
      await readResponse<Tag>(response)
      await refreshTags()
      setTagDraftName('')
      setTagDraftColor('#3B82F6')
      setTagModalError(null)
      setTagDraftEditingId(null)
    } catch (error) {
      setTagModalError(error instanceof Error ? error.message : 'Could not save this tag.')
    }
  }

  async function handleUpdateTag() {
    if (tagDraftEditingId === null) return
    const trimmedName = tagDraftName.trim()
    if (!trimmedName) {
      setTagModalError('Tag name is required')
      return
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(tagDraftColor)) {
      setTagModalError('Color must be a valid hex code')
      return
    }

    try {
      const response = await fetch(`/api/tags/${tagDraftEditingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, color: tagDraftColor }),
      })
      const parsed = await readResponse<Tag>(response)
      setAvailableTags((current) => current.map((tag) => tag.id === parsed.id ? parsed : tag))
      setTodos((current) => current.map((todo) => ({
        ...todo,
        tags: todo.tags?.map((tag) => tag.id === parsed.id ? parsed : tag),
      })))
      setTagDraftName('')
      setTagDraftColor('#3B82F6')
      setTagDraftEditingId(null)
      setTagModalError(null)
    } catch (error) {
      setTagModalError(error instanceof Error ? error.message : 'Could not update this tag.')
    }
  }

  async function handleDeleteTag(tagId: number) {
    try {
      const response = await fetch(`/api/tags/${tagId}`, { method: 'DELETE' })
      await readResponse<{ success: boolean }>(response)
      setAvailableTags((current) => current.filter((tag) => tag.id !== tagId))
      setFilters((current) => current.tagId === tagId ? { ...current, tagId: 'all' } : current)
      setForm((current) => ({ ...current, tag_ids: current.tag_ids.filter((id) => id !== tagId) }))
      setTodos((current) => current.map((todo) => ({
        ...todo,
        tags: todo.tags?.filter((tag) => tag.id !== tagId),
      })))
      if (tagDraftEditingId === tagId) {
        setTagDraftEditingId(null)
        setTagDraftName('')
        setTagDraftColor('#3B82F6')
      }
    } catch (error) {
      setTagModalError(error instanceof Error ? error.message : 'Could not delete this tag.')
    }
  }

  function openTemplateEditor(todo?: Todo) {
    const source = todo ?? {
      ...form,
      reminder_minutes: form.reminder_minutes ? Number(form.reminder_minutes) : null,
      subtasks: editingTodo ? todos.find((item) => item.id === editingTodo.id)?.subtasks ?? [] : [],
    }
    const parsedDate = parseDueDate(source.due_date)
    const minutes = parsedDate.valid && parsedDate.value
      ? Math.ceil((Date.parse(parsedDate.value) - getSingaporeNow().getTime()) / 60_000)
      : 0
    const subtasks = source.subtasks?.map(({ title, position }) => ({ title, position })) ?? []
    setTemplateEditor({
      id: null, name: '', description: '', category: '',
      title_template: source.title,
      priority: source.priority,
      is_recurring: source.is_recurring,
      recurrence_pattern: source.recurrence_pattern ?? 'daily',
      reminder_minutes: source.reminder_minutes?.toString() ?? '',
      offset: minutes >= 1 ? String(minutes) : '',
      subtasks,
      checklist: subtasks.map(({ title }) => title).join('\n'),
    })
    setTemplateError(null)
    setTemplateDialog('save')
  }

  function editTemplate(template: Template) {
    const subtasks = parseTemplateSubtasks(template.subtasks_json)
    setTemplateEditor({
      id: template.id, name: template.name,
      description: template.description ?? '', category: template.category ?? '',
      title_template: template.title_template, priority: template.priority,
      is_recurring: template.is_recurring, recurrence_pattern: template.recurrence_pattern ?? 'daily',
      reminder_minutes: template.reminder_minutes?.toString() ?? '',
      offset: template.due_date_offset_minutes?.toString() ?? '',
      subtasks, checklist: subtasks.map(({ title }) => title).join('\n'),
    })
    setTemplateError(null)
    setTemplateDialog('save')
  }

  function closeTemplateDialog() {
    if (templateActionRef.current) return
    setTemplateDialog(null)
    setTemplateError(null)
  }

  async function saveTemplate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!templateEditor || templateActionRef.current) return
    setTemplateError(null)
    const draft = templateEditor
    const offset = draft.offset.trim() ? Number(draft.offset) : null
    if (!draft.name.trim() || !draft.title_template.trim()) {
      setTemplateError('Name and title are required')
      return
    }
    if (offset !== null && (!Number.isSafeInteger(offset) || offset < 1)) {
      setTemplateError('Due-date offset must be a positive whole number of minutes')
      return
    }
    if ((draft.is_recurring || draft.reminder_minutes) && offset === null) {
      setTemplateError('Recurring templates and reminders require a due-date offset')
      return
    }
    const subtasks = draft.checklist === draft.subtasks.map(({ title }) => title).join('\n')
      ? draft.subtasks
      : draft.checklist.split('\n').map((title) => title.trim()).filter(Boolean).map((title, position) => ({ title, position }))
    templateActionRef.current = true
    setTemplateBusy(true)
    try {
      const saved = await readResponse<Template>(await fetch(draft.id === null ? '/api/templates' : `/api/templates/${draft.id}`, {
        method: draft.id === null ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: draft.name.trim(), description: draft.description.trim() || null,
          category: draft.category.trim() || null,
          title_template: draft.title_template.trim(), priority: draft.priority,
          is_recurring: draft.is_recurring,
          recurrence_pattern: draft.is_recurring ? draft.recurrence_pattern : null,
          reminder_minutes: draft.reminder_minutes ? Number(draft.reminder_minutes) : null,
          due_date_offset_minutes: offset, subtasks,
        }),
      }))
      setTemplates((current) => draft.id === null ? [...current, saved] : current.map((item) => item.id === saved.id ? saved : item))
      setTemplateCategory('')
      setTemplateDialog(draft.id === null ? null : 'manage')
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not save this template.')
    } finally {
      templateActionRef.current = false
      setTemplateBusy(false)
    }
  }

  async function applyTemplate(id: number) {
    if (templateActionRef.current) return
    templateActionRef.current = true
    setTemplateBusy(true)
    setTemplateError(null)
    try {
      const created = await readResponse<Todo>(await fetch(`/api/templates/${id}/use`, { method: 'POST' }))
      setTodos((current) => [...current, created])
      setTemplateDialog(null)
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not use this template.')
    } finally {
      templateActionRef.current = false
      setTemplateBusy(false)
    }
  }

  async function deleteTemplate(template: Template) {
    if (templateActionRef.current || !window.confirm(`Delete template "${template.name}"? Existing todos will not change.`)) return
    templateActionRef.current = true
    setTemplateBusy(true)
    setTemplateError(null)
    try {
      await readResponse<{ success: boolean }>(await fetch(`/api/templates/${template.id}`, { method: 'DELETE' }))
      setTemplates((current) => current.filter((item) => item.id !== template.id))
    } catch (error) {
      setTemplateError(error instanceof Error ? error.message : 'Could not delete this template.')
    } finally {
      templateActionRef.current = false
      setTemplateBusy(false)
    }
  }

  function containTemplateFocus(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      closeTemplateDialog()
    }
    if (event.key !== 'Tab') return
    const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled)',
    )
    const first = focusable.item(0)
    const last = focusable.item(focusable.length - 1)
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
          <button className="quiet-button" type="button" onClick={() => setTagModalOpen(true)}>Manage tags</button>
          {editingTodo && <button className="quiet-button" type="button" onClick={cancelEditing}>Cancel</button>}
        </div>
        {!editingTodo && <label className="todo-field template-quick-use">
          <span>Use Template</span>
          <select
            disabled={templatesLoading || templateBusy || loading || loadFailed || templates.length === 0}
            onChange={(event) => { if (event.target.value) void applyTemplate(Number(event.target.value)) }}
            value=""
          >
            <option value="">{templatesLoading ? 'Loading templates...' : 'Choose a template'}</option>
            {templates.map((template) => <option key={template.id} value={template.id}>
              {template.name}{template.category ? ` (${template.category})` : ''}
            </option>)}
          </select>
        </label>}
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
                is_recurring: event.target.value ? current.is_recurring : false,
              }))}
              type="datetime-local"
              value={form.due_date}
            />
          </label>
          <label className="todo-field">
            <span>Priority</span>
            <select aria-label="Priority" onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value as Priority }))} value={form.priority}>
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
              <option value="">None</option>
              {REMINDER_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
            </select>
          </label>
        </div>
        <div className="tag-picker-wrap">
          <div className="tag-picker-header">
            <span>Tags</span>
            <button className="quiet-button compact-button" type="button" onClick={() => setTagModalOpen(true)}>Manage tags</button>
          </div>
          <div className="tag-picker">
            {availableTags.length === 0 ? (
              <span className="tag-empty-text">No tags yet.</span>
            ) : (
              availableTags.map((tag) => {
                const selected = form.tag_ids.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    className={selected ? 'tag-pill selected-tag' : 'tag-pill'}
                    onClick={() => setForm((current) => ({
                      ...current,
                      tag_ids: current.tag_ids.includes(tag.id)
                        ? current.tag_ids.filter((id) => id !== tag.id)
                        : [...current.tag_ids, tag.id],
                    }))}
                    style={{
                      backgroundColor: selected ? tag.color : undefined,
                      borderColor: tag.color,
                      color: selected ? getTagForegroundColor(tag.color) : undefined,
                    }}
                    type="button"
                  >
                    {selected && <span aria-hidden>✓</span>}
                    <span>{tag.name}</span>
                  </button>
                )
              })
            )}
          </div>
        </div>
        <div className="todo-form-footer">
          <label className="recurring-control">
            <input
              checked={form.is_recurring}
              disabled={!form.due_date}
              onChange={(event) => setForm((current) => ({ ...current, is_recurring: event.target.checked }))}
              type="checkbox"
            />
            <span>Repeat this todo</span>
          </label>
          {!form.due_date && <span className="recurrence-hint">Set a due date to enable repeat</span>}
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
        {form.title.trim() && <button className="quiet-button template-save-trigger" disabled={saving || templatesLoading} onClick={() => openTemplateEditor()} type="button">Save as Template</button>}
        {formError && <p className="todo-error" role="alert">{formError}</p>}
      </form>
    )
  }

  function renderSection(title: string, items: Todo[], className: string) {
    if (items.length === 0) return null
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
                    <span aria-label={`${todo.priority} priority`} className={`priority-badge priority-badge-${todo.priority}`}>
                      {todo.priority[0].toUpperCase() + todo.priority.slice(1)}
                    </span>
                    {todo.due_date && <span>{formatSingaporeDate(todo.due_date)}</span>}
                    {todo.is_recurring && todo.recurrence_pattern && <span className="recurrence-badge" aria-label={`Repeats ${todo.recurrence_pattern}`}>
                      &#128260; {todo.recurrence_pattern}
                    </span>}
                    {todo.reminder_minutes !== null && <span className="reminder-badge" aria-label={`Reminder ${reminderLabel(todo.reminder_minutes)}`}>
                      &#128276; {reminderLabel(todo.reminder_minutes)}
                    </span>}
                    {todo.tags?.map((tag) => (
                      <span
                        className="todo-tag"
                        key={tag.id}
                        style={{ backgroundColor: tag.color, borderColor: tag.color, color: getTagForegroundColor(tag.color) }}
                      >
                        {tag.name}
                      </span>
                    ))}
                  </div>
                  {(() => {
                    const subtasks = todo.subtasks ?? []
                    const progress = calculateProgress(subtasks)
                    const expanded = expandedSubtaskTodoIds.includes(todo.id)
                    const addPending = pendingSubtaskKeys.includes(`todo:${todo.id}`)
                    return (
                      <div className="todo-subtasks">
                        <button
                          aria-controls={`subtasks-${todo.id}`}
                          aria-expanded={expanded}
                          className="subtask-toggle"
                          onClick={() => setExpandedSubtaskTodoIds((current) => expanded
                            ? current.filter((id) => id !== todo.id)
                            : [...current, todo.id])}
                          type="button"
                        >
                          {expanded ? 'Hide' : 'Show'} subtasks
                        </button>
                        {progress.total > 0 && (
                          <div className="subtask-progress">
                            <div className="subtask-progress-label">
                              <span>{progress.completed}/{progress.total} subtasks</span>
                              <span>{progress.percent}%</span>
                            </div>
                            <div
                              aria-label="Subtask completion"
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={progress.percent}
                              aria-valuetext={`${progress.completed} of ${progress.total} subtasks complete`}
                              className={`subtask-progress-track${progress.percent === 100 ? ' complete' : ''}`}
                              role="progressbar"
                            >
                              <div className="subtask-progress-fill" style={{ width: `${progress.percent}%` }} />
                            </div>
                          </div>
                        )}
                        <div className="subtask-panel" hidden={!expanded} id={`subtasks-${todo.id}`}>
                          <ul className="subtask-list">
                            {subtasks.map((subtask) => {
                              const subtaskPending = pendingSubtaskKeys.includes(`subtask:${subtask.id}`)
                              return (
                                <li className="subtask-row" key={subtask.id}>
                                  <input
                                    aria-label={`Mark subtask ${subtask.title} ${subtask.completed ? 'incomplete' : 'complete'}`}
                                    checked={subtask.completed}
                                    disabled={subtaskPending}
                                    onChange={() => void toggleSubtask(todo.id, subtask)}
                                    type="checkbox"
                                  />
                                  <span className={subtask.completed ? 'subtask-title is-complete' : 'subtask-title'}>{subtask.title}</span>
                                  <button
                                    aria-label={`Delete subtask ${subtask.title}`}
                                    className="subtask-delete-button"
                                    disabled={subtaskPending}
                                    onClick={() => void removeSubtask(todo.id, subtask)}
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                </li>
                              )
                            })}
                          </ul>
                          <form
                            className="subtask-add-form"
                            onSubmit={(event) => { event.preventDefault(); void addSubtask(todo) }}
                          >
                            <input
                              aria-label={`Subtask title for ${todo.title}`}
                              autoComplete="off"
                              disabled={addPending}
                              onChange={(event) => setSubtaskDrafts((current) => ({ ...current, [todo.id]: event.target.value }))}
                              placeholder="Add a subtask"
                              value={subtaskDrafts[todo.id] ?? ''}
                            />
                            <button disabled={addPending || !(subtaskDrafts[todo.id] ?? '').trim()} type="submit">
                              Add subtask
                            </button>
                          </form>
                        </div>
                      </div>
                    )
                  })()}
                </div>
                <div className="todo-actions">
                  <button disabled={pendingTodoIds.includes(todo.id)} type="button" onClick={() => startEditing(todo)}>Edit</button>
                  <button aria-label={`Save ${todo.title} as template`} disabled={templatesLoading || todo.id < 1 || pendingTodoIds.includes(todo.id)} type="button" onClick={() => openTemplateEditor(todo)}>Save as Template</button>
                  <button className="delete-action" disabled={pendingTodoIds.includes(todo.id)} type="button" onClick={() => void removeTodo(todo)}>Delete</button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="section-empty">Nothing here.</p>}
      </section>
    )
  }

  function renderTagModal() {
    if (!tagModalOpen) return null

    return (
      <div className="todo-dialog-backdrop" onClick={(event) => {
        if (event.target === event.currentTarget) {
          setTagModalOpen(false)
          setTagDraftEditingId(null)
          setTagDraftName('')
          setTagDraftColor('#3B82F6')
          setTagModalError(null)
        }
      }}>
        <section aria-modal="true" className="tag-modal" role="dialog">
          <div className="todo-dialog-heading">
            <h2>Manage tags</h2>
            <button aria-label="Close tags dialog" className="dialog-close" onClick={() => {
              setTagModalOpen(false)
              setTagDraftEditingId(null)
              setTagDraftName('')
              setTagDraftColor('#3B82F6')
              setTagModalError(null)
            }} type="button">×</button>
          </div>

          <div className="tag-list">
            {availableTags.length === 0 ? (
              <p className="tag-empty-text">No tags yet. Add one below.</p>
            ) : (
              availableTags.map((tag) => (
                <div className="tag-row" key={tag.id}>
                  <span className="tag-pill inline-tag" style={{ backgroundColor: tag.color, color: getTagForegroundColor(tag.color), borderColor: tag.color }}>
                    <span className="tag-label">{tag.name}</span>
                  </span>
                  <div className="tag-actions">
                    <button type="button" onClick={() => {
                      setTagDraftEditingId(tag.id)
                      setTagDraftName(tag.name)
                      setTagDraftColor(tag.color)
                      setTagModalError(null)
                    }}>Edit</button>
                    <button className="delete-action" type="button" onClick={() => void handleDeleteTag(tag.id)}>Delete</button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="tag-form">
            <input
              onChange={(event) => setTagDraftName(event.target.value)}
              placeholder="Tag name"
              type="text"
              value={tagDraftName}
            />
            <input
              onChange={(event) => setTagDraftColor(event.target.value)}
              type="color"
              value={tagDraftColor}
            />
            <button className="primary-button" onClick={() => void (tagDraftEditingId === null ? handleCreateTag() : handleUpdateTag())} type="button">
              {tagDraftEditingId === null ? 'Create tag' : 'Update tag'}
            </button>
          </div>
          {tagDraftEditingId !== null && (
            <button className="quiet-button full-width-button" onClick={() => {
              setTagDraftEditingId(null)
              setTagDraftName('')
              setTagDraftColor('#3B82F6')
              setTagModalError(null)
            }} type="button">Cancel edit</button>
          )}
          {tagModalError && <p className="todo-error" role="alert">{tagModalError}</p>}
        </section>
      </div>
    )
  }

  function renderTemplateDialog() {
    if (!templateDialog) return null
    const editing = templateDialog === 'save' ? templateEditor : null
    const title = templateDialog === 'manage' ? 'Templates' : editing?.id ? 'Edit Template' : 'Save as Template'
    const categories = [...new Set(templates.map((template) => template.category).filter((value): value is string => Boolean(value)))].sort()
    const filtered = templates.filter((template) => !templateCategory || template.category === templateCategory)
    const updateEditor = (fields: Partial<TemplateEditor>) => setTemplateEditor((current) => current ? { ...current, ...fields } : current)
    return (
      <div className="todo-dialog-backdrop template-dialog-backdrop" onClick={(event) => {
        if (event.target === event.currentTarget) closeTemplateDialog()
      }}>
        <section
          ref={templateDialogRef}
          aria-labelledby="template-dialog-title"
          aria-modal="true"
          className="template-dialog"
          onKeyDown={containTemplateFocus}
          role="dialog"
          tabIndex={-1}
        >
          <div className="todo-dialog-heading">
            <h2 id="template-dialog-title">{title}</h2>
            <button aria-label="Close templates dialog" className="dialog-close" disabled={templateBusy} onClick={closeTemplateDialog} type="button">&times;</button>
          </div>
          {templateError && <p className="todo-error" role="alert">{templateError}</p>}
          {editing ? (
            <form className="template-editor" onSubmit={(event) => void saveTemplate(event)}>
              <fieldset disabled={templateBusy}>
                <label className="todo-field">
                  <span>Template name</span>
                  <input autoComplete="off" onChange={(event) => updateEditor({ name: event.target.value })} required value={editing.name} />
                </label>
                <label className="todo-field">
                  <span>Description</span>
                  <textarea onChange={(event) => updateEditor({ description: event.target.value })} value={editing.description} />
                </label>
                <label className="todo-field">
                  <span>Category</span>
                  <input list="template-category-suggestions" onChange={(event) => updateEditor({ category: event.target.value })} value={editing.category} />
                </label>
                <datalist id="template-category-suggestions">
                  {['Work', 'Personal', 'Finance', 'Health', 'Education'].map((category) => <option key={category} value={category} />)}
                </datalist>
                <label className="todo-field">
                  <span>Template title</span>
                  <input onChange={(event) => updateEditor({ title_template: event.target.value })} required value={editing.title_template} />
                </label>
                <label className="todo-field">
                  <span>Template priority</span>
                  <select onChange={(event) => updateEditor({ priority: event.target.value as Priority })} value={editing.priority}>
                    <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
                  </select>
                </label>
                <label className="todo-field">
                  <span>Due-date offset (minutes)</span>
                  <input
                    min="1" step="1" type="number"
                    onChange={(event) => updateEditor({ offset: event.target.value })}
                    required={editing.is_recurring || Boolean(editing.reminder_minutes)}
                    value={editing.offset}
                  />
                </label>
                <p className="workspace-note">Applied from the time you use the template, in Singapore time. Leave blank for no due date. Recurrence and reminders require an offset.</p>
                <label className="recurring-control">
                  <input checked={editing.is_recurring} onChange={(event) => updateEditor({ is_recurring: event.target.checked })} type="checkbox" />
                  <span>Repeat template</span>
                </label>
                {editing.is_recurring && <label className="todo-field">
                  <span>Template recurrence pattern</span>
                  <select onChange={(event) => updateEditor({ recurrence_pattern: event.target.value as RecurrencePattern })} value={editing.recurrence_pattern}>
                    <option value="daily">Daily</option><option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option><option value="yearly">Yearly</option>
                  </select>
                </label>}
                <label className="todo-field">
                  <span>Template reminder</span>
                  <select onChange={(event) => updateEditor({ reminder_minutes: event.target.value })} value={editing.reminder_minutes}>
                    <option value="">None</option>
                    {REMINDER_OPTIONS.map((option) => <option key={option.minutes} value={option.minutes}>{option.label}</option>)}
                  </select>
                </label>
                <label className="todo-field">
                  <span>Template subtasks (one per line)</span>
                  <textarea onChange={(event) => updateEditor({ checklist: event.target.value })} rows={5} value={editing.checklist} />
                </label>
                <p className="workspace-note">Checklist items are copied unchecked. Tags and concrete due dates are not saved.</p>
                <button className="primary-button" disabled={!editing.name.trim() || !editing.title_template.trim()} type="submit">
                  {templateBusy ? 'Saving...' : 'Save Template'}
                </button>
              </fieldset>
            </form>
          ) : (
            <>
              {templatesLoading && <p role="status">Loading templates...</p>}
              {templateLoadError && <p className="todo-error" role="alert">{templateLoadError}</p>}
              {templateLoadError && <button className="quiet-button" disabled={templatesLoading} onClick={() => setTemplateLoadAttempt((current) => current + 1)} type="button">Retry loading templates</button>}
              <label className="todo-field template-category-filter">
                <span>Filter templates by category</span>
                <select onChange={(event) => setTemplateCategory(event.target.value)} value={templateCategory}>
                  <option value="">All categories</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <div className="template-list">
                {!templatesLoading && !templateLoadError && filtered.length === 0 && <p className="workspace-note">No templates yet in this category. Save a task pattern to get started.</p>}
                {filtered.map((template) => {
                  const subtasks = parseTemplateSubtasks(template.subtasks_json)
                  return (
                    <article aria-label={template.name} className="template-card" key={template.id}>
                      <div className="template-card-title">
                        <strong>{template.name}</strong>
                        {template.category && <span className="template-category-badge">{template.category}</span>}
                      </div>
                      {template.description && <p className="template-description">{template.description}</p>}
                      <p className="template-description">{template.title_template}</p>
                      <div className="todo-metadata">
                        <span className={`priority-badge priority-badge-${template.priority}`}>{template.priority}</span>
                        {template.is_recurring && <span className="recurrence-badge">&#128260; {template.recurrence_pattern}</span>}
                        {template.reminder_minutes != null && <span aria-label={`Reminder ${reminderLabel(template.reminder_minutes)}`} className="reminder-badge">&#128276; {reminderLabel(template.reminder_minutes)}</span>}
                      </div>
                      <p className="workspace-note">{template.due_date_offset_minutes === null ? 'No due date' : `Due ${template.due_date_offset_minutes} minutes after use`}</p>
                      {subtasks.length > 0 && <ul aria-label="Template checklist" className="template-checklist">
                        {subtasks.map((subtask, index) => <li key={index}>{subtask.title}</li>)}
                      </ul>}
                      <div className="template-actions">
                        <button className="primary-button" disabled={templateBusy || loading || loadFailed} onClick={() => void applyTemplate(template.id)} type="button">Use</button>
                        <button className="quiet-button" disabled={templateBusy} onClick={() => editTemplate(template)} type="button">Edit</button>
                        <button className="quiet-button delete-action" disabled={templateBusy} onClick={() => void deleteTemplate(template)} type="button">Delete</button>
                      </div>
                    </article>
                  )
                })}
              </div>
            </>
          )}
        </section>
      </div>
    )
  }

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <Link className="wordmark" href="/">Daymark</Link>
        <nav className="workspace-nav" aria-label="Workspace">
          <button className="quiet-button" onClick={() => { setTemplateError(null); setTemplateCategory(''); setTemplateDialog('manage') }} type="button">Templates</button>
          <button className={`quiet-button notification-toggle ${notifications.permission === 'granted' ? 'notification-enabled' : ''}`}
            disabled={!notifications.supported || notifications.permission !== 'default'}
            onClick={() => void notifications.requestPermission()} type="button">
            {notifications.permission === 'granted' ? 'Notifications On'
              : notifications.permission === 'denied' ? 'Notifications blocked' : 'Enable Notifications'}
          </button>
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
        <p className="workspace-note">All dates use Singapore time. Keep this app open for browser reminders; overdue reminders are delivered when you return.</p>
        {!notifications.supported && !loading && <p className="workspace-note">Desktop notifications are unavailable in this browser.</p>}
        {notifications.permission === 'denied' && <p className="workspace-note">Allow notifications in browser site settings, then reload this page.</p>}
        {notifications.error && <p className="todo-page-error" role="alert">{notifications.error}</p>}
        {!templateDialog && templateError && <p className="todo-page-error" role="alert">{templateError}</p>}
        {templateLoadError && !templateDialog && <p className="todo-page-error" role="alert">
          {templateLoadError} <button className="quiet-button" disabled={templatesLoading} onClick={() => setTemplateLoadAttempt((current) => current + 1)} type="button">Retry loading templates</button>
        </p>}

        {!editingTodo && renderTodoForm()}
        <div className="todo-list-heading">
          <h2>Your tasks</h2>
          <div className="todo-list-controls">
            <span>{new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit' }).format(now)} SGT</span>
            <div className="export-import-toolbar" aria-label="Export and import todos">
              <button className="secondary-button export-action" onClick={() => downloadTodos('json')} type="button">Export JSON</button>
              <button className="secondary-button export-action" onClick={() => downloadTodos('csv')} type="button">Export CSV</button>
              <button className="primary-button import-action" disabled={importing} onClick={() => importFileRef.current?.click()} type="button">
                {importing ? 'Importing...' : 'Import'}
              </button>
              <input
                accept="application/json,.json"
                aria-label="Choose JSON backup to import"
                className="import-file-input"
                onChange={(event) => void importTodos(event)}
                ref={importFileRef}
                type="file"
              />
            </div>
          </div>
        </div>
        <p className="import-guidance">Import creates new todos and does not merge with existing ones.</p>
        {importMessage && (
          <p
            className={`import-message import-message-${importMessage.type}`}
            role={importMessage.type === 'error' ? 'alert' : 'status'}
          >
            {importMessage.text}
          </p>
        )}
        <section aria-label="Search and filter todos" className="filter-toolbar">
          <div className="filter-search">
            <label className="todo-field">
              <span>Search todos and subtasks</span>
              <span aria-hidden="true" className="filter-search-icon">&#128269;</span>
              <input
                onChange={(event) => {
                  const search = event.target.value
                  setFilters((current) => ({ ...current, search }))
                  if (!search) flushSearch('')
                }}
                placeholder="Search todos and subtasks..."
                type="search"
                value={filters.search}
              />
            </label>
            {filters.search && <button aria-label="Clear search" className="filter-search-clear" onClick={() => {
              setFilters((current) => ({ ...current, search: '' }))
              flushSearch('')
            }} type="button">&times;</button>}
          </div>
          <div className="filter-quick-controls">
            <label className="todo-field">
              <span>Filter by priority</span>
              <select value={filters.priority} onChange={(event) => setFilters((current) => ({
                ...current, priority: event.target.value as FilterState['priority'],
              }))}>
                <option value="all">All priorities</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            {availableTags.length > 0 && <label className="todo-field">
              <span>Filter by tag</span>
              <select value={selectedTagId} onChange={(event) => setFilters((current) => ({
                ...current, tagId: event.target.value === 'all' ? 'all' : Number(event.target.value),
              }))}>
                <option value="all">All tags</option>
                {availableTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>}
            <button aria-controls="advanced-filters" aria-expanded={advancedExpanded}
              className={`quiet-button filter-advanced-toggle${advancedExpanded ? ' is-expanded' : ''}`}
              onClick={() => setAdvancedExpanded((expanded) => !expanded)} type="button">
              {advancedExpanded ? '\u25bc' : '\u25b6'} Advanced
            </button>
            {filtersActive && <div className="filter-actions">
              <button className="quiet-button filter-clear-all" onClick={() => replaceFilters(DEFAULT_FILTER_STATE)} type="button">Clear All</button>
              <button className="quiet-button filter-save" onClick={() => {
                setPresetName('')
                setPresetError(null)
                presetDialogRef.current?.showModal()
              }} type="button"><span aria-hidden="true">&#128190; </span>Save Filter</button>
            </div>}
          </div>
          <div hidden={!advancedExpanded} id="advanced-filters">
            <div className="filter-advanced-controls">
              <label className="todo-field">
                <span>Completion status</span>
                <select value={filters.completion} onChange={(event) => setFilters((current) => ({
                  ...current, completion: event.target.value as FilterState['completion'],
                }))}>
                  <option value="all">All Todos</option>
                  <option value="incomplete">Incomplete Only</option>
                  <option value="completed">Completed Only</option>
                </select>
              </label>
              <label className="todo-field">
                <span>Due Date From</span>
                <input type="date" value={filters.dueDateFrom ?? ''} onChange={(event) => setFilters((current) => ({
                  ...current, dueDateFrom: event.target.value || null,
                }))} />
              </label>
              <label className="todo-field">
                <span>Due Date To</span>
                <input type="date" value={filters.dueDateTo ?? ''} onChange={(event) => setFilters((current) => ({
                  ...current, dueDateTo: event.target.value || null,
                }))} />
              </label>
            </div>
            {filters.dueDateFrom && filters.dueDateTo && filters.dueDateFrom > filters.dueDateTo
              && <p className="todo-error">From date is after To date</p>}
            {presets.length > 0 && <div className="filter-presets" aria-label="Saved filter presets">
              <h3>Saved Filter Presets</h3>
              {presets.map((preset) => <span className="filter-preset" key={preset.id}>
                <button onClick={() => applyPreset(preset)} type="button">{preset.name}</button>
                <button aria-label={`Delete preset ${preset.name}`} onClick={() => handleDeletePreset(preset)} type="button">&times;</button>
              </span>)}
            </div>}
          </div>
          {filterNotice && <p role="status" className="workspace-note">{filterNotice}</p>}
        </section>
        {pageError && <p className="todo-page-error" role="alert">{pageError}</p>}
        {loadFailed && <button className="quiet-button retry-load-button" onClick={retryWorkspaceLoad} type="button">Retry loading tasks</button>}
        {loading ? <p className="loading-state" role="status">Loading your tasks...</p> : !loadFailed && (
          <div className="todo-sections">
            {todos.length === 0 ? <p className="section-empty">You have no todos yet</p>
              : filteredTodos.length === 0 && <p className="section-empty">No todos match your filters</p>}
            {renderSection('Overdue', sections.overdue, 'overdue-section')}
            {renderSection('Pending', sections.pending, 'pending-section')}
            {renderSection('Completed', sections.completed, 'completed-section')}
          </div>
        )}
      </div>

      <dialog aria-labelledby="preset-dialog-title" className="todo-edit-dialog filter-preset-dialog"
        ref={presetDialogRef} onClose={() => setPresetError(null)}>
        <form onSubmit={handleSavePreset}>
          <div className="todo-dialog-heading">
            <h2 id="preset-dialog-title">Save filter preset</h2>
            <button aria-label="Close preset dialog" className="dialog-close"
              onClick={() => presetDialogRef.current?.close()} type="button">&times;</button>
          </div>
          <p className="filter-preview">{filterPreview}</p>
          <label className="todo-field">
            <span>Preset name</span>
            <input autoFocus required value={presetName} onChange={(event) => setPresetName(event.target.value)} />
          </label>
          {presetError && <p className="todo-error" role="alert">{presetError}</p>}
          <div className="filter-dialog-actions">
            <button className="quiet-button" onClick={() => presetDialogRef.current?.close()} type="button">Cancel</button>
            <button className="primary-button" type="submit">Save</button>
          </div>
        </form>
      </dialog>

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
      {renderTagModal()}
      {renderTemplateDialog()}
    </main>
  )
}
