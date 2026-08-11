"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { getWorkerActivityDetailAction } from "@/app/actions/worker-activity";
import { SessionHistoryModal } from "@/components/work-orders/session-history-modal";
import { LargeFormModal } from "@/components/ui/large-form-modal";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";
import type { WorkerActivityDetail, WorkerActivityJobCardBreakdown } from "@/lib/work-orders/work-session-totals";

// Worker Activity Manager Hours and Payment Detail Unit 10C, Task 3.
//
// Uses the existing LargeFormModal shell (same one the Materials Request/
// Add Material/Receive/Issue popups and the dashboard's Vehicle Expiry
// modal already use) — "do not create a completely different modal style."
// Header summary comes straight from props (already computed by the Worker
// Activity page for the card itself, no extra fetch needed); Today/Week/
// Month + Job Card breakdown + session history come from one new
// getWorkerActivityDetailAction() call, fetched client-side on open —
// Pattern B (see Unit 10C research), matching how SessionHistoryModal
// itself already fetches its own data rather than the page pre-fetching it.
//
// Task 7 — correction is never reimplemented here. "Correct Session"/"View
// Sessions" on a Job Card row swaps this modal out for the existing,
// already manager-gated SessionHistoryModal (scoped to that one Job Card's
// worker_assignment_id) rather than stacking a second overlay on top (the
// two shells share the same z-40/z-50 layer, so nesting them would visually
// collide) — closing SessionHistoryModal returns here.

export type WorkerActivityDetailCurrentJobCard = {
  work_order_id: string;
  work_order_number: string | null;
  issue: string;
  asset_label: string | null;
  worker_assignment_id: string;
  hourly_rate_snapshot: number;
  // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 10:
  // this worker's own estimate for the current Job Card, if set — hours
  // only, never gated by canViewCosts (unlike hourly_rate_snapshot above).
  estimated_hours: number | null;
};

type Period = "today" | "week" | "month";

const PERIOD_LABEL: Record<Period, string> = { today: "Today", week: "This Week", month: "This Month" };

export function WorkerActivityDetailModal({
  workerId,
  workerName,
  workerType,
  skillCategory,
  currentProfileRate,
  status,
  statusTone,
  currentJobCard,
  canViewCosts,
  isManager,
  onClose,
}: {
  workerId: string;
  workerName: string;
  workerType: string;
  skillCategory: string | null;
  currentProfileRate: number;
  status: string;
  statusTone: "green" | "amber" | "blue" | "gray";
  currentJobCard: WorkerActivityDetailCurrentJobCard | null;
  canViewCosts: boolean;
  isManager: boolean;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<WorkerActivityDetail | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [period, setPeriod] = useState<Period>("today");
  const [sessionsFor, setSessionsFor] = useState<{
    workerAssignmentId: string;
    sessionId?: string;
    jobCardNumber?: string | null;
    assetLabel?: string | null;
  } | null>(null);
  // Manager Worker Time Correction Enhancement Unit 10C.1, Task 9 —
  // re-fetch this modal's own totals/rows after returning from a
  // correction, so Today/Week/Month and the session list reflect the
  // corrected values immediately instead of waiting for the next full
  // page load.
  const [reloadToken, setReloadToken] = useState(0);

  // This component is always mounted fresh (the caller renders it
  // conditionally with a fixed workerId for that mount — see
  // components/workers/worker-card.tsx's `{showDetail && (...)}`), so this
  // effect only ever runs once per open; no need to reset state first.
  useEffect(() => {
    let cancelled = false;
    getWorkerActivityDetailAction(workerId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [workerId, reloadToken]);

  // Task 7 — drill into the real correction surface for one Job Card;
  // returning here (not fully closing) when it's dismissed.
  if (sessionsFor) {
    return (
      <SessionHistoryModal
        workerAssignmentId={sessionsFor.workerAssignmentId}
        workerName={workerName}
        isManager={isManager}
        canViewCosts={canViewCosts}
        initialEditSessionId={sessionsFor.sessionId}
        jobCardNumber={sessionsFor.jobCardNumber}
        assetLabel={sessionsFor.assetLabel}
        onClose={() => {
          setSessionsFor(null);
          setReloadToken((n) => n + 1);
        }}
      />
    );
  }

  const periodJobCards: WorkerActivityJobCardBreakdown[] = detail
    ? detail.jobCards.filter((jc) => (period === "today" ? jc.hoursToday : period === "week" ? jc.hoursWeek : jc.hoursMonth) > 0)
    : [];

  return (
    <LargeFormModal
      title="Worker Activity Details"
      subtitle={`${workerName} · ${workerType}`}
      onClose={onClose}
    >
      {/* Task 3 — header summary */}
      <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-base font-black text-[#111827]">{workerName}</p>
            <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-bold text-gray-700">{workerType}</span>
            {skillCategory ? (
              <span className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[11px] font-bold text-gray-700">{skillCategory}</span>
            ) : null}
          </div>
          <StatusBadge label={status} tone={statusTone} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[#4B5563]">
          {canViewCosts ? (
            <span>Current profile rate: <strong className="text-[#111827]">{currentProfileRate.toFixed(3)} KWD/hr</strong></span>
          ) : null}
          {canViewCosts && currentJobCard ? (
            <span>Assignment rate: <strong className="text-[#111827]">{currentJobCard.hourly_rate_snapshot.toFixed(3)} KWD/hr</strong></span>
          ) : null}
        </div>
        {currentJobCard ? (
          <div className="mt-2 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-2 text-xs">
            <p className="font-bold text-[#111827]">
              {currentJobCard.work_order_number ?? "Job Card"}
              {currentJobCard.asset_label ? <span className="ml-1.5 font-normal text-[#6B7280]">· {currentJobCard.asset_label}</span> : null}
            </p>
            <p className="mt-0.5 text-[#4B5563]">{currentJobCard.issue}</p>
            {currentJobCard.estimated_hours !== null ? (
              <p className="mt-0.5 text-[#6B7280]">Estimated for this worker: <strong className="text-[#111827]">{currentJobCard.estimated_hours} h</strong></p>
            ) : null}
          </div>
        ) : (
          <p className="mt-2 text-xs text-[#9CA3AF]">No active Job Card.</p>
        )}
      </div>

      {!detail ? (
        <p className="mt-4 text-center text-sm text-[#6B7280]">{loadError ? "Could not load worker activity." : "Loading…"}</p>
      ) : (
        <>
          {/* Task 4 — Today / This Week / This Month period summary, also
              doubling as the tab control for the Job Card breakdown below. */}
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {(["today", "week", "month"] as const).map((p) => {
              const totals = detail[p];
              const active = period === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`rounded-md border p-2.5 text-left transition ${active ? "border-[#2563EB] ring-1 ring-[#93C5FD] bg-blue-50/40" : "border-[#E5E7EB] bg-white hover:border-[#2563EB]"}`}
                >
                  <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">{PERIOD_LABEL[p]}</p>
                  <p className="mt-1 text-lg font-black text-[#111827]">{totals.hours} h</p>
                  <p className="text-[11px] text-[#6B7280]">
                    {canViewCosts ? `${totals.amount.toFixed(3)} KWD · ` : ""}
                    {totals.jobCardCount} Job Card{totals.jobCardCount !== 1 ? "s" : ""}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Task 5 — Job Card breakdown for the selected period. */}
          <div className="mt-4">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Job Cards Worked — {PERIOD_LABEL[period]}</p>
            {periodJobCards.length === 0 ? (
              <p className="mt-1.5 text-xs text-[#9CA3AF]">No Job Cards worked in this period.</p>
            ) : (
              <div className="mt-1.5 divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#E5E7EB]">
                {periodJobCards.map((jc) => {
                  const hours = period === "today" ? jc.hoursToday : period === "week" ? jc.hoursWeek : jc.hoursMonth;
                  const amount = period === "today" ? jc.amountToday : period === "week" ? jc.amountWeek : jc.amountMonth;
                  return (
                    <div key={jc.workOrderId} className="flex flex-col gap-2 p-2.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-bold text-[#111827]">
                          {jc.workOrderNumber ?? "Job Card"}
                          {jc.assetLabel ? <span className="ml-1.5 font-normal text-[#6B7280]">· {jc.assetLabel}</span> : null}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-[#6B7280]">{jc.issue}</p>
                        <p className="mt-0.5 text-[11px] text-[#9CA3AF]">Last activity {formatDateTime(jc.lastActivityAt)}</p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {jc.currentSessionStatus ? (
                          <StatusBadge label={jc.currentSessionStatus === "Active" ? "Working Now" : "Paused"} tone={jc.currentSessionStatus === "Active" ? "green" : "amber"} />
                        ) : null}
                        <span className="text-xs text-[#4B5563]">{hours}h{canViewCosts ? ` · ${amount.toFixed(3)} KWD` : ""}</span>
                        <Link
                          href={`/maintenance/work-orders/${jc.workOrderId}`}
                          className="inline-flex min-h-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-2 text-[11px] font-bold text-[#111827] transition hover:bg-gray-50"
                        >
                          Open Job Card
                        </Link>
                        <button
                          type="button"
                          onClick={() =>
                            setSessionsFor({
                              workerAssignmentId: jc.workOrderAssignmentId,
                              jobCardNumber: jc.workOrderNumber,
                              assetLabel: jc.assetLabel,
                            })
                          }
                          className="inline-flex min-h-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-2 text-[11px] font-bold text-[#111827] transition hover:bg-gray-50"
                        >
                          {isManager ? "Correct Session" : "View Sessions"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Task 6 — recent session history (already capped to the latest
              20 of the current month by the server). */}
          <div className="mt-4">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Recent Sessions</p>
            {detail.recentSessions.length === 0 ? (
              <p className="mt-1.5 text-xs text-[#9CA3AF]">No sessions recorded this month.</p>
            ) : (
              <div className="mt-1.5 divide-y divide-[#EEF2F6] overflow-hidden rounded-md border border-[#E5E7EB]">
                {detail.recentSessions.map((s) => (
                  <div key={s.id} className="flex flex-col gap-1 p-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-[#111827]">
                        {s.workOrderNumber ?? "Job Card"}{s.assetLabel ? <span className="font-normal text-[#6B7280]"> · {s.assetLabel}</span> : null}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#6B7280]">
                        {formatDateTime(s.startedAt)} → {s.stoppedAt ? formatDateTime(s.stoppedAt) : s.pausedAt ? formatDateTime(s.pausedAt) : "—"}
                        {s.isManualEntry ? " · Manual entry" : ""}
                      </p>
                      {s.correctionReason ? (
                        <p className="mt-0.5 text-[11px] font-semibold text-amber-700">
                          Correction{s.editedByName ? ` (by ${s.editedByName})` : ""}: {s.correctionReason}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {/* Task 7 — "Corrected" badge, main value already
                          reflects the corrected duration since this row
                          comes straight from the (post-correction) session
                          record. */}
                      {s.correctionReason ? <StatusBadge label="Corrected" tone="amber" /> : null}
                      <StatusBadge
                        label={s.status}
                        tone={s.status === "Active" ? "green" : s.status === "Paused" ? "amber" : s.status === "Cancelled" ? "red" : "gray"}
                      />
                      <span className="text-[#4B5563]">
                        {Math.round((s.durationMinutes / 60) * 100) / 100}h{canViewCosts ? ` · ${s.calculatedAmount.toFixed(3)} KWD` : ""}
                      </span>
                      {/* Task 2/8 — direct per-session correction entry
                          point, Manager/Super Admin only; Data Entry never
                          sees this button (isManager is computed and
                          enforced server-side too, in editWorkSession). */}
                      {isManager && s.status !== "Active" && s.status !== "Cancelled" ? (
                        <button
                          type="button"
                          onClick={() =>
                            setSessionsFor({
                              workerAssignmentId: s.workerAssignmentId,
                              sessionId: s.id,
                              jobCardNumber: s.workOrderNumber,
                              assetLabel: s.assetLabel,
                            })
                          }
                          className="inline-flex min-h-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-2 text-[11px] font-bold text-[#111827] transition hover:bg-gray-50"
                        >
                          Correct Session
                        </button>
                      ) : null}
                    </div>
                    {isManager && s.status === "Active" ? (
                      <p className="mt-0.5 text-[11px] font-semibold text-amber-700 sm:ml-2">Stop or pause this session before correction.</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </LargeFormModal>
  );
}
