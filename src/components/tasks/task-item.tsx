"use client";

import { useState, useTransition, type FormEvent } from "react";
import {
  TASK_NOTES_MAX_LENGTH,
  TASK_TITLE_MAX_LENGTH,
  formatRecurrenceLabel,
  type Task,
} from "@/lib/task-types";
import { deleteTaskAction, toggleTaskAction, updateTaskAction } from "@/lib/task-actions";
import { RecurrenceFields } from "@/components/tasks/recurrence-fields";

type TaskItemProps = {
  task: Task;
  isDueToday: boolean;
  isCompletedToday: boolean;
  weeklyCompletedCount: number;
};

export function TaskItem({ task, isDueToday, isCompletedToday, weeklyCompletedCount }: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const formData = new FormData();
    formData.set("id", task.id);
    startTransition(async () => {
      await toggleTaskAction(formData);
    });
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await updateTaskAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setIsEditing(false);
    });
  }

  function handleDelete() {
    const formData = new FormData();
    formData.set("id", task.id);
    startTransition(async () => {
      await deleteTaskAction(formData);
    });
  }

  if (isEditing) {
    return (
      <li className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <form onSubmit={handleSave} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={task.id} />
          <input
            name="title"
            type="text"
            aria-label="Title"
            defaultValue={task.title}
            maxLength={TASK_TITLE_MAX_LENGTH}
            required
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <textarea
            name="notes"
            aria-label="Notes"
            rows={2}
            defaultValue={task.notes ?? ""}
            maxLength={TASK_NOTES_MAX_LENGTH}
            className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          />
          <RecurrenceFields defaultRecurrence={task.recurrence} />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setIsEditing(false);
              }}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
            >
              Cancel
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex items-start gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <input
        type="checkbox"
        checked={isCompletedToday}
        onChange={handleToggle}
        disabled={isPending || !isDueToday}
        className="mt-1 h-4 w-4"
        aria-label={
          isDueToday
            ? `Mark "${task.title}" as ${isCompletedToday ? "incomplete" : "complete"} for today`
            : `"${task.title}" is not due today`
        }
      />
      <div className="flex-1">
        <p
          className={
            isCompletedToday
              ? "text-sm font-medium text-zinc-400 line-through dark:text-zinc-600"
              : "text-sm font-medium text-zinc-900 dark:text-zinc-50"
          }
        >
          {task.title}
        </p>
        {task.recurrence && (
          <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
            {formatRecurrenceLabel(task.recurrence)}
            {task.recurrence.type === "timesPerWeek" &&
              ` · ${weeklyCompletedCount}/${task.recurrence.count} this week`}
          </p>
        )}
        {task.notes && (
          <p
            className={
              isCompletedToday
                ? "mt-1 text-sm text-zinc-400 line-through dark:text-zinc-600"
                : "mt-1 text-sm text-zinc-600 dark:text-zinc-400"
            }
          >
            {task.notes}
          </p>
        )}
      </div>
      <div className="flex shrink-0 gap-3">
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          className="text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="text-sm font-medium text-red-600 hover:text-red-800 disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
        >
          Delete
        </button>
      </div>
    </li>
  );
}
