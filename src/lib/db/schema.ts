import { mysqlTable, char, varchar, boolean, datetime, date, json, uniqueIndex } from "drizzle-orm/mysql-core";
import type { RecurrenceRule } from "@/lib/task-types";

// Mirrors specs/mysql-persistence.md exactly. This schema is a
// persistence-only concern — src/lib/task-types.ts remains the single
// source of truth for the shapes the rest of the app works with; the
// repository layer (src/lib/tasks.ts) translates to and from these rows.

export const tasks = mysqlTable("tasks", {
  id: char("id", { length: 36 }).primaryKey(),
  title: varchar("title", { length: 200 }).notNull(),
  notes: varchar("notes", { length: 2000 }),
  completed: boolean("completed").notNull().default(false),
  completedAt: datetime("completed_at"), // meaningful only when recurrence is null
  recurrence: json("recurrence").$type<RecurrenceRule | null>(), // null = one-off task
  createdAt: datetime("created_at").notNull(),
  updatedAt: datetime("updated_at").notNull(),
});

export const taskCompletions = mysqlTable(
  "task_completions",
  {
    id: char("id", { length: 36 }).primaryKey(),
    taskId: char("task_id", { length: 36 })
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    // mode: "string" is deliberate, not the Drizzle default: a plain DATE has
    // no "Z"-suffix trick the way `datetime()` does (see client.ts), so the
    // default Date-object mode would parse "YYYY-MM-DD" as UTC midnight and
    // risk shifting by a day if ever read through local-timezone getters
    // (exactly what recurrence.ts's parseISODate already guards against for
    // app-side parsing). Keeping it a plain string end-to-end sidesteps that
    // entirely and matches TaskCompletion.occurrenceDate's existing type.
    occurrenceDate: date("occurrence_date", { mode: "string" }).notNull(),
    completedAt: datetime("completed_at").notNull(),
  },
  (table) => ({
    oneCompletionPerTaskPerDay: uniqueIndex("one_completion_per_task_per_day").on(
      table.taskId,
      table.occurrenceDate,
    ),
  }),
);
