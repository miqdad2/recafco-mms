import { resetPasswordAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

type ResetPasswordPageProps = {
  searchParams?: Promise<{
    error?: string;
  }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const params = await searchParams;

  return (
    <div className="w-full max-w-md rounded-md border border-[#E5E7EB] bg-white p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-[#111827]">Choose a new password</h1>
      <p className="mt-1 text-sm text-[#4B5563]">This page requires a valid password reset session.</p>
      {params?.error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">Password reset failed or password is too weak.</p> : null}
      <form action={resetPasswordAction} className="mt-5 space-y-4">
        <label className="block">
          <span className="text-sm font-semibold text-[#111827]">New password</span>
          <input className="focus-ring mt-1 w-full rounded-md border border-[#E5E7EB] px-3 py-2" type="password" name="password" minLength={8} required />
        </label>
        <Button type="submit" className="w-full">
          Update password
        </Button>
      </form>
    </div>
  );
}
