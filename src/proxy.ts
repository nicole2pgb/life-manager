import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getIronSession } from "iron-session";
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

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  const session = await getIronSession<SessionData>(await cookies(), sessionOptions);
  const isAuthenticated = Boolean(session.userId);

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
