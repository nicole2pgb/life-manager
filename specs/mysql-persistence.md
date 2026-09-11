# Spec: MySQL Persistence (Drizzle ORM)

Status: Draft — infrastructure change, not a user-facing feature. Builds on [requirements.md](../requirements.md)'s Global Constraints ("Persistence: ... in-memory ... acceptable for MVP ... must be swappable ... without changing calling code"), and must preserve the behavior already specified in [specs/recurring-tasks.md](recurring-tasks.md), [specs/weekly-overview.md](weekly-overview.md), and [specs/task-progress.md](task-progress.md) exactly.

This is the persistence plan for this project: **MySQL with Drizzle ORM**.

This spec defines a schema and migration plan only. **No application code is written and no packages are installed as part of this spec.**

---

## Goal

Replace the in-memory arrays in `src/lib/tasks.ts` (`tasks: Task[]`, `completions: TaskCompletion[]`, both persisted on `globalThis` to survive dev-server hot reloads) with MySQL-backed storage via Drizzle ORM, while every other file in the app — `src/lib/task-actions.ts`, `src/app/page.tsx`, `src/app/weekly/page.tsx`, every component — stays behavior-identical. The exported function names and shapes in `tasks.ts` don't change; their bodies do, and they become `async`.

## 1. Technology

- **Database:** MySQL. A database named `life_manager` already exists; this spec does not create it.
- **ORM:** [Drizzle ORM](https://orm.drizzle.team/) with its MySQL dialect (`drizzle-orm/mysql-core` for schema definition, `drizzle-orm/mysql2` for the query client).
- **Driver:** [`mysql2`](https://github.com/sidorares/node-mysql2) (specifically `mysql2/promise`, the promise-based API), the standard, most widely-used MySQL driver for Node.js and Drizzle's recommended MySQL driver.
- **Migrations:** Drizzle Kit (`drizzle-kit generate` to produce SQL migration files from the schema, `drizzle-kit migrate` or a small runner script to apply them). No hand-written SQL migration files and no separate migration tool — Drizzle's own tooling covers this end to end, since the ORM is already in use.

This is a firm, already-made decision (per your context) — not a design decision requiring further approval.

## 2. Tables

### `tasks`

| Column | Type | Constraints |
|---|---|---|
| `id` | `CHAR(36)` | `PRIMARY KEY` |
| `title` | `VARCHAR(200)` | `NOT NULL` |
| `notes` | `VARCHAR(2000)` | nullable |
| `completed` | `BOOLEAN` | `NOT NULL DEFAULT false` |
| `completed_at` | `DATETIME` | nullable |
| `recurrence` | `JSON` | nullable |
| `created_at` | `DATETIME` | `NOT NULL` |
| `updated_at` | `DATETIME` | `NOT NULL` |

### `task_completions`

| Column | Type | Constraints |
|---|---|---|
| `id` | `CHAR(36)` | `PRIMARY KEY` |
| `task_id` | `CHAR(36)` | `NOT NULL`, `FOREIGN KEY REFERENCES tasks(id) ON DELETE CASCADE` |
| `occurrence_date` | `DATE` | `NOT NULL` |
| `completed_at` | `DATETIME` | `NOT NULL` |
| — | — | `UNIQUE (task_id, occurrence_date)` |

Both tables use the `InnoDB` storage engine (MySQL's default for new tables since 5.5) — **`InnoDB` is required**, not optional, since `MyISAM` does not support foreign keys at all; the `ON DELETE CASCADE` behavior this spec relies on depends on it.

### Illustrative Drizzle schema

```ts
// Illustrative only — not implemented by this spec.
// src/lib/db/schema.ts
import { mysqlTable, char, varchar, boolean, datetime, date, json, uniqueIndex } from "drizzle-orm/mysql-core";

export const tasks = mysqlTable("tasks", {
  id: char("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  notes: varchar("notes", { length: 2000 }),
  completed: boolean("completed").notNull().default(false),
  completedAt: datetime("completed_at"),
  recurrence: json("recurrence").$type<RecurrenceRule | null>(),
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

export const taskCompletions = mysqlTable(
  "task_completions",
  {
    id: char("id", { length: 36 }).primaryKey(),
    taskId: char("task_id", { length: 36 })
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    occurrenceDate: date("occurrence_date").notNull(),
    completedAt: datetime("completed_at").notNull(),
  },
  (table) => ({
    oneCompletionPerTaskPerDay: uniqueIndex("one_completion_per_task_per_day").on(
      table.taskId,
      table.occurrenceDate,
    ),
  }),
);
```

`recurrence`'s `$type<RecurrenceRule | null>()` gives Drizzle's TypeScript layer the exact same shape already defined in `src/lib/task-types.ts` — no new type is introduced, and no runtime shape-checking happens at this layer (the JSON column just stores/retrieves whatever object is given; validation stays in `task-actions.ts`, as today).

### Primary keys and foreign keys

- Both `id` columns are `CHAR(36)`, populated by the **application layer** exactly as today — `randomUUID()` from `node:crypto` (already used in `createTask`/`toggleTaskOccurrence`) generates a standard hyphenated UUID string, which fits `CHAR(36)` exactly. No MySQL-side UUID generation function is used; this avoids any dependency on MySQL version-specific UUID functions and keeps the existing code flow (the app already has the id before the insert).
- `task_completions.task_id` is a foreign key to `tasks.id` with `ON DELETE CASCADE`, enforced at the database level.

## 3. Data Rules

- **One-off tasks** (`recurrence IS NULL`) use `tasks.completed`/`tasks.completed_at` directly — unchanged from specs/recurring-tasks.md and specs/task-progress.md. No `task_completions` rows are ever created for a one-off task.
- **Recurring tasks** (`recurrence IS NOT NULL`) use `task_completions` rows exclusively for occurrence history — `tasks.completed`/`tasks.completed_at` are never read or written for a recurring task, matching the "inert while recurring" rule already established in specs/recurring-tasks.md and enforced today in `toggleTaskOccurrence`/`updateTask`.
- **`recurrence` and `completed_at` must never both be non-null on the same task row** — this is the exact invariant `updateTask`'s recurrence-gaining branch was recently fixed to enforce in the in-memory implementation (clearing `completedAt` whenever a one-off task gains recurrence). Recommended as a database-level `CHECK` constraint:
  ```sql
  CHECK (recurrence IS NULL OR completed_at IS NULL)
  ```
  **Requires MySQL 8.0.16 or later** (MySQL only began enforcing `CHECK` constraints, rather than silently parsing and ignoring them, in 8.0.16). See [Assumptions](#assumptions) — if the target MySQL version is older, this constraint should be omitted and the invariant left to the application layer alone (which already enforces it, per the fix referenced above), consistent with "avoid unnecessary schema complexity for MVP."
- **Deleting a task deletes its completion records.** Enforced by `task_completions.task_id`'s `ON DELETE CASCADE` — a single `DELETE FROM tasks WHERE id = ?` removes the task and all its completions atomically, replacing the manual cleanup loop `deleteTask` currently performs in-memory.
- **Recurrence semantics are unchanged** — this spec stores the same `RecurrenceRule` shape already defined in `src/lib/task-types.ts`, as a single `JSON` column:
  - `daily`: `{"type":"daily"}` — due every day, per `isDueOn` in `src/lib/recurrence.ts` (unchanged).
  - `weekdays`: `{"type":"weekdays","days":[1,4]}` — the `days` array (integers 0–6, Sunday–Saturday) lives inline inside the same JSON value; no separate column or table. Due-day matching logic (`isDueOn`) is entirely unchanged — it already just reads `recurrence.days` from whatever `RecurrenceRule` object it's given, regardless of where that object came from.
  - `timesPerWeek`: `{"type":"timesPerWeek","count":3}` — unchanged; weekly counting is still computed by querying `task_completions` for distinct `occurrence_date` values within the week range (see below), exactly as `getWeeklyOverview`/`getWeeklyProgress` do today against the in-memory array.
- **Weekly Overview and Progress Tracking behavior are unchanged.** Both are pure functions of `Task`/`TaskCompletion` data (`getWeeklyOverview`, `getWeeklyProgress` in `src/lib/tasks.ts`) — the day-column placement rules, Open Tasks carry-forward, times-per-week summary, creation-date cutoffs, and the progress fraction/percentage calculation from specs/weekly-overview.md and specs/task-progress.md are **application logic that does not move into SQL**. Only the two lowest-level functions in `tasks.ts` (`getTasks`, `getCompletionsForTask`) change to query MySQL instead of reading arrays; everything built on top of them (`getWeeklyOverview`, `getWeeklyProgress`, `getTaskViewModels`) keeps its exact current logic, just awaiting its now-async dependencies.

## 4. App Architecture

- **New database connection module** (e.g. `src/lib/db/client.ts`): creates a `mysql2/promise` connection pool and wraps it in a Drizzle instance. Cached on `globalThis`, mirroring the exact idiom the in-memory store already uses to survive Next.js dev-server hot reloads without leaking connections:

  ```ts
  // Illustrative only — not implemented by this spec.
  import { drizzle } from "drizzle-orm/mysql2";
  import mysql from "mysql2/promise";

  const globalForDb = globalThis as unknown as { __mysqlPool?: mysql.Pool };
  const pool = globalForDb.__mysqlPool ?? (globalForDb.__mysqlPool = mysql.createPool(process.env.DATABASE_URL!));
  export const db = drizzle(pool);
  ```

- **Drizzle schema defined separately** from both the connection module and from `src/lib/task-types.ts` — in its own file (e.g. `src/lib/db/schema.ts`, shown above). `task-types.ts`'s `Task`/`TaskCompletion`/`RecurrenceRule` types remain the single source of truth for the shapes the rest of the app (`task-actions.ts`, pages, components) works with; the Drizzle schema is a separate, persistence-only concern that the repository layer translates to and from.
- **The in-memory repository in `src/lib/tasks.ts` is replaced, function by function, with DB-backed implementations** using the Drizzle client — `getTasks`, `createTask`, `updateTask`, `deleteTask`, `getCompletionsForTask`, `toggleTaskOccurrence` become Drizzle queries; `getTaskViewModels`, `getWeeklyOverview`, `getWeeklyProgress` keep their existing bodies almost verbatim, just `await`-ing the now-async lower-level calls. Every exported function name and conceptual signature stays the same.
- **Server actions and pages await async DB functions.** `src/lib/task-actions.ts`'s four exported actions and both `src/app/page.tsx`/`src/app/weekly/page.tsx` page components add `await` at each call site that didn't need it before. This is mechanical and compiler-checked (TypeScript fails the build on any missed spot) — no logic changes.
- **No UI behavior changes** beyond what persistence requires — which is none. The UI already treats all of this data as server-computed and re-fetched on every request (`dynamic = "force-dynamic"` on both pages); swapping the underlying storage doesn't change what's rendered or how it's interacted with.

## 5. Environment / Security

- **`DATABASE_URL`** — a single MySQL connection string, e.g. `mysql://app_user:<password>@localhost:3306/life_manager`, used by both the running app and Drizzle Kit's migration commands. `mysql2` and Drizzle both accept a connection URI directly, so one variable is sufficient (no separate `DB_HOST`/`DB_USER`/`DB_PASSWORD`/`DB_NAME`/`DB_PORT` variables are needed unless a future deployment target requires them individually).
- Stored in **`.env.local`**, which is already covered by this repo's `.gitignore` (`.env*`) — never committed. When implementation begins, add a `.env.example` with a placeholder value (e.g. `mysql://app_user:changeme@localhost:3306/life_manager`) so setup is self-documenting, without committing a real credential. Not created by this spec.
- **Dedicated application user, never root:** the connection string uses a MySQL user created specifically for this app (e.g. `app_user`), granted only the privileges it actually needs on the `life_manager` database — `SELECT`, `INSERT`, `UPDATE`, `DELETE` on `tasks` and `task_completions`, plus whatever Drizzle Kit's migration step needs (`CREATE`, `ALTER`, `DROP`, `INDEX`, `REFERENCES` on that same database only). No `GRANT ALL`, no access to other databases, no root credentials anywhere in the application or its configuration. Creating this user and granting these privileges happens outside this spec (a manual or scripted DBA step against the existing `life_manager` database), not as application code.

## 6. Migration Strategy

- **Schema creation via Drizzle migrations.** Write the schema in `src/lib/db/schema.ts` (as sketched above), then run `drizzle-kit generate` to produce the first SQL migration file (creating `tasks` and `task_completions`), and apply it against the existing `life_manager` database with `drizzle-kit migrate` (or an equivalent small apply-migrations script run manually during setup). No hand-written migration SQL.
- **No existing data needs to be migrated.** The in-memory store has never held durable data — it's an array that resets on every server restart and was always documented in code as a placeholder ("Will be replaced by a real database later"). This is a storage-mechanism swap, not a data migration: there is nothing to carry over from memory into MySQL.
- **No `users`/auth tables yet.** Per requirements.md, `User` and authentication are a separate, later feature (§5) — this spec creates only `tasks` and `task_completions`. `user_id` is intentionally not added to `tasks` now.
- **Preparing for `user_id` later:** when authentication is implemented, the planned change is an additive migration — `ALTER TABLE tasks ADD COLUMN user_id CHAR(36), ADD FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`, backfilling existing rows to a placeholder/system user before tightening to `NOT NULL` if desired. Because the repository functions in `tasks.ts` are already plain exported functions (not a class or singleton), adding a `userId` parameter to each and a `WHERE user_id = ?` clause to each query is a mechanical follow-up, not a restructuring. `task_completions` needs no direct `user_id` — ownership is inherited transitively through `task_id`.

## 7. Acceptance Criteria

```
Scenario: Created task persists after a server restart
  Given the app is connected to the `life_manager` MySQL database
  When I create a task titled "Buy groceries"
  And the server process restarts
  Then "Buy groceries" still appears in my task list, unchanged

Scenario: Updating a task persists
  Given an existing task "Buy groceries"
  When I rename it to "Buy groceries and milk" and save
  And the server process restarts
  Then the task's title reads "Buy groceries and milk"

Scenario: Deleting a task cascades to its completion records
  Given a recurring daily task "Take vitamins" with 5 recorded completions in task_completions
  When I delete "Take vitamins"
  Then the task row is removed from `tasks`
  And all 5 of its rows are removed from `task_completions`
  And no orphaned `task_completions` rows referencing that task_id remain

Scenario: One-off task completion persists
  Given an incomplete one-off task "Buy groceries"
  When I mark it complete
  And the server process restarts
  Then `tasks.completed` is true and `tasks.completed_at` holds the completion timestamp for that task

Scenario: Recurring task completion persists by occurrence date
  Given a daily task "Take vitamins" with no completion recorded for today
  When I mark today's occurrence complete
  Then a `task_completions` row exists with that task's id, today's date as `occurrence_date`, and a `completed_at` timestamp
  When I mark it complete again the same day
  Then no second `task_completions` row is created for the same task and date (the unique constraint holds)

Scenario: Weekly Overview reads persisted data correctly
  Given a daily task, a Mon/Thu weekday task, and a times-per-week task, all stored in MySQL with some completions recorded
  When I open the Weekly Overview page
  Then day columns, the Open Tasks section, and the times-per-week summary reflect exactly the persisted state, matching the placement and interactivity rules in specs/weekly-overview.md unchanged

Scenario: Task Progress reads persisted data correctly
  Given a mix of one-off, daily, weekday, and times-per-week tasks with completions stored in MySQL
  When I view the progress summary on /weekly
  Then the completed/planned fraction matches the calculation defined in specs/task-progress.md, computed from the persisted data

Scenario: The app builds and lints successfully
  Given the in-memory repository has been replaced with the MySQL-backed implementation described in this spec
  When I run `npm run lint` and `npm run build`
  Then both complete with no errors
```

## 8. Implementation Notes

- **MySQL uses `JSON`, not PostgreSQL's `JSONB`.** MySQL's `JSON` column type stores and validates well-formed JSON but has no binary-indexed storage format the way Postgres's `JSONB` does, and no equivalent of `JSONB`'s GIN-index-based containment queries. This is not a problem for this schema — the `recurrence` column is only ever read/written as a whole object per row (never queried by its internal fields in SQL), so the lack of `JSONB`-style indexing is irrelevant here.
- **`DATETIME` vs. `TIMESTAMP` in MySQL:** this spec uses `DATETIME` (as specified) for `completed_at`, `created_at`, and `updated_at`, not MySQL's `TIMESTAMP` type. This is a deliberate, correct choice for this app: MySQL's `TIMESTAMP` type auto-converts to/from the connection's session time zone and has magic auto-initialize/auto-update behavior tied to the *first* `TIMESTAMP` column in a table unless explicitly disabled, and its range ends in 2038. `DATETIME` stores the literal value given with no implicit timezone conversion and no arbitrary range limit — which is exactly what the UTC storage strategy below needs.
- **Timezone strategy: store timestamp-like values consistently in UTC.** `tasks.created_at`, `tasks.updated_at`, `tasks.completed_at`, and `task_completions.completed_at` all store UTC instants — the same UTC instant the application already produces via `new Date().toISOString()` (always UTC) at the single-captured-`now` call sites in `toggleTaskOccurrence`/`createTask`/`updateTask`. The persistence layer's job is to pass that value through to `DATETIME` and read it back unchanged — no implicit conversion to or from any local time zone at either end.
- **`occurrence_date` remains a MySQL `DATE`, not a timestamp.** It represents a server-authoritative *calendar date* (computed via `formatISODate`/`getTodayISODate` in `src/lib/recurrence.ts`), with no time-of-day or time zone component at all — the UTC storage strategy above doesn't apply to it because there is nothing in a `DATE` value to convert. This is unchanged from the original schema.
- **Database/driver time zone configuration must be explicit, not an implicit local default.** The MySQL connection must be configured with an explicit UTC time zone (e.g. `mysql2`'s `timezone: "Z"` connection option, or the server session set to `+00:00`) rather than left to whatever the host machine's or MySQL server's default happens to be. An unconfigured connection can silently assume local time on either side, which would corrupt round-tripping the moment the app process and the database server disagree about what a given `DATETIME` value means. This must be verified explicitly during implementation, not assumed from driver defaults — see [Risks](#risks).
- **Preserve server-authoritative date handling.** Every existing "today"/"this week" computation in `src/lib/recurrence.ts` and `src/lib/tasks.ts` (`getTodayISODate`, `getWeekday`, `getWeekRange`, the single-captured-`now` pattern in `toggleTaskOccurrence`/`getWeeklyOverview`/`getWeeklyProgress`) is **application logic and does not move into SQL**. MySQL is not asked to compute "now" or "this week," and it never converts a value to a time zone — the app still captures one `now` per request/mutation, in UTC, and passes explicit date/datetime values into every query, exactly as it passes explicit values into the in-memory array operations today.
- **UI/local-time formatting is outside the persistence layer.** If a future feature ever needs to display a timestamp in a user's local time zone, that conversion happens at render time in the UI, not in `tasks.ts`'s repository functions and not in MySQL — this spec's persistence layer only stores and returns the same UTC instant it was given, unchanged.
- **Avoid unnecessary schema complexity for MVP** — no additional tables, no normalized recurrence columns (the `JSON` column is sufficient, per your instructions), no soft-delete columns, no audit/history tables, no indexes beyond the primary keys, the foreign key, and the one unique constraint that's actually load-bearing (`task_completions`'s `UNIQUE(task_id, occurrence_date)`). An index on `task_completions.task_id` alone (beyond what the foreign key and unique index already provide) is not added separately, since the unique index on `(task_id, occurrence_date)` already serves lookups by `task_id` as its leading column.

## Assumptions

- The `life_manager` database and a dedicated, appropriately-privileged, non-root MySQL user already exist or will be provisioned before implementation begins — this spec does not create either.
- MySQL version is 8.0 or later. This is assumed for `JSON` column support (available since 5.7.8, so not actually a hard requirement) but specifically for the optional `CHECK` constraint on `recurrence`/`completed_at` (which MySQL only enforces from 8.0.16 onward) — if an older MySQL version is targeted, that one constraint should be dropped from the migration and the invariant left to the application layer, which already enforces it.
- A single MySQL instance/database is used for the whole app (no read replicas, no sharding) — consistent with "avoid unnecessary schema complexity for MVP" and the single-user nature of the app today.
- The MySQL connection's session time zone will be pinned explicitly to UTC at connection time, rather than left to whatever the server's default happens to be — see Risks.

## Edge Cases

- **`recurrence` JSON shape validation happens only in the application layer** (`task-actions.ts`'s `parseRecurrenceInput`), not in MySQL. MySQL's `JSON` column type guarantees well-formed JSON syntax but nothing about its internal shape (e.g. it won't reject `{"type":"bogus"}` or a `weekdays` object missing `days`) — this is an accepted trade-off, consistent with "avoid unnecessary schema complexity," since the only writer of this column is the application itself, which already validates before every write.
- **A `task_completions` row's `occurrence_date` is a pure calendar date with no time-of-day or time zone component** — inserting the app's existing `"YYYY-MM-DD"` string (from `formatISODate`) directly as a MySQL `DATE` parameter is safe and unambiguous, since `DATE` carries no time/timezone information to misinterpret.
- **Concurrent double-submit of a completion toggle** (e.g. a rapid double click) is guarded by `UNIQUE(task_id, occurrence_date)` at the database level — the in-memory single-threaded process avoided this race "for free," but a real database with concurrent connections does not, so the constraint is the actual safety net here, not just documentation.
- **Deleting and recreating a task with the same title** produces a new row with a new `id` — there is no reuse of a deleted task's completion history, matching the existing in-memory behavior and specs/recurring-tasks.md's documented edge case.
- **A task whose recurrence is changed after creation** (e.g. `daily` → `timesPerWeek`, or removed entirely) is stored as whatever its *current* `recurrence` value is — MySQL, like the in-memory store today, keeps no version history of past recurrence values; only `task_completions` rows are genuinely historical, exactly as already documented in specs/weekly-overview.md and specs/recurring-tasks.md.

## Risks

- **An unconfigured connection time zone would silently break the UTC storage strategy.** `DATETIME` performs no timezone conversion at all, so if the MySQL connection isn't explicitly pinned to UTC, the app's Node.js process and the MySQL server could disagree about what time zone a given wall-clock value "means" (e.g. the app writes a UTC instant but a locally-defaulted connection reads it back assuming local time), silently shifting every timestamp by the server's UTC offset. Mitigation: set the connection's time zone explicitly (e.g. `mysql2`'s `timezone: "Z"` option) as part of the connection module, and verify this with a small manual round-trip check during implementation rather than assuming driver defaults are already UTC.
- **The `CHECK` constraint on `recurrence`/`completed_at` is version-dependent** (MySQL 8.0.16+) — if implementation targets an environment where the MySQL version isn't yet confirmed, this constraint could be silently ignored on an older server (pre-8.0.16 MySQL parses but does not enforce `CHECK` constraints) rather than failing loudly, giving a false sense of enforcement. Mitigation: confirm the target MySQL version before relying on this constraint, or treat it as best-effort defense-in-depth only, with the application layer as the real enforcement point (as it already is).
- **`mysql2`'s default type mapping for `JSON` and `DATE`/`DATETIME` columns must be verified against what the repository layer expects** — e.g., whether `DATE` values are returned as JS `Date` objects or as strings, and whether `JSON` columns are auto-parsed into objects or returned as raw strings. Getting this wrong would require extra, easy-to-miss conversion code in the repository layer. This should be verified with a small manual check during implementation, not assumed from documentation alone, since driver behavior can depend on configuration/version.

## Non-Goals

- Authentication, sessions, or a `users` table (requirements.md §5 — separate, later feature). `user_id` is explicitly deferred, per your instructions.
- Any change to Task Management, Recurring Tasks, Weekly Overview, or Task Progress *behavior* — this is a storage-mechanism swap only; every acceptance criterion in specs/recurring-tasks.md, specs/weekly-overview.md, and specs/task-progress.md must still hold, unchanged.
- Charts, streaks, goals, gamification, or analytics — still out of scope, as in every prior spec.
- Multi-tenancy, row-level security, or per-user data isolation — follows once `User`/auth exists.
- Read replicas, connection-pool tuning, backup/point-in-time-recovery strategy, or any other production-operations concern.
- Normalized recurrence columns, additional indexes beyond those listed, soft-delete, or audit/history tables — explicitly avoided per "avoid unnecessary schema complexity for MVP."
- Timezone conversion for display or localization purposes — that belongs in the UI layer if it's ever needed, not in this persistence layer, which only stores and returns UTC instants unchanged.
