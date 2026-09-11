import { randomUUID } from "node:crypto";
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

// Server-only in-memory store. Persisted on `globalThis` so data survives
// Next.js dev server hot reloads. Will be replaced by a real database later.
// Do not import this module from client components.
const globalForTasks = globalThis as unknown as {
  __tasks?: Task[];
  __taskCompletions?: TaskCompletion[];
};
const tasks: Task[] = globalForTasks.__tasks ?? (globalForTasks.__tasks = []);
const completions: TaskCompletion[] =
  globalForTasks.__taskCompletions ?? (globalForTasks.__taskCompletions = []);

// Tasks created before `recurrence`/`completedAt` existed (surviving a dev
// hot reload in the shared global array) won't have those fields at all.
// Normalize them in place, once, so recurrence logic never reads `undefined`.
for (const task of tasks) {
  if (task.recurrence === undefined) {
    task.recurrence = null;
  }
  if (task.completedAt === undefined) {
    task.completedAt = null;
  }
}

export function getTasks(): Task[] {
  return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createTask(input: {
  title: string;
  notes: string | null;
  recurrence: RecurrenceRule | null;
}): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    title: input.title,
    notes: input.notes,
    completed: false,
    completedAt: null,
    recurrence: input.recurrence,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  return task;
}

export function updateTask(
  id: string,
  input: { title: string; notes: string | null; recurrence: RecurrenceRule | null },
): Task | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;

  // Removing recurrence turns the task back into a one-off task: its
  // `completed` flag was inert while recurring, so it starts fresh.
  const isRemovingRecurrence = task.recurrence !== null && input.recurrence === null;
  // Gaining recurrence: `completedAt` is meaningful only for one-off tasks
  // (see specs/task-progress.md), so it must not carry a stale value forward.
  const isGainingRecurrence = task.recurrence === null && input.recurrence !== null;

  task.title = input.title;
  task.notes = input.notes;
  task.recurrence = input.recurrence;
  if (isRemovingRecurrence) {
    task.completed = false;
    task.completedAt = null;
  } else if (isGainingRecurrence) {
    task.completedAt = null;
  }
  task.updatedAt = new Date().toISOString();
  return task;
}

export function deleteTask(id: string): void {
  const index = tasks.findIndex((t) => t.id === id);
  if (index !== -1) tasks.splice(index, 1);

  for (let i = completions.length - 1; i >= 0; i--) {
    if (completions[i].taskId === id) completions.splice(i, 1);
  }
}

export function getCompletionsForTask(taskId: string): TaskCompletion[] {
  return completions.filter((c) => c.taskId === taskId);
}

// Toggles a task's occurrence for *today*, server-side. For a one-off task
// this flips `completed` (and sets/clears `completedAt` to match — see
// specs/task-progress.md); for a recurring task it toggles today's
// TaskCompletion row and never touches `completedAt`. A `weekdays` task not
// due today is rejected (no-op) even if called directly, since the client's
// UI disabling it is not sufficient on its own.
export function toggleTaskOccurrence(id: string): Task | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;

  // Capture one instant and derive everything from it, so a midnight
  // crossing between calls can't put the weekday/due check and the
  // recorded occurrence date on different calendar days.
  const now = new Date();

  if (task.recurrence === null) {
    task.completed = !task.completed;
    task.completedAt = task.completed ? now.toISOString() : null;
    task.updatedAt = now.toISOString();
    return task;
  }

  if (!isDueOn(task.recurrence, getWeekday(now))) {
    return task;
  }

  const occurrenceDate = getTodayISODate(now);
  const existingIndex = completions.findIndex(
    (c) => c.taskId === id && c.occurrenceDate === occurrenceDate,
  );
  if (existingIndex !== -1) {
    completions.splice(existingIndex, 1);
  } else {
    completions.push({
      id: randomUUID(),
      taskId: id,
      occurrenceDate,
      completedAt: now.toISOString(),
    });
  }

  task.updatedAt = now.toISOString();
  return task;
}

export function getTaskViewModels(): TaskViewModel[] {
  // Capture one instant and derive today's date, weekday, and week range
  // from it, so they can't disagree about what day "now" falls on.
  const now = new Date();
  const todayISO = getTodayISODate(now);
  const todayWeekday = getWeekday(now);
  const { start, end } = getWeekRange(now);

  return getTasks().map((task) => {
    if (task.recurrence === null) {
      return { task, isDueToday: true, isCompletedToday: task.completed, weeklyCompletedCount: 0 };
    }

    const taskCompletions = getCompletionsForTask(task.id);
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

// Builds the Monday-Sunday week containing `anchorDate` for the Weekly
// Overview page — see specs/weekly-overview.md. `anchorDate` picks *which*
// week to show; `now` is the real current instant used for every "is this
// today/this week" check, regardless of which week is being displayed.
// Callers must capture `now` once themselves (e.g. also to default
// `anchorDate` when no week param is supplied) rather than letting this
// function read the clock again, so the two can't disagree across a
// midnight crossing within the same request.
export function getWeeklyOverview(anchorDate: Date, now: Date): WeeklyOverview {
  const todayISO = getTodayISODate(now);
  const { start, end, startDate } = getWeekRange(anchorDate);
  const weekContainsToday = todayISO >= start && todayISO <= end;
  const allTasks = getTasks();

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

      const isCompleted = getCompletionsForTask(task.id).some(
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

    const taskCompletions = getCompletionsForTask(task.id);
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

// Computes the real current week's progress — see specs/task-progress.md.
// Takes only `now` (no anchor date): it always computes the week containing
// `now`, so it can never be made to show a different, navigated week by
// mistake. Reuses `getWeeklyOverview(now, now)` for everything except the
// one-off-task count, rather than re-deriving due-date/eligibility logic.
export function getWeeklyProgress(now: Date): WeeklyProgress {
  const overview = getWeeklyOverview(now, now);

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
  // an earlier week contributes nothing.
  for (const task of getTasks()) {
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
