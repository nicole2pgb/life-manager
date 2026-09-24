import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks as tasksTable, taskCompletions as taskCompletionsTable } from "@/lib/db/schema";
import type {
  DayColumn,
  RecurrenceRule,
  Task,
  TaskCompletion,
  TaskViewModel,
  WeeklyDayItem,
  WeeklyOpenTask,
  WeeklyOverview,
  WeeklyProgress,
  WeeklyTimesPerWeekItem,
} from "@/lib/task-types";
import { formatISODate, getTodayISODate, getWeekday, getWeekRange, isDueOn } from "@/lib/recurrence";

// Server-only repository, backed by MySQL via Drizzle — see
// specs/mysql-persistence.md and specs/user-login.md. Do not import this
// module from client components. The rest of the app (task-actions.ts, both
// pages) only ever sees the Task/TaskCompletion/*ViewModel shapes from
// task-types.ts; the mapping to/from Drizzle's snake_case row shapes
// happens entirely here.
//
// Every exported function takes the caller's authenticated `userId` (from
// verifySession(), never trusted from a client value) as its first
// parameter and scopes every query by it — see specs/user-login.md FR5.9.
// `tasks.user_id` is nullable at the schema/DB level only to accommodate the
// 4 pre-existing legacy rows during migration; every query here filters on
// a specific, non-null userId, so a row this module ever returns always has
// one — see rowToTask's non-null assertion.

type TaskRow = typeof tasksTable.$inferSelect;
type TaskCompletionRow = typeof taskCompletionsTable.$inferSelect;

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    // Every query in this file filters `WHERE user_id = <specific userId>`,
    // which (per SQL's NULL-never-equals-anything semantics) can never
    // match a legacy row with a NULL user_id — so any row reaching this
    // function is guaranteed to have one. See specs/user-login.md Migration
    // Strategy for why the column itself is still nullable at the DB level.
    userId: row.userId!,
    title: row.title,
    notes: row.notes,
    completed: row.completed,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    recurrence: row.recurrence,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToTaskCompletion(row: TaskCompletionRow): TaskCompletion {
  return {
    id: row.id,
    taskId: row.taskId,
    occurrenceDate: row.occurrenceDate,
    completedAt: row.completedAt.toISOString(),
  };
}

// Bulk-use only (internal): fetches every one of this user's tasks and
// completions as one consistent snapshot, so callers that derive a single
// view from both tables (getTaskViewModels, getWeeklyOverview,
// getWeeklyProgress) can't observe a task list and a completion list that
// reflect different points in time — e.g. a task deleted (cascading its
// completions) by another request landing in the gap between two separate,
// unsynchronized queries. A transaction is sufficient for this (InnoDB's
// default REPEATABLE READ isolation gives every read inside one transaction
// the same snapshot) — no row locking is needed since this is read-only.
// `task_completions` has no direct user_id column (see
// specs/user-login.md's Data Model — ownership is inherited transitively
// through task_id), so it's scoped here via a join against this user's own
// tasks rather than fetched unscoped and filtered in memory afterward.
async function getTasksAndCompletionsSnapshot(userId: string): Promise<{
  tasks: Task[];
  completions: TaskCompletion[];
}> {
  return db.transaction(async (tx) => {
    const taskRows = await tx
      .select()
      .from(tasksTable)
      .where(eq(tasksTable.userId, userId))
      .orderBy(desc(tasksTable.createdAt));
    const completionRows = await tx
      .select({
        id: taskCompletionsTable.id,
        taskId: taskCompletionsTable.taskId,
        occurrenceDate: taskCompletionsTable.occurrenceDate,
        completedAt: taskCompletionsTable.completedAt,
      })
      .from(taskCompletionsTable)
      .innerJoin(tasksTable, eq(taskCompletionsTable.taskId, tasksTable.id))
      .where(eq(tasksTable.userId, userId));
    return {
      tasks: taskRows.map(rowToTask),
      completions: completionRows.map(rowToTaskCompletion),
    };
  });
}

function completionsFor(allCompletions: TaskCompletion[], taskId: string): TaskCompletion[] {
  return allCompletions.filter((c) => c.taskId === taskId);
}

export async function getTasks(userId: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(tasksTable)
    .where(eq(tasksTable.userId, userId))
    .orderBy(desc(tasksTable.createdAt));
  return rows.map(rowToTask);
}

export async function createTask(
  userId: string,
  input: { title: string; notes: string | null; recurrence: RecurrenceRule | null },
): Promise<Task> {
  const id = randomUUID();
  const now = new Date();

  await db.insert(tasksTable).values({
    id,
    userId,
    title: input.title,
    notes: input.notes,
    completed: false,
    completedAt: null,
    recurrence: input.recurrence,
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    userId,
    title: input.title,
    notes: input.notes,
    completed: false,
    completedAt: null,
    recurrence: input.recurrence,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

export async function updateTask(
  userId: string,
  id: string,
  input: { title: string; notes: string | null; recurrence: RecurrenceRule | null },
): Promise<Task | null> {
  // Read-then-conditionally-write (the recurrence-gain/loss branches below
  // depend on the row's *previous* recurrence) — wrapped in a transaction
  // with a row lock so a concurrent update can't interleave between the
  // read and the write. Scoping the SELECT by userId as well as id means a
  // task belonging to a different user is indistinguishable from a
  // nonexistent one (FR5.11) — the caller gets `null` either way.
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .for("update");
    if (!row) return null;

    // Removing recurrence turns the task back into a one-off task: its
    // `completed` flag was inert while recurring, so it starts fresh.
    const isRemovingRecurrence = row.recurrence !== null && input.recurrence === null;
    // Gaining recurrence: `completedAt` is meaningful only for one-off tasks
    // (see specs/task-progress.md), so it must not carry a stale value forward.
    const isGainingRecurrence = row.recurrence === null && input.recurrence !== null;

    const now = new Date();
    const completed = isRemovingRecurrence ? false : row.completed;
    const completedAt = isRemovingRecurrence || isGainingRecurrence ? null : row.completedAt;

    await tx
      .update(tasksTable)
      .set({
        title: input.title,
        notes: input.notes,
        recurrence: input.recurrence,
        completed,
        completedAt,
        updatedAt: now,
      })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));

    return rowToTask({
      ...row,
      title: input.title,
      notes: input.notes,
      recurrence: input.recurrence,
      completed,
      completedAt,
      updatedAt: now,
    });
  });
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  // task_completions.task_id is ON DELETE CASCADE — a single statement
  // removes the task and all of its completions atomically. Scoping by
  // userId means deleting another user's task id is a silent no-op (FR5.11),
  // not an error and not an actual deletion.
  await db.delete(tasksTable).where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
}

// Toggles a task's occurrence for *today*, server-side. For a one-off task
// this flips `completed` (and sets/clears `completedAt` to match — see
// specs/task-progress.md); for a recurring task it toggles today's
// TaskCompletion row and never touches `completedAt`. A `weekdays` task not
// due today is rejected (no-op) even if called directly, since the client's
// UI disabling it is not sufficient on its own. Scoping the initial SELECT
// by userId means a different user's task id behaves like it doesn't exist
// (FR5.11).
export async function toggleTaskOccurrence(userId: string, id: string): Promise<Task | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(tasksTable)
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)))
      .for("update");
    if (!row) return null;

    // Capture one instant and derive everything from it, so a midnight
    // crossing during the transaction can't put the weekday/due check and
    // the recorded occurrence date on different calendar days.
    const now = new Date();

    if (row.recurrence === null) {
      const completed = !row.completed;
      const completedAt = completed ? now : null;
      await tx
        .update(tasksTable)
        .set({ completed, completedAt, updatedAt: now })
        .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));
      return rowToTask({ ...row, completed, completedAt, updatedAt: now });
    }

    if (!isDueOn(row.recurrence, getWeekday(now))) {
      return rowToTask(row);
    }

    const occurrenceDate = getTodayISODate(now);

    const [existing] = await tx
      .select()
      .from(taskCompletionsTable)
      .where(
        and(eq(taskCompletionsTable.taskId, id), eq(taskCompletionsTable.occurrenceDate, occurrenceDate)),
      )
      .for("update");

    if (existing) {
      await tx.delete(taskCompletionsTable).where(eq(taskCompletionsTable.id, existing.id));
    } else {
      await tx.insert(taskCompletionsTable).values({
        id: randomUUID(),
        taskId: id,
        occurrenceDate,
        completedAt: now,
      });
    }

    await tx
      .update(tasksTable)
      .set({ updatedAt: now })
      .where(and(eq(tasksTable.id, id), eq(tasksTable.userId, userId)));

    return rowToTask({ ...row, updatedAt: now });
  });
}

export async function getTaskViewModels(userId: string): Promise<TaskViewModel[]> {
  // Capture one instant and derive today's date, weekday, and week range
  // from it, so they can't disagree about what day "now" falls on.
  const now = new Date();
  const todayISO = getTodayISODate(now);
  const todayWeekday = getWeekday(now);
  const { start, end } = getWeekRange(now);

  const { tasks: allTasks, completions: allCompletions } = await getTasksAndCompletionsSnapshot(userId);

  return allTasks.map((task) => {
    if (task.recurrence === null) {
      return { task, isDueToday: true, isCompletedToday: task.completed, weeklyCompletedCount: 0 };
    }

    const taskCompletions = completionsFor(allCompletions, task.id);
    const isDueToday = isDueOn(task.recurrence, todayWeekday);
    // A completion recorded under a since-changed recurrence rule must not
    // make a currently non-due occurrence look completed.
    const isCompletedToday =
      isDueToday && taskCompletions.some((c) => c.occurrenceDate === todayISO);
    const weeklyCompletedCount =
      task.recurrence.type === "timesPerWeek"
        ? new Set(
            taskCompletions
              .filter((c) => c.occurrenceDate >= start && c.occurrenceDate <= end)
              .map((c) => c.occurrenceDate),
          ).size
        : 0;

    return { task, isDueToday, isCompletedToday, weeklyCompletedCount };
  });
}

// Pure (no I/O): builds the Monday-Sunday week containing `anchorDate` from
// an already-fetched, already-consistent, already-user-scoped `allTasks`/
// `allCompletions` snapshot — see specs/weekly-overview.md for the
// placement rules. `now` is the real current instant used for every "is
// this today/this week" check, regardless of which week is being displayed.
// Split out from `getWeeklyOverview` so `getWeeklyProgress` can reuse the
// exact same snapshot for both the overview and its own one-off-task pass,
// instead of querying tasks a second time.
function buildWeeklyOverview(
  anchorDate: Date,
  now: Date,
  allTasks: Task[],
  allCompletions: TaskCompletion[],
): WeeklyOverview {
  const todayISO = getTodayISODate(now);
  const { start, end, startDate } = getWeekRange(anchorDate);
  const weekContainsToday = todayISO >= start && todayISO <= end;

  const days: DayColumn[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
    const dateISO = formatISODate(date);
    const weekday = getWeekday(date);
    const isToday = dateISO === todayISO;

    const items: WeeklyDayItem[] = [];
    for (const task of allTasks) {
      // One-off tasks never appear in a day column — see the `openTasks`
      // section built below — only recurring tasks are placed per day.
      if (task.recurrence === null) continue;

      const createdDateISO = formatISODate(new Date(task.createdAt));
      if (dateISO < createdDateISO) continue;

      if (task.recurrence.type === "timesPerWeek") {
        continue; // shown once in the weekly summary, not per day
      }

      if (!isDueOn(task.recurrence, weekday)) continue;

      const isCompleted = completionsFor(allCompletions, task.id).some(
        (c) => c.occurrenceDate === dateISO,
      );
      items.push({ task, isCompleted, isInteractive: isToday });
    }

    days.push({ date: dateISO, weekday, isToday, items });
  }

  const timesPerWeekItems: WeeklyTimesPerWeekItem[] = [];
  for (const task of allTasks) {
    if (!task.recurrence || task.recurrence.type !== "timesPerWeek") continue;

    const createdDateISO = formatISODate(new Date(task.createdAt));
    if (createdDateISO > end) continue;

    const taskCompletions = completionsFor(allCompletions, task.id);
    const completedCount = new Set(
      taskCompletions
        .filter((c) => c.occurrenceDate >= start && c.occurrenceDate <= end)
        .map((c) => c.occurrenceDate),
    ).size;
    const isCompletedToday =
      weekContainsToday && taskCompletions.some((c) => c.occurrenceDate === todayISO);

    timesPerWeekItems.push({
      task,
      completedCount,
      targetCount: task.recurrence.count,
      isInteractive: weekContainsToday,
      isCompletedToday,
    });
  }

  // Incomplete one-off tasks: shown once per week (not once per day), from
  // their createdAt date onward, until completed — see specs/weekly-overview.md
  // "Open Tasks". A week that ends before the task's createdAt date excludes
  // it entirely (it didn't exist yet during any part of that week).
  const openTasks: WeeklyOpenTask[] = [];
  for (const task of allTasks) {
    if (task.recurrence !== null || task.completed) continue;

    const createdDateISO = formatISODate(new Date(task.createdAt));
    if (createdDateISO > end) continue;

    openTasks.push({ task, isInteractive: weekContainsToday });
  }

  return { weekStart: start, weekEnd: end, days, openTasks, timesPerWeekItems };
}

// Builds the Monday-Sunday week containing `anchorDate` for the Weekly
// Overview page — see specs/weekly-overview.md. `anchorDate` picks *which*
// week to show; `now` is the real current instant used for every "is this
// today/this week" check, regardless of which week is being displayed.
// Callers must capture `now` once themselves (e.g. also to default
// `anchorDate` when no week param is supplied) rather than letting this
// function read the clock again, so the two can't disagree across a
// midnight crossing within the same request. Fetches its task/completion
// data as one consistent, user-scoped snapshot (see
// getTasksAndCompletionsSnapshot).
export async function getWeeklyOverview(userId: string, anchorDate: Date, now: Date): Promise<WeeklyOverview> {
  const { tasks: allTasks, completions: allCompletions } = await getTasksAndCompletionsSnapshot(userId);
  return buildWeeklyOverview(anchorDate, now, allTasks, allCompletions);
}

// Pure (no I/O): computes the real current week's progress from an
// already-fetched, already-user-scoped `allTasks`/`allCompletions` snapshot
// — see specs/task-progress.md. Always uses `now, now` for the underlying
// overview (progress is never scoped to a navigated week), regardless of
// what week `allTasks`/`allCompletions` might otherwise be reused for by a
// caller. Split out for the same reason as buildWeeklyOverview: so a single
// snapshot can be reused by more than one derived view without re-querying.
function buildWeeklyProgress(
  now: Date,
  allTasks: Task[],
  allCompletions: TaskCompletion[],
): WeeklyProgress {
  const overview = buildWeeklyOverview(now, now, allTasks, allCompletions);

  let planned = 0;
  let completed = 0;

  for (const day of overview.days) {
    planned += day.items.length;
    completed += day.items.filter((item) => item.isCompleted).length;
  }

  for (const item of overview.timesPerWeekItems) {
    planned += item.targetCount;
    completed += item.completedCount;
  }

  // One-off tasks: still open ones are the same set Weekly Overview's Open
  // Tasks shows for this week (always eligible — see specs/task-progress.md
  // for why no createdAt check is needed here). A task completed this week
  // (by completedAt) counts as both planned and completed; one completed in
  // an earlier week contributes nothing. Reuses `allTasks` from the same
  // snapshot `overview` was built from, rather than querying again.
  for (const task of allTasks) {
    if (task.recurrence !== null) continue;

    if (!task.completed) {
      planned += 1;
      continue;
    }

    if (task.completedAt === null) continue;

    const completedDateISO = formatISODate(new Date(task.completedAt));
    if (completedDateISO >= overview.weekStart && completedDateISO <= overview.weekEnd) {
      planned += 1;
      completed += 1;
    }
  }

  return { weekStart: overview.weekStart, weekEnd: overview.weekEnd, planned, completed };
}

// Computes the real current week's progress — see specs/task-progress.md.
// Takes only `userId` and `now` (no anchor date): it always computes the
// week containing `now`, so it can never be made to show a different,
// navigated week by mistake. Fetches one task/completion snapshot and
// reuses it for both the underlying week overview and the one-off-task pass
// in buildWeeklyProgress, rather than querying tasks a second time.
export async function getWeeklyProgress(userId: string, now: Date): Promise<WeeklyProgress> {
  const { tasks: allTasks, completions: allCompletions } = await getTasksAndCompletionsSnapshot(userId);
  return buildWeeklyProgress(now, allTasks, allCompletions);
}

// Single consistent snapshot for the Weekly Overview page, which needs both
// the navigated-week overview and the always-real-current-week progress in
// one render (see specs/weekly-overview.md and specs/task-progress.md).
// Fetching one snapshot and building both from it — instead of calling
// getWeeklyOverview and getWeeklyProgress separately, each with its own
// snapshot — means a mutation landing between two page-render reads can no
// longer make the grid and the progress summary disagree about the
// database's state at that moment. The navigated-vs-current-week
// distinction between the two is unchanged: `overview` still follows
// `anchorDate`, `progress` still always uses `now, now` internally.
export async function getWeeklyPageData(
  userId: string,
  anchorDate: Date,
  now: Date,
): Promise<{ overview: WeeklyOverview; progress: WeeklyProgress }> {
  const { tasks: allTasks, completions: allCompletions } = await getTasksAndCompletionsSnapshot(userId);
  return {
    overview: buildWeeklyOverview(anchorDate, now, allTasks, allCompletions),
    progress: buildWeeklyProgress(now, allTasks, allCompletions),
  };
}
