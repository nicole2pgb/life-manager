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

// A session that can never legitimately be saved/destroyed (see the
// read-only fallback in getSession() below) — its userId is simply absent,
// which is all verifySession() needs to correctly treat it as
// unauthenticated. save()/destroy() are safe no-ops rather than throwing:
// nothing should ever legitimately call them on this object, but silently
// doing nothing is strictly safer than crashing if something unexpected
// does.
function emptySession(): IronSession<SessionData> {
  return {
    save: async () => {},
    destroy: () => {},
    updateConfig: () => {},
  } as IronSession<SessionData>;
}

// Server Components, Server Actions, and Route Handlers only, where
// next/headers' cookies() is the real read/write store. Calling .save() or
// .destroy() on the object this returns only works from a Server Action or
// Route Handler (a Server Component's cookies() is read-only) — createSession
// and destroySession below are only ever called from Server Actions.
//
// Confirmed Copilot finding on PR #6: a cookie that fails to decrypt
// (corrupted, tampered, or sealed under a since-rotated SESSION_SECRET)
// must behave as "no session", never throw — see specs/user-login.md
// Security Requirements. iron-session's own internal handling only
// swallows some failure modes (verified against
// node_modules/iron-webcrypto/dist/index.js: "Expired seal", "Bad hmac
// value", "Cannot find password", "Incorrect number of sealed components")
// and lets others (e.g. "Wrong mac prefix", "Invalid expiration" — both
// realistic for a genuinely corrupted, not just wrong-password, cookie)
// propagate uncaught out of getIronSession() itself. This is the actual
// defensive boundary, not a duplicate of that partial handling.
export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  try {
    return await getIronSession<SessionData>(cookieStore, sessionOptions);
  } catch {
    try {
      // Clear the unreadable cookie and construct a fresh session in its
      // place — with no cookie left to unseal, this succeeds trivially.
      // Only possible in a Server Action/Route Handler, where cookies() is
      // writable.
      cookieStore.delete(sessionOptions.cookieName);
      return await getIronSession<SessionData>(cookieStore, sessionOptions);
    } catch {
      // Either cookieStore is read-only (a Server Component calling this
      // only to read session.userId, via verifySession()) or the retry
      // failed for some other reason — either way, degrade to a safe,
      // functionally-empty session rather than propagating an error.
      return emptySession();
    }
  }
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
