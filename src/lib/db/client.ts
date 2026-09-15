import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";

// Server-only. Do not import this module from client components.
//
// Credentials come from DATABASE_URL (see .env.example) — a connection
// string for the dedicated, least-privileged app user, never root. The
// connection's timezone is pinned explicitly to UTC ("Z"), not left to the
// host machine's or MySQL server's default, per specs/mysql-persistence.md's
// timezone strategy: every DATETIME value this app reads or writes is a UTC
// instant, and an unconfigured connection could silently assume local time
// on either side instead.
//
// DATABASE_URL is parsed into discrete fields (host/port/user/password/
// database) rather than passed through mysql2's `uri` option: mysql2 only
// applies a sibling option (like `timezone`) from a `uri` config if the
// parsed URL doesn't already define that same key, so a future change to
// the connection string (or to mysql2's own merge behavior) could otherwise
// silently drop the UTC setting with no error. Parsing it ourselves removes
// that ambiguity — `timezone` is a plain top-level field, not something
// that has to survive a merge.
//
// The pool is cached on `globalThis`, mirroring the same idiom the
// in-memory store used to survive Next.js dev-server hot reloads without
// leaking resources — previously an array, now a connection pool.

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
}

function poolOptionsFromUrl(databaseUrl: string): mysql.PoolOptions {
  const url = new URL(databaseUrl);
  const options: mysql.PoolOptions = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };

  // Forward any query-string options (e.g. `?ssl=...`) the connection
  // string might carry, the same way mysql2's own URL parsing would —
  // parsing discrete fields ourselves shouldn't silently drop functionality
  // a `uri`-based config would have honored.
  for (const [key, value] of url.searchParams) {
    (options as Record<string, unknown>)[key] = value;
  }

  // Set last, so nothing in the connection string can ever override it.
  options.timezone = "Z";

  return options;
}

const globalForDb = globalThis as unknown as { __mysqlPool?: mysql.Pool };

const pool =
  globalForDb.__mysqlPool ??
  (globalForDb.__mysqlPool = mysql.createPool(poolOptionsFromUrl(process.env.DATABASE_URL)));

export const db = drizzle(pool);
