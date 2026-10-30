import Database from 'better-sqlite3'
import { expect, test, type Page } from '@playwright/test'
import { resolve } from 'node:path'
import type { Todo } from '@/lib/db'

async function registerTodoUser(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  })

  const username = `recurring-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  return cdp
}

async function api<T>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  return await page.evaluate(async ({ method, url, body }) => {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: response.status, body: await response.json() }
  }, { method, url, body })
}

async function singaporeDateTimeAfter(page: Page, hours: number): Promise<string> {
  return await page.evaluate((offsetHours) => {
    const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000)
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }, hours)
}

const sg = (local: string) => new Date(`${local}:00+08:00`).toISOString()
const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

async function completeAndFindNext(page: Page, todo: Todo): Promise<Todo[]> {
  const completed = await api<Todo>(page, 'PUT', `/api/todos/${todo.id}`, { completed: true })
  expect(completed.status).toBe(200)
  const all = await api<Todo[]>(page, 'GET', '/api/todos')
  return all.body.filter((item) => item.id !== todo.id && item.title === todo.title)
}

test('repeat requires a due date and a completed daily todo spawns its next instance', async ({ page }) => {
  const cdp = await registerTodoUser(page)

  const repeat = page.getByLabel('Repeat this todo')
  await expect(repeat).toBeDisabled()
  await expect(page.getByText('Set a due date to enable repeat')).toBeVisible()

  await page.getByLabel('Task').fill('Take vitamins')
  await page.getByLabel('Due date and time (Singapore)').fill(await singaporeDateTimeAfter(page, 2))
  await repeat.check()
  await page.locator('.recurrence-select select').selectOption('daily')
  await page.getByRole('button', { name: 'Add todo' }).click()

  const pendingRow = page.locator('.pending-section .todo-row').filter({ hasText: 'Take vitamins' })
  await expect(pendingRow.getByLabel('Repeats daily')).toContainText('🔄 daily')

  const original = (await api<Todo[]>(page, 'GET', '/api/todos')).body.find((todo) => todo.title === 'Take vitamins')!
  await page.locator(`#todo-completion-${original.id}`).check()
  await expect(page.locator('.completed-section')).toContainText('Take vitamins')
  await expect(page.locator('.pending-section .todo-row').filter({ hasText: 'Take vitamins' })).toHaveCount(1)

  const all = (await api<Todo[]>(page, 'GET', '/api/todos')).body
  const next = all.find((todo) => todo.title === 'Take vitamins' && todo.id !== original.id)!
  expect(next).toMatchObject({ completed: false, is_recurring: true, recurrence_pattern: 'daily', priority: original.priority })
  expect(Date.parse(next.due_date!) - Date.parse(original.due_date!)).toBe(86_400_000)
  await cdp.detach()
})

test('completing a weekly todo creates the next occurrence exactly seven days later', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  const dueDate = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const weekly = await api<Todo>(page, 'POST', '/api/todos', {
    title: 'Send weekly report',
    due_date: dueDate,
    is_recurring: true,
    recurrence_pattern: 'weekly',
  })

  expect(weekly.status).toBe(201)
  const [next] = await completeAndFindNext(page, weekly.body)
  expect(next.due_date).toBe(new Date(Date.parse(dueDate) + 7 * 86_400_000).toISOString())
  expect(next).toMatchObject({ completed: false, is_recurring: true, recurrence_pattern: 'weekly' })
  await cdp.detach()
})

test('monthly and yearly recurrence clamp to month end and leap day', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  const year = new Date().getFullYear() + 1
  let leapYear = year
  while (!isLeapYear(leapYear)) leapYear += 1

  const monthly = await api<Todo>(page, 'POST', '/api/todos', {
    title: 'Pay rent', due_date: sg(`${year}-01-31T09:00`), is_recurring: true, recurrence_pattern: 'monthly',
    priority: 'high', reminder_minutes: 60,
  })
  expect(monthly.status).toBe(201)
  const [nextMonthly] = await completeAndFindNext(page, monthly.body)
  expect(nextMonthly.due_date).toBe(sg(`${year}-02-${isLeapYear(year) ? 29 : 28}T09:00`))
  expect(nextMonthly).toMatchObject({ priority: 'high', reminder_minutes: 60, recurrence_pattern: 'monthly' })

  const yearly = await api<Todo>(page, 'POST', '/api/todos', {
    title: 'Renew licence', due_date: sg(`${leapYear}-02-29T09:00`), is_recurring: true, recurrence_pattern: 'yearly',
  })
  const [nextYearly] = await completeAndFindNext(page, yearly.body)
  expect(nextYearly.due_date).toBe(sg(`${leapYear + 1}-02-28T09:00`))
  await cdp.detach()
})

test('next occurrence inherits tags and reminder settings', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  const me = await api<{ user: { id: number } }>(page, 'GET', '/api/auth/me')
  const database = new Database(resolve('.test-todos.db'))
  let tagId: number
  try {
    const tag = database.prepare(
      'INSERT INTO tags (user_id, name, color) VALUES (?, ?, ?)',
    ).run(me.body.user.id, `recurring-tag-${Date.now()}`, '#3B82F6')
    tagId = Number(tag.lastInsertRowid)
  } finally {
    database.close()
  }

  const dueDate = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const recurring = await api<Todo>(page, 'POST', '/api/todos', {
    title: 'Prepare tagged reminder',
    due_date: dueDate,
    is_recurring: true,
    recurrence_pattern: 'weekly',
    reminder_minutes: 30,
    tag_ids: [tagId],
  })
  expect(recurring.status).toBe(201)

  const [next] = await completeAndFindNext(page, recurring.body)
  expect(next).toMatchObject({
    completed: false,
    is_recurring: true,
    recurrence_pattern: 'weekly',
    reminder_minutes: 30,
    tags: recurring.body.tags,
  })
  await cdp.detach()
})

test('double completion does not create duplicate instances', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  const weekly = await api<Todo>(page, 'POST', '/api/todos', {
    title: 'Status report', due_date: sg(`${new Date().getFullYear() + 1}-03-10T14:00`), is_recurring: true, recurrence_pattern: 'weekly',
  })
  await completeAndFindNext(page, weekly.body)
  const next = await completeAndFindNext(page, weekly.body)
  expect(next).toHaveLength(1)
  expect(next[0].due_date).toBe(sg(`${new Date().getFullYear() + 1}-03-17T14:00`))
  await cdp.detach()
})

test('completing a non-recurring todo does not create another instance', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  const dueDate = new Date(Date.now() + 30 * 86_400_000).toISOString()
  const regular = await api<Todo>(page, 'POST', '/api/todos', {
    title: 'One-off task',
    due_date: dueDate,
  })
  expect(regular.status).toBe(201)

  const completion = await api<Todo>(page, 'PUT', `/api/todos/${regular.body.id}`, { completed: true })
  expect(completion.status).toBe(200)
  const todos = await api<Todo[]>(page, 'GET', '/api/todos')
  expect(todos.body.filter((todo) => todo.title === 'One-off task')).toHaveLength(1)
  await cdp.detach()
})

test('rejects invalid recurring todos', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  const noDueDate = await api<{ error: string }>(page, 'POST', '/api/todos', { title: 'No anchor', is_recurring: true, recurrence_pattern: 'daily' })
  expect(noDueDate).toEqual({ status: 400, body: { error: 'Recurring todos require a due date' } })
  const badPattern = await api<{ error: string }>(page, 'POST', '/api/todos', {
    title: 'Bad pattern', due_date: sg(`${new Date().getFullYear() + 1}-03-10T14:00`), is_recurring: true, recurrence_pattern: 'hourly',
  })
  expect(badPattern.status).toBe(400)
  await cdp.detach()
})

test('unchecking repeat stops future recurrence', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  await page.getByLabel('Task').fill('Water plants')
  await page.getByLabel('Due date and time (Singapore)').fill(await singaporeDateTimeAfter(page, 2))
  await page.getByLabel('Repeat this todo').check()
  await page.getByRole('button', { name: 'Add todo' }).click()

  const row = page.locator('.todo-row').filter({ hasText: 'Water plants' })
  await expect(row.getByLabel('Repeats daily')).toBeVisible()
  await row.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByLabel('Repeat this todo').uncheck()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(row.getByLabel('Repeats daily')).toHaveCount(0)

  await row.getByRole('checkbox').check()
  await expect(page.locator('.completed-section')).toContainText('Water plants')
  const all = (await api<Todo[]>(page, 'GET', '/api/todos')).body
  expect(all.filter((todo) => todo.title === 'Water plants')).toHaveLength(1)
  await cdp.detach()
})
