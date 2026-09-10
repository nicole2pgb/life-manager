import type { RecurrenceRule, Weekday } from "@/lib/task-types";

// All dates here are computed from the server's local clock, never the
// client's — see specs/recurring-tasks.md "server-authoritative" rules.

function formatISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayISODate(): string {
  return formatISODate(new Date());
}

export function getWeekday(date: Date): Weekday {
  return date.getDay() as Weekday;
}

// `daily` and `timesPerWeek` tasks are due every day; `weekdays` tasks are
// due only on their configured days.
export function isDueOn(recurrence: RecurrenceRule, weekday: Weekday): boolean {
  if (recurrence.type === "weekdays") {
    return recurrence.days.includes(weekday);
  }
  return true;
}

// Monday-Sunday range (inclusive) containing `date`, as ISO date strings.
export function getWeekRange(date: Date): { start: string; end: string } {
  const weekday = date.getDay(); // 0 = Sunday ... 6 = Saturday
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diffToMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { start: formatISODate(monday), end: formatISODate(sunday) };
}
