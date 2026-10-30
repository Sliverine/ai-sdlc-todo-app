import { expect, test, type Page } from '@playwright/test'
import { getSingaporeNow, toSingaporeParts } from '../lib/timezone'

async function registerCalendarUser(page: Page) {
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

  await page.goto('/login')
  await page.getByLabel('Username').fill(`calendar-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Today, in focus.' })).toBeVisible()
  return cdp
}

function formatMonth(year: number, month: number): string {
  return new Intl.DateTimeFormat('en-SG', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(year, month - 1, 1)))
}

test('navigates months and keeps the selected month in the URL', async ({ page }) => {
  const cdp = await registerCalendarUser(page)
  const current = toSingaporeParts(getSingaporeNow())
  const next = new Date(Date.UTC(current.year, current.month, 1))
  const previous = new Date(Date.UTC(current.year, current.month - 2, 1))

  await page.goto('/calendar')
  await expect(page.locator('.calendar-month-title')).toHaveText(formatMonth(current.year, current.month))
  await expect(page.getByRole('gridcell')).toHaveCount(42)

  await page.getByRole('button', { name: 'Next month' }).click()
  await expect(page).toHaveURL(new RegExp(`month=${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`))
  await expect(page.locator('.calendar-month-title')).toHaveText(formatMonth(next.getUTCFullYear(), next.getUTCMonth() + 1))

  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page).toHaveURL(new RegExp(`month=${current.year}-${String(current.month).padStart(2, '0')}`))
  await page.getByRole('button', { name: 'Previous month' }).click()
  await expect(page).toHaveURL(new RegExp(`month=${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`))
  await page.getByRole('button', { name: 'Today' }).click()
  await expect(page).toHaveURL(new RegExp(`month=${current.year}-${String(current.month).padStart(2, '0')}`))
  await cdp.detach()
})

test('shows a due-dated task in its Singapore day cell and day details', async ({ page }) => {
  const cdp = await registerCalendarUser(page)
  const title = 'Calendar day detail task'
  const dueDate = await page.evaluate(() => {
    const date = new Date(Date.now() + 2 * 60 * 60 * 1000)
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Asia/Singapore',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date)
    const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
    return `${fields.year}-${fields.month}-${fields.day}T${fields.hour}:${fields.minute}`
  })
  await page.getByLabel('Task').fill(title)
  await page.getByLabel('Due date and time (Singapore)').fill(dueDate)
  await page.getByLabel('Priority').selectOption('high')
  const created = page.waitForResponse((response) =>
    response.url().endsWith('/api/todos') && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Add todo' }).click()
  expect((await created).status()).toBe(201)

  await page.goto(`/calendar?month=${dueDate.slice(0, 7)}`)
  const dayCell = page.locator('.calendar-cell').filter({ hasText: title })
  await expect(dayCell).toBeVisible()
  await expect(dayCell.locator('.calendar-todo-high')).toContainText(title)
  await dayCell.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText(title)
  await expect(dialog.getByRole('checkbox')).not.toBeChecked()
  await expect(dialog).toContainText('high')
  await cdp.detach()
})

test('falls back to the current Singapore month for an invalid month parameter', async ({ page }) => {
  const cdp = await registerCalendarUser(page)
  const current = toSingaporeParts(getSingaporeNow())

  await page.goto('/calendar?month=2026-13')
  await expect(page.locator('.calendar-month-title')).toHaveText(formatMonth(current.year, current.month))
  await expect(page.getByRole('gridcell')).toHaveCount(42)
  await cdp.detach()
})

test('redirects unauthenticated calendar requests to login', async ({ page }) => {
  await page.goto('/calendar')
  await expect(page).toHaveURL(/\/login$/)
})
