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
      automaticPresenceSimulation: true,
    },
  })

  const username = `backup-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Today, in focus.' })).toBeVisible()
  return cdp
}

test('exports and restores todos with subtasks and tags, and imports duplicates as new todos', async ({ page }) => {
  const cdp = await registerTodoUser(page)

  await page.locator('.todo-form-heading').getByRole('button', { name: 'Manage tags' }).click()
  await page.getByPlaceholder('Tag name').fill('Project')
  await page.getByRole('button', { name: 'Create tag' }).click()
  await expect(page.getByRole('dialog')).toContainText('Project')
  await page.getByRole('button', { name: 'Close tags dialog' }).click()
  await page.locator('.tag-picker').getByRole('button', { name: 'Project' }).click()

  await page.getByLabel('Task').fill('Prepare release')
  await page.getByRole('button', { name: 'Add todo' }).click()
  const todoRow = page.locator('.todo-row').filter({ hasText: 'Prepare release' })
  await expect(todoRow).toContainText('Project')
  await todoRow.getByRole('button', { name: 'Show subtasks' }).click()
  const subtaskInput = todoRow.getByRole('textbox', { name: 'Subtask title for Prepare release' })
  await subtaskInput.fill('Draft notes')
  await subtaskInput.press('Enter')
  await expect(todoRow).toContainText('0/1 subtasks')

  const csvDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export CSV' }).click()
  const csvDownload = await csvDownloadPromise
  expect(csvDownload.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.csv$/)

  const jsonDownloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export JSON' }).click()
  const jsonDownload = await jsonDownloadPromise
  expect(jsonDownload.suggestedFilename()).toMatch(/^todos-\d{4}-\d{2}-\d{2}\.json$/)
  const payload = await page.evaluate(async () => await (await fetch('/api/todos/export?format=json')).json())

  await todoRow.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Prepare release')).toHaveCount(0)
  const backup = { name: 'todos-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) }
  const importInput = page.getByLabel('Choose JSON backup to import')
  await importInput.setInputFiles(backup)
  await expect(page.getByRole('status')).toContainText('Successfully imported 1 todos')

  let restored = page.locator('.todo-row').filter({ hasText: 'Prepare release' })
  await expect(restored).toContainText('Project')
  await restored.getByRole('button', { name: 'Show subtasks' }).click()
  await expect(restored).toContainText('Draft notes')
  await expect(restored).toContainText('0/1 subtasks')

  await importInput.setInputFiles(backup)
  await expect(page.getByRole('status')).toContainText('Successfully imported 1 todos')
  restored = page.locator('.todo-row').filter({ hasText: 'Prepare release' })
  await expect(restored).toHaveCount(2)
  await cdp.detach()
})

test('shows clear errors for malformed and unsupported JSON backups', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  const importInput = page.getByLabel('Choose JSON backup to import')

  await importInput.setInputFiles({
    name: 'broken.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{'),
  })
  await expect(page.locator('.import-message-error')).toHaveText('Invalid JSON format')

  await importInput.setInputFiles({
    name: 'wrong-format.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1 })),
  })
  await expect(page.locator('.import-message-error'))
    .toHaveText('Failed to import todos. Please check the file format.')
  await cdp.detach()
})
