import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { sealData } from "iron-session";
import { proxy } from "@/proxy";
import { sessionOptions } from "@/lib/auth/session";

// Confirmed Copilot findings on PR #6, both covered here:
// - Finding 2: proxy.ts reads the session cookie directly off
//   request.cookies (not next/headers' cookies()) — these tests exercise
//   the real exported `proxy` function against real NextRequest objects,
//   so they'd fail if that stopped working.
// - Finding 4: a tampered/garbage session cookie must be treated as
//   anonymous (redirect to /login on a protected route), never throw.

async function requestTo(pathname: string, cookieValue?: string): Promise<NextRequest> {
  const headers = new Headers();
  if (cookieValue !== undefined) {
    headers.set("cookie", `${sessionOptions.cookieName}=${cookieValue}`);
  }
  return new NextRequest(new Request(`http://localhost:3000${pathname}`, { headers }));
}

async function validSessionCookie(userId: string): Promise<string> {
  return sealData({ userId }, { password: sessionOptions.password });
}

describe("proxy", () => {
  it("redirects an unauthenticated request on a protected route to /login", async () => {
    const response = await proxy(await requestTo("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("does not redirect an unauthenticated request to /login or /register", async () => {
    const loginResponse = await proxy(await requestTo("/login"));
    expect(loginResponse.headers.get("location")).toBeNull();

    const registerResponse = await proxy(await requestTo("/register"));
    expect(registerResponse.headers.get("location")).toBeNull();
  });

  it("treats a garbage/tampered session cookie as unauthenticated, not an error", async () => {
    // `.resolves.not.toThrow()` was a no-op — `toThrow` expects a function
    // to invoke, not a resolved value, so it never actually inspected
    // anything. `.resolves` alone already asserts the promise fulfills
    // (fails immediately if it rejects); any matcher after it is enough to
    // complete the assertion, so `.toBeDefined()` is used here instead.
    await expect(proxy(await requestTo("/", "not-a-real-sealed-cookie-value"))).resolves.toBeDefined();
    const response = await proxy(await requestTo("/", "not-a-real-sealed-cookie-value"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("treats a truncated (corrupted) real session cookie as unauthenticated, not an error", async () => {
    const real = await validSessionCookie("some-user-id");
    const corrupted = real.slice(0, Math.floor(real.length / 2));

    await expect(proxy(await requestTo("/weekly", corrupted))).resolves.toBeDefined();
    const response = await proxy(await requestTo("/weekly", corrupted));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("allows a request with a genuinely valid session cookie through to a protected route", async () => {
    const cookie = await validSessionCookie("some-user-id");
    const response = await proxy(await requestTo("/", cookie));
    expect(response.headers.get("location")).toBeNull();
  });

  it("redirects an authenticated request away from /login to /", async () => {
    const cookie = await validSessionCookie("some-user-id");
    const response = await proxy(await requestTo("/login", cookie));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });
});
