"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Printer } from "lucide-react";

// Job Card Print Screen + A4 Output Refinement Unit 10G.57, Task 1/2/11.
//
// Screen-only navigation for the Job Card print page — Back / Open Job Card
// / Print — rendered above the A4 preview. Marked "no-print" (this file's
// only styling contract with the print page) so it never appears in the
// actual printed output; the print page itself already hides the app
// sidebar/header via its own @media print rule.

const btnClass =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-sm font-bold text-[#111827] transition hover:bg-gray-50";

export function PrintScreenActions({ detailHref }: { detailHref: string }) {
  const router = useRouter();

  // Task 11 — go back through browser history when there is somewhere to go
  // back to; otherwise land on the Job Card detail page rather than a dead
  // end (e.g. this print page was opened directly in a new tab).
  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(detailHref);
    }
  }

  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <button type="button" onClick={handleBack} className={btnClass}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back
      </button>
      <Link href={detailHref} className={btnClass}>
        <FileText className="h-4 w-4" aria-hidden="true" /> Open Job Card
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-red-700"
      >
        <Printer className="h-4 w-4" aria-hidden="true" /> Print
      </button>
    </div>
  );
}
