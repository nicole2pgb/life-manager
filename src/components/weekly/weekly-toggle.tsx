"use client";

import { useTransition } from "react";
import { toggleTaskAction } from "@/lib/task-actions";

export function WeeklyToggle({
  taskId,
  label,
  completed,
  interactive,
}: {
  taskId: string;
  label: string;
  completed: boolean;
  interactive: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const formData = new FormData();
    formData.set("id", taskId);
    startTransition(async () => {
      await toggleTaskAction(formData);
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={completed}
        onChange={handleToggle}
        disabled={isPending || !interactive}
        className="h-4 w-4"
      />
      <span
        className={
          completed
            ? "text-zinc-400 line-through dark:text-zinc-600"
            : "text-zinc-900 dark:text-zinc-50"
        }
      >
        {label}
      </span>
    </label>
  );
}
