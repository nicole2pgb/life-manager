import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Next.js auto-loads .env.local for the app itself, but the drizzle-kit CLI
// is a separate process and does not — load it explicitly here.
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add it to .env.local before running drizzle-kit.");
}

export default defineConfig({
  dialect: "mysql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
