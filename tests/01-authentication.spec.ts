import { expect, test, type Page } from '@playwright/test'

async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  })
  return { cdp, authenticatorId }
}

async function createAccount(page: Page, username: string) {
  await page.goto('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: `Welcome, ${username}.` })).toBeVisible()
}

function uniqueUsername() {
  return `e2e-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`
}

test('registers, persists a session, logs out, protects routes, and logs in', async ({ page }) => {
  await addVirtualAuthenticator(page)
  const username = uniqueUsername()

  await page.goto('/')
  await expect(page).toHaveURL('/login')
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: `Welcome, ${username}.` })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL('/')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL('/login')
  await page.goto('/calendar')
  await expect(page).toHaveURL('/login')

  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  await page.goto('/login')
  await expect(page).toHaveURL('/')
})

test('rejects duplicate registration without preventing login', async ({ page }) => {
  await addVirtualAuthenticator(page)
  const username = uniqueUsername()
  await createAccount(page, username)
  await page.getByRole('button', { name: 'Sign out' }).click()

  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.locator('.auth-form').getByRole('alert')).toContainText('Username already taken')
  await expect(page).toHaveURL('/login')

  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
})

test('registers a second authenticator and can log in with it', async ({ page }) => {
  const first = await addVirtualAuthenticator(page)
  const username = uniqueUsername()
  await createAccount(page, username)

  const secondCdp = await page.context().newCDPSession(page)
  await secondCdp.send('WebAuthn.enable')
  await secondCdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'usb',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
    },
  })
  await page.getByRole('button', { name: 'Add another passkey' }).click()
  await expect(page.getByText('Passkey added to this account.')).toBeVisible()

  await first.cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId: first.authenticatorId })
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByLabel('Username').fill(username)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: `Welcome, ${username}.` })).toBeVisible()

  await secondCdp.detach()
})

test('keeps the session active when logout fails', async ({ page }) => {
  await addVirtualAuthenticator(page)
  await createAccount(page, uniqueUsername())
  await page.route('**/api/auth/logout', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Temporary failure' }),
  }))

  await page.getByRole('button', { name: 'Sign out' }).click()

  await expect(page.locator('.logout-control').getByRole('alert'))
    .toHaveText('Unable to sign out. Please try again.')
  await expect(page).toHaveURL('/')
})
