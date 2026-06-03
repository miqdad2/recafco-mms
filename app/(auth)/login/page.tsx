import Link from "next/link";
import { LockKeyhole, Mail, ShieldCheck } from "lucide-react";

import { signInAction } from "@/app/actions/auth";
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
  "invalid-credentials": "Supabase Auth rejected this email or password. Check the Auth user, password, and email confirmation status.",
  "missing-profile": "This Auth user does not have an active application profile. Create a matching row in public.profiles using the Auth user UUID.",
  "inactive-profile": "This application profile is inactive. Set public.profiles.is_active to true for this user.",
  session: "A login session could not be created. Check the Supabase URL and anon key configured in Vercel."
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const errorMessage = params?.error ? errorMessages[params.error] ?? "Sign in failed. Check your Supabase Auth user and active app profile." : null;

  return (
    <div className="w-full max-w-[440px] rounded-md border border-[#D9DDE3] bg-white p-6 shadow-md shadow-black/5">
      <div className="recafco-brand-enter recafco-brand-scan relative mb-6 overflow-hidden rounded-md bg-[#111827] px-5 py-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandLogo variant="dark" size="lg" showText={false} />
          <div>
            <p className="text-lg font-black tracking-wide text-white">RECAFCO</p>
            <p className="text-xs font-semibold uppercase tracking-wide text-red-100">Enterprise Maintenance Management</p>
          </div>
        </div>
      </div>
      <div className="mb-6 flex items-start gap-3">
        <div className="rounded-md bg-red-50 p-3 text-[#ED1C24]">
          <LockKeyhole className="h-6 w-6" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-[#111827]">Sign in</h1>
          <p className="mt-1 text-sm leading-5 text-[#4B5563]">Use your RECAFCO account to continue.</p>
        </div>
      </div>
      {errorMessage ? (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}
      <form action={signInAction} className="space-y-4">
        <input type="hidden" name="next" value={params?.next ?? "/dashboard"} />
        <label className="block">
          <span className="text-sm font-semibold text-[#111827]">Email</span>
          <span className="mt-1 flex min-h-11 items-center gap-2 rounded-md border border-[#D9DDE3] bg-white px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#ED1C24]">
            <Mail className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden="true" />
            <input className="min-h-10 w-full border-0 bg-transparent text-sm outline-none" type="email" name="email" required autoComplete="email" />
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#111827]">Password</span>
          <span className="mt-1 flex min-h-11 items-center gap-2 rounded-md border border-[#D9DDE3] bg-white px-3 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#ED1C24]">
            <LockKeyhole className="h-4 w-4 shrink-0 text-[#6B7280]" aria-hidden="true" />
            <input className="min-h-10 w-full border-0 bg-transparent text-sm outline-none" type="password" name="password" required autoComplete="current-password" />
          </span>
        </label>
        <SubmitButton className="min-h-11 w-full" idleLabel="Sign in" pendingLabel="Signing in" />
      </form>
      <div className="mt-5 flex items-center justify-between gap-3 border-t border-[#E5E7EB] pt-4">
        <Link className="text-sm font-semibold text-[#ED1C24] hover:text-[#c9151c]" href="/forgot-password">
          Forgot password
        </Link>
        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#4B5563]">
          <ShieldCheck className="h-4 w-4 text-[#16A34A]" aria-hidden="true" />
          Protected access
        </div>
      </div>
    </div>
  );
}
