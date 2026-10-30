# Cross-Agent Synchronization

This file records shared architectural decisions, resolved specification conflicts, and implementation-order guidance for all agents working on this repository. Read it before designing or implementing features, together with the relevant PRP.

## Maintenance Rules

- Do not delete, rename, or replace this file. Preserve it across refactors and documentation updates.
- Record every design decision and implementation change in this file as part of the same task. Keep entries concise, noting what changed and the relevant rationale or behavior; do not omit changes because they seem small.
- When source documents conflict, record the conflict and chosen resolution here. Update this record if the source-of-truth decision changes.

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

## Resolved Specification Conflicts

When using the one-shot implementation spec, honor its explicit resolutions over older simplified descriptions in the user guide, evaluation checklist, or PRP index:

- **Authentication order:** Build auth/session primitives before protected routes. The PRP index's suggestion to defer authentication is incompatible with the requirement that every API route check the session.
- **Recurring inheritance:** New instances inherit priority, tags, reminder timing, and recurrence settings. Therefore tags and reminders must be ready before recurrence integration is considered complete.
- **Templates:** Capture subtasks as `{ title, position }` JSON and recreate them on use. Due dates and tags are not captured.
- **Search:** Search todo titles and subtask titles, case-insensitively with a 300 ms debounce. Do not add tag-name text search unless the one-shot spec is revised. Apply filters in this order: search, priority, tag, completion, date range.
- **Reminders:** Poll every 30 seconds; the user guide's one-minute description is outdated relative to the one-shot spec.
- **Todo deletion:** Delete immediately without a confirmation step and rely on SQLite cascade behavior for subtasks and tag links.
- **Export/import:** JSON export includes subtasks and tag names/colors, but not original IDs. CSV is one-way. Import validates the complete structure before writing, remaps IDs, resolves tags by case-insensitive name, and runs in one transaction.
- **Calendar filters:** The calendar shows all of the user's dated todos; list-view filters are not carried over.

## Verification and Evaluation Gates

- Create all eight tables and enable `PRAGMA foreign_keys = ON`.
- Implement every route in the one-shot API surface; authenticate first and scope all user-owned reads/writes by `session.userId`.
- Route Singapore-time-sensitive calculations through `lib/timezone.ts`; do not use raw `new Date()` for application date/time logic.
- Pass production build, lint, and TypeScript checks; leave no `console.log` in shipped code.
- Cover unit, integration, and E2E behavior. The one-shot names 12 Playwright specs (the due-date spec may be folded into CRUD); the evaluation asks for all feature flows and three consecutive stable runs. Project testing rules target at least 80% coverage.
- Check WebAuthn/session security, input validation, prepared SQL, cookie attributes, CSRF/rate limiting expectations, accessible controls/contrast, and responsive behavior.
- MVP evaluation includes a working HTTPS deployment, persistent database, production authentication, all core features, passing E2E tests, and no critical bugs. SQLite persistence must be considered when choosing a deployment platform; the deployment docs favor Railway with a persistent volume over Vercel's ephemeral filesystem.

## Known Documentation Mismatches

- The PRP index groups authentication last or parallel, while the one-shot and API contract require it first.
- The one-shot's feature order places recurrence before reminders and tags, despite recurrence inheritance requirements. Use the dependency-safe sequence above.
- Evaluation and the PRP index describe search over tag names in places, while the one-shot and detailed search behavior specify titles and subtasks.
- Test counts vary: the one-shot enumerates 12 Playwright specs, while other documentation says 11 feature suites. Due-date tests may be included in the CRUD suite; preserve behavior coverage rather than forcing a file count.
- The security and testing rules add expectations not fully enumerated in the one-shot, including CSRF/rate limiting and unit/integration coverage. Treat them as additional project quality gates.
- The README's former sample tree incorrectly placed PRPs under `.github/`; the canonical target tree now places all PRPs in the root `PRPs/` directory and is referenced by both agent guides.
