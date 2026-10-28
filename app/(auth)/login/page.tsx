import { Mail, ShieldCheck } from "lucide-react";

import { signInAction } from "@/app/actions/auth";
import { AuthLogo } from "@/components/auth/auth-logo";
import { LoginSubmitButton } from "@/components/auth/login-submit-button";
import { PasswordInput } from "@/components/auth/password-input";

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
    <div className="recafco-brand-enter w-full max-w-[480px] rounded-3xl border border-[#E3E8EF] bg-white px-6 py-8 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.28),0_2px_6px_rgba(15,23,42,0.04)] sm:px-10 sm:py-10 lg:[@media(max-height:820px)]:py-7">
      {/* Neutral badge: white disc, hairline ring, soft outer halo. The
          logo is sized to the circle's inscribed 6:5 box (~0.77 × diameter)
          so its edges never touch the ring. */}
      <div className="mx-auto mt-2 flex size-[160px] items-center justify-center rounded-full bg-white shadow-[0_0_0_1px_#E3E8EF,0_0_0_9px_#F4F7FB,0_0_0_10px_#E9EDF3,0_18px_36px_-18px_rgba(15,23,42,0.35)] sm:size-[184px] lg:[@media(max-height:820px)]:size-[148px]">
        <AuthLogo className="w-[120px] sm:w-[140px] lg:[@media(max-height:820px)]:w-[112px]" priority />
      </div>

      <h1 className="mt-8 lg:[@media(max-height:820px)]:mt-6 text-[28px] font-extrabold leading-tight tracking-[-0.01em] text-[#0B1730] sm:text-[32px]">Welcome back</h1>
      <p className="mt-2 text-[15px] leading-6 text-[#5B6576]">Sign in to access the RECAFCO Maintenance Management System.</p>

      {errorMessage ? (
        <div role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      <form action={signInAction} className="mt-6 space-y-5 lg:[@media(max-height:820px)]:mt-5 lg:[@media(max-height:820px)]:space-y-4">
        <input type="hidden" name="next" value={params?.next ?? "/dashboard"} />
        <div>
          <label htmlFor="login-email" className="text-sm font-semibold text-[#0F172A]">
            Email
          </label>
          <span className="mt-2 flex h-[52px] items-center gap-3 rounded-xl border border-[#D7DDE6] bg-white px-4 transition-[border-color,box-shadow] duration-150 focus-within:border-[#ED1C24] focus-within:shadow-[0_0_0_3px_rgba(237,28,36,0.14)] motion-reduce:transition-none">
            <Mail className="h-5 w-5 shrink-0 text-[#6B7280]" aria-hidden="true" />
            <input
              id="login-email"
              className="h-full min-h-0 w-full border-0 bg-transparent text-[15px] text-[#0F172A] outline-none placeholder:text-[#8A94A6]"
              // Plain text, not type="email": sign-in also accepts the part
              // of the email before "@" (signInAction), which the browser's
              // email check would block. Still an email keyboard on phones.
              type="text"
              inputMode="email"
              name="email"
              required
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Enter your email"
            />
          </span>
        </div>
        <div>
          <label htmlFor="login-password" className="text-sm font-semibold text-[#0F172A]">
            Password
          </label>
          <PasswordInput id="login-password" placeholder="Enter your password" />
          <p className="mt-2 text-xs text-[#8A94A6]">Need password reset? Contact the system administrator.</p>
        </div>
        <div className="pt-1">
          <LoginSubmitButton />
        </div>
      </form>

      <div className="mt-7 flex items-center gap-4">
        <span className="h-px flex-1 bg-[#E5E9F0]" aria-hidden="true" />
        <span className="flex items-center gap-2 text-sm font-semibold text-[#4B5563]">
          <ShieldCheck className="h-5 w-5 text-[#16A34A]" aria-hidden="true" />
          Protected access
        </span>
        <span className="h-px flex-1 bg-[#E5E9F0]" aria-hidden="true" />
      </div>
    </div>
  );
}
