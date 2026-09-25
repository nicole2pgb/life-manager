import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing", () => {
  it("verifies a correct password against its own hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("correct horse battery staple", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    await expect(verifyPassword("wrong password", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time, even for the same password (salted)", async () => {
    const [hashA, hashB] = await Promise.all([hashPassword("same password"), hashPassword("same password")]);
    expect(hashA).not.toBe(hashB);
  });

  it("never stores the plaintext password inside the resulting hash", async () => {
    const plaintext = "super-secret-value";
    const hash = await hashPassword(plaintext);
    expect(hash).not.toContain(plaintext);
  });
});
