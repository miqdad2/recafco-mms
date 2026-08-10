"use client";

import { useState } from "react";
import Link from "next/link";
import { Clock3 } from "lucide-react";

import { LargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";

// Data Entry Dashboard Closure and Closed Jobs Clarity Unit 10G.9, Task 2/6/8/9.
//
// A DELIBERATELY read-only list — Job Cards with status "Closure Requested"
// that Data Entry itself requested, now waiting on the Manager's decision.
// This is a NEW, separate component from components/dashboard/closure-
// requests-modal.tsx (Manager's own "Review Closure" entry point, which
// leads into ClosureReviewModal's Approve Closure action) rather than a
// reuse-with-a-flag of that component — Task 8's "role-safe variant"
// principle applied literally: the safest way to guarantee Data Entry can
// never reach an Approve action from here is for this component to contain
// no code path that leads to one at all, not to hide a button behind a role
// check inside the Manager's own approval-flow component. Every row here is
// plain text plus "Open Full Job Card" — nothing else.
//
// Data comes from page.tsx as server-computed props (Pattern A, same
// convention as the Manager dashboard's own mgClosureRequestsForModal) —
// no client fetch-on-open, since this list is already computed as part of
// the same Data Entry data batch every dashboard load already does.

export type WaitingApprovalRow = {
  id: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string;
  requestedAtLabel: string;
  requestedByName: string | null;
  materialsLabel: string;
  totalHours: number;
  detailHref: string;
};

function materialsTone(label: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (label === "Fully Issued") return "green";
  if (label === "Partially Issued") return "amber";
  if (label === "Not Issued") return "red";
  if (label === "Ready to Issue") return "blue";
  return "gray";
}

function WaitingApprovalRowView({ row }: { row: WaitingApprovalRow }) {
  return (
    <div className="border-b border-[#EEF2F6] py-3 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-[#111827]">
            {row.workOrderNumber ?? "Job Card"}
            {row.assetLabel ? <span className="font-normal text-[#6B7280]"> — {row.assetLabel}</span> : null}
          </p>
          <p className="mt-0.5 truncate text-xs text-[#374151]">{row.issue}</p>
          <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
            Requested {row.requestedAtLabel}{row.requestedByName ? ` by ${row.requestedByName}` : ""}
          </p>
        </div>
        <StatusBadge label={row.materialsLabel} tone={materialsTone(row.materialsLabel)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-[#6B7280]">Worker hours: <strong className="text-[#111827]">{row.totalHours}h</strong></span>
        <Link
          href={row.detailHref}
          className="inline-flex min-h-8 items-center rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] transition hover:border-[#2563EB] hover:text-[#2563EB]"
        >
          Open Full Job Card
        </Link>
      </div>
    </div>
  );
}

function WaitingManagerApprovalModal({ jobCards, totalCount, onClose }: { jobCards: WaitingApprovalRow[]; totalCount: number; onClose: () => void }) {
  return (
    <LargeFormModal title="Waiting Manager Approval" subtitle="Job Cards you've requested closure for — waiting on the Manager's decision." onClose={onClose}>
      <p className="mb-3 text-sm font-semibold text-[#111827]">Waiting on Manager: {totalCount}</p>
      {jobCards.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-10 text-center">
          <p className="text-sm font-semibold text-[#111827]">Nothing waiting on Manager approval.</p>
          <p className="text-xs text-[#6B7280]">Job Cards you request closure for will appear here until the Manager decides.</p>
        </div>
      ) : (
        <>
          <div>
            {jobCards.map((row) => (
              <WaitingApprovalRowView key={row.id} row={row} />
            ))}
          </div>
          {totalCount > jobCards.length ? (
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">Showing the oldest {jobCards.length} of {totalCount}.</p>
          ) : null}
        </>
      )}
      <div className="mt-4 flex justify-end border-t border-[#EEF2F6] pt-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
        >
          Close
        </button>
      </div>
    </LargeFormModal>
  );
}

export function WaitingManagerApprovalCard({ count, jobCards }: { count: number; jobCards: WaitingApprovalRow[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2.5 rounded-md border border-[#E5E7EB] bg-white px-3 py-2.5 text-left transition hover:border-[#2563EB] hover:shadow-sm"
      >
        <span className="inline-flex shrink-0 rounded-md bg-amber-500 p-2 text-white">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[10px] font-black uppercase leading-tight text-[#6B7280]">Waiting Manager Approval</span>
          <span className="block text-lg font-black leading-tight text-[#111827]">{count}</span>
        </span>
      </button>
      {open ? <WaitingManagerApprovalModal jobCards={jobCards} totalCount={count} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
