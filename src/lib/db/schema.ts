import { mysqlTable, char, varchar, boolean, datetime, date, json, uniqueIndex } from "drizzle-orm/mysql-core";
import type { RecurrenceRule } from "@/lib/task-types";

// Mirrors specs/mysql-persistence.md and specs/user-login.md exactly. This
// schema is a persistence-only concern — src/lib/task-types.ts remains the
// single source of truth for the shapes the rest of the app works with; the
// repository layer (src/lib/tasks.ts) translates to and from these rows.

export const users = mysqlTable("users", {
  id: char("id", { length: 36 }).primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  createdAt: datetime("created_at", { fsp: 3 }).notNull(),
});

export const tasks = mysqlTable("tasks", {
  id: char("id", { length: 36 }).primaryKey(),
  // Tightened to NOT NULL + a foreign key in migration 0004, once the 4
  // legacy rows that predated this column were explicitly assigned to an
  // account (see specs/user-login.md's Migration Strategy and
  // scripts/assign-legacy-tasks.ts) — confirmed via a zero-orphan check
  // before this migration was generated.
  userId: char("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 200 }).notNull(),
  notes: varchar("notes", { length: 2000 }),
  completed: boolean("completed").notNull().default(false),
  // fsp: 3 (millisecond precision) — the app supplies `Date` values with
  // millisecond precision (`new Date()`), and task ordering depends on
  // `createdAt`; a plain DATETIME (second precision) would silently
  // truncate that and widen the tie window for near-simultaneous creates.
  completedAt: datetime("completed_at", { fsp: 3 }), // meaningful only when recurrence is null
  recurrence: json("recurrence").$type<RecurrenceRule | null>(), // null = one-off task
  createdAt: datetime("created_at", { fsp: 3 }).notNull(),
  updatedAt: datetime("updated_at", { fsp: 3 }).notNull(),
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
    completedAt: datetime("completed_at", { fsp: 3 }).notNull(),
  },
  (table) => ({
    oneCompletionPerTaskPerDay: uniqueIndex("one_completion_per_task_per_day").on(
      table.taskId,
      table.occurrenceDate,
    ),
  }),
);
