'use client'

import { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { generateCalendarGrid, getSingaporeDateKey } from '@/lib/calendar'
import { getSingaporeNow, toSingaporeParts } from '@/lib/timezone'
import type { Holiday, Todo } from '@/lib/db'
import { LogoutButton } from '../LogoutButton'

const MAX_VISIBLE_TODOS = 3
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parseMonthParam(raw: string | null): { year: number; month: number } {
  const now = toSingaporeParts(getSingaporeNow())
  if (raw && /^(\d{4})-(\d{2})$/.test(raw)) {
    const [year, month] = raw.split('-').map(Number)
    if (year >= 1 && month >= 1 && month <= 12) return { year, month }
  }
  return { year: now.year, month: now.month }
}

function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-SG', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
}

function formatCalendarDate(date: string): string {
  return new Intl.DateTimeFormat('en-SG', { dateStyle: 'full', timeZone: 'UTC' })
    .format(new Date(`${date}T12:00:00Z`))
}

function CalendarContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { year, month } = parseMonthParam(searchParams.get('month'))
  const monthKey = `${year}-${month}`
  const [calendarData, setCalendarData] = useState<{
    monthKey: string
    todos: Todo[]
    holidays: Holiday[]
    error: string
  }>({ monthKey: '', todos: [], holidays: [], error: '' })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const loading = calendarData.monthKey !== monthKey
  const error = loading ? '' : calendarData.error
  const todos = loading ? [] : calendarData.todos
  const holidays = loading ? [] : calendarData.holidays

  useEffect(() => {
    const controller = new AbortController()

    async function loadCalendar() {
      try {
        const [todoResponse, holidayResponse] = await Promise.all([
          fetch('/api/todos', { signal: controller.signal }),
          fetch(`/api/holidays?year=${year}&month=${month}`, { signal: controller.signal }),
        ])
        if (!todoResponse.ok || !holidayResponse.ok) throw new Error('Unable to load calendar data')

        const [todoData, holidayData] = await Promise.all([todoResponse.json(), holidayResponse.json()])
        if (controller.signal.aborted) return
        setCalendarData({
          monthKey,
          todos: Array.isArray(todoData) ? todoData : [],
          holidays: Array.isArray(holidayData.holidays) ? holidayData.holidays : [],
          error: '',
        })
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setCalendarData({
            monthKey,
            todos: [],
            holidays: [],
            error: loadError instanceof Error ? loadError.message : 'Unable to load calendar data',
          })
        }
      }
    }

    void loadCalendar()
    return () => controller.abort()
  }, [monthKey, month, year])

  function navigate(nextYear: number, nextMonth: number) {
    router.replace(`/calendar?month=${nextYear}-${String(nextMonth).padStart(2, '0')}`, { scroll: false })
  }

  function moveMonth(offset: number) {
    const next = new Date(Date.UTC(year, month - 1 + offset, 1))
    navigate(next.getUTCFullYear(), next.getUTCMonth() + 1)
  }

  const days = generateCalendarGrid(year, month)
  const todosByDate = new Map<string, Todo[]>()
  for (const todo of todos) {
    if (!todo.due_date) continue
    const date = getSingaporeDateKey(todo.due_date)
    const dayTodos = todosByDate.get(date) ?? []
    dayTodos.push(todo)
    todosByDate.set(date, dayTodos)
  }
  const holidaysByDate = new Map(holidays.map((holiday) => [holiday.date, holiday]))
  const selectedTodos = selectedDate ? todosByDate.get(selectedDate) ?? [] : []

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <Link className="wordmark" href="/">Daymark</Link>
        <nav className="workspace-nav" aria-label="Workspace">
          <Link className="text-link" href="/">List</Link>
          <LogoutButton />
        </nav>
      </header>
      <section className="calendar-workspace" aria-labelledby="calendar-title">
        <div className="calendar-intro">
          <p className="eyebrow">Personal workspace</p>
          <h1 id="calendar-title">Calendar</h1>
        </div>
        <nav className="calendar-toolbar" aria-label="Calendar navigation">
          <div className="calendar-month-controls">
            <button className="quiet-button" type="button" aria-label="Previous month" onClick={() => moveMonth(-1)}>Previous</button>
            <button className="quiet-button" type="button" onClick={() => {
              const now = toSingaporeParts(getSingaporeNow())
              navigate(now.year, now.month)
            }}>Today</button>
            <button className="quiet-button" type="button" aria-label="Next month" onClick={() => moveMonth(1)}>Next</button>
          </div>
          <h2 className="calendar-month-title" aria-live="polite">{formatMonth(year, month)}</h2>
        </nav>
        {error && <p className="todo-page-error" role="alert">{error}</p>}
        {loading && <p className="loading-state" role="status">Loading calendar…</p>}
        <div className="calendar-scroll" aria-busy={loading}>
          <div className="calendar-grid" role="grid" aria-label={formatMonth(year, month)}>
            {WEEKDAYS.map((weekday) => (
              <div className="calendar-weekday" role="columnheader" key={weekday}>{weekday}</div>
            ))}
            {days.map((day) => {
              const dayTodos = todosByDate.get(day.date) ?? []
              const holiday = holidaysByDate.get(day.date)
              const visibleTodos = dayTodos.slice(0, MAX_VISIBLE_TODOS)
              const overflow = dayTodos.length - visibleTodos.length
              const classes = [
                'calendar-cell',
                day.isCurrentMonth ? '' : 'calendar-cell-outside',
                day.isToday ? 'calendar-cell-today' : '',
                day.isPast && day.isCurrentMonth ? 'calendar-cell-past' : '',
                day.isWeekend ? 'calendar-cell-weekend' : '',
              ].filter(Boolean).join(' ')

              return (
                <button
                  className={classes}
                  type="button"
                  role="gridcell"
                  key={day.date}
                  aria-label={`${formatCalendarDate(day.date)}${holiday ? `, ${holiday.name}` : ''}, ${dayTodos.length} tasks`}
                  onClick={() => setSelectedDate(day.date)}
                >
                  <span className="calendar-cell-date">{day.date.slice(-2).replace(/^0/, '')}</span>
                  {holiday && <span className="calendar-holiday">{holiday.name}</span>}
                  <span className="calendar-todos">
                    {visibleTodos.map((todo) => (
                      <span className={`calendar-todo calendar-todo-${todo.priority}${todo.completed ? ' is-complete' : ''}`} key={todo.id}>
                        {todo.title}
                      </span>
                    ))}
                  </span>
                  {overflow > 0 && <span className="calendar-overflow">+{overflow} more</span>}
                </button>
              )
            })}
          </div>
        </div>
      </section>
      {selectedDate && (
        <DayTodosModal
          date={selectedDate}
          todos={selectedTodos}
          holiday={holidaysByDate.get(selectedDate) ?? null}
          onClose={() => setSelectedDate(null)}
        />
      )}
    </main>
  )
}

function DayTodosModal({
  date,
  todos,
  holiday,
  onClose,
}: {
  date: string
  todos: Todo[]
  holiday: Holiday | null
  onClose: () => void
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="calendar-dialog-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section className="calendar-dialog" role="dialog" aria-modal="true" aria-labelledby="calendar-dialog-title">
        <div className="todo-dialog-heading">
          <h2 id="calendar-dialog-title">{formatCalendarDate(date)}</h2>
          <button className="dialog-close" type="button" aria-label="Close day details" onClick={onClose}>×</button>
        </div>
        {holiday && <p className="calendar-dialog-holiday">{holiday.name}</p>}
        {todos.length > 0 ? (
          <ul className="calendar-dialog-list">
            {todos.map((todo) => (
              <li className="calendar-dialog-todo" key={todo.id}>
                <input type="checkbox" checked={todo.completed} disabled aria-label={`${todo.completed ? 'Completed' : 'Not completed'}: ${todo.title}`} />
                <span className={todo.completed ? 'is-complete' : ''}>{todo.title}</span>
                <span className={`priority-badge priority-badge-${todo.priority}`}>{todo.priority}</span>
              </li>
            ))}
          </ul>
        ) : <p className="calendar-empty-day">No tasks due.</p>}
      </section>
    </div>
  )
}

export default function CalendarPage() {
  return (
    <Suspense fallback={<main className="workspace-shell"><p className="loading-state">Loading calendar…</p></main>}>
      <CalendarContent />
    </Suspense>
  )
}
