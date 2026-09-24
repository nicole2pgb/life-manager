import { config } from "dotenv";

// Next.js auto-loads .env.local for the app itself; Vitest is a separate
// process and does not, so tests need DATABASE_URL/SESSION_SECRET loaded
// explicitly — same as scripts/migrate.ts.
config({ path: ".env.local" });
