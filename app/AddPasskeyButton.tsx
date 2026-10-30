'use client'

import { startRegistration } from '@simplewebauthn/browser'
import { useState } from 'react'

type Options = Parameters<typeof startRegistration>[0]['optionsJSON']

async function readJson(response: Response) {
  const data: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : 'Unable to add a passkey.'
    throw new Error(message)
  }
  return data as { challenge: string } & Options
}

export function AddPasskeyButton({ username }: { username: string }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function addPasskey() {
    setBusy(true)
    setMessage(null)
    try {
      const optionsResponse = await fetch('/api/auth/register-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      })
      const options = await readJson(optionsResponse)
      const credential = await startRegistration({ optionsJSON: options })
      const verifyResponse = await fetch('/api/auth/register-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, challenge: options.challenge, response: credential }),
      })
      await readJson(verifyResponse)
      setMessage('Passkey added to this account.')
    } catch (caught) {
      const errorName = caught instanceof Error ? caught.name : ''
      if (errorName === 'NotAllowedError') {
        setMessage('Passkey request cancelled. You can try again when ready.')
      } else if (caught instanceof Error) {
        setMessage(caught.message)
      } else {
        setMessage('Unable to add a passkey. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="passkey-control">
      <button className="secondary-button" type="button" onClick={addPasskey} disabled={busy}>
        {busy ? 'Waiting for passkey...' : 'Add another passkey'}
      </button>
      <span aria-live="polite" className="passkey-message">{message}</span>
    </div>
  )
}
