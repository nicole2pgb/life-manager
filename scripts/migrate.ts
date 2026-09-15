import { config } from "dotenv";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/mysql2/migrator";
import { connectionOptionsFromUrl } from "../src/lib/db/connection-options";

// Next.js auto-loads .env.local for the app itself, but this script is a
// standalone process — load it explicitly.
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
}

// A dedicated, single Connection — deliberately NOT this project's shared
// Pool (src/lib/db/client.ts) — so the SET SESSION statement below and
// every statement `migrate()` runs are guaranteed to execute on the exact
// same MySQL session. A pool leases a (possibly different) physical
// connection for each unrelated query it's given, so running the SET
// through a pooled `db.execute()` and then handing a *different* pooled
// `db` to `migrate()` could silently apply the SET to a connection that
// migrate() never actually uses. A migration run is inherently one-shot
// and sequential, so a single Connection is both simpler and the only
// fully correct choice here.
async function main() {
  const connection = await mysql.createConnection(
    connectionOptionsFromUrl(process.env.DATABASE_URL as string),
  );

  try {
    const db = drizzle(connection);

    // Fixes the fresh-install InnoDB gap in migration 0000: 0000's CREATE
    // TABLE statements don't specify an engine (relying on the server's
    // default), so on a fresh MySQL server whose default_storage_engine
    // isn't InnoDB, 0000's own ADD CONSTRAINT ... FOREIGN KEY statement
    // would fail before migration 0001 (which converts the engine after
    // the fact) ever gets a chance to run. 0000 has already been applied
    // elsewhere and must not be edited, and nothing can be inserted
    // "before" it in the migration sequence — so this forces the
    // *session's* default engine to InnoDB before migrations run instead.
    // Unqualified CREATE TABLE statements use whichever engine is current
    // for the session, regardless of the server-wide default, so this
    // guarantees 0000 succeeds on a truly fresh database without changing
    // any migration file. See specs/mysql-persistence.md.
    //
    // Safe on an already-migrated database (like this project's local
    // one): drizzle's migration tracking only compares each migration's
    // timestamp against the latest applied timestamp (see
    // readMigrationFiles / dialect.migrate in drizzle-orm) — it does not
    // re-verify file hashes of already-applied migrations. Every migration
    // currently in drizzle/ has a timestamp at or before the last applied
    // one, so all of them are skipped entirely; this SET statement then
    // has nothing to affect, since no CREATE TABLE runs in that session.
    await db.execute(sql`SET SESSION default_storage_engine = InnoDB`);
    await migrate(db, { migrationsFolder: "./drizzle" });

    console.log("Migrations applied.");
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
