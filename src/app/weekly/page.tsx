import Link from "next/link";
import { getWeeklyOverview } from "@/lib/tasks";
import { formatISODate, parseISODate } from "@/lib/recurrence";
import { WEEKDAY_LABELS } from "@/lib/task-types";
import { WeeklyToggle } from "@/components/weekly/weekly-toggle";

// Depends on the server clock and the `week` search param — must not be
// statically cached (reading `searchParams` already forces this, but this
// is kept explicit for parity with `/`, which is dynamic for the same
// underlying reason: clock-dependent data).
export const dynamic = "force-dynamic";

export default async function WeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  // Capture one instant for this request: it's the default anchor date when
  // no valid `week` param is supplied, and it's also what `getWeeklyOverview`
  // uses for every "is this today/this week" check — so the two can't
  // disagree if a request happens to straddle midnight.
  const now = new Date();
  const anchorDate = (week && parseISODate(week)) || now;
  const overview = getWeeklyOverview(anchorDate, now);

  const weekStartDate = parseISODate(overview.weekStart) as Date;
  const prevWeekDate = new Date(
    weekStartDate.getFullYear(),
    weekStartDate.getMonth(),
    weekStartDate.getDate() - 7,
  );
  const nextWeekDate = new Date(
    weekStartDate.getFullYear(),
    weekStartDate.getMonth(),
    weekStartDate.getDate() + 7,
  );
  const prevHref = `/weekly?week=${formatISODate(prevWeekDate)}`;
  const nextHref = `/weekly?week=${formatISODate(nextWeekDate)}`;

  const isEmpty =
    overview.days.every((day) => day.items.length === 0) &&
    overview.openTasks.length === 0 &&
    overview.timesPerWeekItems.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Weekly Overview</h1>
          <Link
            href="/"
            className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Tasks
          </Link>
        </div>
        <div className="flex items-center justify-between text-sm">
          <Link
            href={prevHref}
            className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            ← Previous week
          </Link>
          <span className="text-zinc-500 dark:text-zinc-400">
            {overview.weekStart} – {overview.weekEnd}
          </span>
          <Link
            href={nextHref}
            className="font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Next week →
          </Link>
        </div>
      </header>

      {isEmpty ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">No tasks in this week.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-7">
            {overview.days.map((day) => (
              <div
                key={day.date}
                className={`flex flex-col gap-2 rounded-lg border p-3 ${
                  day.isToday
                    ? "border-zinc-400 dark:border-zinc-500"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  {WEEKDAY_LABELS[day.weekday]} · {day.date.slice(5)}
                </p>
                {day.items.length === 0 ? (
                  <p className="text-xs text-zinc-400 dark:text-zinc-600">—</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {day.items.map((item) => (
                      <li key={item.task.id}>
                        <WeeklyToggle
                          taskId={item.task.id}
                          label={item.task.title}
                          completed={item.isCompleted}
                          interactive={item.isInteractive}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {overview.openTasks.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Open tasks</h2>
              <ul className="flex flex-col gap-2">
                {overview.openTasks.map((item) => (
                  <li
                    key={item.task.id}
                    className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <WeeklyToggle
                      taskId={item.task.id}
                      label={item.task.title}
                      completed={false}
                      interactive={item.isInteractive}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {overview.timesPerWeekItems.length > 0 && (
            <div className="flex flex-col gap-2">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">This week</h2>
              <ul className="flex flex-col gap-2">
                {overview.timesPerWeekItems.map((item) => (
                  <li
                    key={item.task.id}
                    className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
                  >
                    <WeeklyToggle
                      taskId={item.task.id}
                      label={`${item.task.title} — ${item.completedCount}/${item.targetCount} this week`}
                      completed={item.isCompletedToday}
                      interactive={item.isInteractive}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
