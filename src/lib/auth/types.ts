// See specs/user-login.md. `User` deliberately excludes `passwordHash` — it
// is the shape ever passed around outside src/lib/auth/users.ts, never the
// raw DB row.
export type User = {
  id: string;
  email: string;
  createdAt: string;
};

// Stored, encrypted, in the iron-session cookie — see session.ts. Kept to
// the minimum per Next.js's own guidance: no PII, no role, just enough to
// look the user back up.
export type SessionData = {
  userId?: string;
};
