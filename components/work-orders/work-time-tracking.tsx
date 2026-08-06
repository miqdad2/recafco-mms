import Link from "next/link";
import { Clock, PauseCircle, PlayCircle, Users } from "lucide-react";

import { WorkerSessionRow } from "@/components/work-orders/worker-session-row";
import type { WorkOrderLaborSummary } from "@/lib/work-orders/work-session-totals";

// Work Session Time Tracking and Labor Cost Calculation Unit 8, Task 6/7/9.
// Internal Team roster only (Unit 7) — Freelancer/External Company have no
// timer controls here; their agreed amount stays in the Assignment section.
//
// Job Card Work Tracking Entry Points and Assignment Visibility Unit 8B,
// Task 5/7: this section now always renders (previously returned null with
// no internal workers, so its own `id="work-time-tracking"` anchor didn't
// exist yet for a Job Card that hadn't been assigned) — an empty Job Card
// still needs a real, scrollable landing spot for the quick-view's "Assign
// Workers"/"Track Work" links and the "?section=work-time" deep link below.
//
// Premium Job Card Detail Page Redesign Unit 8C.2, Task 7: added a
// "Workers working now" / "Paused sessions" read at the top (purely derived
// from `summary.workers`, already loaded — no new query) so Data Entry
// never has to scan every row to see the overall state at a glance.
export function WorkTimeTracking({
  workOrderId,
  summary,
  canManageSessions,
  isManager,
  canViewCosts,
  canAssign,
}: {
  workOrderId: string;
  summary: WorkOrderLaborSummary;
  canManageSessions: boolean;
  isManager: boolean;
  canViewCosts: boolean;
  canAssign: boolean;
}) {
  if (summary.workers.length === 0) {
    return (
      <section id="work-time-tracking" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-[#111827] p-2 text-white">
            <Clock className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Time &amp; Cost</p>
            <h2 className="mt-0.5 text-lg font-black text-[#111827]">Work Time Tracking</h2>
          </div>
        </div>
        <div className="mt-4 flex flex-col items-center gap-3 rounded-md border border-dashed border-[#E5E7EB] bg-[#F9FAFB] py-8 text-center">
          <p className="text-sm text-[#6B7280]">No internal workers assigned yet.</p>
          {canAssign && (
            <Link
              href="#assignment"
              className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-4 py-2 text-sm font-bold text-white transition hover:bg-red-700"
            >
              <Users className="h-4 w-4" aria-hidden />
              Assign Workers
            </Link>
          )}
        </div>
      </section>
    );
  }

  const workingNow = summary.workers.filter((w) => w.status === "Active").length;
  const pausedCount = summary.workers.filter((w) => w.status === "Paused").length;

  return (
    <section id="work-time-tracking" className="rounded-md border border-[#DDE2EA] bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-[#111827] p-2 text-white">
          <Clock className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Live status</p>
          <h2 className="mt-0.5 text-lg font-black text-[#111827]">Work Time Tracking</h2>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
          <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Total labor hours</p>
          <p className="text-lg font-black text-[#111827]">{summary.total_hours}</p>
        </div>
        <div className="rounded-md border border-green-200 bg-green-50 p-3">
          <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-green-700">
            <PlayCircle className="h-3 w-3" aria-hidden /> Working now
          </p>
          <p className="text-lg font-black text-green-800">{workingNow}</p>
        </div>
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
          <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
            <PauseCircle className="h-3 w-3" aria-hidden /> Paused
          </p>
          <p className="text-lg font-black text-amber-800">{pausedCount}</p>
        </div>
        {canViewCosts && (
          <div className="rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3">
            <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Total labor cost</p>
            <p className="text-lg font-black text-[#111827]">{summary.total_amount.toFixed(3)} KWD</p>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {summary.workers.map((w) => (
          <WorkerSessionRow
            key={w.worker_assignment_id}
            workOrderId={workOrderId}
            worker={w}
            canManageSessions={canManageSessions}
            isManager={isManager}
            canViewCosts={canViewCosts}
          />
        ))}
      </div>

      {!canManageSessions && (
        <p className="mt-3 text-xs text-[#9CA3AF]">This Job Card is closed — work sessions are read-only.</p>
      )}
    </section>
  );
}
