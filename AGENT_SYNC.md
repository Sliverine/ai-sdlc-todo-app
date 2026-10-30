# Cross-Agent Synchronization

This file records shared architectural decisions, resolved specification conflicts, and implementation-order guidance for all agents working on this repository. Read it before designing or implementing features, together with the relevant PRP.

## Maintenance Rules

- Before reviewing requirements or making design/implementation decisions, check the worktree and fetch the configured remote. If the worktree is clean and the current branch has an upstream, fast-forward with `git pull --ff-only` and confirm the branch is current. Fetch alone does not update the checked-out files. If local edits, divergence, or conflicts prevent a safe fast-forward, preserve the work and coordinate with its owner before proceeding against possibly stale files.
- Do not delete, rename, or replace this file. Preserve it across refactors and documentation updates.
- Record every design decision and implementation change in this file as part of the same task. Keep entries concise, noting what changed and the relevant rationale or behavior; do not omit changes because they seem small.
- When source documents conflict, record the conflict and chosen resolution here. Update this record if the source-of-truth decision changes.
- Distinguish approved decisions from unresolved product questions. Recording a resolution here does not mean the conflicting source documents or application have already been updated.

## System Components

The target is one Next.js 16 App Router application with React 19, Tailwind CSS 4, synchronous `better-sqlite3`, WebAuthn passkeys, and Playwright tests. It is not a set of independently deployed services.

- **Identity and route protection:** WebAuthn registration/login, JWT session cookie, session utilities, and middleware. API handlers use the authenticated `session.userId` for all user-owned data.
- **Persistence and shared types:** `lib/db.ts` owns the eight-table schema, interfaces, prepared statements, and CRUD objects. Enable SQLite foreign keys at connection initialization.
- **Time handling:** `lib/timezone.ts` is the shared boundary for Singapore (`Asia/Singapore`) date/time calculations.
- **Feature API and domain logic:** Todo CRUD, priority/sorting, recurring instances, reminders, subtasks, tags, templates, import/export, and holidays.
- **Client experience:** A main client todo page owns list workflows and feature UI; separate login and calendar pages provide authentication and calendar views. Keep the main todo page monolithic as specified by project conventions.
- **Quality and delivery:** Unit/integration tests cover logic and persistence; Playwright covers user flows including virtual WebAuthn. Build, lint, type safety, accessibility, security, performance, and persistent deployment are evaluation concerns.

## Project Structure

`README.md` section 4, **Project Structure Verification**, is the canonical target hierarchy. Keep `PRPs/` at the repository root; `.github/` contains Copilot instructions, not PRPs. The current repository is planning/reference documentation only, so scaffold the application hierarchy at the repository root when implementation begins. Any future hierarchy change must update the README and both agent instruction files in the same task.

## Dependency-Safe Build Order

The one-shot build order and the PRP index differ. Use this sequence because it satisfies both the shared API authentication contract and the feature dependencies described by the detailed PRPs:

1. **Foundation:** Define all schema and types together; initialize SQLite with foreign keys; add Singapore timezone utilities.
2. **Authentication:** Implement session primitives and WebAuthn before user-scoped API routes.
3. **Todo CRUD:** Implement user-scoped create/read/update/delete, validation, sorting/sections, and optimistic UI behavior.
4. **Priority:** Add priority validation, sorting, filters, and accessible badges.
5. **Subtasks, tags, and reminders:** These can be developed independently once the todo contract is stable.
6. **Recurring todos:** Complete recurrence only after priority, tags, and reminders exist, because a new occurrence inherits all of them.
7. **Templates:** Implement after priority, recurrence, reminders, and subtasks; templates capture subtask definitions.
8. **Search/filtering:** Implement after priority, tags, and subtasks are available.
9. **Export/import:** Implement after subtasks and tags; import must validate before writes and use one transaction.
10. **Calendar:** Implement after todo/priority and authentication contracts; holidays are global data.

Steps 5 can proceed in parallel after CRUD if ownership and API contracts remain stable. Steps 8-10 can proceed independently once their listed dependencies are met.

## Implementation Ownership and Contracts

- Assign one integration owner to `lib/db.ts`, shared types, and the monolithic `app/page.tsx`. Parallel contributors should own isolated route groups, helpers, or tests rather than concurrently editing these shared files.
- Agree on request/response shapes and validation rules before parallel feature work. Initialize all eight tables and shared types together, including the indexes specified in the detailed PRPs.
- Keep database code server-only; client components import shared database interfaces with `import type`. Normalize SQLite integer booleans at the persistence boundary.
- Use separate local, test, and production database paths. Database initialization and migration failures must surface explicitly rather than being hidden by broad catches.
- Define the timestamp contract consistently: store instants as canonical UTC ISO 8601 strings, keep holidays as Singapore-local `YYYY-MM-DD` dates, and perform Singapore calendar arithmetic, date grouping, and display through `lib/timezone.ts`. Parse local date/time input explicitly as Singapore time; do not shift an instant to simulate a timezone. Normalize SQL timestamp defaults and API serialization to this contract.
- Complete recurrence and its tag copying in one transaction, template use and subtask creation in one transaction, and each import in one transaction. Validate merged update state and test rollback and concurrent requests.

## Resolved Specification Conflicts

Honor the decisions recorded here when source documents disagree. The original resolutions below follow the one-shot spec; the approved clarifications that follow identify additional decisions and intentional departures from it.

- **Authentication order:** Build auth/session primitives before protected routes. The PRP index's suggestion to defer authentication is incompatible with the session contract for protected feature APIs.
- **Recurring inheritance:** New instances inherit priority, tags, reminder timing, and recurrence settings. Therefore tags and reminders must be ready before recurrence integration is considered complete.
- **Templates:** Capture subtasks as `{ title, position }` JSON and recreate them on use. Concrete due dates and tags are not captured; an optional relative due-date offset is stored.
- **Search:** Search todo titles and subtask titles, case-insensitively with a 300 ms debounce. Do not add tag-name text search unless the one-shot spec is revised. Apply filters in this order: search, priority, tag, completion, date range.
- **Reminders:** Poll every 30 seconds; the user guide's one-minute description is outdated relative to the one-shot spec.
- **Todo deletion:** Delete immediately without a confirmation step and rely on SQLite cascade behavior for subtasks and tag links.
- **Export/import:** JSON export includes subtasks and tag names/colors, but not original IDs. CSV is one-way. Import validates the complete structure before writing, remaps IDs, resolves tags by case-insensitive name, and runs in one transaction.
- **Calendar filters:** The calendar shows all of the user's dated todos; list-view filters are not carried over.

### Approved Clarifications (2026-10-30)

These decisions were approved for this synchronization document. They authorize no application implementation by themselves.

| Topic | Conflict or gap | Approved decision |
|---|---|---|
| Public authentication endpoints | The blanket session-first rule would prevent initial registration and login. | Initial registration/login options and verification are public entry points, with input validation, origin protection, and rate limiting. Protected feature APIs still authenticate first. |
| Additional passkeys | PRP 11 requires multiple authenticators, but new-user registration rejects an existing username and does not define enrollment. | Provide a separate authenticated enrollment flow bound to the current user. A username alone must never authorize adding a credential. Exact endpoint details remain an implementation contract to define. |
| Challenge lifecycle | PRP 11 leaves challenge persistence and browser binding underspecified. | Challenges must be short-lived, browser-bound, and single-use, with atomic consumption. Choose the storage mechanism explicitly before implementing authentication. |
| Calendar grid | The one-shot permits five or six rows, while PRP 10's acceptance criteria require 42 cells. | Emit exactly six rows of seven cells, including adjacent-month dates. This intentionally chooses the detailed acceptance criteria over the condensed grid description. |
| Reminder eligibility and delivery | PRP 04 permits stale overdue reminders and uses exactly-once wording despite documenting a multi-tab race; the one-shot bounds eligibility at the due date. | Use the inclusive window `[due_date - reminder_minutes, due_date]`, excluding completed and already-acknowledged reminders. Delivery is best-effort while an app tab is open and polling, not guaranteed exactly-once across tabs. Use a notification tag to mitigate duplicate OS notifications and acknowledge through the existing todo update endpoint. |
| Reminder acknowledgement | The one-shot does not spell out the acknowledgement call; PRP 04 uses `PUT /api/todos/[id]`. | Retain that existing update endpoint for acknowledgement, enforce ownership, and stamp sent time server-side. Reset acknowledgement only when the due date or reminder timing actually changes. Do not treat this acknowledgement as proof of exactly-once delivery. |
| Template corruption | PRP 07 creates a todo without subtasks when stored `subtasks_json` cannot be parsed. | Surface an explicit error and create nothing if the stored checklist is malformed. This intentionally departs from the silent fallback to avoid an incomplete, success-shaped result. |
| Template date requirements | A template can omit its offset, but recurring todos require a due date and reminders need a date anchor. | Require a valid relative due-date offset for templates with recurrence or reminders, validate at save and use time, and expose an offset control in the UI. Templates without either setting may omit the offset. |
| Interactive deadlines and restoration | A blanket future-date check would prevent completion or renaming of overdue todos and restoration of historical backups. | Apply the minimum-one-minute rule to newly supplied or changed interactive deadlines. Allow unchanged overdue dates on other updates and valid historical dates on import. Validate recurrence/reminder invariants against the merged record. |
| Tag contrast | PRP 06 calls for white text on arbitrary tag colors while also requiring WCAG AA contrast. | Preserve the selected background color and choose a contrast-compliant foreground rather than requiring white text. |
| Timestamp representation | SQLite defaults, Singapore-local strings, and ISO timestamp examples are inconsistent across specifications. | Use the timestamp contract under Implementation Ownership and Contracts. Singapore remains the application calendar/display timezone; UTC storage does not change product timezone behavior. |

## Unresolved Product Questions

Do not silently choose behavior for these cases. Record the approved resolution here before implementing the affected behavior.

- **Reopening recurring occurrences:** Should reopening and recompleting an occurrence create another successor, or must an occurrence have at most one successor for its lifetime? A `false -> true` check prevents duplicate requests on an already-completed record but does not settle this case. The current schema has no explicit successor or chain link.
- **Ambiguous case-insensitive tag reuse:** Normal tag uniqueness is case-sensitive, so one user can have existing names differing only by case. Import requires case-insensitive reuse, but does not specify which existing tag wins if several match. Keep normal uniqueness unchanged until a selection or normalization policy is approved.

## Verification and Evaluation Gates

- Create all eight tables and enable `PRAGMA foreign_keys = ON`.
- Implement every route in the one-shot API surface plus the approved authenticated passkey-enrollment flow. Authenticate protected APIs first and scope all user-owned reads/writes by `session.userId`; apply the public authentication exceptions above.
- Route Singapore-time-sensitive calculations through `lib/timezone.ts`; do not use raw `new Date()` for application date/time logic.
- Pass production build, lint, and TypeScript checks; leave no `console.log` in shipped code.
- Cover unit, integration, and E2E behavior. The one-shot names 12 Playwright specs (the due-date spec may be folded into CRUD); the evaluation asks for all feature flows and three consecutive stable runs. Project testing rules target at least 80% coverage.
- Use isolated test databases and independent E2E fixtures rather than depending on a previous spec having run. Configure actual virtual WebAuthn authenticators through Chromium DevTools Protocol; browser flags alone do not create an authenticator.
- Test transaction rollback, concurrent recurrence completion, cross-user access through parent/child relationships, reminder boundaries, and Singapore/UTC date boundaries. State the scope of coverage measurements.
- Measure acceptance thresholds rather than assuming them: sorting 500 todos under 50 ms, filtering 1,000 todos under 100 ms excluding the intentional 300 ms debounce, importing 500 todos under five seconds, average API responses under 300 ms, and CRUD p95 under 300 ms. Verify the remaining frontend, accessibility, and browser targets in `EVALUATION.md` under documented conditions.
- Check WebAuthn/session security, input validation, prepared SQL, cookie attributes, CSRF/rate limiting expectations, accessible controls/contrast, and responsive behavior.
- MVP evaluation includes a working HTTPS deployment, persistent database, production authentication, all core features, passing E2E tests, and no critical bugs. SQLite persistence must be considered when choosing a deployment platform; the deployment docs favor Railway with a persistent volume over Vercel's ephemeral filesystem.
- Target an initial single Railway application instance with a persistent SQLite volume and configurable database path. Verify data survives restart and redeployment, exercise backup/restore, and smoke-test production passkeys on the configured HTTPS origin. Vercel's ephemeral filesystem alone does not satisfy persistence.

## Known Documentation Mismatches

- The PRP index groups authentication last or parallel, while the one-shot and API contract require it first.
- The one-shot's feature order places recurrence before reminders and tags, despite recurrence inheritance requirements. Use the dependency-safe sequence above.
- Evaluation and the PRP index describe search over tag names in places, while the one-shot and detailed search behavior specify titles and subtasks.
- Test counts vary: the one-shot enumerates 12 Playwright specs, while other documentation says 11 feature suites. Due-date tests may be included in the CRUD suite; preserve behavior coverage rather than forcing a file count.
- The security and testing rules add expectations not fully enumerated in the one-shot, including CSRF/rate limiting and unit/integration coverage. Treat them as additional project quality gates.
- The README's former sample tree incorrectly placed PRPs under `.github/`; the canonical target tree now places all PRPs in the root `PRPs/` directory and is referenced by both agent guides.

## Team Pitfalls and Prevention

- **Stale checkout:** Remote commits may change requirements, APIs, or files while an agent is starting. Check `git status --short --branch`, fetch the configured remote, and fast-forward with `git pull --ff-only` before reviewing task requirements or making design/implementation decisions. Do not mistake `git fetch` alone for updating the working tree.
- **Concurrent edits lost or accidentally included:** Inspect status and diffs before editing and before committing. Preserve work you did not create; never use reset/checkout or other destructive commands to clear conflicts. Stage only files belonging to the current task unless explicitly asked otherwise. If a safe update is blocked by local edits or branch divergence, coordinate rather than guessing.
- **Conflicting or obsolete requirements:** Read this file, the relevant PRP, and the README hierarchy after synchronizing. Treat explicit resolutions here and in the one-shot spec as controlling; do not silently merge contradictory requirements. Record new decisions and update the shared source documents as required.
- **Files created in the wrong place:** Follow the README target hierarchy. Keep PRPs at the repository root, not under `.github/`; keep application code, shared logic, tests, and scripts in `app/`, `lib/`, `tests/`, and `scripts/` respectively. The current repository is documentation-only, so scaffold before assuming source code or test commands exist.
- **Cross-feature contract breaks:** Keep user data scoped to `session.userId`; keep database access server-side; use prepared statements and enable SQLite foreign keys. Use transactions for multi-table operations such as import. Recurrence must carry forward tags and reminder settings, and templates must preserve their specified subtask snapshot.
- **Timezone/date regressions:** Route application date/time calculations through `lib/timezone.ts`. Test recurrence month-end/leap-year behavior and Singapore calendar boundaries rather than relying on local machine timezone.
- **Unverified changes:** Use tests and checks appropriate to the changed layer: unit/integration for domain and persistence logic, Playwright for critical user flows, plus build/lint/type checks. Do not claim tests pass when the app has not yet been scaffolded or the checks were not run.
- **Architecture drift:** Preserve the specified single Next.js app and monolithic main todo client page unless a shared design decision explicitly changes that convention. Do not introduce duplicate project trees or unapproved abstractions while parallel work is in flight.
- **Agent path drift:** Agent definitions live in the repository-local `.claude/agents/` directory. Refer to those checked-in files rather than `~/.claude/agents/` when documenting this project's agents.
