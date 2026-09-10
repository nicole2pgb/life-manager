"use client";

import { useRef, useState, useTransition } from "react";
import { createTaskAction } from "@/lib/task-actions";
import { TASK_NOTES_MAX_LENGTH, TASK_TITLE_MAX_LENGTH } from "@/lib/tasks";

export function TaskForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createTaskAction(formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setError(null);
      formRef.current?.reset();
    });
  }

  return (
    <form
      ref={formRef}
      action={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="title" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          maxLength={TASK_TITLE_MAX_LENGTH}
          required
          placeholder="What do you need to do?"
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="notes" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Notes (optional)
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={2}
          maxLength={TASK_NOTES_MAX_LENGTH}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isPending ? "Adding…" : "Add task"}
      </button>
    </form>
  );
}
