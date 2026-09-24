import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import type { SessionData } from "@/lib/auth/types";

// See specs/user-login.md "Technology Decisions" and "Session & Route
// Protection". Session data is just { userId } inside a signed + encrypted
// HTTP-only cookie — no server-side session table.

if (!process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET is not set. Add it to .env.local (see .env.example).");
}

// Exported so src/proxy.ts can decrypt the same cookie for its optimistic,
// UX-only redirect check — see that file for why it must never be the only
// place this is checked.
export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_SECRET,
  cookieName: "life_manager_session",
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  },
};

// Server Components, Server Actions, and Route Handlers only, where
// next/headers' cookies() is the real read/write store. Calling .save() or
// .destroy() on the object this returns only works from a Server Action or
// Route Handler (a Server Component's cookies() is read-only) — createSession
// and destroySession below are only ever called from Server Actions.
export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}

export async function createSession(userId: string): Promise<void> {
  const session = await getSession();
  session.userId = userId;
  await session.save();
}

export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}

// The Data Access Layer entry point (Next.js's own recommended pattern —
// see the bundled authentication guide). Every Server Action and every page
// must call this before reading or writing any task data; see
// specs/user-login.md's Technology Decisions for why src/proxy.ts's
// redirect is not sufficient on its own. Redirects immediately rather than
// returning an empty/undefined userId, so a caller can never accidentally
// proceed as if a session existed. Memoized per request with React's
// cache() so multiple call sites within one render only decrypt the cookie
// once.
export const verifySession = cache(async (): Promise<{ userId: string }> => {
  const session = await getSession();
  if (!session.userId) {
    redirect("/login");
  }
  return { userId: session.userId };
});
