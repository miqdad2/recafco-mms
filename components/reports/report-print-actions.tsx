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

export function ReportPrintActions() {
  return (
    <div className="no-print mb-4 flex flex-wrap items-center gap-2">
      <Link href="/reports" className={btnClass}>
        <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to Reports
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
