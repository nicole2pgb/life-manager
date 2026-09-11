# Feature Spec: Task Progress Tracking

Status: Draft — next feature after Task Management, Recurring Tasks, and Weekly Overview (all implemented).
Builds on: [requirements.md](../requirements.md) §4 (Task Progress Tracking), [specs/recurring-tasks.md](recurring-tasks.md), and [specs/weekly-overview.md](weekly-overview.md), reusing the `Task` / `TaskCompletion` model and the server-authoritative date helpers already implemented in `src/lib/task-types.ts`, `src/lib/tasks.ts`, and `src/lib/recurrence.ts`.

This spec does **not** implement anything.

---

## Scope

Task Progress Tracking adds a single, read-only summary — "how much of this week's planned work is done" — reusing data that already exists. It does not add a new page, new data, or new interactivity. This spec covers:

- Defining exactly what counts as "planned" and "completed" for the current week, per task type.
- A percentage/fraction display (e.g. "12/20 this week", "60%").
- Where this summary is shown.
- What happens when there is nothing to track (zero relevant tasks).

## Non-Goals

Explicitly out of scope for this feature:

- Streaks, charts, trend graphs, points, badges, or any gamification.
- "Goals" as a concept (a separate, explicitly out-of-scope backlog item per requirements.md's Scope Boundary).
- Historical or all-time progress. Progress is always "this week" — see [Current-Week vs. Current-Day Progress](#current-week-vs-current-day-progress).
- Any new interactive control. Progress Tracking is a **read-only** summary — completing/un-completing tasks still only happens on the Tasks page or Weekly Overview; nothing here toggles anything.
- A new page. Progress is a small addition to an existing page — see [Interaction with Weekly Overview](#interaction-with-weekly-overview) for exactly where.
- Any persistence beyond one small addition to `Task` (see [Data Model Proposal](#data-model-proposal)). No new entity, no per-occurrence history table for one-off tasks, no changes to `TaskCompletion`.
- PostgreSQL and authentication (still deferred per requirements.md's Global Constraints).

## User Stories

- As a user, I want to see roughly how much of my planned work for the week I've finished, so I stay motivated and know where I stand (requirements.md §4's user story, verbatim).
- As a user, I want that number to update the moment I check something off, without needing to do any extra step.
- As a user, I want a sensible, non-broken display when I have no tasks at all yet.

## What "Progress" Means

Progress is a single fraction for the **current, real calendar week** (Monday–Sunday, containing today): `completed / planned`, where "planned" is the total number of occurrences a user could complete this week across every task, and "completed" is how many of those are actually marked done right now.

This reuses two ideas already fully implemented for other features:
- An "occurrence" is exactly the same concept `specs/recurring-tasks.md` and `specs/weekly-overview.md` already established (a due date for `daily`/`weekdays`, a completion slot for `timesPerWeek`, or — for one-off tasks — the task itself; see below).
- The current week's boundaries are computed via the existing `getWeekRange` helper, exactly as Weekly Overview already does — never re-derived independently (this is the Cross-Feature Risk requirements.md explicitly calls out).

## Which Tasks Count Toward Progress

Every task counts toward the current week's progress **except** a recurring task whose `createdAt` is entirely after this week (the same creation-date cutoff already established in specs/weekly-overview.md), or a one-off task that was completed in some earlier week and has stayed completed since (see the one-off rule below — a one-off task's eligibility depends on its current open/completed state, not on when it was created). Concretely, per type:

### Daily recurring tasks
Every day of the current week from `createdAt` onward (inclusive) is one planned occurrence; a day is completed if a `TaskCompletion` row exists for that date. A daily task created mid-week contributes fewer than 7 occurrences, exactly matching how it already appears in Weekly Overview's day columns for the same week. **Directly reused, not recomputed:** this is precisely the set of items `getWeeklyOverview(now, now).days[*].items` already contains for `daily` tasks — Progress Tracking sums that array rather than re-deriving due dates independently.

### Weekday recurring tasks
Same mechanism as daily, restricted to the task's configured weekdays: only the days within the current week that are both on/after `createdAt` and in `recurrence.days` count as planned occurrences. Also directly reused from `getWeeklyOverview(now, now).days[*].items` — the current implementation places `daily` and `weekdays` items in the same `DayColumn.items` array, so both types are summed together with no per-type branching needed.

### Times-per-week tasks
One task contributes `recurrence.count` planned occurrences (not 7, and not tied to specific days) and `completedCount` completed occurrences, for every `timesPerWeek` task eligible for the current week (`createdAt` on or before the week's Sunday — the same eligibility rule Weekly Overview's summary section already uses). **Directly reused:** this is exactly `getWeeklyOverview(now, now).timesPerWeekItems[*].targetCount` and `.completedCount` — no new counting logic.
- Consistent with specs/recurring-tasks.md, exceeding the target is not an error: if `completedCount > targetCount` for a task (e.g. 4/3), the extra completions still add to the week's total `completed` figure, even though they push that one task's own contribution above its own `targetCount`. The overall week fraction can therefore, in rare cases, exceed 100% (e.g. "21/20"). This is intentional, not a bug — see [Edge Cases](#edge-cases).

### One-off tasks
One-off tasks have no due date and no per-date `TaskCompletion` record. This feature adds one small, targeted piece of data to make their progress contribution well-defined: `Task.completedAt` (see [Data Model Proposal](#data-model-proposal)). A one-off task counts toward the **current week's** progress under either of these two conditions:

- **Still open (carried forward):** `task.completed === false`. This is exactly the same set of tasks Weekly Overview's "Open Tasks" section shows for the current week — this feature is deliberately consistent with that carry-forward model rather than diverging from it. It contributes 1 to `planned` and 0 to `completed`. (There is no need to separately check `createdAt` here: any task that exists at all was necessarily created on or before "now", and "now" always falls within the current week by definition — so every currently-open one-off task automatically qualifies. This is a simplification available *only* because progress always looks at the current week; Weekly Overview needs an explicit `createdAt` cutoff because it can browse arbitrary past/future weeks, but progress cannot.)
- **Completed this week:** `task.completed === true` **and** `task.completedAt` falls within the current week's Monday–Sunday range. It contributes 1 to `planned` **and** 1 to `completed`. Completing a one-off task that had been carried forward from a previous week (still open, still showing in this week's Open Tasks) therefore visibly increases this week's progress the moment it's checked off — matching how completing anything else does.

A one-off task that was completed in a **previous** week (`completedAt` outside the current week's range) contributes nothing to the current week's totals — it's neither open now, nor completed now. This prevents old, long-since-finished tasks from permanently inflating every future week's numbers.

### Creation-date cutoff
As with Weekly Overview, no task of any type contributes an occurrence to a date before its own `createdAt`. This is inherited for free for `daily`/`weekdays`/`timesPerWeek` by reusing `getWeeklyOverview`'s output. For one-off tasks it's automatically satisfied rather than separately checked — see above.

## Completed vs. Remaining Counts

- **Completed** = the sum of every counted occurrence above that is currently marked done: a `TaskCompletion` row exists for that date (recurring tasks), or `task.completed === true` with `task.completedAt` falling in the current week (one-off tasks).
- **Remaining** = `planned - completed`. Not displayed as its own number in the MVP UI (FR4.1 only asks for "completed vs. total"), but trivially derivable if a future iteration wants it — no extra computation needed.
- Both numbers are always computed fresh from current data on every page load (no caching, no stored snapshot) — consistent with the existing edge case already established for Weekly Overview and Task Management: deleting a task immediately removes its contribution from both `planned` and `completed`.

## Percentage Calculation

`percentage = planned === 0 ? null : round((completed / planned) * 100)`. `null` signals the "nothing planned" neutral state (see below) rather than being coerced to `0%` or `NaN%`. The percentage is derived at display time from `completed`/`planned` — it is not stored as its own field, so there is exactly one source of truth for the underlying numbers.

Display: the primary text is always the exact fraction ("12/20 this week"), which is accurate even when it exceeds 100% (see the `timesPerWeek` over-target case above). If a progress bar is also shown, its **fill width** is capped at 100% (`Math.min(100, percentage)`) so an over-100% week doesn't visually overflow the bar — the bar is a supplementary visual, the fraction text remains the source of truth.

## Behavior When There Are Zero Relevant Tasks

When `planned === 0` (no daily/weekdays occurrences due this week, no eligible `timesPerWeek` tasks, and no one-off task either currently open or completed this week), render a neutral empty state — e.g. "No tasks planned this week" — never `0/0`, `NaN%`, or a crash. This directly matches requirements.md's FR4's acceptance criteria and edge case.

## Current-Week vs. Current-Day Progress

Progress Tracking in this MVP is **weekly only** — there is no separate "today's progress" indicator anywhere. This matters because the weekly total for `daily`/`weekdays` tasks includes **every day of the current week, including days that haven't happened yet**: early in the week (e.g. Monday), a daily task already contributes all 7 of that week's occurrences to `planned`, even though only one day has passed. This means the percentage naturally starts low early in the week and rises as the week progresses, even with perfect day-by-day completion — this is expected and intentional (it mirrors "how much of the week's plan is done", not "how am I doing today"), not a bug to fix. See [Edge Cases](#edge-cases).

## Interaction with Weekly Overview

**Placement:** the progress summary is shown as a small block at the top of the existing Weekly Overview page (`/weekly`), above the day grid. It is not duplicated onto the Tasks page (`/`) in this MVP — confirmed as the final decision; see [Risks & Assumptions](#risks--assumptions) for why.

**Independence from week navigation:** Weekly Overview supports navigating to past/future weeks via `?week=YYYY-MM-DD` (specs/weekly-overview.md), but per requirements.md's explicit "progress is always scoped to 'this week' only — no historical progress", **the progress summary always reflects the real, current calendar week — never the week the user has navigated Weekly Overview to.** Concretely: the progress summary must be computed from its own `getWeeklyOverview(now, now)` call (or an equivalent dedicated function — see Data Model Proposal), not from whatever `overview` object the page already computed for the potentially-different navigated week. This is the single most important implementation detail in this spec to get right — reusing the page's navigated-week `overview` object directly would silently make the progress summary show the wrong week's numbers whenever the user clicks "Previous/Next week."

A user browsing a past or future week will therefore see a progress summary that doesn't match the grid below it (e.g. "12/20 this week" while looking at last week's completed grid). This is a deliberate, requirements-driven limitation, not an oversight — consider labeling the summary distinctly (e.g. "This week's progress" as its own heading, separate from the navigated date range already shown above the grid) to reduce confusion.

## Data Model Proposal

One small, targeted addition to `Task`; no changes to `TaskCompletion`, and no new entity:

```ts
// Change to src/lib/task-types.ts

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  completed: boolean;         // meaningful only when recurrence is null — unchanged
  completedAt: string | null; // meaningful only when recurrence is null — new
  recurrence: RecurrenceRule | null;
  createdAt: string;
  updatedAt: string;
};
```

**Semantics of `completedAt`** (this is the only behavior change to existing task logic that this feature requires):
- Meaningful **only** for one-off tasks (`recurrence === null`), exactly mirroring how `completed` itself is already documented as "meaningful only when recurrence is null." For a recurring task, `completedAt` is simply never set and never read — recurring tasks continue to use `TaskCompletion` rows exclusively for occurrence history, unchanged from specs/recurring-tasks.md.
- `Task.completed` remains the simple boolean that already drives display everywhere else (Tasks page, Weekly Overview's Open Tasks) — this feature does not change what `completed` means or how it's toggled.
- `completedAt` is set to the current timestamp at the moment `completed` transitions from `false` to `true` (i.e. in `toggleTaskOccurrence`'s existing one-off branch, and nowhere else).
- Reopening a one-off task (toggling `completed` from `true` back to `false`) clears `completedAt` back to `null`. The same reset already happens to `completed` itself when recurrence is removed from a task (`updateTask`'s existing "isRemovingRecurrence" branch) — that branch must also clear `completedAt` to `null` for the same reason: a task with `completed === false` should never carry a stale `completedAt`.
- Existing tasks created before this field existed won't have it in the shared in-memory store; normalize a missing `completedAt` to `null` the same way the store already normalizes a missing `recurrence` to `null` (see the existing normalization loop in `src/lib/tasks.ts`).

```ts
// Suggested addition to src/lib/task-types.ts

export type WeeklyProgress = {
  weekStart: string; // Monday, "YYYY-MM-DD" — always the real current week
  weekEnd: string;   // Sunday, "YYYY-MM-DD"
  completed: number;
  planned: number;   // 0 means "nothing planned this week" — render the neutral state
};
```

**Suggested new server-only function**, alongside `getWeeklyOverview` in `src/lib/tasks.ts`:

- `getWeeklyProgress(now: Date): WeeklyProgress` — takes only `now` (no anchor date; it always computes the week containing `now`, by construction ruling out the "wrong week" bug described above). Internally:
  1. Calls `getWeeklyOverview(now, now)` to get the current week's `days` and `timesPerWeekItems` — reused, not recomputed.
  2. `plannedFromDays = sum of days[*].items.length`; `completedFromDays = sum of days[*].items.filter(i => i.isCompleted).length`.
  3. `plannedFromTimesPerWeek = sum of timesPerWeekItems[*].targetCount`; `completedFromTimesPerWeek = sum of timesPerWeekItems[*].completedCount`.
  4. Separately, iterates `getTasks()` for one-off tasks (`recurrence === null`) and, for each, applies the rule from [One-off tasks](#one-off-tasks): `!task.completed` → +1 `plannedFromOneOff`; `task.completed && completedAt within [weekStart, weekEnd]` → +1 to both `plannedFromOneOff` and `completedFromOneOff`; otherwise (completed in an earlier week) → contributes nothing.
  5. Returns `{ weekStart, weekEnd, planned: plannedFromDays + plannedFromTimesPerWeek + plannedFromOneOff, completed: completedFromDays + completedFromTimesPerWeek + completedFromOneOff }`.

This keeps the one-off-task counting rule (the only genuinely new logic in this feature) isolated to a few lines, while every other task type's contribution is a pure reduction over data `getWeeklyOverview` already produces.

## Functional Requirements

- FR1: The current, real calendar week's progress is shown as "`completed`/`planned` this week" at the top of the Weekly Overview page (FR4.1 in requirements.md).
- FR2: `planned` = the sum of: `daily`/`weekdays` occurrences due this week (subject to the creation-date cutoff) + each eligible `timesPerWeek` task's `count` + every one-off task currently open (carried forward into this week's Open Tasks) or completed within this week (FR4.2 in requirements.md, with the one-off rule as resolved in this spec).
- FR3: The fraction is accompanied by a simple visual indicator (a progress bar, fill capped at 100%) — no charts, streaks, or trend graphs (FR4.3 in requirements.md).
- FR4: The figure is computed fresh on every page load from current data — no caching or stored snapshot — so it updates immediately after any completion/un-completion, creation, or deletion, the same way Weekly Overview already does (FR4.4 in requirements.md; relies on the `revalidatePath("/weekly")` calls already present in every task server action).
- FR5: When `planned === 0`, a neutral empty-state message is shown instead of `0/0`, `NaN%`, or an error.
- FR6: The progress summary always reflects the real current week, independent of any `?week=` value Weekly Overview is currently navigated to.
- FR7: `Task.completedAt` is set when a one-off task's `completed` flag transitions to `true`, and cleared to `null` whenever `completed` transitions (back) to `false` — whether via toggling or via the existing recurrence-removal reset. It is never set or read for a recurring task.

## Acceptance Criteria

```
Scenario: Progress reflects completed and total occurrences
  Given this week has 20 total planned occurrences across all eligible tasks
  And 12 of them are currently completed
  Then the progress summary shows "12/20"

Scenario: Progress updates on completion
  Given the progress summary currently shows "12/20"
  When I mark one more occurrence complete (from the Tasks page or Weekly Overview)
  Then the progress summary updates to "13/20"

Scenario: Progress updates on un-completion
  Given the progress summary currently shows "13/20"
  When I un-complete an occurrence I previously completed
  Then the progress summary updates to "12/20"

Scenario: No tasks planned this week
  Given I have no tasks at all, or none eligible for the current week
  Then the progress summary shows a neutral empty state, not "0/0", "NaN%", or an error

Scenario: One-off task created this week counts toward progress
  Given I create a one-off task "Buy groceries" today
  Then planned increases by 1
  When I mark it complete
  Then completedAt is set to today's date
  And completed increases by 1

Scenario: Completing a carried-forward one-off task increases this week's progress
  Given a one-off task "Buy groceries" was created last week and is still incomplete
  And it currently appears in this week's Weekly Overview "Open Tasks" section
  And it already contributes 1 to this week's planned count (as an open task)
  When I mark it complete today
  Then completedAt is set to today's date
  And this week's completed count increases by 1
  And "Buy groceries" no longer appears in Open Tasks

Scenario: A one-off task completed in a previous week does not count toward this week
  Given a one-off task "Old errand" was completed last week (completedAt falls in last week's range)
  When I view this week's progress summary
  Then "Old errand" contributes neither to planned nor to completed this week

Scenario: Reopening a one-off task clears completedAt and reverts its contribution
  Given a one-off task "Buy groceries" was completed earlier this week and currently contributes 1 to both planned and completed
  When I mark it incomplete again
  Then completedAt is cleared to null
  And "Buy groceries" still contributes 1 to planned (it's open again, carried forward)
  But no longer contributes to completed
  And it reappears in this week's Open Tasks

Scenario: Daily task contributes all 7 days regardless of how much of the week has passed
  Given a daily task "Take vitamins" existed for the entire current week
  And today is Tuesday with only Monday and Tuesday completed
  Then "Take vitamins" contributes 7 to planned and 2 to completed for this week

Scenario: Times-per-week task contributes its target, not 7
  Given "Gym" is set to 3 times per week with 2 completions so far
  Then "Gym" contributes 3 to planned and 2 to completed

Scenario: Exceeding a times-per-week target still counts extra completions
  Given "Gym" is set to 3 times per week and has 4 completions this week
  Then "Gym" contributes 3 to planned and 4 to completed
  And the overall week fraction may exceed 100% as a result — this is not an error

Scenario: Deleting a task recalculates progress immediately
  Given "Gym" (timesPerWeek, target 3, 2 completed) is included in this week's totals
  When I delete "Gym" from the Tasks page
  Then planned decreases by 3 and completed decreases by 2 on the next page load

Scenario: Progress ignores Weekly Overview's week navigation
  Given the real current week's progress is "12/20"
  When I navigate Weekly Overview to next week or last week
  Then the progress summary still shows "12/20" (the real current week), not the navigated week's numbers
```

## Edge Cases

- A daily/weekdays occurrence for a day that has already passed this week and was never completed counts as "not completed" toward the total — no distinction between "missed" and "not yet due" (inherited from specs/weekly-overview.md's identical rule).
- Early in the week, a low percentage despite perfect completion so far is expected (see [Current-Week vs. Current-Day Progress](#current-week-vs-current-day-progress)) — do not "fix" this by only counting elapsed days; that would contradict FR4.2's literal definition of "planned" and would make the number harder to reconcile with the Weekly Overview grid, which also always shows all 7 days.
- A `timesPerWeek` task exceeding its target can push the week's overall total above 100% — display the bar capped at 100% width, but the fraction text uncapped and accurate (e.g. "21/20").
- A one-off task's recurrence can be changed after creation (e.g. edited to become `daily`). Since recurrence is not versioned anywhere else in this app, at computation time the task is evaluated under whatever recurrence it *currently* has — if it was one-off when created this week and is later made recurring, it stops being counted via the one-off rule and starts being counted via the daily/weekdays rule instead, with no double-counting and no special-case code needed (this falls out naturally from evaluating `task.recurrence` fresh every time).
- A task deleted mid-week disappears from both `planned` and `completed` immediately, since progress is always recomputed from current data (never cached) — matching the existing edge case already documented for Weekly Overview and requirements.md §4.
- If the server process restarts (dev hot-reload) and the in-memory store is genuinely empty, progress correctly shows the zero-tasks neutral state — no special handling needed beyond FR5.
- A one-off task can be completed and reopened multiple times within the same week (e.g. checked, unchecked, checked again). Each transition to `true` resets `completedAt` to the current moment, so only the *latest* completion matters for whether it currently counts — there is no history of intermediate toggles, consistent with `TaskCompletion`'s own idempotent-per-day behavior for recurring tasks.
- A one-off task carried forward from several weeks ago and completed today counts fully toward *this* week's progress (both planned and completed), even though it was "supposed to" have been done long ago. This is intentional — Progress Tracking has no concept of overdue/backlog weighting, matching the "no missed/overdue state" rule already established in specs/weekly-overview.md.
- Existing one-off tasks created before this feature shipped won't have a `completedAt` in the shared in-memory store even if `completed` is already `true`. Treat a missing `completedAt` the same as `null` during normalization (see Data Model Proposal) — such a task is then indistinguishable from "completed in an unknown, non-current week" and correctly contributes nothing to the current week's progress unless it's later reopened and recompleted.

## Validation Rules

No new user input is introduced by this feature. Progress Tracking is entirely derived, read-only output — there is nothing to validate.

## Risks & Assumptions

- **Decision:** One-off tasks count toward the current week's progress by mirroring Weekly Overview's "Open Tasks" carry-forward model exactly, using a new `Task.completedAt` timestamp to determine whether a completion happened *this* week. This was a revision from an earlier version of this spec, which instead scoped one-off tasks to their creation week only (to avoid adding any new field) — that approach was rejected because it could make the denominator shrink when an old task was completed without the numerator ever growing to match, which doesn't read as "progress." Introducing `completedAt` (which was actually already present in requirements.md's original Data Model Overview for one-off tasks, but never implemented) resolves this precisely and keeps Progress Tracking's one-off handling consistent with Weekly Overview's, rather than introducing a second, conflicting notion of "which week does this one-off task belong to."
- **Decision:** The progress summary lives only on `/weekly`, not duplicated onto the Tasks page (`/`). Weekly Overview is already the page scoped to "the current week," already computes the exact `days`/`timesPerWeekItems` data `getWeeklyProgress` reduces over, and is already revalidated on every task mutation, so FR4.4 ("updates immediately") comes for free with no new revalidation wiring. A dedicated `/progress` page was considered and rejected as unnecessary ceremony for a single summary line plus a bar, per "keep MVP-simple." Adding it to `/` too later is a trivial extension (call `getWeeklyProgress(now)` from a second page) and would not change any computation logic in this spec.
- **Assumption:** Progress is computed independently of whatever week Weekly Overview is currently navigated to, per requirements.md's "this week only" framing. See [Interaction with Weekly Overview](#interaction-with-weekly-overview) for the implementation implication (must not reuse the page's navigated-week `overview` object).
- **Risk:** Because `getWeeklyOverview` and `getWeeklyProgress` both exist and both compute "the current week's occurrences," a future edit to one's due-date/eligibility logic without a matching edit to the other would make Weekly Overview and Progress Tracking silently disagree — the Cross-Feature Risk requirements.md warns about. Mitigated here by `getWeeklyProgress` calling `getWeeklyOverview` internally for everything except the one-off count, rather than re-implementing due-date logic a second time. The one-off rule itself is likewise defined to exactly match Weekly Overview's Open Tasks eligibility, for the same reason.
- **Risk:** Displaying the progress summary on `/weekly` while the page itself may be navigated to a different week could read as a bug to a future contributor unfamiliar with this spec's explicit "always current week" requirement — worth a code comment at the call site, not just this spec, to prevent a well-intentioned "fix" that wires it to the navigated week instead.
- **Risk:** `completedAt` is a small, targeted addition, but it does touch `toggleTaskOccurrence` and `updateTask` — both already-working, already-tested code paths for Task Management and Recurring Tasks. The implementer should extend those functions' existing one-off branches, not restructure them, to avoid regressing already-working toggle/edit behavior (the same caution specs/recurring-tasks.md already gave when it first extended these same functions).

## Open Questions

None — both points that previously needed sign-off (how one-off tasks count toward progress, and where the summary is shown) have been decided as described above.
