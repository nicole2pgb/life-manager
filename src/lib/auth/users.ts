import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { users as usersTable } from "@/lib/db/schema";
import type { User } from "@/lib/auth/types";
import { hashPassword } from "@/lib/auth/password";

// Server-only repository, mirroring src/lib/tasks.ts's shape and
// conventions (app-generated UUIDs, DATETIME(3) in UTC). Do not import from
// client components. `passwordHash` never leaves this file as part of a
// `User` value — see src/lib/auth/types.ts.

type UserRow = typeof usersTable.$inferSelect;

function rowToUser(row: UserRow): User {
  return { id: row.id, email: row.email, createdAt: row.createdAt.toISOString() };
}

// Normalizes the same way on every read and write, per specs/user-login.md's
// edge case ("Email is normalized (trimmed, lowercased) before uniqueness
// checks and storage") — this is the actual case-insensitivity mechanism,
// not reliance on MySQL's collation.
export function normalizeEmail(rawEmail: string): string {
  return rawEmail.trim().toLowerCase();
}

export async function getUserByEmail(rawEmail: string): Promise<User | null> {
  const email = normalizeEmail(rawEmail);
  const [row] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  return row ? rowToUser(row) : null;
}

export async function getUserById(id: string): Promise<User | null> {
  const [row] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  return row ? rowToUser(row) : null;
}

// Returns null (rather than throwing) if the email is already taken, so
// callers can produce the FR5.2 "already in use" message without relying on
// catching a database constraint error. Checks first for a fast/clear
// rejection, but also catches the database's own unique-constraint error on
// insert — the check-then-insert isn't atomic, so two concurrent
// registrations for the same email could both pass the initial check; the
// `users.email` UNIQUE constraint is the actual race-proof guarantee, this
// is just translating its failure into the same "already in use" outcome.
export async function createUser(input: { email: string; password: string }): Promise<User | null> {
  const email = normalizeEmail(input.email);

  const existing = await getUserByEmail(email);
  if (existing) return null;

  const id = randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(input.password);

  try {
    await db.insert(usersTable).values({ id, email, passwordHash, createdAt: now });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ER_DUP_ENTRY") {
      return null;
    }
    throw error;
  }

  return { id, email, createdAt: now.toISOString() };
}

// Only for verifying credentials at login — the one place password_hash is
// read at all. Never exported as part of the public `User` shape.
export async function getAuthByEmail(rawEmail: string): Promise<{ id: string; passwordHash: string } | null> {
  const email = normalizeEmail(rawEmail);
  const [row] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  return row ? { id: row.id, passwordHash: row.passwordHash } : null;
}
