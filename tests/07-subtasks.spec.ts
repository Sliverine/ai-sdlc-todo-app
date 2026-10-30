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

  const username = `subtasks-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: 'Today, in focus.' })).toBeVisible()
  return cdp
}

test('adds, completes, deletes, collapses, and cascades subtasks with live progress', async ({ page }) => {
  const cdp = await registerTodoUser(page)
  await page.getByLabel('Task').fill('Prepare the release')
  await page.getByRole('button', { name: 'Add todo' }).click()
  const todoRow = page.locator('.todo-row').filter({ hasText: 'Prepare the release' })
  await expect(todoRow).toBeVisible()
  await expect(todoRow.getByRole('progressbar')).toHaveCount(0)

  await todoRow.getByRole('button', { name: 'Show subtasks' }).click()
  const subtaskInput = todoRow.getByRole('textbox', { name: 'Subtask title for Prepare the release' })
  await subtaskInput.fill('   ')
  await expect(todoRow.getByRole('button', { name: 'Add subtask' })).toBeDisabled()
  await expect(todoRow.getByRole('listitem')).toHaveCount(0)

  await subtaskInput.fill('Draft the announcement')
  await subtaskInput.press('Enter')
  await expect(todoRow).toContainText('0/1 subtasks')
  await expect(todoRow.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')

  await subtaskInput.fill('Check deployment')
  await todoRow.getByRole('button', { name: 'Add subtask' }).click()
  await expect(todoRow).toContainText('0/2 subtasks')
  await todoRow.getByRole('checkbox', { name: 'Mark subtask Draft the announcement complete' }).check()
  await expect(todoRow).toContainText('1/2 subtasks')
  await expect(todoRow.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')

  await todoRow.getByRole('button', { name: 'Delete subtask Check deployment' }).click()
  await expect(todoRow).toContainText('1/1 subtasks')
  await expect(todoRow.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
  await expect(todoRow.getByRole('progressbar')).toHaveClass(/complete/)

  await todoRow.getByRole('button', { name: 'Hide subtasks' }).click()
  await expect(todoRow.getByRole('list')).toBeHidden()
  await expect(todoRow).toContainText('1/1 subtasks')
  await todoRow.getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByText('Prepare the release')).toHaveCount(0)
  await expect(page.getByText('Draft the announcement')).toHaveCount(0)
  await cdp.detach()
})
