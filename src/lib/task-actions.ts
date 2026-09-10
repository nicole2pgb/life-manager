"use server";

import { revalidatePath } from "next/cache";
import { createTask, deleteTask, toggleTaskOccurrence, updateTask } from "@/lib/tasks";
import {
  TASK_TITLE_MAX_LENGTH,
  TASK_NOTES_MAX_LENGTH,
  TIMES_PER_WEEK_MAX,
  TIMES_PER_WEEK_MIN,
  type RecurrenceRule,
  type Weekday,
} from "@/lib/task-types";

export type TaskActionResult = { error: string | null };

function parseRecurrenceInput(formData: FormData): RecurrenceRule | null | { error: string } {
  const type = String(formData.get("recurrenceType") ?? "none");

  switch (type) {
    case "none":
      return null;

    case "daily":
      return { type: "daily" };

    case "weekdays": {
      const days = Array.from(
        new Set(
          formData
            .getAll("weekdays")
            .map((value) => Number(value))
            .filter((value): value is Weekday => Number.isInteger(value) && value >= 0 && value <= 6),
        ),
      );
      if (days.length === 0) {
        return { error: "Select at least one weekday." };
      }
      return { type: "weekdays", days };
    }

    case "timesPerWeek": {
      const count = Number(formData.get("timesPerWeekCount"));
      if (!Number.isInteger(count) || count < TIMES_PER_WEEK_MIN || count > TIMES_PER_WEEK_MAX) {
        return {
          error: `Times per week must be a whole number between ${TIMES_PER_WEEK_MIN} and ${TIMES_PER_WEEK_MAX}.`,
        };
      }
      return { type: "timesPerWeek", count };
    }

    default:
      return { error: "Invalid recurrence type." };
  }
}

function parseTaskInput(
  formData: FormData,
): { title: string; notes: string | null; recurrence: RecurrenceRule | null } | { error: string } {
  const title = String(formData.get("title") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  if (!title) {
    return { error: "Title is required." };
  }
  if (title.length > TASK_TITLE_MAX_LENGTH) {
    return { error: `Title must be ${TASK_TITLE_MAX_LENGTH} characters or fewer.` };
  }
  if (notes.length > TASK_NOTES_MAX_LENGTH) {
    return { error: `Notes must be ${TASK_NOTES_MAX_LENGTH} characters or fewer.` };
  }

  const recurrence = parseRecurrenceInput(formData);
  if (recurrence !== null && "error" in recurrence) {
    return { error: recurrence.error };
  }

  return { title, notes: notes || null, recurrence };
}

export async function createTaskAction(formData: FormData): Promise<TaskActionResult> {
  const parsed = parseTaskInput(formData);
  if ("error" in parsed) return { error: parsed.error };

  createTask(parsed);
  revalidatePath("/");
  return { error: null };
}

export async function updateTaskAction(formData: FormData): Promise<TaskActionResult> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing task id." };

  const parsed = parseTaskInput(formData);
  if ("error" in parsed) return { error: parsed.error };

  const updated = updateTask(id, parsed);
  if (!updated) return { error: "Task not found." };

  revalidatePath("/");
  return { error: null };
}

export async function deleteTaskAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  deleteTask(id);
  revalidatePath("/");
}

export async function toggleTaskAction(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  toggleTaskOccurrence(id);
  revalidatePath("/");
}
