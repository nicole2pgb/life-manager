import { config } from "dotenv";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { eq, isNull } from "drizzle-orm";
import { connectionOptionsFromUrl } from "../src/lib/db/connection-options";
import { tasks, users } from "../src/lib/db/schema";

// One-time, manually-run data fix for the task rows that existed before
// this feature shipped — see specs/user-login.md "Migration Strategy for
// the 4 Existing Tasks". Deliberately NOT part of any Server Action or
// request path: deciding who owns previously-unowned data is a one-time
// human decision, not a standing rule the application should enforce on
// every registration (that was an earlier, explicitly rejected design —
// see the spec).
//
// Usage: npx tsx scripts/assign-legacy-tasks.ts <email>
// The email must already belong to an account you registered through the
// app. Safe to run multiple times — it only ever touches rows that still
// have no owner (a no-op once none remain).

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
}

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error("Usage: npx tsx scripts/assign-legacy-tasks.ts <email>");
    process.exit(1);
  }

  const connection = await mysql.createConnection(
    connectionOptionsFromUrl(process.env.DATABASE_URL as string),
  );

  try {
    const db = drizzle(connection);

    const [user] = await db.select().from(users).where(eq(users.email, email));
    if (!user) {
      console.error(`No registered account found for "${email}". Register through the app first.`);
      process.exit(1);
    }

    const orphanedRows = await db.select().from(tasks).where(isNull(tasks.userId));
    if (orphanedRows.length === 0) {
      console.log("No unowned tasks found — nothing to assign.");
      return;
    }

    await db.update(tasks).set({ userId: user.id }).where(isNull(tasks.userId));
    console.log(`Assigned ${orphanedRows.length} unowned task(s) to ${email}.`);
  } finally {
    await connection.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
