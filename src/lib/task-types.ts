export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday ... 6 = Saturday

export type RecurrenceRule =
  | { type: "daily" }
  | { type: "weekdays"; days: Weekday[] }
  | { type: "timesPerWeek"; count: number };

export type Task = {
  id: string;
  title: string;
  notes: string | null;
  completed: boolean; // meaningful only when recurrence is null
  recurrence: RecurrenceRule | null; // null = one-off task
  createdAt: string;
  updatedAt: string;
};

export type TaskCompletion = {
  id: string;
  taskId: string;
  occurrenceDate: string; // "YYYY-MM-DD"
  completedAt: string;
};

// Server-computed, per-task display state for "today" — never derived on
// the client, since "today" and due-ness must be server-authoritative.
export type TaskViewModel = {
  task: Task;
  isDueToday: boolean;
  isCompletedToday: boolean;
  weeklyCompletedCount: number; // meaningful only for recurrence.type === "timesPerWeek"
};

export const TASK_TITLE_MAX_LENGTH = 200;
export const TASK_NOTES_MAX_LENGTH = 2000;

export const TIMES_PER_WEEK_MIN = 1;
export const TIMES_PER_WEEK_MAX = 7;
export const TIMES_PER_WEEK_DEFAULT = 3;

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

// Monday-first, for display purposes only. Stored `Weekday` values remain 0-6 (Sun-Sat).
export const WEEKDAY_DISPLAY_ORDER: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

export const WEEKDAY_OPTIONS: { value: Weekday; label: string }[] = WEEKDAY_DISPLAY_ORDER.map(
  (value) => ({ value, label: WEEKDAY_LABELS[value] }),
);

export function formatRecurrenceLabel(recurrence: RecurrenceRule): string {
  switch (recurrence.type) {
    case "daily":
      return "Daily";
    case "weekdays":
      return WEEKDAY_DISPLAY_ORDER.filter((day) => recurrence.days.includes(day))
        .map((day) => WEEKDAY_LABELS[day])
        .join(", ");
    case "timesPerWeek":
      return `${recurrence.count}× per week`;
  }
}
