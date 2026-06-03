import Link from "next/link";

import { forgotPasswordAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

type ForgotPasswordPageProps = {
  searchParams?: Promise<{
    sent?: string;
    error?: string;
  }>;
};

export default async function ForgotPasswordPage({ searchParams }: ForgotPasswordPageProps) {
  const params = await searchParams;

  return (
    <div className="w-full max-w-md rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-[#111827]">Reset password</h1>
      <p className="mt-1 text-sm text-[#4B5563]">Send a password reset link to the user&apos;s email.</p>
      {params?.sent ? <p className="mt-4 rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">Reset email requested.</p> : null}
      {params?.error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Enter a valid email address.</p> : null}
      <form action={forgotPasswordAction} className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-semibold text-[#111827]">Email</span>
          <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" type="email" name="email" required />
        </label>
        <Button type="submit" className="w-full">
          Send reset link
        </Button>
      </form>
      <Link href="/login" className="mt-4 block text-sm font-semibold text-[#ED1C24]">
        Back to login
      </Link>
    </div>
  );
}
