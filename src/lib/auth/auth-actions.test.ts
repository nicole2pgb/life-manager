import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { loginAction, registerAction } from "@/lib/auth/auth-actions";
import { createUser, getUserByEmail } from "@/lib/auth/users";
import { deleteTestUser } from "@/lib/testing/test-users";

// See specs/user-login.md "Testing Requirements" #3: registration/login
// logic is asserted "at the function level, not by comparing rendered UI
// text". These tests cover every path that returns { error } directly.
//
// The *success* path of both actions (correct credentials) additionally
// calls createSession(), which reads next/headers' cookies() — only usable
// inside a real Next.js request scope, not plain Vitest (confirmed: it
// throws "cookies was called outside a request scope" here). That path is
// covered elsewhere instead: src/proxy.test.ts and
// src/lib/auth/unseal-failure-modes.test.ts exercise session
// sealing/decryption directly, and src/lib/tasks.test.ts's cross-user
// isolation tests exercise an authenticated userId's downstream effects.

function testEmail(): string {
  return `vitest-${randomUUID()}@example.test`;
}

function credentials(email: string, password: string): FormData {
  const formData = new FormData();
  formData.set("email", email);
  formData.set("password", password);
  return formData;
}

describe("registerAction", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await Promise.all(createdUserIds.splice(0).map(deleteTestUser));
  });

  it("rejects an invalid email address", async () => {
    const result = await registerAction(credentials("not-an-email", "Password123"));
    expect(result.error).toBe("Enter a valid email address.");
  });

  it("rejects a password shorter than 8 characters", async () => {
    const result = await registerAction(credentials(testEmail(), "short1"));
    expect(result.error).toBe("Password must be at least 8 characters.");
  });

  it("rejects a duplicate email, case-insensitively, without creating a second account", async () => {
    const email = testEmail();
    const existing = await createUser({ email, password: "Password123" });
    expect(existing).not.toBeNull();
    createdUserIds.push(existing!.id);

    const result = await registerAction(credentials(email.toUpperCase(), "DifferentPass1"));
    expect(result.error).toBe("That email is already in use.");

    const found = await getUserByEmail(email);
    expect(found?.id).toBe(existing!.id);
  });
});

describe("loginAction", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await Promise.all(createdUserIds.splice(0).map(deleteTestUser));
  });

  it("rejects an incorrect password with the generic message", async () => {
    const email = testEmail();
    const user = await createUser({ email, password: "Password123" });
    expect(user).not.toBeNull();
    createdUserIds.push(user!.id);

    const result = await loginAction(credentials(email, "WrongPassword1"));
    expect(result.error).toBe("Invalid email or password.");
  });

  it("rejects a non-existent email with the exact same generic message as a wrong password", async () => {
    const result = await loginAction(credentials(testEmail(), "SomePassword1"));
    expect(result.error).toBe("Invalid email or password.");
  });

  it("rejects a request missing email or password without querying the database", async () => {
    const result = await loginAction(credentials("", ""));
    expect(result.error).toBe("Invalid email or password.");
  });
});
