import { LockKeyhole, Mail, ShieldCheck } from "lucide-react";

import { signInAction } from "@/app/actions/auth";
import { PasswordInput } from "@/components/auth/password-input";
import { BrandLogo } from "@/components/layout/brand-logo";
import { SubmitButton } from "@/components/ui/submit-button";

type LoginPageProps = {
  searchParams?: Promise<{
    error?: string;
    next?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  "invalid-input": "Enter a valid email address and password.",
  "invalid-credentials": "The email or password is incorrect.",
  "inactive-profile": "This application profile is inactive. Contact the system administrator.",
  locked: "This account is temporarily locked. Contact the system administrator.",
  "reset-admin-managed": "Password reset is managed by the system administrator in this local deployment.",
  session: "A login session could not be created. Check the local database configuration."
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorMessage = params?.error ? errorMessages[params.error] ?? "Sign in failed. Check your local account and active app profile." : null;

  return (
    <div className="w-full max-w-[480px] rounded-xl border border-[#D9DDE3] bg-white p-6 shadow-lg shadow-black/5 sm:p-8">
      {/* Left Header Logo Polish Unit 10G.46, Task 2: now that the hero
          panel has its own large logo again (the official page brand mark),
          this card logo steps down from "xl" to "lg" so the two don't read
          as duplicated/equal-weight branding — this card keeps a smaller
          confirming logo, not a second full-size one. Header padding
          trimmed to match (py-6/py-7 -> py-5/py-6), same proportions used
          the last time this card carried an "lg" logo. */}
      <div className="recafco-brand-enter recafco-brand-scan relative mb-6 overflow-hidden rounded-lg bg-[#111827] px-6 py-5 sm:py-6">
        <div className="flex items-center justify-center">
          <BrandLogo variant="dark" size="lg" showText={false} />
        </div>
      </div>
      <div className="mb-5 flex items-start gap-3 sm:mb-6">
        <div className="rounded-md bg-red-50 p-2.5 text-[#ED1C24]">
          <LockKeyhole className="h-5 w-5" aria-hidden="true" />
        </div>
        <div>
          {/* Final Polish Unit 10G.45, Task 3 (Option B — the preferred,
              cleaner option): "Welcome back" removed again — for an
              internal system, "Sign in" alone reads calmer than a
              lead-in line above it. */}
          <h1 className="text-2xl font-bold text-[#111827]">Sign in</h1>
          <p className="mt-1 text-sm leading-5 text-[#4B5563]">Use your RECAFCO account to continue.</p>
          <p className="mt-1 text-xs font-medium text-[#64748B]">Access is managed by the system administrator.</p>
        </div>
      </div>
      {errorMessage ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <form action={signInAction} className="space-y-5">
        <input type="hidden" name="next" value={params?.next ?? "/dashboard"} />
        <label className="block">
          <span className="text-sm font-semibold text-[#111827]">Email</span>
          <span className="mt-1 flex min-h-12 items-center gap-2 rounded-md border border-[#D9DDE3] bg-white px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#ED1C24]">
            <Mail className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden="true" />
            <input className="min-h-11 w-full border-0 bg-transparent text-sm outline-none" type="email" name="email" required autoComplete="email" />
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#111827]">Password</span>
          <PasswordInput />
          <span className="mt-1.5 block text-xs text-[#9CA3AF]">Need password reset? Contact the system administrator.</span>
        </label>
        <SubmitButton className="min-h-12 w-full" idleLabel="Sign in" pendingLabel="Signing in" />
      </form>
      <div className="mt-5 flex items-center justify-center gap-3 border-t border-[#E5E7EB] pt-4">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#4B5563]">
          <ShieldCheck className="h-4 w-4 text-[#16A34A]" aria-hidden="true" />
          Protected access
        </div>
      </div>
    </div>
  );
}
