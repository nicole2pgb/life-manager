import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createUser, getAuthByEmail, getUserByEmail } from "@/lib/auth/users";
import { deleteTestUser } from "@/lib/testing/test-users";

function testEmail(): string {
  return `vitest-${randomUUID()}@example.test`;
}

describe("user registration", () => {
  const createdUserIds: string[] = [];

  afterEach(async () => {
    await Promise.all(createdUserIds.splice(0).map(deleteTestUser));
  });

  it("creates a user and returns it without the password hash", async () => {
    const email = testEmail();
    const user = await createUser({ email, password: "Password123" });

    expect(user).not.toBeNull();
    createdUserIds.push(user!.id);
    expect(user!.email).toBe(email);
    expect(user).not.toHaveProperty("passwordHash");
  });

  it("normalizes email case and surrounding whitespace before storing and looking up", async () => {
    const email = testEmail();
    const user = await createUser({ email: `  ${email.toUpperCase()}  `, password: "Password123" });

    expect(user).not.toBeNull();
    createdUserIds.push(user!.id);

    const found = await getUserByEmail(email);
    expect(found?.id).toBe(user!.id);
  });

  it("rejects a duplicate email, case-insensitively", async () => {
    const email = testEmail();
    const first = await createUser({ email, password: "Password123" });
    expect(first).not.toBeNull();
    createdUserIds.push(first!.id);

    const second = await createUser({ email: email.toUpperCase(), password: "DifferentPass1" });
    expect(second).toBeNull();
  });

  it("stores a bcrypt hash, never the plaintext password", async () => {
    const email = testEmail();
    const password = "Password123";
    const user = await createUser({ email, password });
    expect(user).not.toBeNull();
    createdUserIds.push(user!.id);

    const auth = await getAuthByEmail(email);
    expect(auth).not.toBeNull();
    expect(auth!.passwordHash).not.toBe(password);
    // bcrypt hashes always start with one of these version prefixes.
    expect(auth!.passwordHash.startsWith("$2")).toBe(true);
  });
});
