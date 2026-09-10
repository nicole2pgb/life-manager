# Feature Spec: Weekly Overview

Status: Draft — next feature after Task Management and Recurring Tasks (both implemented).
Builds on: [requirements.md](../requirements.md) §3 (Weekly Overview) and [specs/recurring-tasks.md](recurring-tasks.md), reusing the `Task` / `TaskCompletion` shapes and the server-authoritative date helpers already implemented in `src/lib/task-types.ts`, `src/lib/tasks.ts`, and `src/lib/recurrence.ts`.

---

## Scope

Weekly Overview is a **read-mostly, day-partitioned view** of the same tasks already managed on the Tasks page — it introduces no new task data, only a new way of laying existing tasks out across a Monday–Sunday week, plus the ability to complete/un-complete **today's** occurrence from within that layout. This spec covers:

- A new page showing one Monday–Sunday week, one column (or section) per day.
- Placing each recurring type (`daily`, `weekdays`, `timesPerWeek`) onto the correct day(s), or into a week-level summary for `timesPerWeek`.
- Listing incomplete one-off tasks once per week, in a separate "Open Tasks" section — never repeated across day columns (a one-off task has no due date, so it cannot be "placed" on a specific day).
- Showing each occurrence's completed/incomplete state.
- Navigating to the previous and next week.
- Toggling completion for **today's** occurrence only, reusing the existing toggle action unchanged.

## Non-Goals

Explicitly out of scope for this feature:

- Any aggregate/percentage progress indicator across tasks (that's the separate, later "Progress Tracking" feature — see requirements.md §4). This view shows per-task completion state only, never a total.
- Creating, editing, or deleting tasks from this view. All task authoring stays on the existing Tasks page (`/`); Weekly Overview only displays and toggles completion.
- Adding a "due date" concept to `Task`. One-off tasks have no due-date field today and this feature does not add one (see [One-Off Tasks](#one-off-tasks) for how they're placed instead).
- Completing/un-completing any day other than today, in any week (past, current, or future). This was already a non-goal in specs/recurring-tasks.md and remains one here — the day-by-day layout makes more days *visible*, not more days *editable*.
- Jumping to an arbitrary date/week (e.g. a date picker or "jump to month"). Only sequential previous/next navigation.
- Drag-and-drop rescheduling, a "missed"/"overdue" visual state distinct from plain "incomplete", or any notification/reminder.
- A record of completed one-off tasks anywhere in Weekly Overview. Once a one-off task is completed it simply stops appearing (see [Open Tasks](#open-tasks)); reviewing completed one-off tasks remains the Tasks page's job.
- PostgreSQL and authentication (still deferred per requirements.md's Global Constraints).

## User Stories

- As a user, I want to see my whole week at a glance, so I know what's planned each day without opening each task individually.
- As a user, I want to see which of today's tasks I've already completed, so I know what's left today without leaving this view.
- As a user, I want to check the previous or next week, so I can review what I did or see what's coming up.
- As a user, I want a `timesPerWeek` task (like "Gym") to show my progress for the week without being awkwardly duplicated across days it isn't tied to.

## Which Tasks Appear on Which Days

This is the core ambiguity this spec resolves. Each task type is placed as follows:

### One-off tasks
A one-off task (`recurrence === null`) has no due-date field — it never has, and this feature does not add one (see Non-Goals). It **never appears in a day column** — placing it on a specific day would invent a due date it doesn't have, and would risk showing the same task up to seven times in one week. Instead:
- **While incomplete** (`task.completed === false`): it appears exactly **once per week**, in a separate "Open Tasks" section (not tied to any day column), starting from the week that contains its `createdAt` date and continuing in every subsequent week for as long as it stays incomplete. Reusing the same `completed` boolean already shown on the Tasks page — no new field involved.
- **Once completed** (`task.completed === true`): it is removed from Open Tasks entirely, in every week. It does not reappear anywhere else in Weekly Overview as a "completed" record — completed one-off tasks remain visible only on the Tasks page, which is unaffected by this feature.
- It must never appear in a week that is entirely before its `createdAt` date (a week whose Sunday is earlier than the task's creation date).
- See [Open Tasks](#open-tasks) below for the exact placement rule and interactivity.

### Open Tasks
A dedicated section of the page, separate from the 7 day columns, listing every currently-incomplete one-off task eligible for the displayed week — one entry per task, never one per day:
- **Eligibility:** a task is included if `createdAt`'s calendar date is on or before the displayed week's Sunday (`weekEnd`) — i.e. the task existed by some point during or before this week — and `task.completed === false`. A week whose Sunday is earlier than the task's `createdAt` excludes it entirely, satisfying "must never appear before its creation date."
- **Ordering:** same order as the rest of the app (`getTasks()`'s existing newest-created-first ordering) — no new sort is introduced.
- **Interactivity:** the whole Open Tasks section's toggle controls are interactive only when the displayed week contains today — mirroring exactly how the `timesPerWeek` summary's interactivity is gated (see [Interactivity](#interactivity-only-today-is-ever-actionable)). Viewing a past or future week renders Open Tasks read-only. This is a deliberate extension of the "only today is actionable" principle to a task type that has no per-day granularity of its own — see Risks & Assumptions for the alternative that was considered and rejected.
- Every entry is incomplete by construction (completed tasks are excluded, not shown-then-struck-through), so there is no separate "isCompleted" flag to track here — checking an item's box completes it and it disappears from Open Tasks on the next render, in every week.

### Daily tasks
Appear under **every one of the 7 days** in the displayed week, provided the day's date is on or after the task's `createdAt` date (see [Creation-Date Cutoff](#creation-date-cutoff-applies-to-every-recurrence-type)). Each day's completion state is independent, driven by whether a `TaskCompletion` row exists for that exact date.

### Weekday tasks
Appear **only** under the days matching `recurrence.days`, again subject to the creation-date cutoff. A day that isn't in `recurrence.days` shows nothing for this task at all — unlike the single-page Tasks view (which shows the task with a disabled control on non-due days), the day-partitioned layout doesn't need a disabled state: the task simply isn't listed under a day it isn't due.

### Times-per-week tasks
Do **not** appear under any individual day. Unlike `weekdays`, a `timesPerWeek` task is never gated by which weekday it is — it is available every day of the displayed week (the same "due every day" rule as `daily`, per `isDueOn` in `src/lib/recurrence.ts`), subject only to the creation-date cutoff. Instead of a day cell, each `timesPerWeek` task gets one entry in a separate week-level summary section (e.g. "Gym — 2/3 this week"), computed the same way as the existing single-page counter: the number of distinct `TaskCompletion` dates for that task falling within the displayed week's Monday–Sunday range, versus `recurrence.count` — each date contributes at most one completion toward that count, consistent with the per-day idempotency already established in specs/recurring-tasks.md. If the task's `createdAt` is after the displayed week's Sunday, it's omitted from that week's summary entirely (see below).

The summary entry's single interactive control (see [Interactivity](#interactivity-only-today-is-ever-actionable)) reflects **today's own completion state**, independently of the aggregate count: if a `TaskCompletion` already exists for today's date, the control renders as completed/checked; otherwise it renders as not completed/unchecked. This is the same one-day-at-a-time toggle already implemented for the Tasks page, just displayed here — it is not a per-day breakdown of the whole week, only today's status plus the week's total.

### Creation-date cutoff applies to every recurrence type
A task never appears — on any day, or in the `timesPerWeek` summary — for a week or day that precedes its `createdAt` date. This already existed conceptually in specs/recurring-tasks.md ("no retroactive occurrences... backfillable") but only mattered for "today"; Weekly Overview is the first feature that can display days/weeks before a task existed, so the check must actually be implemented here: `occurrenceDate >= createdAtDate` (both compared as calendar dates, ignoring time-of-day).

## Completed vs. Incomplete Representation

- **Open Tasks entry (one-off task):** every entry shown is incomplete by definition — the moment `task.completed` becomes `true` (via `task.completed`, identical semantics to the Tasks page), the task is simply omitted from Open Tasks rather than shown struck through. There is no "completed" visual state for one-off tasks in Weekly Overview at all — see [One-off tasks](#one-off-tasks) and [Open Tasks](#open-tasks).
- **Daily / weekday task cell (a specific day):** completed = a `TaskCompletion` row exists for `{ taskId, occurrenceDate: thatDay }`. No distinction is made between "incomplete because it's in the past" and "incomplete because it hasn't happened yet" — both simply render as not completed. There is no third "missed" state.
- **Times-per-week summary entry:** shows `completedCount/targetCount` for the displayed week (e.g. "2/3"), exactly like the existing single-page counter, just recomputed for whichever week is displayed instead of always "this week". Reaching or exceeding the target does not hide, disable, or otherwise change the entry (unchanged from specs/recurring-tasks.md) — the count keeps counting past the target (e.g. "4/3") without becoming an error state. Separately from that count, the entry's own toggle (interactive only when today falls within the displayed week) reflects whether **today specifically** has a completion — see [Times-per-week tasks](#times-per-week-tasks).

## Interactivity: Only "Today" Is Ever Actionable

Every cell/entry in the grid is *visible* regardless of which week is displayed, but only the cell(s) corresponding to the **actual current server date** are interactive:

- If the displayed week contains today, the single day-column for today has live, clickable completion controls for its `daily`/`weekdays` items, and both the `timesPerWeek` summary row and the entire Open Tasks section are also interactive (toggling still only ever affects today's date — or, for Open Tasks, the task's single `completed` flag — exactly as in specs/recurring-tasks.md).
- Every other day-column — whether in a past week, a future week, or a non-today day within the currently-displayed week — is **read-only**: no checkbox/button is rendered as clickable (or it is rendered `disabled`), consistent with the non-goal "no backfilling a past day, no completing a future day in advance." The same read-only rule applies to Open Tasks and the `timesPerWeek` summary whenever the displayed week does not contain today.
- This requires no new server-side guard beyond what already exists: `toggleTaskOccurrence(id)` (in `src/lib/tasks.ts`) takes no date argument at all — it always acts on the server's current date regardless of what the client displays or sends. Weekly Overview reuses this action completely unchanged; the read-only rendering on non-today cells is a display-layer concern only, not a new authorization rule.

## One-Off Tasks

Covered in [Which Tasks Appear on Which Days](#one-off-tasks) and [Open Tasks](#open-tasks) above. Restated for clarity: a one-off task never appears in a day column. While incomplete, it appears once per week in the Open Tasks section, starting from the week containing its `createdAt` date and continuing every week after until it's completed, at which point it disappears from Open Tasks (and from Weekly Overview generally) for good. It is otherwise identical in behavior to how it already works on the Tasks page (same `completed` flag, same toggle action, same edit/delete — though editing/deleting still only happens from the Tasks page per Non-Goals).

## Times-Per-Week Representation

Covered in [Which Tasks Appear on Which Days](#times-per-week-tasks) above. Restated: one row per `timesPerWeek` task in a dedicated section of the page (not inside any day column, and never gated by weekday), showing `completedCount/targetCount` for the displayed week, with a single toggle control that is only interactive when the displayed week contains today. That control's checked/unchecked state reflects whether today specifically already has a `TaskCompletion` — a day with an existing completion for the currently interactive day renders as completed, independently of the aggregate count.

## Past and Future Days

- **Past days** (including entire past weeks): rendered exactly as they were recorded — whatever `TaskCompletion` rows exist for those dates determine completed/incomplete. Read-only, per [Interactivity](#interactivity-only-today-is-ever-actionable).
- **Future days** (including entire future weeks): rendered as due-or-not (per recurrence rule) with completion always showing as incomplete, since no `TaskCompletion` row can exist yet for a date that hasn't occurred. Read-only, same as past days — a future day cannot be pre-completed.
- **Today**, when visible in the displayed week: the only interactive day.

## Week Navigation

Per requirements.md FR3.5, the MVP supports **sequential previous/next week navigation** (not an arbitrary date picker):

- The page accepts which week to display via a URL search parameter, e.g. `/weekly?week=YYYY-MM-DD`, where the date is any date within the desired week (the server computes that week's Monday from it using the existing `getWeekRange` logic — the same function already used by `getTaskViewModels`). Omitting the parameter shows the current week.
- A "Previous week" link points to `/weekly?week=<7 days before the currently displayed Monday>`; "Next week" points to `/weekly?week=<7 days after>`. Both are plain links (no client-side state), consistent with this project's existing progressive-enhancement-friendly, mostly-server-rendered approach.
- Navigating weeks is purely a display change: it never creates, deletes, or modifies any `Task` or `TaskCompletion` (FR3.6), and it never changes which date is "today" for interactivity purposes.

## Monday–Sunday Week Boundaries

Unchanged from specs/recurring-tasks.md: weeks run Monday through Sunday, computed server-side via the existing `getWeekRange(date)` helper in `src/lib/recurrence.ts`. Weekly Overview must reuse this exact function (called with the requested week's anchor date, not necessarily "now") rather than re-deriving week boundaries independently, so it can never disagree with the `timesPerWeek` counter already shown on the Tasks page for the current week.

## Data Model Proposal

No changes to `Task` or `TaskCompletion` (see `specs/recurring-tasks.md`). This feature adds only **view/computation** types, analogous to the existing `TaskViewModel`:

```ts
// Suggested addition to src/lib/task-types.ts

export type DayColumn = {
  date: string;        // "YYYY-MM-DD"
  weekday: Weekday;
  isToday: boolean;     // true only for the day matching the server's current date
  items: WeeklyDayItem[];
};

export type WeeklyDayItem = {
  task: Task;           // recurrence is "daily" or "weekdays" for day items — one-off tasks never appear here
  isCompleted: boolean;
  isInteractive: boolean; // === isToday of the containing DayColumn
};

export type WeeklyTimesPerWeekItem = {
  task: Task;            // recurrence.type === "timesPerWeek"
  completedCount: number;
  targetCount: number;   // task.recurrence.count
  isInteractive: boolean; // true only if the displayed week contains today
  isCompletedToday: boolean; // whether today specifically has a TaskCompletion; only meaningful when isInteractive
};

// A one-off task that is still incomplete and eligible for the displayed
// week. Every entry is incomplete by construction — completed one-off
// tasks are simply absent, not shown-then-struck-through.
export type WeeklyOpenTask = {
  task: Task;             // recurrence === null, task.completed === false
  isInteractive: boolean; // true only if the displayed week contains today
};

export type WeeklyOverview = {
  weekStart: string; // Monday, "YYYY-MM-DD"
  weekEnd: string;   // Sunday, "YYYY-MM-DD"
  days: DayColumn[]; // exactly 7 entries, Monday..Sunday in order — one-off tasks never appear in these
  openTasks: WeeklyOpenTask[]; // incomplete one-off tasks, shown once per week, not per day
  timesPerWeekItems: WeeklyTimesPerWeekItem[];
};
```

**Suggested new server-only function** (for whoever implements this next — not created by this spec), alongside `getTaskViewModels` in `src/lib/tasks.ts`:

- `getWeeklyOverview(anchorDate: Date, now: Date): WeeklyOverview` — takes **two** explicit `Date` arguments rather than reading the clock itself: `anchorDate` picks which week to show (derived from the `week` search param, or defaulted by the caller), and `now` is the real current instant, used for every "is this today/this week" check. The caller (the `/weekly` page) captures `now = new Date()` once per request and passes it through to `getWeeklyOverview` — the same captured value is also what the page uses to default `anchorDate` when no valid `week` param is supplied. `getWeeklyOverview` itself never calls `new Date()` internally; this is deliberate, so a request can't have its default anchor date and its "today" checks read from two different instants if the request happens to straddle midnight (the same class of bug already fixed for `getTaskViewModels`/`toggleTaskOccurrence`, which capture their own single `now` internally since they take no anchor date). Given `now`, the function computes `getWeekRange(anchorDate)`, builds the 7 `DayColumn`s (filtering each task by recurrence type — one-off tasks excluded entirely — due-day match, and the creation-date cutoff), builds `openTasks` by filtering all one-off, incomplete tasks whose `createdAt` is on or before the week's `end`, and builds `timesPerWeekItems` the same way `getTaskViewModels` already computes `weeklyCompletedCount`, just parameterized by the requested week's range instead of always "this week". `isToday`/`isInteractive` flags are computed by comparing each column's `date` (or, for `timesPerWeekItems`/`openTasks`, the displayed week's range) to `getTodayISODate(now)`. `isCompletedToday` on a `WeeklyTimesPerWeekItem` is computed exactly as `TaskViewModel.isCompletedToday` already is on the Tasks page: whether a `TaskCompletion` exists for that same `now`'s date.

## Functional Requirements

- FR1: A new page (suggested route: `/weekly`) displays one Monday–Sunday week as 7 day columns/sections, one Open Tasks section, and one `timesPerWeek` summary section, without altering the existing Tasks page at `/`.
- FR2: Each day column shows only `daily`/`weekdays` tasks due on that date (subject to the creation-date cutoff). One-off tasks never appear in a day column, under any circumstance.
- FR3: Incomplete one-off tasks appear once per week in the Open Tasks section (never once per day), starting from the week containing their `createdAt` date and continuing every week until completed; a completed one-off task does not appear in Open Tasks, or anywhere else in Weekly Overview.
- FR4: `timesPerWeek` tasks appear once, in the summary section, never inside a day column (FR3.3 in requirements.md).
- FR5: Every item shows a completed/incomplete state per [Completed vs. Incomplete Representation](#completed-vs-incomplete-representation).
- FR6: Only items on the day matching the server's actual current date (and, for `timesPerWeek` and Open Tasks, only when the displayed week contains today) are interactive; toggling calls the existing `toggleTaskAction`/`toggleTaskOccurrence` unchanged, with no new parameters.
- FR7: "Previous week" and "next week" controls navigate via the `week` search parameter as described above; navigating never mutates any task or completion data (FR3.6 in requirements.md).
- FR8: A week with no applicable tasks on any day, no open one-off tasks, and no `timesPerWeek` tasks shows an empty-state message, not an error.
- FR9: Deleting a task on the Tasks page removes it from every week's Weekly Overview immediately (no separate cleanup needed — the view is always computed fresh from current data, consistent with `dynamic = "force-dynamic"` already used on `/`).

## Acceptance Criteria

```
Scenario: View the current week
  Given I have a daily task "Take vitamins" and a Mon/Thu task "English"
  When I open Weekly Overview with no week parameter
  Then I see the current Monday-Sunday week
  And "Take vitamins" appears under all 7 days
  And "English" appears only under Monday and Thursday

Scenario: Incomplete one-off task appears once in Open Tasks, not in any day column
  Given I created an incomplete one-off task "Buy groceries" today
  When I view the current week's Weekly Overview
  Then "Buy groceries" appears once, in the Open Tasks section
  And it does not appear under any day column, including today's

Scenario: Incomplete one-off task carries forward into future weeks via Open Tasks
  Given I created an incomplete one-off task "Buy groceries" today and it is still incomplete
  When I navigate to next week's Weekly Overview
  Then "Buy groceries" still appears once in that week's Open Tasks section
  And it continues to appear in every later week's Open Tasks until it is completed

Scenario: Completing a one-off task removes it from Open Tasks entirely
  Given "Buy groceries" was created last Monday and has been appearing in Open Tasks ever since
  When I mark it complete
  Then it no longer appears in Open Tasks for the current week
  And it no longer appears in Open Tasks for last Monday's week either
  And it does not appear anywhere else in Weekly Overview as a completed item

Scenario: One-off task never appears in a week entirely before its creation date
  Given I created a one-off task "Buy groceries" today
  When I navigate to the previous week's Weekly Overview
  Then "Buy groceries" does not appear in that week's Open Tasks section
  And it does not appear anywhere else in that week

Scenario: Open Tasks is read-only outside the current week
  Given "Buy groceries" is incomplete and appears in Open Tasks
  When I view a week other than the current week
  Then "Buy groceries" still appears in that week's Open Tasks section
  And its toggle control is disabled (read-only)

Scenario: Times-per-week task shown once, not per day
  Given "Gym" is set to 3 times per week with 2 completions so far this week
  When I view the current week's Weekly Overview
  Then "Gym" appears once, in the weekly summary section
  And it shows "2/3"
  And it does not appear under any individual day column

Scenario: Times-per-week toggle reflects today's own completion, not just the count
  Given "Gym" shows "1/3" this week, and today's date does not yet have a completion
  When I view the current week's Weekly Overview
  Then Gym's toggle control shows as not completed
  When I check it
  Then Gym's toggle control shows as completed
  And the count updates to "2/3"

Scenario: Times-per-week toggle is read-only outside the current week
  Given "Gym" shows "3/3" for last week
  When I view last week's Weekly Overview
  Then Gym's summary entry shows "3/3"
  And its toggle control is disabled (read-only)

Scenario: Toggle today's occurrence from Weekly Overview
  Given "Take vitamins" is not yet completed today
  When I check its box under today's column in Weekly Overview
  Then it shows as completed under today's column
  And it also shows as completed on the Tasks page

Scenario: Past and future days are not interactive
  Given I am viewing the current week's Weekly Overview
  When I look at a day column other than today
  Then its completion controls are disabled (read-only)
  And attempting to toggle them has no effect

Scenario: Navigate to next week
  Given I am viewing the current week
  When I click "Next week"
  Then I see the following Monday-Sunday week's data
  And no task or completion is created, deleted, or modified by navigating

Scenario: Navigate to previous week
  Given I am viewing the current week
  When I click "Previous week"
  Then I see the prior Monday-Sunday week's data, including historical completion state as recorded
  And its day columns are all read-only

Scenario: Recurring task created mid-week is not shown retroactively
  Given a daily task "Meditate" was created this Wednesday
  When I view the current week's Weekly Overview
  Then "Meditate" appears under Wednesday, Thursday, Friday, Saturday, and Sunday
  And it does not appear under Monday or Tuesday

Scenario: Recurring task not shown in a week before it existed
  Given a daily task "Meditate" was created this week
  When I navigate to the previous week's Weekly Overview
  Then "Meditate" does not appear on any day of that week

Scenario: Empty week
  Given I have no tasks at all
  When I view any week in Weekly Overview
  Then I see an empty-state message instead of empty day columns or an error

Scenario: Deleted task disappears from Weekly Overview
  Given "Gym" (timesPerWeek) is shown in this week's summary
  When I delete "Gym" from the Tasks page
  Then it no longer appears in Weekly Overview for that week
```

## Edge Cases

- A `weekdays` task due on a day that has already passed this week (e.g. it's Wednesday and the task was due Monday but not completed) shows as incomplete on Monday's column — not specially flagged as "missed" (see Non-Goals).
- A task's recurrence rule can be edited on the Tasks page at any time; Weekly Overview always reflects the *current* rule for every day shown, including past days — it does not reconstruct what the rule used to be on a given historical day. (This mirrors how `TaskCompletion` history is already decoupled from the current rule in specs/recurring-tasks.md — only completion *records* are historical, the recurrence *rule* itself is not versioned.)
- If a task was recurring in the past but recurrence was later removed (making it one-off), past weeks in Weekly Overview stop showing it under its old recurring days and instead show it (if still incomplete) in that week's Open Tasks section — because "is this task currently one-off or recurring" is not versioned; only completion history is preserved (consistent with specs/recurring-tasks.md's "Removing recurrence from a task" scenario). Conversely, a task that gains recurrence after being one-off stops appearing in Open Tasks and starts appearing in day columns instead, for every week from then on.
- Viewing a week far in the past or future works the same way arithmetically (±7 days per navigation click) — there is no minimum/maximum navigable range in MVP.
- A task created "today" that is `weekdays`-recurring but not due today still correctly appears later in the same week on its actual due day(s) (the creation-date cutoff only excludes days *before* creation, not days after it within the same week).
- Because a one-off task has a single global `completed` flag rather than a per-day record, its presence in Open Tasks is evaluated from its *current* state, not a historical snapshot: navigating back to a past week that falls on or after its `createdAt` date will show it in that past week's Open Tasks too, for as long as it remains incomplete right now. The moment it's completed, it disappears from Open Tasks in every one of those past weeks simultaneously — there is no week-by-week memory of "was it open when I looked last time." This differs from recurring tasks, whose `TaskCompletion` rows are genuinely per-date and immutable history — one-off task placement in Open Tasks is a live reflection of current state, not a historical record.

## Validation Rules

- The `week` search parameter, if present, must parse as a valid date; an invalid or malformed value falls back to the current week rather than erroring (consistent with FR5.7-style graceful handling elsewhere in this app — there is no dedicated error page for a bad query parameter in MVP).
- No other new user input is introduced by this feature — toggling reuses the existing `toggleTaskAction`, which already validates only that a task `id` was provided.

## Risks & Assumptions

- **Assumption:** One-off tasks never appear in a day column — they'd have no real due date to be placed on, and repeating the same task across all 7 days was explicitly rejected as confusing and redundant. Instead, incomplete one-off tasks appear once per week in a dedicated Open Tasks section, from the week containing their `createdAt` date until completed, at which point they disappear from Weekly Overview entirely (not just from Open Tasks — there is no "completed" one-off display anywhere in this feature; that remains the Tasks page's job). This supersedes an earlier version of this spec, which placed one-off tasks in every day column while incomplete — that approach is what created the "same task shown seven times a week" problem this revision fixes. It still deliberately reuses only the existing `completed` boolean and `createdAt` date — no due date, deadline, or new scheduling field was introduced. The direct consequence is that Open Tasks membership in past weeks is a live reflection of *current* completion state rather than immutable history (see the matching Edge Case above) — accepted here as a reasonable MVP trade-off rather than adding a `completedAt`/per-day record.
- **Assumption:** The Open Tasks section's toggle is interactive only when the displayed week contains today, exactly mirroring how the `timesPerWeek` summary is gated. This was a genuine judgment call: since a one-off task's `completed` flag isn't tied to any date at all, completing it from a past or future week's Open Tasks view wouldn't actually "backfill" or "pre-complete" anything the way toggling a specific day's occurrence would — the Tasks page itself lets you complete a one-off task unconditionally, any time. The alternative (always interactive, regardless of displayed week) was rejected in favor of keeping one consistent rule across the whole page ("this page is read-only unless you're looking at the current week") rather than a task-type-specific exception, per this spec's explicit instruction to leave "today-only interactivity" unchanged. Worth revisiting if it turns out to be confusing in practice.
- **Assumption:** The creation-date cutoff (tasks never appear before their `createdAt` date) is enforced uniformly for all recurrence types, even though the existing implementation never needed this check before (it only ever looked at "today"). This is new logic the implementer must add, not something already covered by `getTaskViewModels`.
- **Risk:** Because Weekly Overview can render many days/weeks of historical and future state, it's tempting to also add a mini progress summary per day or per week "for free" — this must be resisted; any such aggregate belongs to the separate Progress Tracking feature (requirements.md §4) and reusing its future `getOccurrencesForWeek`-style computation, not duplicating it here.
- **Resolved risk:** Reusing `getWeekRange` for an arbitrary anchor date (not just "now") is straightforward since the function already takes a `date: Date` argument — but calling the "now"-only helpers (`getTodayISODate`, `getWeekday`) with the *displayed* week's date instead of the *real* current date would silently break `isToday`/`isInteractive`. Both the anchor date and the real "now" are needed simultaneously in `getWeeklyOverview`, so its signature makes this explicit rather than relying on implementer discipline: `getWeeklyOverview(anchorDate, now)` takes both as separate required parameters, and the function never reads the clock itself (see the Data Model Proposal's "Suggested new server-only function" section).

## Open Questions

None — the one genuinely ambiguous point in requirements.md (how one-off tasks fit into a day-partitioned week) has been resolved explicitly above as an assumption — incomplete one-off tasks appear once per week in a dedicated Open Tasks section, never repeated across day columns, until completed — with its trade-offs recorded, rather than left open.
