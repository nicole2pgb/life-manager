"use server";

import { revalidatePath } from "next/cache";
import {
  createTask,
  deleteTask,
  setTaskCompleted,
  updateTask,
  TASK_TITLE_MAX_LENGTH,
  TASK_NOTES_MAX_LENGTH,
} from "@/lib/tasks";

export type TaskActionResult = { error: string | null };

function parseTaskInput(
  formData: FormData,
): { title: string; notes: string | null } | { error: string } {
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

  return { title, notes: notes || null };
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
  const currentlyCompleted = formData.get("completed") === "true";
  if (!id) return;

  setTaskCompleted(id, !currentlyCompleted);
  revalidatePath("/");
}
