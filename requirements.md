# Life Manager — MVP Requirements

This document translates the MVP backlog into implementation-ready requirements for the five MVP features: Task Management, Recurring Tasks, Weekly Overview, Task Progress Tracking, and User Login.

**Stack:** Next.js (App Router), TypeScript, Tailwind CSS. PostgreSQL is the intended persistence layer, but is not required to ship the MVP — see [Global Constraints](#global-constraints).

**Scope boundary:** Notifications, Goals, Journal, AI integration, Calendar integration, and analytics are explicitly out of scope. Do not implement them, and do not add fields, hooks, or endpoints in anticipation of them.

---

## Data Model Overview

All five features share two core entities. Defining them once up front avoids each feature re-deriving them inconsistently.

### `User`
| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | Primary key |
| email | string | Unique, lowercase, used for login |
| passwordHash | string | Never exposed to client |
| createdAt | datetime | |

### `Task`
| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | Primary key |
| userId | string (UUID) | Owner, foreign key to `User` |
| title | string | Required, 1–200 chars |
| notes | string \| null | Optional, max 2000 chars |
| recurrence | `RecurrenceRule \| null` | `null` = one-off task |
| createdAt | datetime | |
| updatedAt | datetime | |

### `TaskCompletion`
A recurring task produces one `TaskCompletion` record per occurrence date once it is marked done. A one-off task is considered complete when its own `completedAt` is set.

| Field | Type | Notes |
|---|---|---|
| id | string (UUID) | Primary key |
| taskId | string (UUID) | Foreign key to `Task` |
| occurrenceDate | date | The calendar date this completion applies to |
| completedAt | datetime | |

For one-off (non-recurring) tasks, add:

| Field | Type | Notes |
|---|---|---|
| completedAt | datetime \| null | On `Task` itself; null = not completed |

### `RecurrenceRule` (embedded on `Task`, not a separate table)
```ts
type RecurrenceRule =
  | { type: "daily" }
  | { type: "weekdays"; days: Array<0|1|2|3|4|5|6> } // 0 = Sunday ... 6 = Saturday
  | { type: "timesPerWeek"; count: number }          // 1–7
```

This is the single source of truth for how recurrence is stored. All three examples in the backlog map onto it:
- "Take vitamins daily" → `{ type: "daily" }`
- "English every Monday and Thursday" → `{ type: "weekdays", days: [1, 4] }`
- "Gym 3 times per week" → `{ type: "timesPerWeek", count: 3 }`

---

## Global Constraints

- **Auth gates everything.** Every task-related route and API call requires an authenticated session. There is no anonymous/guest mode in MVP.
- **Persistence:** Use PostgreSQL if a database is already wired up; otherwise, an in-memory or file-backed store behind a repository interface (`TaskRepository`, `UserRepository`) is acceptable for MVP so the app runs without infra setup. The interface must be swappable for a real PostgreSQL implementation without changing calling code.
- **No shared/team data.** All data is scoped to a single user; there is no sharing, collaboration, or multi-user visibility of tasks.
- **Timezone:** Assume a single timezone per user (server default or browser-detected at login), stored once. Do not build per-task timezone handling.
- **Week definition:** The week starts on Monday and ends on Sunday, consistently across Weekly Overview and Progress Tracking.
- **No offline support, no real-time sync.** Standard request/response via Next.js Server Actions or Route Handlers is sufficient.
- **Styling:** Tailwind CSS utility classes; no separate design system or component library needed for MVP.

---

## 1. Task Management

### User Story
As a user, I want to create, edit, and complete tasks, so that I can keep track of what I need to do in one place.

### Functional Requirements
- FR1.1: A user can create a task with a required `title` and optional `notes`.
- FR1.2: A user can edit the `title` and `notes` of an existing task they own.
- FR1.3: A user can mark a task as complete and can un-complete it (toggle).
- FR1.4: A user can delete a task.
- FR1.5: A user can see a list of all their non-recurring tasks, with completed and incomplete tasks visually distinguished (e.g. strikethrough, muted style).
- FR1.6: Recurring tasks (feature 2) are created and edited through this same task form, with an added recurrence option — there is no separate "recurring task" entity or page.

### Acceptance Criteria

```
Scenario: Create a task
  Given I am logged in and on the tasks page
  When I submit a new task with title "Buy groceries"
  Then a new task is created with that title
  And it appears in my task list as incomplete

Scenario: Reject empty title
  Given I am logged in and creating a task
  When I submit the form with an empty title
  Then the task is not created
  And I see a validation message requiring a title

Scenario: Edit a task
  Given I have an existing task "Buy groceries"
  When I change its title to "Buy groceries and milk" and save
  Then the task's title is updated
  And its previous data is no longer shown

Scenario: Complete a task
  Given I have an incomplete task "Buy groceries"
  When I mark it as complete
  Then the task is shown as completed
  And its completed state persists after a page reload

Scenario: Un-complete a task
  Given I have a completed task
  When I mark it as incomplete
  Then the task is shown as incomplete again

Scenario: Delete a task
  Given I have an existing task
  When I delete it
  Then it no longer appears in my task list
```

### Edge Cases
- Title with only whitespace is treated as empty and rejected.
- Title longer than 200 characters is rejected with a clear validation message (define the limit in one shared constant/schema used by both client and server validation).
- Deleting a task that has completion history (if recurring) removes its `TaskCompletion` records too (cascade delete).
- A user cannot view, edit, or delete another user's task (return 404, not 403, to avoid leaking existence).

### Risks & Assumptions
- Assumption: no task priority, tags, due dates, or subtasks in MVP — only title, notes, completion, and recurrence.
- Assumption: no soft-delete/undo; deletion is permanent.

---

## 2. Recurring Tasks

### User Story
As a user, I want to set up tasks that repeat on a schedule, so that I don't have to recreate them manually every day or week.

### Functional Requirements
- FR2.1: When creating or editing a task, a user can set a recurrence: none (default), daily, specific weekdays, or N times per week.
- FR2.2: "Specific weekdays" requires selecting at least one weekday (Mon–Sun).
- FR2.3: "N times per week" requires an integer count between 1 and 7 (inclusive); it does not pin specific days — the user decides which days to complete it on.
- FR2.4: A recurring task generates an "occurrence" for each day it is due, which the user can independently complete per day/week (see `TaskCompletion` in the data model).
- FR2.5: For `daily` and `weekdays` recurrence, an occurrence exists on each matching calendar date and is completed/uncompleted independently per date.
- FR2.6: For `timesPerWeek` recurrence, there is no fixed date per occurrence — the requirement is satisfied by completing the task on any N days within the Monday–Sunday week. Track completions as a list of dates within that week; progress = count of distinct completion dates that week vs. `count`.
- FR2.7: Editing a task's recurrence rule going forward does not rewrite past completion history.

### Acceptance Criteria

```
Scenario: Create a daily recurring task
  Given I am creating a task
  When I set title "Take vitamins" and recurrence "daily"
  Then the task appears as due every day going forward
  And I can mark it complete independently on each day

Scenario: Create a specific-weekdays recurring task
  Given I am creating a task
  When I set title "English" and recurrence to weekdays Monday and Thursday
  Then the task appears as due only on Mondays and Thursdays
  And it does not appear as due on other days

Scenario: Create a times-per-week recurring task
  Given I am creating a task
  When I set title "Gym" and recurrence "3 times per week"
  Then the task shows a weekly progress indicator such as "0/3 this week"
  And completing it on any 3 distinct days that week marks it fully done for the week

Scenario: Reject invalid times-per-week count
  Given I am setting recurrence to "times per week"
  When I enter a count of 0 or greater than 7
  Then the form shows a validation error
  And the task is not saved

Scenario: Complete a specific day of a daily task
  Given "Take vitamins" is a daily recurring task
  When I mark today's occurrence complete
  Then only today's occurrence is marked complete
  And yesterday's and tomorrow's occurrences remain unaffected

Scenario: Week rolls over for times-per-week task
  Given "Gym" is set to 3 times per week and I completed it 3 times last week
  When a new week (Monday) begins
  Then the weekly progress resets to 0/3 for the new week
  And last week's completion history remains stored and unaffected
```

### Edge Cases
- Changing a task's recurrence type (e.g. from `daily` to `timesPerWeek`) does not delete or alter previously recorded `TaskCompletion` rows for prior dates/weeks.
- Un-completing a `timesPerWeek` occurrence removes exactly one completion date for that week, decrementing the count (e.g. 2/3 → 1/3).
- A `weekdays` recurrence must reject an empty day selection.
- Marking a `daily`/`weekdays` occurrence complete for a date twice is idempotent (no duplicate `TaskCompletion` rows for the same task + date).

### Risks & Assumptions
- Assumption: no "end date" or "number of occurrences" limit for recurrence in MVP — recurring tasks repeat indefinitely until edited or deleted.
- Assumption: no catch-up/backfill for missed daily occurrences — a missed day is simply shown as incomplete for that date, not carried forward.
- Risk: `timesPerWeek` is the most implementation-complex rule since it has no fixed dates. Keep the UI simple (a counter + list of this week's completion dates) rather than trying to suggest which days to do it on.

---

## 3. Weekly Overview

### User Story
As a user, I want a weekly view of my tasks, so that I can see at a glance what's planned and what I've completed.

### Functional Requirements
- FR3.1: A weekly view displays the current week (Monday–Sunday) as columns or rows, one per day.
- FR3.2: Each day shows: one-off tasks due that day (none, unless explicitly scheduled — see Edge Cases) plus recurring occurrences due that day (`daily` and matching `weekdays` tasks).
- FR3.3: `timesPerWeek` tasks appear once per week (not duplicated across days) with their current progress (e.g. "Gym — 1/3 this week").
- FR3.4: Each item shows its completion state and can be toggled complete/incomplete directly from this view (reuses the same action as Task Management).
- FR3.5: The user can navigate to the previous and next week.
- FR3.6: Navigating weeks only changes which week's data is displayed — it does not create, delete, or modify any tasks.

### Acceptance Criteria

```
Scenario: View current week
  Given I have a daily task "Take vitamins" and a Mon/Thu task "English"
  When I open the Weekly Overview for the current week
  Then "Take vitamins" appears on all 7 days
  And "English" appears only on Monday and Thursday

Scenario: Toggle completion from weekly view
  Given I see "Take vitamins" listed under today in the Weekly Overview
  When I mark it complete from this view
  Then it shows as completed in the Weekly Overview
  And it also shows as completed if I check the Task Management page

Scenario: Times-per-week task in weekly view
  Given "Gym" is set to 3 times per week and I've completed it twice this week
  When I view the Weekly Overview
  Then "Gym" appears once in a weekly summary area (not per-day)
  And it shows "2/3"

Scenario: Navigate to next/previous week
  Given I am viewing the current week
  When I click "next week"
  Then I see occurrences computed for the following Monday–Sunday range
  And no new tasks or completions are created by navigating
```

### Edge Cases
- A recurring task created mid-week only shows occurrences from its creation date onward, not retroactively for earlier days in that week.
- Viewing a past week shows historical completion state as it was recorded (read-only for dates in the past — the user can still toggle if needed, but this is not restricted in MVP for simplicity; do not add a "lock past weeks" rule unless asked).
- A week with zero tasks shows an empty state message, not an error.

### Risks & Assumptions
- Assumption: "Weekly Overview" reuses the same completion toggle logic as Task Management and Recurring Tasks rather than introducing a separate completion mechanism — this must be one shared function/endpoint, not duplicated logic.
- Assumption: no drag-and-drop rescheduling in this view.

---

## 4. Task Progress Tracking

### User Story
As a user, I want to see how much of my planned work I've completed, so that I can stay motivated and know where I stand.

### Functional Requirements
- FR4.1: For the current week, show an overall completion count: completed occurrences vs. total planned occurrences (e.g. "12/20 this week").
- FR4.2: "Planned occurrences" for the week = sum of: one-off tasks due/created that week + `daily`/`weekdays` occurrences due that week + each `timesPerWeek` task's `count`.
- FR4.3: Display this as a simple visual indicator (progress bar or percentage) — no charts, streaks, or trend graphs in MVP.
- FR4.4: The progress figure updates immediately when a task/occurrence is completed or un-completed.

### Acceptance Criteria

```
Scenario: Progress reflects completed and total occurrences
  Given this week has 20 total planned occurrences across all tasks
  And I have completed 12 of them
  Then the progress indicator shows "12/20" (or 60%)

Scenario: Progress updates on completion
  Given my current weekly progress is "12/20"
  When I mark one more occurrence complete
  Then the progress indicator updates to "13/20"

Scenario: Progress updates on un-completion
  Given my current weekly progress is "13/20"
  When I un-complete an occurrence I previously completed
  Then the progress indicator updates to "12/20"

Scenario: No tasks planned
  Given I have no tasks for the current week
  Then the progress indicator shows "0/0" or an equivalent neutral empty state, not an error or division-by-zero crash
```

### Edge Cases
- Division by zero when total planned occurrences is 0 — must render a neutral state (e.g. "No tasks planned this week"), not `NaN%` or a crash.
- Progress is calculated per week (Mon–Sun), matching Weekly Overview — there is no all-time or monthly progress view in MVP.
- A task completed then deleted mid-week: its completion no longer counts toward that week's totals after deletion (recalculated from current data, not cached).

### Risks & Assumptions
- Assumption: progress is always scoped to "this week" only — no historical progress charts or streak tracking (that would be Analytics, which is out of scope).
- Assumption: the same "planned occurrences" calculation used here must be reused (not recomputed separately) from whatever logic powers the Weekly Overview, to avoid the two views showing inconsistent numbers.

---

## 5. User Login

### User Story
As a user, I want to create an account and log in, so that my tasks and progress are saved to me and available when I return.

### Functional Requirements
- FR5.1: A user can register with an email and password.
- FR5.2: Email must be unique (case-insensitive) and a valid email format.
- FR5.3: Password must be at least 8 characters (MVP minimum — no additional complexity rules).
- FR5.4: Passwords are hashed (e.g. bcrypt/argon2) before storage — never stored or logged in plaintext.
- FR5.5: A user can log in with email + password to establish a session.
- FR5.6: A user can log out, ending their session.
- FR5.7: Unauthenticated users attempting to access task-related pages are redirected to the login page.
- FR5.8: Authenticated users attempting to access login/register pages are redirected to the main task/overview page.

### Acceptance Criteria

```
Scenario: Register a new account
  Given I am on the registration page
  When I submit a valid, unused email and a password of 8+ characters
  Then a new account is created
  And I am logged in and redirected to the main app view

Scenario: Reject duplicate email
  Given an account already exists with "user@example.com"
  When I try to register again with "user@example.com"
  Then registration fails
  And I see a message indicating that email is already in use

Scenario: Reject weak password
  Given I am registering
  When I submit a password shorter than 8 characters
  Then registration fails
  And I see a validation message about the minimum length

Scenario: Log in with correct credentials
  Given I have a registered account
  When I submit my correct email and password
  Then I am logged in and redirected to the main app view

Scenario: Reject incorrect credentials
  Given I have a registered account
  When I submit the correct email with an incorrect password
  Then login fails
  And I see a generic "invalid email or password" message (not revealing which field was wrong)

Scenario: Log out
  Given I am logged in
  When I log out
  Then my session ends
  And I am redirected to the login page

Scenario: Redirect unauthenticated access
  Given I am not logged in
  When I navigate directly to the tasks or weekly overview page
  Then I am redirected to the login page
```

### Edge Cases
- Login attempt for a non-existent email returns the same generic error as a wrong password (prevents user enumeration).
- Email is normalized (trimmed, lowercased) before uniqueness checks and storage.
- Session handling: use a standard, well-supported approach (e.g. signed HTTP-only cookie session, or a minimal auth library) — do not hand-roll JWT/crypto logic for MVP.

### Risks & Assumptions
- Assumption: no email verification, password reset, or "remember me" flow in MVP — only register, log in, log out.
- Assumption: no OAuth/social login — email/password only.
- Assumption: no roles/permissions system — every user only ever sees their own data.
- Risk: password storage and session handling are the highest-stakes code in this feature; use established, audited libraries rather than custom implementations.

---

## Cross-Feature Risks & Assumptions

- **Occurrence computation must be centralized.** Weekly Overview, Progress Tracking, and the completion toggle all depend on the same definition of "which occurrences exist for a given task on a given week." Implement this once (e.g. a `getOccurrencesForWeek(task, weekStart)` function) and reuse it everywhere, rather than letting each feature derive it independently — this is the single biggest source of inconsistent-numbers bugs if skipped.
- **Persistence layer is swappable but not yet PostgreSQL.** Build the repository interface first; wiring an actual PostgreSQL database is a follow-up task, not blocking MVP delivery.
- **No mobile-specific design work assumed** beyond standard Tailwind responsive utilities — no separate mobile app or native layout.
- **No automated test suite is specified here** — acceptance criteria above are written in Given/When/Then form so they can be implemented directly as tests (unit or integration) if/when the team decides to add them.
