import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

const MIGRATIONS_FOLDER = "./drizzle";

// Confirmed Copilot finding on PR #6: drizzle's migrate() applies every
// pending migration in a folder in one continuous run (see
// node_modules/drizzle-orm/mysql-core/dialect.js's migrate() — a single
// loop over all pending entries with no pause between files). On a
// database that already has tasks with no owner (this project's own
// pre-auth data), a single `npm run db:migrate` invocation would apply
// 0003 (adds the nullable tasks.user_id column) and immediately continue
// into 0004 (tightens it to NOT NULL + a foreign key) in the same call —
// leaving no window for a human to register an account and run
// scripts/assign-legacy-tasks.ts in between, exactly the two-step
// procedure specs/user-login.md's Migration Strategy describes. 0004 itself
// still never deletes anything (it fails outright if any row has a NULL
// user_id, by design), but *reaching* that failure automatically, mid-run,
// isn't the same as the deliberate, stoppable procedure the spec promises.
//
// GATED_MIGRATIONS lets a specific migration declare a precondition that
// must hold before this script will apply it. If the precondition isn't
// met, the script applies everything strictly before that migration (using
// drizzle's own migrate(), against a temporary folder containing only that
// prefix) and then stops with instructions — never silently skipping,
// deleting, or auto-resolving anything. Re-running `npm run db:migrate`
// after the precondition is met picks up exactly where it left off.
const GATED_MIGRATIONS: Record<
  string,
  { check: (connection: mysql.Connection) => Promise<boolean>; message: string }
> = {
  "0004_tighten_task_owner": {
    async check(connection) {
      const errorCode = (error: unknown): string | undefined =>
        error && typeof error === "object" && "code" in error ? String(error.code) : undefined;

      try {
        const [rows] = await connection.query<mysql.RowDataPacket[]>(
          "SELECT COUNT(*) AS count FROM `tasks` WHERE `user_id` IS NULL",
        );
        return Number(rows[0].count) === 0;
      } catch (error) {
        // A fresh install where `tasks` doesn't exist yet (migration 0000
        // hasn't run) trivially has no orphaned tasks — nothing to guard
        // against, so it's safe to let migrate() continue through the
        // whole pending set in one call.
        if (errorCode(error) === "ER_NO_SUCH_TABLE") {
          return true;
        }
        // `tasks` exists but `user_id` doesn't yet (migration 0003 — which
        // adds it as nullable — hasn't run in this same invocation, e.g. a
        // database still on pre-auth migrations 0000-0002, exactly this
        // project's own history). Every existing `tasks` row will become an
        // orphan (user_id IS NULL) the instant 0003 adds that column, so the
        // precondition reduces to "are there any existing rows at all?" —
        // 0003 hasn't run yet, so `user_id IS NULL` can't be asked directly.
        if (errorCode(error) === "ER_BAD_FIELD_ERROR") {
          const [rows] = await connection.query<mysql.RowDataPacket[]>(
            "SELECT COUNT(*) AS count FROM `tasks`",
          );
          return Number(rows[0].count) === 0;
        }
        throw error;
      }
    },
    message:
      "Stopped before migration 0004 (tasks.user_id -> NOT NULL + foreign key): some tasks " +
      "still have no owner (user_id IS NULL). Nothing has been deleted or changed by this " +
      "migration. Register an account through the app, then run:\n" +
      "  npm run assign-legacy-tasks -- <your-email>\n" +
      "and re-run `npm run db:migrate` once that completes — it will pick up exactly where it " +
      "left off.",
  },
};

type JournalEntry = { tag: string; when: number };

function readJournal(): { entries: JournalEntry[] } {
  const journalPath = path.join(MIGRATIONS_FOLDER, "meta", "_journal.json");
  return JSON.parse(fs.readFileSync(journalPath, "utf8"));
}

// Builds a temporary migrations folder containing only the journal entries
// strictly before `stopBeforeTag`, so drizzle's real migrate() can be used
// to apply exactly that safe prefix — see GATED_MIGRATIONS above. Returns
// null if there is nothing to apply before it (nothing to do). Passing
// already-applied entries through again here is harmless: migrate()
// independently re-checks each one's timestamp against the database's own
// tracking table and skips anything already applied.
function buildPrefixFolder(stopBeforeTag: string): string | null {
  const journal = readJournal();
  const cutIndex = journal.entries.findIndex((entry) => entry.tag === stopBeforeTag);
  const prefixEntries = cutIndex === -1 ? journal.entries : journal.entries.slice(0, cutIndex);
  if (prefixEntries.length === 0) return null;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "life-manager-migrate-"));
  fs.mkdirSync(path.join(tempDir, "meta"));
  fs.writeFileSync(path.join(tempDir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries: prefixEntries }));
  for (const entry of prefixEntries) {
    fs.copyFileSync(path.join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), path.join(tempDir, `${entry.tag}.sql`));
  }
  return tempDir;
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

    // Mirrors drizzle's own bootstrap (dialect.js creates this table lazily
    // on first use) — created slightly earlier here since the loop below
    // reads from it directly to know which migrations are actually
    // pending, not just listed in the journal.
    await db.execute(sql`
      create table if not exists \`__drizzle_migrations\` (
        id serial primary key,
        hash text not null,
        created_at bigint
      )
    `);
    const [lastAppliedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT created_at FROM `__drizzle_migrations` ORDER BY created_at DESC LIMIT 1",
    );
    const lastApplied = lastAppliedRows.length > 0 ? Number(lastAppliedRows[0].created_at) : -Infinity;

    // Find the first *pending* migration (if any) whose gate precondition
    // currently fails, walking the journal in order. Already-applied
    // migrations are never re-checked — only a migration this run would
    // actually attempt to apply can hold things back. Only that one
    // migration and everything after it are held back — anything before it
    // is applied normally below.
    const { entries } = readJournal();
    let stopBeforeTag: string | null = null;
    for (const entry of entries) {
      if (entry.when <= lastApplied) continue; // already applied — never re-gated
      const gate = GATED_MIGRATIONS[entry.tag];
      if (gate && !(await gate.check(connection))) {
        stopBeforeTag = entry.tag;
        break;
      }
    }

    if (stopBeforeTag) {
      const prefixFolder = buildPrefixFolder(stopBeforeTag);
      if (prefixFolder) {
        try {
          await migrate(db, { migrationsFolder: prefixFolder });
        } finally {
          fs.rmSync(prefixFolder, { recursive: true, force: true });
        }
      }
      console.log(GATED_MIGRATIONS[stopBeforeTag].message);
      return;
    }

    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
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
