import Link from "next/link";
import { registerAction } from "@/lib/auth/auth-actions";
import { AuthForm } from "@/components/auth/auth-form";

export default function RegisterPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Create an account</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Password must be at least 8 characters.
        </p>
      </div>
      <AuthForm
        action={registerAction}
        submitLabel="Register"
        pendingLabel="Creating account…"
        passwordAutoComplete="new-password"
      />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
          Log in
        </Link>
      </p>
    </div>
  );
}
