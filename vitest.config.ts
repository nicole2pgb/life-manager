import path from "node:path";
import { defineConfig } from "vitest/config";

// See specs/user-login.md "Testing Requirements": no separate test
// database — tests run against the same local life_manager MySQL database
// as `npm run dev`, using disposable test-only users (see
// src/lib/testing/test-users.ts) that never touch real data.
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
