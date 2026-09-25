"use client";

import { useState, useTransition, type FormEvent } from "react";
import type { AuthActionResult } from "@/lib/auth/auth-actions";

// Shared by the login and register pages — same two fields, differing only
// in which Server Action they submit to and their labels. Follows the same
// onSubmit + preventDefault + manual FormData pattern already established
// in TaskForm (see src/components/tasks/task-form.tsx): a native
// `<form action={fn}>` resets the form at submit time, before the action
// resolves, which would clear an invalid password field before the user
// even sees the validation error.
export function AuthForm({
  action,
  submitLabel,
  pendingLabel,
  passwordAutoComplete,
}: {
  action: (formData: FormData) => Promise<AuthActionResult>;
  submitLabel: string;
  pendingLabel: string;
  passwordAutoComplete: "current-password" | "new-password";
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      // On success the action redirects server-side and this promise never
      // resolves with a value the client acts on; only the error path
      // returns normally.
      const result = await action(formData);
      if (result?.error) {
        setError(result.error);
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete={passwordAutoComplete}
          required
          minLength={8}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
        />
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={isPending}
        className="self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900"
      >
        {isPending ? pendingLabel : submitLabel}
      </button>
    </form>
  );
}
