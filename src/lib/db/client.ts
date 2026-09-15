import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { connectionOptionsFromUrl } from "@/lib/db/connection-options";

// Server-only. Do not import this module from client components.
//
// Credentials come from DATABASE_URL (see .env.example) — a connection
// string for the dedicated, least-privileged app user, never root. The
// connection's timezone is pinned explicitly to UTC ("Z"), not left to the
// host machine's or MySQL server's default, per specs/mysql-persistence.md's
// timezone strategy: every DATETIME value this app reads or writes is a UTC
// instant, and an unconfigured connection could silently assume local time
// on either side instead. See connection-options.ts for how DATABASE_URL is
// parsed.
//
// This pool is for the running app's request-driven, concurrent access
// only. Do not reuse it for one-shot administrative work like migrations
// (see scripts/migrate.ts) — a pool leases a possibly-different physical
// connection per query, which would silently break any per-session setting
// (e.g. a storage-engine override) a migration might need to hold across
// several statements.
//
// The pool is cached on `globalThis`, mirroring the same idiom the
// in-memory store used to survive Next.js dev-server hot reloads without
// leaking resources — previously an array, now a connection pool.

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
}

const globalForDb = globalThis as unknown as { __mysqlPool?: mysql.Pool };

const pool =
  globalForDb.__mysqlPool ??
  (globalForDb.__mysqlPool = mysql.createPool(connectionOptionsFromUrl(process.env.DATABASE_URL)));

export const db = drizzle(pool);
