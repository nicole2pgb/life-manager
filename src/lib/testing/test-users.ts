import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { tasks as tasksTable, users as usersTable } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";

// Test-only helpers — see specs/user-login.md "Testing Requirements". Tests
// run against the same local database as `npm run dev`, so every disposable
// user/task these create must be cleaned up afterward. Do not import this
// module from application code.

export async function createTestUser(): Promise<{ id: string; email: string }> {
  const id = randomUUID();
  const email = `vitest-${id}@example.test`;
  const passwordHash = await hashPassword("Test-Password-123");
  await db.insert(usersTable).values({ id, email, passwordHash, createdAt: new Date() });
  return { id, email };
}

// Deletes the user and every task they own. tasks.user_id has no foreign
// key yet (see specs/user-login.md's Migration Strategy — it's added later,
// once the pre-existing unowned rows are resolved), so deleting the `users`
// row alone would not cascade; the tasks are deleted explicitly first. That
// delete does cascade to task_completions via the existing tasks.id
// foreign key, unaffected by this feature.
export async function deleteTestUser(id: string): Promise<void> {
  await db.delete(tasksTable).where(eq(tasksTable.userId, id));
  await db.delete(usersTable).where(eq(usersTable.id, id));
}
