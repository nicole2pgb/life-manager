import bcrypt from "bcryptjs";

// See specs/user-login.md Security Requirements — bcryptjs only, never a
// hand-rolled comparison. Cost factor 12: high enough to be a meaningful
// slowdown against brute force, low enough not to noticeably delay a single
// interactive login on ordinary hardware.
const COST_FACTOR = 12;

export async function hashPassword(plainTextPassword: string): Promise<string> {
  return bcrypt.hash(plainTextPassword, COST_FACTOR);
}

// Always use this instead of comparing hashes directly — bcrypt.compare is
// the library's constant-time comparison, per Security Requirements.
export async function verifyPassword(plainTextPassword: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainTextPassword, hash);
}
