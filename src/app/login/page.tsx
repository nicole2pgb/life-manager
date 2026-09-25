import Link from "next/link";
import { loginAction } from "@/lib/auth/auth-actions";
import { AuthForm } from "@/components/auth/auth-form";

export default function LoginPage() {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-12 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">Log in</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Welcome back to Life Manager.</p>
      </div>
      <AuthForm
        action={loginAction}
        submitLabel="Log in"
        pendingLabel="Logging in…"
        passwordAutoComplete="current-password"
      />
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Don&apos;t have an account?{" "}
        <Link href="/register" className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
          Register
        </Link>
      </p>
    </div>
  );
}
