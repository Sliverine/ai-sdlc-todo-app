'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export function LogoutButton() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function logout() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' })
      if (!response.ok) throw new Error('Logout request failed')
      router.replace('/login')
      router.refresh()
    } catch {
      setError('Unable to sign out. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="logout-control">
      <button className="quiet-button" type="button" onClick={logout} disabled={busy}>
        {busy ? 'Signing out...' : 'Sign out'}
      </button>
      <span className="logout-error" role={error ? 'alert' : undefined}>{error}</span>
    </div>
  )
}
