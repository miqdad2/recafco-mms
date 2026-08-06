"use client";

import { useState } from "react";
import Link from "next/link";

import { StatusBadge } from "@/components/ui/status-badge";
import { WorkerActivityDetailModal } from "@/components/workers/worker-activity-detail-modal";
import { displaySimplifiedStatus, simplifiedStatusTone } from "@/lib/work-orders/simplified-status-display";
import type { WorkerActivityStatus, WorkerCurrentJobCard } from "@/lib/work-orders/work-session-totals";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";

// Worker Activity Manager Hours and Payment Detail Unit 10C.
//
// Extracted out of the (Server Component) assignments/page.tsx — a "View
// Details" button needs local client state to open
// WorkerActivityDetailModal, which a plain server-rendered component can't
// hold. Every field/link this card already showed (Unit 9F) is unchanged;
// the only additions are the "View Details" button and the modal it opens.

export type CombinedWorker = WorkerProfileRow & {
  status: WorkerActivityStatus | "Inactive";
  current_job_card: WorkerCurrentJobCard | null;
  today_hours: number;
  month_hours: number;
  month_amount: number;
};

// Task 3/7 — color rules: Working Now green, Paused amber, Assigned blue
// (tied to a Job Card but not started), Available gray/neutral, Inactive a
// muted gray with the whole card visually receded.
function statusTone(status: WorkerActivityStatus | "Inactive"): "green" | "amber" | "blue" | "gray" {
  if (status === "Working Now") return "green";
  if (status === "Paused") return "amber";
  if (status === "Assigned") return "blue";
  return "gray"; // Available / Inactive
}

function statusAccentClass(status: WorkerActivityStatus | "Inactive"): string {
  if (status === "Working Now") return "border-l-[#16A34A]";
  if (status === "Paused") return "border-l-[#F59E0B]";
  if (status === "Assigned") return "border-l-[#2563EB]";
  return "border-l-[#D1D5DB]"; // Available / Inactive
}

function MiniChip({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-bold text-gray-700">
      {label}
    </span>
  );
}

// Task 5/6 — one compact card per worker. Never taller than: identity row,
// one current-Job-Card block (or a one-line "no active Job Card" note), and
// one footer row of hours + actions.
export function WorkerCard({ worker, canViewCosts, canManageWorkerProfiles, isManager }: {
  worker: CombinedWorker;
  canViewCosts: boolean;
  canManageWorkerProfiles: boolean;
  // Task 2/7 — gates "Correct Session" inside the detail modal; Data Entry
  // (which can still open the modal read-only) never sees it.
  isManager: boolean;
}) {
  const [showDetail, setShowDetail] = useState(false);
  const jc = worker.current_job_card;
  const jcDisplayStatus = jc ? displaySimplifiedStatus(jc.status) : null;

  return (
    <>
      <div className={`rounded-md border-l-4 bg-white p-3 shadow-sm ${statusAccentClass(worker.status)} ${!worker.is_active ? "opacity-60" : ""}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="truncate text-sm font-black text-[#111827]">{worker.name}</p>
              <MiniChip label={worker.worker_type} />
              {worker.skill_category ? <MiniChip label={worker.skill_category} /> : null}
            </div>
            {worker.phone ? <p className="mt-0.5 text-xs text-[#6B7280]">{worker.phone}</p> : null}
          </div>
          <StatusBadge label={worker.status} tone={statusTone(worker.status)} />
        </div>

        {/* Task 1 — current Job Card */}
        {jc ? (
          <div className="mt-2 rounded-md bg-[#F8FAFC] px-2.5 py-2">
            <p className="truncate text-xs font-bold text-[#111827]">
              {jc.work_order_number ?? "Job Card"}
              {jc.asset_label ? <span className="ml-1.5 font-normal text-[#6B7280]">· {jc.asset_label}</span> : null}
            </p>
            <p className="mt-0.5 truncate text-xs text-[#4B5563]">{jc.issue}</p>
            {jcDisplayStatus ? (
              <div className="mt-1">
                <StatusBadge label={jcDisplayStatus} tone={simplifiedStatusTone(jcDisplayStatus)} />
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#9CA3AF]">No active Job Card.</p>
        )}

        {/* Footer — hours + actions */}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-[#EEF2F6] pt-2">
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[#6B7280]">
            <span>Today: <strong className="text-[#111827]">{worker.today_hours} h</strong></span>
            <span>This month: <strong className="text-[#111827]">{worker.month_hours} h</strong></span>
            {canViewCosts ? <span>Cost (month): <strong className="text-[#111827]">{worker.month_amount.toFixed(3)} KWD</strong></span> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {/* Task 2 — View Details: available to both Manager and Data
                Entry (read-only for Data Entry — the modal itself never
                shows "Correct Session" unless isManager). */}
            <button
              type="button"
              onClick={() => setShowDetail(true)}
              className="inline-flex min-h-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-bold text-[#111827] transition hover:bg-gray-50"
            >
              View Details
            </button>
            {jc ? (
              <Link
                href={`/maintenance/work-orders/${jc.work_order_id}`}
                className="inline-flex min-h-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-bold text-[#111827] transition hover:bg-gray-50"
              >
                Open Job Card
              </Link>
            ) : null}
            <Link
              href="/maintenance/daily-activity"
              className="inline-flex min-h-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-bold text-[#111827] transition hover:bg-gray-50"
            >
              Open Daily Activity
            </Link>
            {canManageWorkerProfiles ? (
              <Link
                href="/admin/worker-profiles"
                className="inline-flex min-h-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-bold text-[#111827] transition hover:bg-gray-50"
              >
                Worker Profile
              </Link>
            ) : null}
          </div>
        </div>
      </div>

      {showDetail && (
        <WorkerActivityDetailModal
          workerId={worker.id}
          workerName={worker.name}
          workerType={worker.worker_type}
          skillCategory={worker.skill_category}
          currentProfileRate={worker.hourly_rate}
          status={worker.status}
          statusTone={statusTone(worker.status)}
          currentJobCard={jc}
          canViewCosts={canViewCosts}
          isManager={isManager}
          onClose={() => setShowDetail(false)}
        />
      )}
    </>
  );
}
