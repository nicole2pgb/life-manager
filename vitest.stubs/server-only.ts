// Stub for the bare `server-only` import used in src/lib/auth/session.ts.
// The real `server-only` package's content unconditionally throws when
// executed — it relies on Next.js's bundler stripping/special-casing it per
// client-vs-server bundle, which Vitest has no equivalent of. Aliased here
// (see vitest.config.ts) to a genuine no-op instead, since the guarantee it
// enforces (this module is server-only) is already true by construction
// for everything under test — nothing here runs in a browser.
export {};
