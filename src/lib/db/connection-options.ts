import type mysql from "mysql2/promise";

// Shared by src/lib/db/client.ts (the app's long-lived connection pool) and
// scripts/migrate.ts (a dedicated single connection — see that file for why
// migrations must not share the app's pool). Both need to parse
// DATABASE_URL identically so they can never silently disagree about how
// to connect.
export function connectionOptionsFromUrl(databaseUrl: string): mysql.PoolOptions {
  const url = new URL(databaseUrl);
  const options: Record<string, unknown> = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
  };

  // Forward any query-string options (e.g. `?ssl=...`, `?connectionLimit=5`)
  // the connection string might carry, the same way mysql2's own URL
  // parsing would — including normalizing their type. A query string is
  // always text, but a value like "10" or "true" means the number 10 or
  // the boolean true to mysql2 (e.g. connectionLimit, multipleStatements),
  // not the literal string "10"/"true" — passing the raw string through
  // unchanged would silently hand mysql2 the wrong type for any such
  // option. This mirrors mysql2's own (unexported) ConnectionConfig.parseUrl,
  // which tries JSON.parse on each value and falls back to the plain string.
  for (const [key, value] of url.searchParams) {
    try {
      options[key] = JSON.parse(value);
    } catch {
      options[key] = value;
    }
  }

  // Set last, so nothing in the connection string can ever override it.
  options.timezone = "Z";

  return options as mysql.PoolOptions;
}
