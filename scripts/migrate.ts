import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";

// Next.js auto-loads .env.local for the app itself, but this script is a
// standalone process — load it explicitly, and do so *before* importing
// src/lib/db/client.ts (via a dynamic import below), since that module
// reads process.env.DATABASE_URL at import time.
config({ path: ".env.local" });

// Fixes the fresh-install InnoDB gap in migration 0000: 0000's CREATE TABLE
// statements don't specify an engine (relying on the server's default), so
// on a fresh MySQL server whose default_storage_engine isn't InnoDB, 0000's
// own ADD CONSTRAINT ... FOREIGN KEY statement would fail before migration
// 0001 (which converts the engine after the fact) ever gets a chance to
// run. 0000 has already been applied elsewhere and must not be edited, and
// nothing can be inserted "before" it in the migration sequence — so this
// forces the *session's* default engine to InnoDB before migrations run
// instead. Unqualified CREATE TABLE statements use whichever engine is
// current for the session, regardless of the server-wide default, so this
// guarantees 0000 succeeds on a truly fresh database without changing any
// migration file. See specs/mysql-persistence.md.
//
// Safe on an already-migrated database (like this project's local one):
// drizzle's migration tracking only compares each migration's timestamp
// against the latest applied timestamp (see readMigrationFiles /
// dialect.migrate in drizzle-orm) — it does not re-verify file hashes of
// already-applied migrations. Every migration currently in drizzle/ has a
// timestamp at or before the last applied one, so all of them are skipped
// entirely; this SET statement then has nothing to affect, since no
// CREATE TABLE runs in that session.
async function main() {
  const { db } = await import("../src/lib/db/client");

  await db.execute(sql`SET SESSION default_storage_engine = InnoDB`);
  await migrate(db, { migrationsFolder: "./drizzle" });

  console.log("Migrations applied.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
