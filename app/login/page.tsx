'use client'

import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

type AuthMode = 'register' | 'login'

async function responseData<T>(response: Response): Promise<T> {
  const data: unknown = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
      ? data.error
      : 'Unable to complete that request.'
    throw new Error(message)
  }
  return data as T
}

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState<AuthMode | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/auth/me')
      .then((response) => {
        if (active && response.ok) router.replace('/')
      })
      .catch(() => undefined)
    return () => { active = false }
  }, [router])

  async function authenticate(mode: AuthMode) {
    const normalizedUsername = username.trim()
    if (!normalizedUsername) {
      setError('Enter a username to continue.')
      return
    }

    setBusy(mode)
    setError(null)

    try {
      const optionsResponse = await fetch(`/api/auth/${mode}-options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: normalizedUsername }),
      })
      const options = await responseData<{ challenge: string }>(optionsResponse)
      const credential = mode === 'register'
        ? await startRegistration({ optionsJSON: options as Parameters<typeof startRegistration>[0]['optionsJSON'] })
        : await startAuthentication({ optionsJSON: options as Parameters<typeof startAuthentication>[0]['optionsJSON'] })
      const verifyResponse = await fetch(`/api/auth/${mode}-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: normalizedUsername, challenge: options.challenge, response: credential }),
      })
      await responseData(verifyResponse)
      router.replace('/')
      router.refresh()
    } catch (caught) {
      const errorName = caught instanceof Error ? caught.name : ''
      if (errorName === 'NotAllowedError') {
        setError('Passkey request cancelled. You can try again when ready.')
      } else if (typeof window !== 'undefined' && !('PublicKeyCredential' in window)) {
        setError('This browser does not support passkeys.')
      } else if (caught instanceof Error) {
        setError(caught.message)
      } else {
        setError('Unable to complete passkey authentication. Please try again.')
      }
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-brand-row">
          <Link className="wordmark" href="/">Daymark</Link>
          <span className="privacy-mark"><span aria-hidden="true" /> Passkey access</span>
        </div>
        <div className="auth-copy">
          <p className="eyebrow">A quieter way to keep track</p>
          <h1 id="auth-title">Your day,<br /><span>in good order.</span></h1>
          <p className="auth-description">Sign in with a passkey on this device, or create an account to begin.</p>
        </div>
        <form className="auth-form" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="username">Username</label>
          <input
            autoComplete="username"
            id="username"
            maxLength={64}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="e.g. alex.morgan"
            value={username}
          />
          <div className="auth-actions">
            <button className="primary-button" disabled={busy !== null} onClick={() => authenticate('login')} type="button">
              {busy === 'login' ? 'Waiting for passkey...' : 'Sign in'}
            </button>
            <button className="secondary-button" disabled={busy !== null} onClick={() => authenticate('register')} type="button">
              {busy === 'register' ? 'Creating passkey...' : 'Create account'}
            </button>
          </div>
          <p className="auth-error" aria-live="polite" role={error ? 'alert' : undefined}>{error}</p>
        </form>
        <p className="auth-footnote">Your passkey stays on your device. No password required.</p>
      </section>
      <aside className="auth-aside" aria-hidden="true">
        <div className="aside-line aside-line-one" />
        <div className="aside-line aside-line-two" />
        <div className="aside-note">
          <span className="aside-index">01 / PRIVATE BY DESIGN</span>
          <p>Less remembering.<br />More being here.</p>
          <span className="aside-rule" />
        </div>
        <span className="aside-date">DAYMARK · PERSONAL WORKSPACE</span>
      </aside>
    </main>
  )
}
