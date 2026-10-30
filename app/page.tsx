import Link from 'next/link'
import { AddPasskeyButton } from './AddPasskeyButton'
import { LogoutButton } from './LogoutButton'
import { getSession } from '@/lib/auth'

export default async function HomePage() {
  const session = await getSession()

  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <Link className="wordmark" href="/">Daymark</Link>
        <LogoutButton />
      </header>
      <section className="workspace-content" aria-labelledby="welcome-title">
        <p className="eyebrow">Personal workspace</p>
        <h1 id="welcome-title">Welcome, {session?.username ?? 'there'}.</h1>
        <p className="workspace-note">Your passkey is connected. Todo tools will live here.</p>
        <Link className="text-link" href="/calendar">Open calendar</Link>
        {session && <AddPasskeyButton username={session.username} />}
      </section>
    </main>
  )
}
