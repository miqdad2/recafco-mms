import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export function PermissionDenied({ title = "Permission denied", message = "Your role does not have access to this record or action." }: { title?: string; message?: string }) {
  return (
    <main className="flex min-h-[60vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-xl rounded-md border border-[#DDE2EA] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-red-50 text-[#ED1C24]">
          <ShieldAlert className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-black text-[#111827]">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-[#4B5563]">{message}</p>
        <Link href="/dashboard" className="focus-ring mt-6 inline-flex min-h-10 items-center justify-center rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c9151c]">
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
