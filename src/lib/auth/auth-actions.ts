"use server";

import { redirect } from "next/navigation";
import { createUser, getAuthByEmail } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, destroySession } from "@/lib/auth/session";

export type AuthActionResult = { error: string | null };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 8;
// Matches users.email's VARCHAR(255) column (specs/user-login.md's Data
// Model). Rejecting an over-length email here, before it ever reaches
// createUser(), avoids either silent truncation or an unhandled
// ER_DATA_TOO_LONG propagating out of a Server Action as an unstyled error
// page — the same reasoning as validating password length here rather than
// letting the database be the first thing to object.
const EMAIL_MAX_LENGTH = 255;

// A precomputed hash of an arbitrary, non-secret placeholder string — not
// tied to any real account. Used only so a login attempt for a
// non-existent email still runs a bcrypt compare of comparable cost to a
// real one, per specs/user-login.md's anti-enumeration requirement: without
// this, a nonexistent-email request would return noticeably faster than a
// wrong-password request (no hash to compare against), which a timing
// attack could use to enumerate registered emails even though both cases
// already return the same error message and status.
const TIMING_SAFE_DUMMY_HASH = "$2b$12$GC/ZNL9x1tTwvJBWQH5SPOub/1fvv1Wz1SVglVy8uJgqsfsxqT.Di";

function parseCredentials(formData: FormData): { email: string; password: string } | { error: string } {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !EMAIL_REGEX.test(email) || email.length > EMAIL_MAX_LENGTH) {
    return { error: "Enter a valid email address." };
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { error: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }

  return { email, password };
}

export async function registerAction(formData: FormData): Promise<AuthActionResult> {
  const parsed = parseCredentials(formData);
  if ("error" in parsed) return { error: parsed.error };

  const user = await createUser(parsed);
  if (!user) {
    return { error: "That email is already in use." };
  }

  await createSession(user.id);
  redirect("/");
}

export async function loginAction(formData: FormData): Promise<AuthActionResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  // Same generic message and code path whether the email doesn't exist or
  // the password is wrong — requirements.md's explicit anti-enumeration
  // requirement. Always run the compare (against the dummy hash if there's
  // no real account) rather than short-circuiting, for the timing reason
  // documented above.
  const GENERIC_ERROR = "Invalid email or password.";

  if (!email || !password) {
    return { error: GENERIC_ERROR };
  }

  const auth = await getAuthByEmail(email);
  const isValid = await verifyPassword(password, auth?.passwordHash ?? TIMING_SAFE_DUMMY_HASH);

  if (!auth || !isValid) {
    return { error: GENERIC_ERROR };
  }

  await createSession(auth.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
