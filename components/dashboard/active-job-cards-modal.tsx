"use client";

import Link from "next/link";

import { LargeFormModal, useLargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";

// Manager Dashboard KPI Click Behavior Clarification Unit 10E.4, Task 1/2.
//
// Reuses the LargeFormModal shell exactly like VehicleExpiryModal (Unit
// 10B.1) and the Closed Job Cards modal (Unit 10E) — a server component
// (the Manager dashboard) passes `closeHref` so this navigates back to the
// plain dashboard URL on close, same ?vehicleExpiry=1-style overlay
// convention every other dashboard modal already uses. Data is passed in
// fully pre-computed — this component does no fetching of its own; the
// dashboard already builds this exact row list (Task 1/2) from data it
// computes unconditionally for the KPI count/attention board/labor
// snapshot, so opening this modal costs no new query.

export type ActiveJobCardRow = {
  id: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string;
  workersLabel: string;
  materialsLabel: string;
  workStatus: string;
  detailHref: string;
};

function materialsTone(label: string): "green" | "amber" | "red" | "blue" | "gray" {
  if (label === "Materials Completed") return "green";
  if (label === "Ready to Issue") return "blue";
  if (label === "Partially Available") return "amber";
  if (label === "Materials Pending") return "red";
  return "gray";
}

function JobCardRow({ row }: { row: ActiveJobCardRow }) {
  return (
    <div className="flex flex-col gap-2 border-b border-[#EEF2F6] py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-[#111827]">
          {row.workOrderNumber ?? "Job Card"}
          {row.assetLabel ? <span className="font-normal text-[#6B7280]"> — {row.assetLabel}</span> : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-[#6B7280]">{row.issue}</p>
        <p className="mt-0.5 text-[11px] text-[#9CA3AF]">
          {row.workersLabel} · {row.workStatus}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <StatusBadge label={row.materialsLabel} tone={materialsTone(row.materialsLabel)} />
        <Link
          href={row.detailHref}
          className="inline-flex min-h-9 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-3 text-xs font-bold text-[#111827] transition hover:border-[#ED1C24] hover:text-[#ED1C24]"
        >
          Open Job Card
        </Link>
      </div>
    </div>
  );
}

// Footer buttons ("Open Daily Activity" / "Close", Task 2) — same pattern
// VehicleExpiryModal's own footer uses.
function ModalFooter() {
  const modal = useLargeFormModal();
  return (
    <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[#EEF2F6] pt-4 sm:flex-row sm:justify-end">
      <button
        type="button"
        onClick={() => modal?.requestClose()}
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
      >
        Close
      </button>
      <Link
        href="/maintenance/daily-activity"
        className="inline-flex min-h-10 items-center justify-center rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white transition hover:bg-[#c8181e]"
      >
        Open Daily Activity
      </Link>
    </div>
  );
}

export function ActiveJobCardsModal({
  jobCards,
  totalActiveCount,
  closeHref,
}: {
  jobCards: ActiveJobCardRow[];
  totalActiveCount: number;
  closeHref: string;
}) {
  return (
    <LargeFormModal title="Active Job Cards" subtitle="Job Cards currently open — workers, materials, and work status." closeHref={closeHref}>
      {jobCards.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-10 text-center">
          <p className="text-sm font-semibold text-[#111827]">No active Job Cards right now.</p>
        </div>
      ) : (
        <>
          <div>
            {jobCards.map((row) => (
              <JobCardRow key={row.id} row={row} />
            ))}
          </div>
          {totalActiveCount > jobCards.length ? (
            <p className="mt-3 text-center text-xs text-[#9CA3AF]">
              Showing the latest {jobCards.length} of {totalActiveCount} active Job Cards. Open Daily Activity to see the rest.
            </p>
          ) : null}
        </>
      )}
      <ModalFooter />
    </LargeFormModal>
  );
}
