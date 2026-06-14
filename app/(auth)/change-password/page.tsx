import { KeyRound, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";

import { changePasswordAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

const errorMessages: Record<string, string> = {
  "invalid-input": "Please fill in all fields correctly.",
  "passwords-mismatch": "New password and confirmation do not match.",
  "wrong-current-password": "Current password is incorrect.",
  "same-as-current": "New password must be different from the current password.",
  "no-account": "Login account not found. Contact your administrator.",
};

export default async function ChangePasswordPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const context = await requireUser({ skipPasswordChangeCheck: true });

  // Non-forced users don't need this page — send them to the dashboard.
  if (!context.mustResetPassword) {
    redirect("/dashboard");
  }

  const sp = (await searchParams) ?? {};
  const errorMsg = sp.error ? (errorMessages[sp.error] ?? "An error occurred. Please try again.") : null;

  return (
    <div className="w-full max-w-md">
      {/* Header */}
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#ED1C24]/10">
          <KeyRound className="h-7 w-7 text-[#ED1C24]" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-black text-[#111827]">Set a new password</h1>
        <p className="mt-2 text-sm text-[#4B5563]">
          Your account is using a temporary password set by an administrator.
          You must choose a new password before continuing.
        </p>
      </div>

      {/* Error banner */}
      {errorMsg && (
        <div className="mb-5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {errorMsg}
        </div>
      )}

      <form
        action={changePasswordAction}
        className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-sm"
      >
        <div className="border-b border-[#E5E7EB] bg-[#FAFAFA] px-6 py-4">
          <p className="text-xs font-black uppercase tracking-widest text-[#4B5563]">
            Signed in as
          </p>
          <p className="mt-0.5 font-semibold text-[#111827]">{context.email}</p>
        </div>

        <div className="space-y-5 p-6">
          <label className="block">
            <span className="text-sm font-semibold text-[#111827]">
              Current (temporary) password <span className="text-[#ED1C24]">*</span>
            </span>
            <input
              className="focus-ring mt-1.5 w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 font-mono text-sm tracking-wider"
              type="password"
              name="current_password"
              autoComplete="current-password"
              required
              autoFocus
            />
          </label>

          <div className="h-px bg-[#F0F0F0]" />

          <label className="block">
            <span className="text-sm font-semibold text-[#111827]">
              New password <span className="text-[#ED1C24]">*</span>
            </span>
            <input
              className="focus-ring mt-1.5 w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 font-mono text-sm tracking-wider"
              type="password"
              name="new_password"
              autoComplete="new-password"
              minLength={8}
              required
            />
            <p className="mt-1 text-xs text-[#6B7280]">Minimum 8 characters.</p>
          </label>

          <label className="block">
            <span className="text-sm font-semibold text-[#111827]">
              Confirm new password <span className="text-[#ED1C24]">*</span>
            </span>
            <input
              className="focus-ring mt-1.5 w-full rounded-md border border-[#E5E7EB] px-3 py-2.5 font-mono text-sm tracking-wider"
              type="password"
              name="confirm_new_password"
              autoComplete="new-password"
              minLength={8}
              required
            />
          </label>
        </div>

        <div className="border-t border-[#E5E7EB] px-6 py-4">
          <Button type="submit" className="w-full gap-2">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            Set new password and continue
          </Button>
        </div>
      </form>

      <p className="mt-4 text-center text-xs text-[#9CA3AF]">
        You will be redirected to the dashboard after changing your password.
      </p>
    </div>
  );
}
