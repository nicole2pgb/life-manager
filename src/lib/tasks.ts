import { randomUUID } from "node:crypto";
import type { Task } from "@/lib/task-types";

// Server-only in-memory store. Persisted on `globalThis` so data survives
// Next.js dev server hot reloads. Will be replaced by a real database later.
// Do not import this module from client components.
const globalForTasks = globalThis as unknown as { __tasks?: Task[] };
const tasks: Task[] = globalForTasks.__tasks ?? (globalForTasks.__tasks = []);

export function getTasks(): Task[] {
  return [...tasks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createTask(input: { title: string; notes: string | null }): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    title: input.title,
    notes: input.notes,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };
  tasks.push(task);
  return task;
}

export function updateTask(
  id: string,
  input: { title: string; notes: string | null },
): Task | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;

  task.title = input.title;
  task.notes = input.notes;
  task.updatedAt = new Date().toISOString();
  return task;
}

export function toggleTaskCompleted(id: string): Task | null {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;

  task.completed = !task.completed;
  task.updatedAt = new Date().toISOString();
  return task;
}

export function deleteTask(id: string): void {
  const index = tasks.findIndex((t) => t.id === id);
  if (index !== -1) tasks.splice(index, 1);
}
