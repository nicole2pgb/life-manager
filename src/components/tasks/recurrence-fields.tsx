"use client";

import { useState } from "react";
import {
  TIMES_PER_WEEK_DEFAULT,
  TIMES_PER_WEEK_MAX,
  TIMES_PER_WEEK_MIN,
  WEEKDAY_OPTIONS,
  type RecurrenceRule,
} from "@/lib/task-types";

type RecurrenceType = "none" | "daily" | "weekdays" | "timesPerWeek";

const RECURRENCE_OPTIONS: { value: RecurrenceType; label: string }[] = [
  { value: "none", label: "None" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Specific weekdays" },
  { value: "timesPerWeek", label: "Times per week" },
];

export function RecurrenceFields({
  defaultRecurrence = null,
}: {
  defaultRecurrence?: RecurrenceRule | null;
}) {
  const [type, setType] = useState<RecurrenceType>(defaultRecurrence?.type ?? "none");
  const defaultDays = defaultRecurrence?.type === "weekdays" ? defaultRecurrence.days : [];
  const defaultCount =
    defaultRecurrence?.type === "timesPerWeek" ? defaultRecurrence.count : TIMES_PER_WEEK_DEFAULT;

  return (
    <fieldset className="flex flex-col gap-2 border-0 p-0">
      <legend className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Repeat</legend>
      <div className="flex flex-wrap gap-3 text-sm text-zinc-700 dark:text-zinc-300">
        {RECURRENCE_OPTIONS.map((option) => (
          <label key={option.value} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="recurrenceType"
              value={option.value}
              defaultChecked={type === option.value}
              onChange={() => setType(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>

      {type === "weekdays" && (
        <div className="flex flex-wrap gap-3 text-sm text-zinc-700 dark:text-zinc-300">
          {WEEKDAY_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-1.5">
              <input type="checkbox" name="weekdays" value={option.value} defaultChecked={defaultDays.includes(option.value)} />
              {option.label}
            </label>
          ))}
        </div>
      )}

      {type === "timesPerWeek" && (
        <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
          Times per week
          <input
            type="number"
            name="timesPerWeekCount"
            min={TIMES_PER_WEEK_MIN}
            max={TIMES_PER_WEEK_MAX}
            defaultValue={defaultCount}
            className="w-16 rounded-md border border-zinc-300 px-2 py-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
        </label>
      )}
    </fieldset>
  );
}
