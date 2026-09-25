import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { unsealData } from "iron-session";
import { sessionOptions } from "@/lib/auth/session";
import type { SessionData } from "@/lib/auth/types";

// This project's Next.js version renamed `middleware.ts` to `proxy.ts` (see
// AGENTS.md's note to check bundled docs for API changes before writing
// code) — same mechanism, new file/export name. See
// specs/user-login.md "Technology Decisions": this only performs the
// optimistic, UX-facing redirect (FR5.7/FR5.8). It reads the session cookie
// with no database call, exactly as Next's own guidance for Proxy requires.
// It is not the authorization boundary — every Server Action and page
// independently calls verifySession() (src/lib/auth/session.ts) before
// touching any data, since a matcher change or a route moved outside this
// file's coverage must not silently become unauthenticated.

const PUBLIC_ROUTES = new Set(["/login", "/register"]);

// Confirmed Copilot finding on PR #6: reads the cookie directly off
// `request.cookies` and decrypts it with iron-session's low-level
// unsealData(), rather than getIronSession(await cookies(), ...) (the
// pattern src/lib/auth/session.ts uses for Server Components/Actions).
// Proxy is documented as its own network boundary, run separately from the
// render pipeline — node_modules/next/dist/docs/.../proxy.md: "Proxy is
// meant to be invoked separately of your render code ... you should not
// attempt relying on shared modules or globals" — and next/headers'
// cookies() depends on request-scoped context normally established by the
// App Router's render machinery. request.cookies is NextRequest's own
// property, always populated directly from the incoming request
// regardless of that, so reading the cookie this way has no dependency on
// whether Proxy's execution context initializes the same globals a page
// render does. (The official bundled authentication guide's own Proxy
// example does use cookies() from next/headers this way and presumably
// works in the common case, but request.cookies + unsealData() is the more
// defensible choice for this specific file rather than relying on that.)
async function readUserId(request: NextRequest): Promise<string | undefined> {
  const raw = request.cookies.get(sessionOptions.cookieName)?.value;
  if (!raw) return undefined;

  try {
    const session = await unsealData<SessionData>(raw, {
      password: sessionOptions.password,
      ttl: sessionOptions.ttl,
    });
    return session.userId;
  } catch {
    // A cookie that fails to decrypt (corrupted, tampered, or sealed under
    // a since-rotated SESSION_SECRET) must be treated as "no session",
    // never thrown — the same requirement src/lib/auth/session.ts's
    // getSession() enforces for every page and Server Action. Verified
    // against node_modules/iron-webcrypto/dist/index.js that iron-session's
    // own unsealData() only swallows some failure modes ("Expired seal",
    // "Bad hmac value", "Cannot find password", "Incorrect number of
    // sealed components") and lets others ("Wrong mac prefix", "Invalid
    // expiration") propagate uncaught — this catch is the actual boundary.
    return undefined;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  const userId = await readUserId(request);
  const isAuthenticated = Boolean(userId);

  if (!isAuthenticated && !isPublicRoute) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isAuthenticated && isPublicRoute) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
