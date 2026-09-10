# Feature Spec: Recurring Tasks

Status: Draft — next feature after Task Management (implemented).
Builds on: [requirements.md](../requirements.md) §2 (Recurring Tasks), reusing the `Task` shape already implemented in `src/lib/task-types.ts` / `src/lib/tasks.ts`.

---

## Scope

Recurring Tasks extend the existing Task entity — they are not a separate entity, page, or product area. This spec covers:

- Adding a `recurrence` rule to a task at creation or edit time, with three types: **daily**, **specific weekdays**, and **N times per week**.
- Computing, for a given recurring task, whether it is "due today" and what its current-week completion status is.
- Completing / un-completing a recurring task's occurrence from the existing single-page task list (the only page that exists today).
- Editing and deleting recurring tasks, including what happens to their completion history.
- A data model for recurrence and per-occurrence completions that the future Weekly Overview and Progress Tracking features can reuse without redesign.

This spec does **not** cover how Weekly Overview or Progress Tracking render this data — only that the data they'll need already exists in the right shape.

## Non-Goals

Explicitly out of scope for this feature:

- A calendar/weekly grid view (that's the separate, later "Weekly Overview" feature).
- Aggregate progress across all tasks, charts, or percentages (that's the separate, later "Progress Tracking" feature). The only progress UI in this feature is a per-task "X of N this week" count for `timesPerWeek` tasks, shown because the feature is unusable without it.
- Marking/backfilling a past day's occurrence, or completing a future day in advance. Only "today" can be toggled (see [Explicit Behavior](#explicit-behavior-per-recurrence-type)).
- An end date, a maximum number of occurrences, or "pause" for a recurring task — recurrence runs indefinitely until edited or deleted.
- Reminders/notifications.
- Multi-user data, authentication, or a real database (PostgreSQL). The existing in-memory, single-user store (`src/lib/tasks.ts`) is extended, not replaced.
- Any recurrence type beyond the three listed (no monthly, no custom intervals, no "every N days").

## User Stories

- As a user, I want to mark a task as repeating daily, so I don't have to recreate it every day (e.g. "Take vitamins").
- As a user, I want a task to repeat only on specific weekdays, so it only shows up on the days it's relevant (e.g. "English" on Monday and Thursday).
- As a user, I want a task to repeat a certain number of times per week without being tied to specific days, so I have flexibility in when I do it (e.g. "Gym" 3×/week, "Coding" 5×/week).
- As a user, I want to complete or un-complete today's instance of a recurring task independently of other days, so my history stays accurate.
- As a user, I want to edit a recurring task's schedule or delete it entirely, the same way I already can with a regular task.

## Recurrence Types

A task has at most one recurrence rule at a time:

| Type | Meaning | Example |
|---|---|---|
| `none` (default) | One-off task — current behavior, unchanged | "Buy groceries" |
| `daily` | Due every day | "Take vitamins" |
| `weekdays` | Due only on selected weekdays | "English" on Mon + Thu |
| `timesPerWeek` | Due N times per week, any days the user chooses | "Gym" 3×/week |

## Explicit Behavior per Recurrence Type

### Daily
- The task is due every calendar day, indefinitely.
- Each day has its own independent completion state.
- The task list shows a checkbox reflecting **today's** completion state only. Completing it records a completion for today's date; it has no effect on any other day.

### Weekdays
- A task with this recurrence type is considered **due only on its configured weekdays** (any non-empty subset of Monday–Sunday) — it is not due on any other day. For example, a task recurring on Monday and Thursday is not due on Tuesday.
- On a day it is due, it behaves exactly like a `daily` task for that day (independent per-day completion, checkbox reflects today).
- On a day it is **not** due, the task still appears in the list (so the user can see and edit it), but its completion control is disabled — there is no occurrence to complete on a day it isn't scheduled.

### Times per week
- The task is due a fixed number of times (1–7) somewhere within the current week; it is not tied to specific days, and it **remains available (not due/not-due-gated) every day of the week** — unlike `weekdays`, there is no day on which its completion control is disabled.
- The task list shows a weekly counter, e.g. "Gym — 2/3 this week", plus a single "mark done today" checkbox.
- A completion counts **at most once per calendar day**:
  - Checking it records one completion for today's date, increasing the weekly count by 1. Completing (checking) it again on the **same** day is a no-op — it must not create a second completion or increase the count further.
  - Completing it on **another** day within the week increases the count again (once per that day).
  - Unchecking today's completion removes today's completion record and decreases the count by 1.
- The week is Monday–Sunday. Reaching the target count (e.g. 3/3) does not lock the task; the user can still uncheck today or, on a later day that week, check another day. **Exceeding the weekly target is allowed** — the count simply reflects distinct completed dates that week, uncapped at the target (e.g. 4/3 is possible and simply displays as-is, not as an error).
- At the start of a new week (next Monday), the counter resets to 0/N. Prior weeks' completions remain stored and are not altered.

## Data Model Proposal

Extends the existing `Task` type (`src/lib/task-types.ts`) rather than introducing a parallel entity.

```ts
// src/lib/task-types.ts (extended)

export type RecurrenceRule =
  | { type: "daily" }
  | { type: "weekdays"; days: Weekday[] }   // non-empty, unique, 1-7 entries
  | { type: "timesPerWeek"; count: number } // integer 1-7

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday ... 6 = Saturday

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  completed: boolean;        // meaningful only when recurrence is null — see note below
  recurrence: RecurrenceRule | null; // null = one-off task (current, unchanged behavior)
  createdAt: string;
  updatedAt: string;
};
```

New entity — one row per completed occurrence:

```ts
export type TaskCompletion = {
  id: string;
  taskId: string;
  occurrenceDate: string; // "YYYY-MM-DD", calendar date the completion applies to
  completedAt: string;    // ISO datetime the completion was recorded
};
```

**Key rule reducing ambiguity:** `Task.completed` and `TaskCompletion` are never both authoritative for the same task.
- If `task.recurrence === null`, completion state is `task.completed` (current, already-implemented behavior — unchanged).
- If `task.recurrence !== null`, `task.completed` is ignored everywhere (not read, not displayed) and completion state is derived exclusively from `TaskCompletion` rows for that `taskId`. It is not deleted or "used" when recurrence is added — it simply becomes inert. When recurrence is later removed from a task (set back to `none`), the task reverts to using `task.completed`, reset to `false` (existing `TaskCompletion` rows for that task remain in storage but stop being consulted).

**Storage:** Follows the existing pattern in `src/lib/tasks.ts` — an in-memory array (e.g. `completions: TaskCompletion[]`) persisted on `globalThis`, with the same shape of accessor functions (`getCompletionsForTask`, `toggleOccurrenceCompletion`, etc.). No database changes.

**Suggested new/changed server-only functions** (for whoever implements this next — not created by this spec):
- `tasks.ts`: add `recurrence` to `createTask`/`updateTask` inputs; add `toggleOccurrenceCompletion(taskId, dateISO): TaskCompletion[] | null` (server-side toggle, mirrors the existing `toggleTaskCompleted` server-derived pattern — the client never supplies the current state).
- `task-actions.ts`: extend `createTaskAction`/`updateTaskAction` to parse and validate `recurrence` from `FormData`; add `toggleTaskOccurrenceAction(formData)` that reads only `id` from the form, looks up the task server-side, and either toggles `task.completed` (recurrence `null`) or toggles today's `TaskCompletion` (recurrence set) — replacing calls to the existing `toggleTaskAction` for recurring tasks while leaving it as-is for one-off tasks (or unifying into one action; implementation detail left open, behavior is not).
- A small shared helper, e.g. `isDueOn(recurrence, date): boolean` and `getWeekRange(date): { start, end }` (Monday–Sunday), so this logic is written once and is directly reusable by Weekly Overview and Progress Tracking later.

## Functional Requirements

- FR1: The task create/edit form gains a recurrence selector: **None** (default), **Daily**, **Specific weekdays**, **N times per week**.
- FR2: Selecting **Specific weekdays** reveals a multi-select of Monday–Sunday; at least one must be selected to save.
- FR3: Selecting **N times per week** reveals a numeric input for the count; it must be an integer from 1 to 7 to save.
- FR4: The task list displays every task (recurring and one-off) as it does today, plus for recurring tasks: a short label of the schedule (e.g. "Daily", "Mon, Thu", "3× per week") and the appropriate completion control per [Explicit Behavior](#explicit-behavior-per-recurrence-type).
- FR5: Completing/un-completing a recurring task's occurrence only ever affects **today's** date; it never affects other dates or other weeks.
- FR6: Editing a task's title/notes/recurrence uses the same form and validation already implemented for Task Management (title required, ≤200 chars; notes optional, ≤2000 chars) plus the new recurrence validation (FR2, FR3).
- FR7: Changing a task's recurrence rule (including turning recurrence on or off) never rewrites or deletes previously recorded completions for that task.
- FR8: Deleting a task deletes all of its `TaskCompletion` rows along with it (cascade), matching the existing cascade behavior already specified for Task Management.

## Acceptance Criteria

```
Scenario: Create a daily recurring task
  Given I am creating a task
  When I set title "Take vitamins" and recurrence "Daily"
  Then the task is saved with recurrence type "daily"
  And it shows a checkbox reflecting today's completion state

Scenario: Create a specific-weekdays recurring task
  Given I am creating a task
  When I set title "English" and recurrence "Specific weekdays" with Monday and Thursday selected
  Then the task is saved with recurrence type "weekdays" and days [Monday, Thursday]

Scenario: Reject empty weekday selection
  Given I am creating a task with recurrence "Specific weekdays"
  When I submit without selecting any weekday
  Then the task is not saved
  And I see a validation message requiring at least one weekday

Scenario: Create a times-per-week recurring task
  Given I am creating a task
  When I set title "Gym" and recurrence "N times per week" with count 3
  Then the task is saved with recurrence type "timesPerWeek" and count 3
  And it shows "0/3 this week"

Scenario: Reject invalid times-per-week count
  Given I am creating a task with recurrence "N times per week"
  When I enter a count of 0, 8, or a non-integer value
  Then the task is not saved
  And I see a validation message that the count must be between 1 and 7

Scenario: Complete today's occurrence of a daily task
  Given "Take vitamins" is a daily recurring task, not yet completed today
  When I check its completion box
  Then a completion is recorded for today's date only
  And reloading the page still shows it as completed today

Scenario: Un-complete today's occurrence
  Given "Take vitamins" is completed today
  When I uncheck its completion box
  Then today's completion record is removed
  And the checkbox reflects incomplete

Scenario: Weekday task not due today has no active completion control
  Given "English" recurs on Monday and Thursday
  And today is Tuesday
  Then "English" appears in the task list
  And its completion control is disabled, with no way to record an occurrence for Tuesday

Scenario: Weekday task due today can be completed
  Given "English" recurs on Monday and Thursday
  And today is Monday
  When I check its completion box
  Then a completion is recorded for today's date

Scenario: Times-per-week progress increments
  Given "Gym" is set to 3 times per week with 1 completion so far this week
  When I check its "mark done today" box
  Then the weekly count shows "2/3"

Scenario: Times-per-week progress decrements
  Given "Gym" shows "2/3" this week, including a completion recorded today
  When I uncheck today's completion
  Then the weekly count shows "1/3"

Scenario: Times-per-week task only counts once per day
  Given "Gym" shows "1/3" this week with today already completed
  When I attempt to mark it done again today
  Then the weekly count remains "1/3"
  And no duplicate completion record is created

Scenario: Times-per-week week resets
  Given "Gym" showed "3/3" last week
  When a new week (Monday) begins
  Then the weekly count shows "0/3" for the new week
  And last week's 3 completion records remain stored, unchanged

Scenario: Editing recurrence type preserves history
  Given "Gym" (timesPerWeek, 3) has 2 completions recorded this week
  When I edit it to recurrence "Daily"
  Then its recurrence type is updated to "daily"
  And its 2 prior completion records are not deleted or altered

Scenario: Removing recurrence from a task
  Given "Take vitamins" is a daily recurring task with completion history
  When I edit it and set recurrence to "None"
  Then the task becomes a one-off task with completed = false
  And it is no longer shown with a schedule label or weekly counter
  And its prior completion records remain in storage but are no longer read

Scenario: Deleting a recurring task removes its history
  Given "Gym" has 5 completion records
  When I delete the task
  Then the task no longer appears in the list
  And all of its completion records are also removed
```

## Validation Rules

- `weekdays.days`: array of 1–7 unique values from `{0..6}` (Sunday–Saturday); empty array is invalid.
- `timesPerWeek.count`: integer, `1 <= count <= 7`; non-integers, 0, negative numbers, or values above 7 are invalid.
- Recurrence type itself is one of exactly four values (`none`, `daily`, `weekdays`, `timesPerWeek`); no other value is accepted server-side regardless of what the client sends.
- Title/notes validation is unchanged from Task Management (title required ≤200 chars; notes optional ≤2000 chars).
- A completion can only be toggled for **today's date**, determined server-side (never trust a client-supplied date) — this also closes off any possibility of a client backfilling or pre-filling arbitrary dates.
- Toggling a `weekdays` task's occurrence on a day it is not due is rejected server-side (no-op), even if attempted directly (e.g. via a raw request bypassing a disabled UI control).

## Edge Cases

- A recurring task created partway through the day/week only ever has completions from its creation date forward — no retroactive occurrences are implied or backfillable.
- Deleting and recreating a task with the same title does not restore old completion history — it is a new task with a new id.
- A `timesPerWeek` task can end a week "over target" (e.g. 4/3) if the user completes it more days than required; this is not an error state, just displayed as-is.
- Server date/time (not the client's local device clock) is authoritative for "today" and for week boundaries, to prevent client clock manipulation and to keep a single source of truth given there's no per-user timezone setting yet (see [Risks & Assumptions](#risks--assumptions)).
- Concurrent double-submits (e.g. rapid double-click) of a completion toggle must not create two `TaskCompletion` rows for the same task + date — toggling is idempotent per date.

## Risks & Assumptions

- **Assumption:** "Today" and "this week" are computed using the server's local date/time, since there is no authenticated user and thus no per-user timezone yet. This is acceptable for a single-developer/single-timezone MVP and is the same assumption already recorded in requirements.md's Global Constraints; it will need revisiting once auth/timezone-per-user exists.
- **Assumption:** The week runs Monday–Sunday, consistent with requirements.md, so that this feature's `timesPerWeek` counter and the future Weekly Overview never disagree.
- **Assumption:** No UI is needed to complete a day other than today in this feature slice — that capability naturally arrives with the Weekly Overview feature (which will let the user navigate to and interact with other days/weeks). Building it here would duplicate work.
- **Risk:** `timesPerWeek` is the most implementation-complex rule because it has no fixed due dates. Keeping the UI to a single "today" checkbox plus a counter (rather than letting the user pick which past days to mark) keeps the MVP scope small and avoids building calendar-picking UI twice (once here, once in Weekly Overview).
- **Risk:** Extending `Task` with a `recurrence` field and adding a second in-memory store (`TaskCompletion`) touches the same files the Task Management feature already implemented (`tasks.ts`, `task-types.ts`, `task-actions.ts`, `task-item.tsx`). The implementer should extend, not rewrite, those files to avoid regressing already-working Task Management behavior (create/edit/delete/toggle for one-off tasks must keep working exactly as today).

## Open Questions

None — the choices above (server-authoritative "today", Monday–Sunday weeks, today-only completion, inert `completed` field on recurring tasks) were made explicitly to remove ambiguity for implementation rather than leave them open.
