# Feature Spec: User Login / Authentication

Status: Draft — final MVP feature, following Task Management, Recurring Tasks, Weekly Overview, Task Progress Tracking, and MySQL Persistence (all implemented).
Builds on: [requirements.md](../requirements.md) §5 (User Login) and its Global Constraint "Auth gates everything," plus [specs/mysql-persistence.md](mysql-persistence.md), which already anticipated this feature (`users` table, `tasks.user_id`, additive migration plan) without implementing it.

This spec does **not** implement anything. It touches every existing feature only insofar as their data must become owned by a user — no behavior, UI, or computation described in specs/recurring-tasks.md, specs/weekly-overview.md, or specs/task-progress.md changes.

---

## Scope

- Register (email + password), log in, log out.
- Secure password hashing (never plaintext, never logged).
- Session-based authentication (a cookie identifies the caller; no client-managed tokens).
- Protecting every task-related route/action so only authenticated users can reach them.
- Scoping all task data (`tasks`, `task_completions`) to the owning user, so one user can never see or modify another's data.
- Adding `users` and a `tasks.user_id` column, with a safe migration path for the 4 existing local task rows.

## Non-Goals (explicitly out of scope)

- Email verification, password reset/"forgot password," or "remember me" (per requirements.md's Risks & Assumptions for this feature).
- OAuth/social login — email/password only.
- Roles, permissions, or admin capabilities — every user sees only their own data; there is no concept of an admin or shared/team data (per the app's Global Constraints).
- Rate limiting, CAPTCHA, or brute-force lockout. Worth flagging as a real gap for a public deployment (see [Risks & Assumptions](#risks--assumptions)), but out of scope for MVP, consistent with "keep MVP-simple" and this app's single/few-user personal context.
- Multi-device/"log out everywhere" session management beyond whatever falls out naturally from the chosen session mechanism (see [Open Questions](#open-questions)).
- Any change to Task Management, Recurring Tasks, Weekly Overview, or Task Progress *behavior* — this feature only adds an ownership boundary around existing behavior.
- Charts, streaks, goals, gamification, analytics, notifications, calendar/AI integration — still out of scope per requirements.md's Scope Boundary.

## User Stories

- As a user, I want to create an account and log in, so my tasks and progress are saved to me and available when I return (requirements.md §5, verbatim).
- As a user, I want to be confident no one else can see or change my tasks.
- As a returning user, I want to be sent to the login page automatically if I'm not signed in, rather than seeing broken or empty data.

## Data Model

New `users` table, following the same column conventions already established in specs/mysql-persistence.md (`CHAR(36)` app-generated UUIDs via `randomUUID()`, `DATETIME(3)` in UTC, InnoDB):

| Column | Type | Constraints |
|---|---|---|
| `id` | `CHAR(36)` | `PRIMARY KEY` |
| `email` | `VARCHAR(255)` | `NOT NULL`, `UNIQUE` |
| `password_hash` | `VARCHAR(255)` | `NOT NULL` |
| `created_at` | `DATETIME(3)` | `NOT NULL` |

- `email` is normalized (trimmed, lowercased) by the application before every insert and lookup, per requirements.md's edge case — this is the primary defense for case-insensitive uniqueness, not reliance on MySQL's default collation.
- `password_hash` never leaves the server — it's not part of any type returned to a Server Action caller or rendered in any component.
- No `updated_at`/profile fields — nothing about a `User` is ever edited in this MVP (no profile page, no password change).

`tasks` table change (additive, see [Migration Strategy](#migration-strategy-for-the-4-existing-tasks)):

| Column | Type | Constraints |
|---|---|---|
| `user_id` | `CHAR(36)` | `NOT NULL` (after migration), `FOREIGN KEY REFERENCES users(id) ON DELETE CASCADE` |

`task_completions` gets **no direct column change** — ownership is inherited transitively through `task_completions.task_id → tasks.id`, exactly as specs/mysql-persistence.md already stated. Deleting a user cascades to their tasks (`ON DELETE CASCADE` on `tasks.user_id`), which in turn cascades to their completions (the existing `tasks.id → task_completions.task_id` cascade) — one deletion, two cascades, no new cleanup code.

`src/lib/task-types.ts`'s `Task` type gains `userId: string`, mirroring the DB column. No other existing type changes.

## Technology Decisions

**Decided and approved** — both items below were open questions in the draft version of this spec and have been resolved:

**Password hashing: `bcryptjs`.** Pure JavaScript, no native build step (the project has none today — even `mysql2` is pure JS), well-audited, and the library requirements.md's own Risk note anticipates ("bcrypt/argon2"). Cost factor 12.

**Session mechanism: `iron-session` (stateless encrypted cookie).** The session (just `{ userId }`) lives entirely inside a signed + encrypted HTTP-only cookie; no new database table. Verifying a session is a pure decrypt operation with no DB round-trip. Logout overwrites the cookie with an empty/expired one. Accepted trade-off: there is no server-side session record, so "log out everywhere" or force-revoking a single compromised session isn't possible without adding a blocklist later — acceptable for this app's single/few-user personal scope (see [Non-Goals](#non-goals-explicitly-out-of-scope)).

**Route protection: Next.js `proxy.ts` (this project's Next.js version renamed `middleware.ts` to `proxy.ts` — see the note in AGENTS.md about checking bundled docs for API changes; the exported function is named `proxy`, not `middleware`).** Per Next.js's own guidance, `proxy.ts` runs on the Node.js runtime by default in this version and is explicitly documented as suitable only for **optimistic** checks (reading the session cookie for a fast redirect), not as the sole authorization boundary — "the majority of security checks should be performed as close as possible to your data source." Concretely:

- `src/proxy.ts`, matching all routes except static assets, reads and decrypts the session cookie (no DB call) and redirects to `/login` if absent on a protected route (FR5.7), or redirects an authenticated user away from `/login`/`/register` to `/` (FR5.8).
- Every Server Action and every page in `src/app/` **independently** re-verifies the session server-side (via a shared `verifySession()` helper) before touching any data — this is not optional defense-in-depth, it's the primary enforcement point; `proxy.ts` only exists to avoid rendering a doomed page before redirecting.

## Functional Requirements

Requirements FR5.1–FR5.8 are exactly as specified in requirements.md §5 and are not repeated here verbatim except where this spec adds precision. New requirements needed to actually scope existing data by owner:

- FR5.9: Every `tasks`/`task_completions` read and write in `src/lib/tasks.ts` is scoped to the authenticated caller's `user_id` — `getTasks`, `createTask`, `updateTask`, `deleteTask`, `toggleTaskOccurrence`, `getTaskViewModels`, `getWeeklyOverview`, `getWeeklyProgress`, `getWeeklyPageData` all take a `userId` parameter and add it to every query (`WHERE user_id = ?` on `tasks`; completions are scoped implicitly by only ever joining through a task the caller already owns). This is the exact mechanical follow-up specs/mysql-persistence.md's "Preparing for `user_id` later" section already anticipated: these are plain exported functions, not a class/singleton, so adding a parameter is additive, not a restructuring.
- FR5.10: `src/lib/task-actions.ts`'s four Server Actions each resolve the current session's `userId` server-side (never from `FormData` or any client-supplied value) before calling into `tasks.ts` — the same "never trust the client for identity" principle already applied to `toggleTaskOccurrence`'s completed-state fix.
- FR5.11: Attempting to update/delete/toggle a task that exists but belongs to a different user behaves identically to the task not existing at all (404-equivalent "not found," per requirements.md §1's existing edge case "return 404, not 403, to avoid leaking existence" — now actually reachable once multiple users exist).
- FR5.12: The `/`, `/weekly` pages and all four task Server Actions require an authenticated session; `/login` and `/register` pages do not.

## Session & Route Protection

- On successful login or registration, a session is established (cookie set) and the response redirects to `/` (FR5.5, "Register a new account" scenario).
- `proxy.ts` provides the optimistic, UX-facing redirect for FR5.7/FR5.8 (see [Technology Decisions](#technology-decisions)) — it is not the enforcement point. Every Server Action and every page independently re-derives `userId` from the session via a shared `verifySession()` helper (FR5.10) before reading or writing any data, exactly as Next.js's own authentication guide recommends: a proxy/middleware matcher can be refactored or a route moved without anyone noticing coverage was silently lost, so real enforcement must live next to the data access itself, not in one central file alone.
- Logout clears the session cookie and redirects to `/login`.

## Migration Strategy for the 4 Existing Tasks

This app currently has 4 pre-existing task rows with no owner. **Decision (revised from an earlier draft of this spec):** there is no general application-level rule that "the first registered user inherits all unowned tasks." That would be a permanent, silently-triggered piece of production authorization logic sitting on top of the registration flow forever, for the sake of a one-time data fix — exactly the kind of hidden behavior that becomes a liability the moment a second real registration happens (e.g. in a test environment, or if someone registers before you do). Instead, the 4 rows are handled as an explicit, one-time, manually-run data migration step, decoupled entirely from application code:

1. **Migration `0003` (additive):** `CREATE TABLE users (...)` as specified above, and `ALTER TABLE tasks ADD COLUMN user_id CHAR(36) NULL` — nullable, **no** foreign key yet. This is non-destructive: existing rows simply get `user_id = NULL`. The application code deployed alongside this migration scopes every query by `user_id`, which means **the 4 existing rows become invisible to every account** (including a newly registered one) until explicitly assigned — a safe default (nothing is exposed to the wrong account) rather than a convenient one.
2. **Explicit one-off assignment script (`scripts/assign-legacy-tasks.ts`), run manually, once, by a human decision — never by application/runtime code:** takes a target user's email as a command-line argument, looks up that user, and runs `UPDATE tasks SET user_id = ? WHERE user_id IS NULL` for that specific account. This script is only ever run after a real account already exists (you register normally first, through the app, like any other user) and after you've explicitly decided that account should own these 4 rows — it is never wired into `registerAction` or any other request path. **This is the only way these rows are ever assigned an owner.** If you'd rather not carry them forward at all, simply never run the script for them — they remain permanently unowned and invisible, and are never automatically deleted either (see the next point).
3. **Migration `0004` (tightening, applied only after resolving step 2):** `ALTER TABLE tasks MODIFY user_id CHAR(36) NOT NULL, ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE` — two statements, **no `DELETE`**. This migration must never silently discard orphaned rows: if any task still has `user_id IS NULL` when it runs, the `MODIFY ... NOT NULL` statement fails outright (MySQL refuses to add a `NOT NULL` constraint over existing `NULL`s) and the migration aborts with nothing changed — that failure is the intended, safe behavior, not something to work around with a cleanup `DELETE`. Verify with `SELECT COUNT(*) FROM tasks WHERE user_id IS NULL` returning `0` before applying, exactly the same manual-verification discipline already used for every prior migration in this project.
4. **`npm run db:migrate` itself enforces the gap between steps 1 and 3.** Drizzle's migration runner applies every pending migration in one continuous run with no natural pause between files — on a database that still has orphaned tasks, a single invocation would otherwise apply `0003` and immediately continue into `0004` before a human ever gets the chance to register and run step 2. `scripts/migrate.ts` closes this gap itself: before applying anything, it checks whether `0004` is pending and, if so, whether zero tasks currently have `user_id IS NULL` — including on a database that hasn't even run `0003` yet (where that column doesn't exist at all: every existing row would become an orphan the instant `0003` adds it, so the check falls back to "are there any rows in `tasks` at all"). If tasks are still orphaned, it applies everything strictly before `0004` and then stops with on-screen instructions to register and run `scripts/assign-legacy-tasks.ts` — never touching `0004`. Re-running `npm run db:migrate` afterward picks up exactly where it left off and applies `0004` once the precondition holds. This makes the two-step procedure actually reproducible on any database carrying pre-existing task rows, not just something that happened to work once by coincidence of timing.
   - **This safety net only exists in `scripts/migrate.ts`.** Exactly like the InnoDB gap specs/mysql-persistence.md already documents, the bare `drizzle-kit migrate` CLI has no knowledge of this gate — running it directly against a database with orphaned tasks would attempt `0003` and `0004` together and fail on `0004`'s `NOT NULL` constraint (safely — nothing is deleted — but with a raw SQL error instead of the deliberate, instructive stop above). Always use `npm run db:migrate`, never the bare CLI, for the same reason specs/mysql-persistence.md already gives.

This keeps the same discipline specs/mysql-persistence.md established: additive first, verified, then tightened — and keeps the one-time nature of "what happens to 4 specific rows created during earlier development" entirely out of the permanent authentication/authorization code path.

## Security Requirements

- Passwords are hashed with `bcryptjs` before storage; plaintext passwords are never written to the database, logs, or any error message.
- Password comparison uses the hashing library's constant-time compare function (`bcrypt.compare`), never a manual `===` on a hash.
- Login failure (wrong password) and login failure (no such account) return the exact same generic message and status — "invalid email or password" — with no timing or content difference a client could use to enumerate registered emails (requirements.md's explicit edge case).
- The session cookie is `HttpOnly`, `Secure` (in production), and `SameSite=Lax` at minimum — never readable from client-side JavaScript, never sent cross-site on a state-changing request.
- The session cookie's encryption/signing secret (`SESSION_SECRET`) is a long random value (32+ characters) stored only in `.env.local`, following the exact same pattern `DATABASE_URL` already uses (never committed, `.env.example` gets a placeholder).
- No authentication logic is hand-rolled cryptography — hashing and session encryption/signing both go through established, audited libraries only (requirements.md's explicit Risk for this feature).
- Every existing task query gains a `user_id` scope (FR5.9) — this is the actual enforcement of "each user can only see and modify their own tasks," not merely a UI-level filter. A malicious or buggy client sending another user's task `id` must be rejected server-side regardless of what the UI would normally show.

## Testing Requirements

**Decided:** this feature introduces automated tests — the first in this project — given requirements.md's own Risk flag that "password storage and session handling are the highest-stakes code in this feature." Manual verification (as used for every prior feature) remains necessary for full acceptance-criteria coverage but is no longer sufficient on its own for this feature.

**Framework: [Vitest](https://vitest.dev/).** Chosen as the minimal option appropriate for this project: zero-config TypeScript support (no Babel/ts-jest setup), fast, and it needs no new runtime dependency beyond the test runner itself — this project already runs entirely on Node.js server-side code (Server Actions, Drizzle queries) with no component-rendering tests planned, so a browser/jsdom testing layer (and everything that comes with one, e.g. React Testing Library) is deliberately not introduced. `vitest.config.ts` resolves the existing `@/*` → `src/*` path alias so test files import modules exactly the way application code does.

**No second database.** Tests run against the same local `life_manager` MySQL database already configured via `DATABASE_URL` in `.env.local` — appropriate for this project's single-developer, local-only setup (no CI pipeline exists yet). Every test that touches the database creates its own disposable user(s) with clearly-marked test emails (e.g. `vitest-<random>@example.test`) and any tasks needed for that test, then deletes the user(s) in an `afterEach`/`afterAll` (cascading to their tasks/completions via the existing `ON DELETE CASCADE` chain) — tests never read, modify, or depend on the 4 pre-existing task rows or any other real data.

**Scope, in priority order (matching the feature's actual risk profile):**

1. **Password hashing** (`src/lib/auth/password.ts`) — pure unit tests, no DB: a hashed password verifies correctly; the wrong password fails verification; hashing the same password twice produces different hashes (salting); the plaintext password never appears in the stored hash string.
2. **Cross-user task isolation** (`src/lib/tasks.ts`) — integration tests against the real DB, the highest-priority coverage per your explicit focus: create two disposable users, give each their own tasks (one-off and recurring), and assert that `getTasks`/`getTaskViewModels`/`getWeeklyOverview`/`getWeeklyProgress` for user A never includes anything belonging to user B; assert that `updateTask`/`deleteTask`/`toggleTaskOccurrence` called with user A's session but user B's task `id` behave exactly like the task doesn't exist (returns `null`/no-op) and leave user B's row unmodified.
3. **Registration/login logic** (`src/lib/auth/users.ts` and the auth Server Actions) — integration tests against the real DB: duplicate email (case-insensitive) is rejected; a correct password logs in; an incorrect password and a non-existent email both fail with the same generic outcome (asserted at the function level, not by comparing rendered UI text).
4. Session cookie sealing/unsealing (`src/lib/auth/session.ts`) is exercised indirectly through the above (login/registration establish a session; the isolation tests read it back) rather than tested in isolation — iron-session itself is the audited, already-tested library; this project's own code around it (attaching the right `userId`) is what needs coverage.

**Manual verification remains required** for anything not practical to assert in an automated test: the actual redirect behavior of `proxy.ts` in a browser (FR5.7/FR5.8), the login/register form's error display, and a direct check (e.g. via MySQL Workbench) that `password_hash` is not plaintext after a real registration through the UI.

## Acceptance Criteria

The scenarios from requirements.md §5 apply unchanged (Register, Reject duplicate email, Reject weak password, Log in, Reject incorrect credentials, Log out, Redirect unauthenticated access — not repeated here). This spec adds the ownership-isolation scenarios that only become meaningful once more than one user can exist:

```
Scenario: A user cannot see another user's tasks
  Given "alice@example.com" has a task "Alice's errand"
  And "bob@example.com" has a task "Bob's errand"
  When Bob logs in and views his task list
  Then he sees only "Bob's errand"
  And "Alice's errand" does not appear anywhere in his view

Scenario: A user cannot modify another user's task by id
  Given Alice's task "Alice's errand" has id "abc-123"
  When Bob (authenticated as himself) submits an update/delete/toggle action for task id "abc-123"
  Then the action fails as if the task does not exist
  And "Alice's errand" is not changed

Scenario: Existing tasks remain invisible until explicitly assigned
  Given the database has 4 pre-existing tasks with no owner (user_id IS NULL)
  When any account registers and logs in
  Then none of the 4 unowned tasks appear in that account's task list
  (they remain invisible to everyone until scripts/assign-legacy-tasks.ts is run manually for a chosen account — see Migration Strategy)

Scenario: Legacy tasks appear only for the account they were explicitly assigned to
  Given scripts/assign-legacy-tasks.ts has been run for "you@example.com"
  When "you@example.com" logs in
  Then all 4 legacy tasks appear in that account's task list, unchanged
  When any other account logs in
  Then none of those 4 tasks appear for them

Scenario: Weekly Overview and Progress are scoped per user
  Given Alice and Bob each have their own recurring and one-off tasks
  When Alice views /weekly
  Then the day grid, Open Tasks, times-per-week summary, and progress figure reflect only Alice's tasks
  And are unaffected by Bob's data
```

## Edge Cases

- Registering with an email that differs only in case from an existing account (`User@Example.com` vs `user@example.com`) is rejected as a duplicate — normalization happens before the uniqueness check, not after.
- A logged-in user navigating directly to `/login` or `/register` is redirected to `/` (FR5.8), not shown the form.
- An expired or tampered session cookie is treated identically to "not logged in" — redirected to `/login`, never a crash or a 500.
- Deleting a user (not exposed in any MVP UI, but possible via direct DB action) cascades to delete all of their tasks and completions — consistent with the existing `ON DELETE CASCADE` pattern, not a new behavior needing separate cleanup code.
- The `users` table has no `updated_at`/soft-delete — consistent with "avoid unnecessary schema complexity for MVP" already established in specs/mysql-persistence.md.
- A second, later registration (a second real user) simply creates a normal account with zero tasks — registration never assigns any pre-existing task to anyone; only the manually-run `scripts/assign-legacy-tasks.ts` does that, and only when a human explicitly runs it (see [Migration Strategy](#migration-strategy-for-the-4-existing-tasks)).
- A cookie that fails to decrypt at all (corrupted or genuinely tampered, not just expired) is treated identically to a missing one — both `src/proxy.ts` and `src/lib/auth/session.ts`'s `getSession()` catch any unsealing failure and fall through to "no session" rather than letting the error propagate as a 500.

## Risks & Assumptions

- **No permanent auto-claim behavior for unowned tasks** (revised decision — see [Migration Strategy](#migration-strategy-for-the-4-existing-tasks)): assigning the 4 legacy rows is a one-time, manually-run script, not application logic. Consequence: right after this feature ships, those 4 tasks are invisible to everyone (including you) until you deliberately run the script — this is intentional and safe, not a bug, but worth remembering so it isn't mistaken for data loss.
- **Risk (flagged in requirements.md itself):** password storage and session handling are the highest-stakes code in this app. Mitigated by using established libraries only (`bcryptjs`, `iron-session`) and never hand-rolling cryptography, per [Security Requirements](#security-requirements).
- **Risk:** no rate limiting or brute-force protection on login/register in MVP (see [Non-Goals](#non-goals-explicitly-out-of-scope)) — acceptable for a personal app not yet exposed to the public internet, but should be revisited before any wider deployment.
- **Risk:** with `iron-session`'s stateless cookie, there is no server-side "kill switch" for a single compromised session short of rotating the shared secret (which invalidates *every* session at once). Accepted as an MVP trade-off for this app's scale.
- **Risk:** `proxy.ts` alone is not a security boundary (per Next.js's own guidance, quoted in [Technology Decisions](#technology-decisions)) — every Server Action and page must independently call `verifySession()`. A future contributor adding a new page or action without that call would silently reintroduce an unauthenticated route; this is a real, ongoing discipline requirement, not a one-time implementation detail.

## Open Questions

All four items previously open in the draft of this spec have been decided (session mechanism: `iron-session`; hashing: `bcryptjs`; migration approach: explicit manual script, no auto-claim; testing: Vitest — see the relevant sections above). One small decision remains for you to make **after** implementation, not before:

1. **Who should own the 4 legacy tasks, if anyone:** run `scripts/assign-legacy-tasks.ts <your-email>` after registering to keep them, or simply never run it and leave them permanently unowned and invisible (they are never automatically deleted — migration `0004` fails loudly instead if any are still unowned when it runs, rather than silently discarding them). Either is safe; this spec does not need to decide it up front since the tasks stay invisible-but-intact either way until you choose.
