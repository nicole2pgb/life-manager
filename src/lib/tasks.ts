import { randomUUID } from "node:crypto";
import type { RecurrenceRule, Task, TaskCompletion, TaskViewModel } from "@/lib/task-types";
import { getTodayISODate, getWeekday, getWeekRange, isDueOn } from "@/lib/recurrence";

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

  task.title = input.title;
  task.notes = input.notes;
  task.recurrence = input.recurrence;
  if (isRemovingRecurrence) {
    task.completed = false;
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
// this flips `completed`; for a recurring task it toggles today's
// TaskCompletion row. A `weekdays` task not due today is rejected (no-op)
// even if called directly, since the client's UI disabling it is not
// sufficient on its own.
export function toggleTaskOccurrence(id: string): Task | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;

  if (task.recurrence === null) {
    task.completed = !task.completed;
    task.updatedAt = new Date().toISOString();
    return task;
  }

  if (!isDueOn(task.recurrence, getWeekday(new Date()))) {
    return task;
  }

  const occurrenceDate = getTodayISODate();
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
      completedAt: new Date().toISOString(),
    });
  }

  task.updatedAt = new Date().toISOString();
  return task;
}

export function getTaskViewModels(): TaskViewModel[] {
  const today = new Date();
  const todayISO = getTodayISODate();
  const todayWeekday = getWeekday(today);
  const { start, end } = getWeekRange(today);

  return getTasks().map((task) => {
    if (task.recurrence === null) {
      return { task, isDueToday: true, isCompletedToday: task.completed, weeklyCompletedCount: 0 };
    }

    const taskCompletions = getCompletionsForTask(task.id);
    const isDueToday = isDueOn(task.recurrence, todayWeekday);
    const isCompletedToday = taskCompletions.some((c) => c.occurrenceDate === todayISO);
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
