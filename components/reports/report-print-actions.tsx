"use client";

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

// Printable Division-Based Reports Foundation Unit 10G.69, Task 3.
//
// Screen-only "Back to Reports" / "Print Report" bar, shared by every
// printable report page this unit adds — same shape as the single Job Card
// print page's own PrintScreenActions (components/work-orders/print-screen-
// actions.tsx), generalized: no "Open <record>" link (a report has no
// single underlying record to jump back to), and "Back" always goes to the
// Reports landing page rather than browser history, since these report
// print pages are meant to be reached directly from /reports.

const btnClass =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-sm font-bold text-[#111827] transition hover:bg-gray-50";

// `backHref` / `backLabel` are for a print view that has its own screen
// report page to return to (Site Location Assets); the default is unchanged.
export function ReportPrintActions({
  backHref = "/reports",
  backLabel = "Back to Reports",
}: {
  backHref?: string;
  backLabel?: string;
} = {}) {
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <Link href={backHref} className={btnClass}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> {backLabel}
      </Link>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-3.5 py-1.5 text-sm font-bold text-white transition hover:bg-red-700"
      >
        <Printer className="h-4 w-4" aria-hidden="true" /> Print Report
      </button>
    </div>
  );
}
