import { describe, expect, it, vi } from "vitest";
import { sealData, unsealData } from "iron-session";

// Documents the exact behavior src/proxy.ts's readUserId() and
// src/lib/auth/session.ts's getSession() are both built to defend against
// (confirmed Copilot findings 2/3/4 on PR #6): iron-session's own
// unsealData() only swallows *some* decode failures internally — verified
// directly against node_modules/iron-webcrypto/dist/index.js's unseal():
// "Incorrect number of sealed components", "Expired seal", "Bad hmac
// value", and "Cannot find password" are caught and resolved to `{}`, but
// "Wrong mac prefix" and "Invalid expiration" are not, and propagate as a
// real throw. Both of this project's call sites wrap
// unsealData()/getIronSession() in their own try/catch specifically
// because that gap exists — this test locks in the assumption so a future
// iron-session upgrade that changes it would be caught here, not
// discovered as a live 500.
describe("iron-session unsealData failure modes", () => {
  const password = "a".repeat(32);

  // A real seal looks like `Fe26.2*<id>*<salt>*<iv>*<data>*<expiration>*<hmacSalt>*<hmac>~<version>`
  // (8 `*`-separated parts, then a `~`-separated version suffix). Splits it
  // apart, replaces one field, and reassembles — the only way to reach the
  // specific uncaught failure modes below without also changing the
  // component count (which routes into the *caught* "Incorrect number of
  // sealed components" case instead).
  function corruptSealField(sealed: string, fieldIndex: number, newValue: string): string {
    const [rawSeal, version] = sealed.split("~");
    const parts = rawSeal.split("*");
    parts[fieldIndex] = newValue;
    return `${parts.join("*")}~${version}`;
  }

  it("an unstructured garbage string is swallowed internally and resolves to an empty object", async () => {
    // Wrong component count ("Incorrect number of sealed components") is
    // one of iron-session's own caught cases.
    await expect(unsealData("not-a-real-sealed-value", { password })).resolves.toEqual({});
  });

  it("a truncated (mid-field) real seal is swallowed internally and resolves to an empty object", async () => {
    const seal = await sealData({ userId: "abc" }, { password });
    const truncated = seal.slice(0, Math.floor(seal.length / 2));
    // Truncation almost always changes the `*`-separated component count
    // too, landing in the same caught case as the fully-garbage string.
    await expect(unsealData(truncated, { password })).resolves.toEqual({});
  });

  it("an expired seal is swallowed internally and resolves to an empty object", async () => {
    // iron-webcrypto adds a fixed 60s clock-skew allowance on top of ttl
    // (node_modules/iron-webcrypto/dist/index.js: `timestampSkewSec = 60`),
    // so a 1s ttl only actually expires after ~61s — fake timers jump the
    // clock forward instantly instead of making this test really wait.
    vi.useFakeTimers();
    try {
      const seal = await sealData({ userId: "abc" }, { password, ttl: 1 });
      vi.advanceTimersByTime(61_000);
      await expect(unsealData(seal, { password, ttl: 1 })).resolves.toEqual({});
    } finally {
      vi.useRealTimers();
    }
  });

  it("a seal sealed under a different password is swallowed internally and resolves to an empty object", async () => {
    // Same passwordId, mismatched key material -> fails the HMAC check
    // ("Bad hmac value"), which is also one of the caught cases.
    const seal = await sealData({ userId: "abc" }, { password });
    await expect(unsealData(seal, { password: "b".repeat(32) })).resolves.toEqual({});
  });

  it("a corrupted mac prefix (right shape, wrong content) is NOT caught and throws", async () => {
    const seal = await sealData({ userId: "abc" }, { password });
    const corrupted = corruptSealField(seal, 0, "Fe99.9");
    await expect(unsealData(corrupted, { password })).rejects.toThrow(/wrong mac prefix/i);
  });

  it("a corrupted expiration field (right shape, non-numeric content) is NOT caught and throws", async () => {
    const seal = await sealData({ userId: "abc" }, { password });
    const corrupted = corruptSealField(seal, 5, "not-a-number");
    await expect(unsealData(corrupted, { password })).rejects.toThrow(/invalid expiration/i);
  });
});
