import { expect, test, type Page } from '@playwright/test'

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

  const username = `todo-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Today, in focus.' })).toBeVisible()
  return cdp
}

async function singaporeDateTimeAfter(page: Page, hours: number): Promise<string> {
  return await page.evaluate((offsetHours) => {
    const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000)
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }, hours)
}

test('creates, edits, completes, reopens, and deletes a todo', async ({ page }) => {
  const cdp = await registerTodoUser(page)

  await page.getByLabel('Task').fill('Review the weekly plan')
  await page.getByRole('button', { name: 'Add todo' }).click()
  const initialRow = page.locator('.todo-row').filter({ hasText: 'Review the weekly plan' })
  await expect(page.locator('.pending-section')).toContainText('Review the weekly plan')
  await expect(initialRow).toContainText('medium')

  await initialRow.getByRole('button', { name: 'Edit' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByLabel('Task')).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Close edit dialog' })).toBeFocused()
  await dialog.getByLabel('Task').fill('Discarded edit')
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(page.locator('.todo-row').filter({ hasText: 'Review the weekly plan' })).toBeVisible()

  await page.locator('.todo-row').filter({ hasText: 'Review the weekly plan' }).getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByLabel('Task').fill('Review the revised plan')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  const revisedRow = page.locator('.todo-row').filter({ hasText: 'Review the revised plan' })
  await revisedRow.getByRole('checkbox').check()
  await expect(page.locator('.completed-section')).toContainText('Review the revised plan')
  const completedCheckbox = page.locator('.completed-section').getByRole('checkbox', { name: 'Mark Review the revised plan incomplete' })
  await expect(completedCheckbox).toBeFocused()
  await completedCheckbox.click()
  await expect(page.locator('.pending-section')).toContainText('Review the revised plan')

  await page.locator('.todo-row').filter({ hasText: 'Review the revised plan' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Review the revised plan')).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('Review the revised plan')).toHaveCount(0)
  await cdp.detach()
})

test('creates a future-dated todo with priority, recurrence, and reminder metadata', async ({ page }) => {
  const cdp = await registerTodoUser(page)

  await page.getByLabel('Task').fill('Submit the project report')
  await page.getByLabel('Due date and time (Singapore)').fill(await singaporeDateTimeAfter(page, 2))
  await page.getByLabel('Priority').selectOption('high')
  await page.getByLabel('Repeat this todo').check()
  await page.locator('.recurrence-select select').selectOption('weekly')
  await page.getByLabel('Reminder').selectOption('15')
  await page.getByRole('button', { name: 'Add todo' }).click()

  const todoRow = page.locator('.todo-row').filter({ hasText: 'Submit the project report' })
  await expect(todoRow).toContainText('high')
  await expect(todoRow).toContainText('Repeats weekly')
  await expect(todoRow).toContainText('Reminder set')
  await cdp.detach()
})

test('removes an optimistic create when the API fails', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  await page.route('**/api/todos', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary failure' }) })
      return
    }
    await route.continue()
  })

  await page.getByLabel('Task').fill('This will fail')
  await page.getByRole('button', { name: 'Add todo' }).click()
  await expect(page.locator('.todo-error')).toHaveText('Temporary failure')
  await expect(page.getByText('This will fail')).toHaveCount(0)
  await cdp.detach()
})

test('waits for the initial task list before enabling todo creation', async ({ page }) => {
  let releaseListRequest = () => {}
  const listRequestGate = new Promise<void>((resolve) => { releaseListRequest = resolve })
  await page.route('**/api/todos', async (route) => {
    if (route.request().method() === 'GET') await listRequestGate
    await route.continue()
  })
  const cdp = await registerTodoUser(page)
  const createButton = page.locator('.todo-submit')

  await expect(createButton).toBeDisabled()
  releaseListRequest()
  await expect(createButton).toBeEnabled()
  await cdp.detach()
})

test('keeps creation disabled after a failed initial load until retry succeeds', async ({ page }) => {
  let allowListRequest = false
  await page.route('**/api/todos', async (route) => {
    if (route.request().method() === 'GET' && !allowListRequest) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary failure' }) })
      return
    }
    await route.continue()
  })
  const cdp = await registerTodoUser(page)
  const createButton = page.locator('.todo-submit')

  await expect(page.locator('.todo-page-error')).toHaveText('Your tasks could not be loaded.')
  await expect(createButton).toBeDisabled()
  allowListRequest = true
  await page.getByRole('button', { name: 'Retry loading tasks' }).click()
  await expect(createButton).toBeEnabled()
  await cdp.detach()
})

test('restores the original todo after edit, completion, and delete failures', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  await page.route('**/api/todos/*', async (route) => {
    if (['PUT', 'DELETE'].includes(route.request().method())) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporary failure' }) })
      return
    }
    await route.continue()
  })

  await page.getByLabel('Task').fill('Rollback target')
  await page.getByRole('button', { name: 'Add todo' }).click()
  let todoRow = page.locator('.todo-row').filter({ hasText: 'Rollback target' })
  await expect(todoRow).toBeVisible()

  await todoRow.getByRole('button', { name: 'Edit' }).click()
  await page.getByRole('dialog').getByLabel('Task').fill('Failed rename')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.locator('.todo-error')).toHaveText('Temporary failure')
  await expect(page.locator('.todo-row').filter({ hasText: 'Rollback target' })).toBeVisible()
  await page.getByRole('button', { name: 'Close edit dialog' }).click()

  todoRow = page.locator('.todo-row').filter({ hasText: 'Rollback target' })
  await todoRow.getByRole('checkbox').click()
  await expect(page.locator('.todo-page-error')).toHaveText('Could not update completion. Please try again.')
  await expect(page.locator('.pending-section').getByRole('checkbox', { name: 'Mark Rollback target complete' })).not.toBeChecked()

  await page.locator('.todo-row').filter({ hasText: 'Rollback target' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page.locator('.todo-page-error')).toHaveText('Could not delete this todo. Please try again.')
  await expect(page.locator('.todo-row').filter({ hasText: 'Rollback target' })).toBeVisible()
  await cdp.detach()
})