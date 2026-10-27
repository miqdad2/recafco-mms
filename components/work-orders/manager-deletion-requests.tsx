"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, Archive, ChevronDown, ChevronUp, Trash2 } from "lucide-react";

import { DeletionReviewForm } from "@/components/work-orders/deletion-request-panel";
import { formatKuwaitDateTime } from "@/lib/format/kuwait-time";

// Final Integration Review — Manager-only block on the existing Job Cards
// page (no new module): pending Job Card deletion requests with the same
// Approve / Reject flow as the Job Card page, plus a link to the read-only
// Deleted Job Cards history. Rendered only for deletion reviewers; the
// server actions enforce the role again.

export type PendingDeletionRow = {
  requestId: string;
  workOrderId: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  reason: string;
  requestedByName: string;
  requestedAt: string;
  requestedByMe: boolean;
  blockedReasons: string[];
};

function PendingRow({ row }: { row: PendingDeletionRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <Link href={`/maintenance/work-orders/${row.workOrderId}`} className="text-sm font-bold text-[#111827] hover:text-[#ED1C24] hover:underline">
            {row.workOrderNumber ?? "Job Card"}
          </Link>
          {row.assetLabel ? <span className="ml-2 text-[13px] text-[#4B5563]">{row.assetLabel}</span> : null}
          <p className="mt-1 text-[13px] text-[#374151]">
            <span className="font-semibold">Reason:</span> {row.reason}
          </p>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            Requested by {row.requestedByName} · {formatKuwaitDateTime(row.requestedAt)}
          </p>
          {row.blockedReasons.length > 0 ? (
            <p className="mt-1 flex items-start gap-1 text-xs font-semibold text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Cannot be deleted now: {row.blockedReasons.join(" ")}
            </p>
          ) : null}
        </div>
        {row.requestedByMe ? (
          <p className="shrink-0 text-xs font-semibold text-[#6B7280]">Your request — another reviewer must decide</p>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-md border border-[#D1D5DB] bg-white px-3 text-sm font-bold text-[#111827] transition-colors hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
          >
            Review {open ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}
      </div>
      {open && !row.requestedByMe ? <DeletionReviewForm requestId={row.requestId} blocked={row.blockedReasons.length > 0} /> : null}
    </li>
  );
}

export function ManagerDeletionRequests({ pending, deletedHref, showingDeleted }: { pending: PendingDeletionRow[]; deletedHref: string; showingDeleted: boolean }) {
  return (
    <section aria-labelledby="pending-deletions-heading" className="rounded-md border border-[#E5E7EB] bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF2F6] px-4 py-2.5">
        <h2 id="pending-deletions-heading" className="flex items-center gap-2 text-sm font-black text-[#111827]">
          <Trash2 className="h-4 w-4 text-[#ED1C24]" aria-hidden="true" />
          Pending Deletion Requests
          <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${pending.length ? "bg-red-50 text-[#B91C1C]" : "bg-[#F3F4F6] text-[#6B7280]"}`}>{pending.length}</span>
        </h2>
        <Link
          href={deletedHref}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-[13px] font-bold text-[#374151] transition-colors hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#ED1C24]"
        >
          <Archive className="h-4 w-4" aria-hidden="true" />
          {showingDeleted ? "Hide Deleted Job Cards" : "Deleted Job Cards (history)"}
        </Link>
      </div>
      {pending.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[#6B7280]">No deletion requests are waiting.</p>
      ) : (
        <ul className="divide-y divide-[#EEF2F6]">
          {pending.map((row) => (
            <PendingRow key={row.requestId} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}
