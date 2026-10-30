# Cross-Agent Synchronization

Optional reference for core cross-cutting architecture decisions, behavior resolutions, and open product questions. Consult only when explicitly requested.

## Maintenance Rules

- Keep this file opt-in; do not make routine updates. If explicitly asked to maintain it, record only core shared decisions and unresolved questions, not implementation history.
- Preserve approved decisions and distinguish them from open questions; this file does not replace the source PRPs or implementation.

## System Components

The target is one Next.js 16 App Router application with React 19, Tailwind CSS 4, synchronous `better-sqlite3`, WebAuthn passkeys, and Playwright tests. It is not a set of independently deployed services.

- **Identity and route protection:** WebAuthn registration/login, JWT session cookie, session utilities, and Next.js 16 `proxy.ts`. API handlers use the authenticated `session.userId` for all user-owned data.
- **Persistence and shared types:** `lib/db.ts` owns the eight application tables plus the auth challenge table, interfaces, prepared statements, and CRUD objects. Enable SQLite foreign keys at connection initialization.
- **Time handling:** `lib/timezone.ts` is the shared boundary for Singapore (`Asia/Singapore`) date/time calculations.
- **Feature API and domain logic:** Todo CRUD, priority/sorting, recurring instances, reminders, subtasks, tags, templates, import/export, and holidays.
- **Client experience:** A main client todo page owns list workflows and feature UI; separate login and calendar pages provide authentication and calendar views. Keep the main todo page monolithic as specified by project conventions.
- **Quality and delivery:** Unit/integration tests cover logic and persistence; Playwright covers user flows including virtual WebAuthn. Build, lint, type safety, accessibility, security, performance, and persistent deployment are evaluation concerns.

## Dependency-Safe Build Order

Implement the shared schema/time utilities, authentication, todo CRUD, and priority first. Subtasks, tags, and reminders can proceed independently after CRUD; recurrence follows because it inherits tags/reminders; templates follow recurrence and subtasks. Search needs priority/tags/subtasks, export/import needs subtasks/tags, and calendar needs todos, priority, and authentication.

## Implementation Ownership and Contracts

- Assign one integration owner to `lib/db.ts`, shared types, and the monolithic `app/page.tsx`. Parallel contributors should own isolated route groups, helpers, or tests rather than concurrently editing these shared files.
- Agree on request/response shapes and validation rules before parallel feature work. Initialize all eight tables and shared types together, including the indexes specified in the detailed PRPs.
- Keep database code server-only; client components import shared database interfaces with `import type`. Normalize SQLite integer booleans at the persistence boundary.
- Use separate local, test, and production database paths. Database initialization and migration failures must surface explicitly rather than being hidden by broad catches.
- Define the timestamp contract consistently: store instants as canonical UTC ISO 8601 strings, keep holidays as Singapore-local `YYYY-MM-DD` dates, and perform Singapore calendar arithmetic, date grouping, and display through `lib/timezone.ts`. Parse local date/time input explicitly as Singapore time; do not shift an instant to simulate a timezone. Normalize SQL timestamp defaults and API serialization to this contract.
- Complete recurrence and its tag copying in one transaction, template use and subtask creation in one transaction, and each import in one transaction. Validate merged update state and test rollback and concurrent requests.

## Resolved Specification Conflicts

When source documents conflict, prefer these durable behavior decisions and update the owning PRP when needed:

- Build authentication before protected APIs. Initial registration/login endpoints are public but validate input and origin; additional passkeys require the active user's session.
- Challenges are short-lived, browser-bound, single-use, and atomically consumed. Recurring instances inherit priority, tags, and reminders.
- Templates snapshot subtasks, not tags or concrete due dates. Recurring/reminder templates require a valid due-date offset; malformed subtask JSON fails without creating a todo.
- Search covers todo and subtask titles (300 ms debounce), with filters ordered search, priority, tag, completion, date. Calendar uses a fixed 6x7 grid and ignores list filters.
- Reminders are eligible only in `[due_date - reminder_minutes, due_date]`; delivery is best-effort while polling, not exactly-once. Acknowledge server-side and reset only when schedule fields change.
- Delete todos immediately with database cascades. JSON export includes subtasks and tag names/colors but not IDs; import validates first and runs transactionally. CSV is one-way.
- Apply future-date validation only to new or changed interactive deadlines; allow unchanged overdue dates and valid historical imports. Validate recurrence/reminder rules against merged updates.
- Store instants as canonical UTC ISO 8601; keep holidays as Singapore-local dates and use `lib/timezone.ts` for Singapore calendar arithmetic/display. Choose accessible foreground colors for custom tag backgrounds.

## Unresolved Product Questions

Do not silently choose behavior for these cases. Record the approved resolution here before implementing the affected behavior.

- **Reopening recurring occurrences:** Should reopening and recompleting an occurrence create another successor, or must an occurrence have at most one successor for its lifetime? A `false -> true` check prevents duplicate requests on an already-completed record but does not settle this case. The current schema has no explicit successor or chain link.
- **Ambiguous case-insensitive tag reuse:** Normal tag uniqueness is case-sensitive, so one user can have existing names differing only by case. Import requires case-insensitive reuse, but does not specify which existing tag wins if several match. Keep normal uniqueness unchanged until a selection or normalization policy is approved.

## Current Core Contracts and Risks

- Todo reads and mutations are scoped to `session.userId`; mutation routes validate origin, cap JSON bodies at 64 KiB, and return 404 for missing or foreign-owned items. Recheck recurrence/reminder invariants against merged state.
- Parse `datetime-local` inputs as Singapore time and store UTC ISO timestamps. Only new or changed interactive deadlines require at least one minute in the future; unchanged overdue dates remain valid, and an exact-now deadline is Pending.
- Authentication currently has no rate limiting; username-first flows can reveal account/credential existence. Stateless JWTs copied from a browser remain valid until their seven-day expiry, even after logout.

Consult or update this reference only when explicitly requested.
