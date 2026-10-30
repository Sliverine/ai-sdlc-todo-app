import { expect, test, type Page } from '@playwright/test'

const priorityTitles = {
  high: 'Prepare launch checklist',
  medium: 'Review meeting notes',
  low: 'Organize reading list',
} as const

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

  const username = `priority-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Today, in focus.' })).toBeVisible()
  return cdp
}

async function createPriorityTodo(page: Page, title: string, priority?: 'high' | 'medium' | 'low') {
  await page.getByLabel('Task').fill(title)
  if (priority) await page.getByLabel('Priority', { exact: true }).selectOption(priority)
  await page.getByRole('button', { name: 'Add todo' }).click()
  await expect(page.locator('.todo-row').filter({ hasText: title })).toBeVisible()
}

function contrastRatio(foreground: string, background: string): number {
  function luminance(color: string) {
    const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number)
    if (!channels || channels.length !== 3) throw new Error(`Unexpected computed color: ${color}`)
    const [red, green, blue] = channels.map((channel) => {
      const normalized = channel / 255
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue
  }

  const values = [luminance(foreground), luminance(background)].sort((first, second) => second - first)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

test('shows color-coded priorities, filters the list, and re-sorts edited todos', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  const cdp = await registerTodoUser(page)

  await createPriorityTodo(page, priorityTitles.medium, 'medium')
  await createPriorityTodo(page, priorityTitles.low, 'low')
  await createPriorityTodo(page, priorityTitles.high, 'high')

  const pendingRows = page.locator('.pending-section .todo-row')
  const sortedTitles = await pendingRows.locator('.todo-title').allTextContents()
  expect(sortedTitles).toEqual([priorityTitles.high, priorityTitles.medium, priorityTitles.low])
  await expect(page.locator('.todo-row').filter({ hasText: priorityTitles.high }).getByText('High')).toBeVisible()

  const badgeStyles = await page.locator('.todo-row').evaluateAll((rows) => rows.map((row) => {
    const badge = row.querySelector('.priority-badge')
    if (!badge) throw new Error('Priority badge was not rendered')
    const style = getComputedStyle(badge)
    return { text: badge.textContent?.trim(), color: style.color, background: style.backgroundColor }
  }))
  expect(badgeStyles).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'High', background: 'rgb(239, 68, 68)' }),
    expect.objectContaining({ text: 'Medium', background: 'rgb(245, 158, 11)' }),
    expect.objectContaining({ text: 'Low', background: 'rgb(59, 130, 246)' }),
  ]))
  for (const badge of badgeStyles) expect(contrastRatio(badge.color, badge.background)).toBeGreaterThanOrEqual(4.5)

  await page.getByLabel('Filter by priority').selectOption('high')
  await expect(page.locator('.todo-row')).toHaveCount(1)
  await expect(page.locator('.todo-row')).toContainText(priorityTitles.high)

  await page.getByLabel('Filter by priority').selectOption('all')
  await page.locator('.todo-row').filter({ hasText: priorityTitles.low }).getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByLabel('Priority', { exact: true }).selectOption('high')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.locator('.pending-section .todo-row').first()).toContainText(priorityTitles.high)

  await page.getByLabel('Filter by priority').selectOption('high')
  await expect(page.locator('.todo-row')).toHaveCount(2)
  await expect(page.locator('.todo-row').filter({ hasText: priorityTitles.low })).toContainText('High')
  await cdp.detach()
})

test('uses system light and dark themes with readable priority badges', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/login')
  const lightAuthSurface = await page.locator('.auth-panel').evaluate((element) => getComputedStyle(element).backgroundColor)
  await page.emulateMedia({ colorScheme: 'dark' })
  const darkAuthSurface = await page.locator('.auth-panel').evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(darkAuthSurface).not.toBe(lightAuthSurface)

  const cdp = await registerTodoUser(page)
  await createPriorityTodo(page, priorityTitles.high, 'high')
  await createPriorityTodo(page, priorityTitles.medium, 'medium')
  await createPriorityTodo(page, priorityTitles.low, 'low')

  const darkBadgeStyles = await page.locator('.priority-badge').evaluateAll((badges) => badges.map((badge) => {
    const style = getComputedStyle(badge)
    return { text: badge.textContent?.trim(), color: style.color, background: style.backgroundColor }
  }))
  expect(darkBadgeStyles).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'High', color: 'rgb(248, 113, 113)' }),
    expect.objectContaining({ text: 'Medium', color: 'rgb(251, 191, 36)' }),
    expect.objectContaining({ text: 'Low', color: 'rgb(96, 165, 250)' }),
  ]))
  for (const badge of darkBadgeStyles) expect(contrastRatio(badge.color, badge.background)).toBeGreaterThanOrEqual(4.5)
  await cdp.detach()
})