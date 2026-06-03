import Link from "next/link";
import { ArrowLeft, FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F5F6F8] px-4 py-12">
      <div className="w-full max-w-xl rounded-md border border-[#DDE2EA] bg-white p-6 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-gray-100 text-[#2B2B2B]">
          <FileQuestion className="h-7 w-7" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-black text-[#111827]">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-[#4B5563]">
          The page may have moved, or your role may not have access to that route.
        </p>
        <Link
          href="/dashboard"
          className="focus-ring mt-6 inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-semibold text-white hover:bg-[#c9151c]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to dashboard
        </Link>
      </div>
    </main>
  );
}
