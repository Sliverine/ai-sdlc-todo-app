import Link from 'next/link'
import { LogoutButton } from '../LogoutButton'

export default function CalendarPage() {
  return (
    <main className="workspace-shell">
      <header className="workspace-header">
        <Link className="wordmark" href="/">Daymark</Link>
        <LogoutButton />
      </header>
      <section className="workspace-content" aria-labelledby="calendar-title">
        <p className="eyebrow">Personal workspace</p>
        <h1 id="calendar-title">Calendar</h1>
        <p className="workspace-note">Calendar view will be added with the calendar feature.</p>
        <Link className="text-link" href="/">Back to tasks</Link>
      </section>
    </main>
  )
}
