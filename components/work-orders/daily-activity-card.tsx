import Link from "next/link";
import { AlertTriangle, PackageSearch, Printer, Users } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { WorkerSessionRow } from "@/components/work-orders/worker-session-row";
import type { WorkOrderLaborSummary } from "@/lib/work-orders/work-session-totals";

// Daily Activity Compact Control Board Unit 9C, polished in Final UI Polish
// Unit 9D.
//
// Two surfaces live here:
//  - DailyActivityListRow — a compact, low-height row for the left list.
//    Only identity + three small chips + a priority accent bar. No worker
//    controls, no buttons — clicking it just selects the Job Card.
//  - DailyActivitySelectedPanel — the full control surface (Next Action,
//    worker session controls, materials/closure mini-sections, footer
//    actions), rendered ONCE, for whichever single Job Card is selected.
// Rendering full WorkerSessionRow controls for every one of up to 50 Job
// Cards was what made the old page so tall (Unit 9C) — this split keeps
// that to one card at a time. Unit 9D tightens spacing further and (Task 2)
// makes the selected state read as "this is what you're looking at," not
// "this is a problem."

export type DailyActivityChip = { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" };
export type DailyActivityNextAction = { message: string; buttonLabel: string | null; href: string | null };

// Mirrors app/(dashboard)/maintenance/daily-activity/page.tsx's own
// PriorityBucket union exactly (kept in sync manually, same convention as
// the role-slug checks duplicated elsewhere in this app) — used only to
// pick the list row's left accent color.
type PriorityBucket = "working" | "paused" | "materials" | "closure" | "assigned-idle" | "unassigned";

export type DailyActivityCardData = {
  id: string;
  workOrderNumber: string | null;
  status: string;
  displayStatus: string;
  displayStatusTone: "green" | "amber" | "red" | "blue" | "gray";
  isUnusualActiveSession: boolean;
  assetLabel: string | null;
  issue: string;
  createdLabel: string;
  workTeam: string | null;
  assignmentChip: DailyActivityChip;
  materialsChip: DailyActivityChip;
  workTimeChip: DailyActivityChip;
  closureChip: DailyActivityChip;
  closureReasons: string[];
  materialAlert: string | null;
  materialsActionLabel: string;
  materialsActionHref: string;
  materialsTotals: { required: number; issued: number; remaining: number };
  priorityBucket: PriorityBucket;
  priorityLabel: string;
  nextAction: DailyActivityNextAction;
  showAssignWorkers: boolean;
  showRequestClosure: boolean;
  laborSummary: WorkOrderLaborSummary;
  canManageSessions: boolean;
  isManager: boolean;
  canViewCosts: boolean;
  detailHref: string;
};

// Anchor target inside the panel that the Next Action button scrolls to for
// the Paused/Not-Started cases (Task 7) — same panel, so this is a plain
// same-page hash link, not a new route. Exported so page.tsx's nextAction
// computation can build the exact matching href instead of duplicating the
// literal string.
export const WORKERS_SECTION_ID = "daily-activity-workers";

// Task 3 — priority indicator color: green for working/ready, amber for
// paused, red only for blocked/materials-pending (the one state that
// actually needs urgent attention), neutral-blue for everything else
// (not started / needs assignment) — most rows should NOT be red.
function priorityAccentClass(bucket: PriorityBucket): string {
  if (bucket === "materials") return "border-l-[#ED1C24]"; // blocked — red
  if (bucket === "paused") return "border-l-[#F59E0B]"; // amber
  if (bucket === "working" || bucket === "closure") return "border-l-[#16A34A]"; // working/ready — green
  return "border-l-[#93C5FD]"; // not started / unassigned — neutral blue
}

const chipToneClass: Record<DailyActivityChip["tone"], string> = {
  green: "border-green-200 bg-green-50 text-green-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  gray: "border-gray-200 bg-gray-50 text-gray-700",
};

// Task 1 — a smaller-than-StatusBadge chip just for the compact list row,
// so three of them plus the Job Card number/issue still fit in a short row.
function MiniChip({ label, tone }: DailyActivityChip) {
  return (
    <span className={`inline-flex items-center rounded border px-1 py-0.5 text-[9px] font-bold leading-none ${chipToneClass[tone]}`}>
      {label}
    </span>
  );
}

// A tiny status badge for the list row header line — StatusBadge itself is
// a bit tall (px-2.5 py-1) for a row this short, so the list row uses this
// smaller sibling instead; the panel header keeps the full-size StatusBadge.
function TinyStatusBadge({ label, tone }: DailyActivityChip) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-1 py-0.5 text-[9px] font-bold leading-none ${chipToneClass[tone]}`}>
      {label}
    </span>
  );
}

// ── Left list row (Task 1/2/3) ──────────────────────────────────────────────

export function DailyActivityListRow({
  card,
  isSelected,
  onSelect,
}: {
  card: DailyActivityCardData;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      className={`block w-full rounded-md border-l-4 bg-white p-2 text-left transition ${priorityAccentClass(card.priorityBucket)} ${
        // Task 2 — selected reads as "this is the one you're looking at":
        // a soft blue tint + thin blue border, never red/error-styled.
        isSelected ? "bg-blue-50 ring-1 ring-[#93C5FD]" : "ring-1 ring-[#E5E7EB] hover:bg-gray-50"
      }`}
    >
      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-xs font-black text-[#111827]">{card.workOrderNumber ?? "Job Card"}</span>
        <div className="flex shrink-0 items-center gap-1">
          {card.isUnusualActiveSession ? <AlertTriangle className="h-3 w-3 text-amber-600" aria-hidden="true" /> : null}
          <TinyStatusBadge label={card.displayStatus} tone={card.displayStatusTone} />
        </div>
      </div>
      <p className="truncate text-[11px] text-[#6B7280]">{card.assetLabel ?? "No asset linked"}</p>
      <p className="line-clamp-1 text-[11px] text-[#374151]">{card.issue}</p>
      <div className="mt-1 flex flex-wrap gap-1">
        <MiniChip label={card.materialsChip.label} tone={card.materialsChip.tone} />
        <MiniChip label={card.workTimeChip.label} tone={card.workTimeChip.tone} />
        <MiniChip label={card.assignmentChip.label} tone={card.assignmentChip.tone} />
      </div>
    </button>
  );
}

// ── Right selected-card control panel (Task 6/7/8/9) ────────────────────────

export function DailyActivitySelectedPanel({ card, canPrint }: { card: DailyActivityCardData; canPrint: boolean }) {
  const detailHref = card.detailHref;
  // Task 6/12 — never repeat the same click as both the panel's one primary
  // Next Action button AND a mini-section/empty-state secondary button
  // (same "one main action" rule Unit 9B's card established).
  const materialsActionIsPrimary = card.nextAction.buttonLabel === card.materialsActionLabel;
  const assignWorkersIsPrimary = card.nextAction.buttonLabel === "Assign Workers";
  const requestClosureIsPrimary = card.nextAction.buttonLabel === "Request Closure";
  // Task 7 — red is reserved for states that genuinely need attention now;
  // the Next Action panel itself only gets the red accent/button when it's
  // pointing at one of those (materials blocked, or none at all left to do).
  const nextActionIsUrgent = card.materialsChip.label === "Materials Pending";

  return (
    <section className="rounded-lg border border-[#DDE2EA] bg-white p-3 shadow-sm sm:p-4">
      {/* Task 6 — small "Selected Job Card" label above the header. */}
      <p className="text-[10px] font-black uppercase tracking-wide text-[#9CA3AF]">Selected Job Card</p>

      {/* Header */}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-2 border-b border-[#EEF2F6] pb-2.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={detailHref} className="text-base font-black text-[#111827] hover:text-[#ED1C24] hover:underline">
              {card.workOrderNumber ?? "Job Card"}
            </Link>
            <StatusBadge label={card.displayStatus} tone={card.displayStatusTone} />
            {card.isUnusualActiveSession ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-800">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Active work session
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[#374151]">{card.issue}</p>
          <p className="mt-0.5 text-xs text-[#6B7280]">
            {card.assetLabel ?? "No asset linked"} · Created {card.createdLabel}
            {card.workTeam ? ` · ${card.workTeam}` : ""}
          </p>
        </div>
      </div>

      {/* Task 7 — Next Action: a title, one sentence, one primary button.
          Red accent is reserved for the genuinely urgent case (materials
          pending); every other next action uses a calmer neutral/blue
          treatment so the panel doesn't read as an error by default. */}
      <div
        className={`mt-2.5 rounded-md border-l-4 p-2.5 ${
          nextActionIsUrgent ? "border-[#ED1C24] bg-red-50/50" : "border-[#2563EB] bg-blue-50/40"
        }`}
      >
        <p className={`text-[10px] font-black uppercase tracking-wide ${nextActionIsUrgent ? "text-[#B91C1C]" : "text-[#1D4ED8]"}`}>
          Next Action
        </p>
        <p className="mt-0.5 text-sm font-semibold text-[#111827]">{card.nextAction.message}</p>
        <div className="mt-2">
          {card.nextAction.buttonLabel && card.nextAction.href ? (
            <Link
              href={card.nextAction.href}
              className={`inline-flex min-h-8 items-center justify-center rounded-md px-3.5 py-1.5 text-xs font-bold text-white transition ${
                nextActionIsUrgent ? "bg-[#ED1C24] hover:bg-[#c8181e]" : "bg-[#2563EB] hover:bg-blue-700"
              }`}
            >
              {card.nextAction.buttonLabel}
            </Link>
          ) : (
            <Link
              href={detailHref}
              className="inline-flex min-h-8 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
            >
              Open Job Card
            </Link>
          )}
        </div>
      </div>

      {/* Worker control section — full WorkerSessionRow controls, but only
          ever for THIS one selected Job Card (Task 8). */}
      <div id={WORKERS_SECTION_ID} className="mt-3 scroll-mt-3">
        <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Workers</p>
        {card.laborSummary.workers.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 rounded-md border border-dashed border-[#E5E7EB] bg-[#F9FAFB] py-4 text-center">
            <p className="text-xs text-[#6B7280]">No workers assigned yet.</p>
            {card.showAssignWorkers && !assignWorkersIsPrimary ? (
              <Link
                href={`${detailHref}?editAssignment=1#assignment`}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-3 py-1 text-xs font-bold text-white transition hover:bg-red-700"
              >
                <Users className="h-3.5 w-3.5" aria-hidden="true" /> Assign Workers
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            {card.laborSummary.workers.length > 1 ? (
              <p className="text-[10px] font-semibold text-[#6B7280]">Worker timers are tracked individually.</p>
            ) : null}
            {card.laborSummary.workers.map((w) => (
              <WorkerSessionRow
                key={w.worker_assignment_id}
                workOrderId={card.id}
                worker={w}
                canManageSessions={card.canManageSessions}
                isManager={card.isManager}
                canViewCosts={card.canViewCosts}
                todayHours={w.today_hours}
              />
            ))}
          </div>
        )}
      </div>

      {/* Materials mini-section (Task 9) — one compact card. */}
      <div className="mt-2.5 rounded-md border border-[#EEF2F6] p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Materials</p>
          <StatusBadge label={card.materialsChip.label} tone={card.materialsChip.tone} />
        </div>
        {card.materialsTotals.required > 0 ? (
          <p className="mt-1 text-xs text-[#4B5563]">
            Required {card.materialsTotals.required} · Issued {card.materialsTotals.issued} · Remaining {card.materialsTotals.remaining}
          </p>
        ) : null}
        {card.materialAlert ? <p className="mt-0.5 text-xs font-semibold text-[#B45309]">{card.materialAlert}</p> : null}
        {!materialsActionIsPrimary ? (
          <div className="mt-1.5">
            <Link
              href={card.materialsActionHref}
              className="inline-flex min-h-7 items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
            >
              <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" /> {card.materialsActionLabel}
            </Link>
          </div>
        ) : null}
      </div>

      {/* Closure mini-section (Task 9) — one compact card. */}
      <div className="mt-2 rounded-md border border-[#EEF2F6] p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Closure</p>
          <StatusBadge label={card.closureChip.label} tone={card.closureChip.tone} />
        </div>
        {card.closureChip.label === "Not Ready" && card.closureReasons.length > 0 ? (
          <p className="mt-1 text-xs text-[#6B7280]">{card.closureReasons.join(" · ")}</p>
        ) : null}
        {card.closureChip.label === "Ready" ? <p className="mt-1 text-xs font-semibold text-[#16A34A]">Ready for closure request.</p> : null}
        {card.showRequestClosure && !requestClosureIsPrimary ? (
          <div className="mt-1.5">
            <Link
              href={`${detailHref}#closure-panel`}
              className="inline-flex min-h-7 items-center rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
            >
              Request Closure
            </Link>
          </div>
        ) : null}
      </div>

      {/* Footer actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#EEF2F6] pt-2.5">
        <Link
          href={detailHref}
          className="inline-flex min-h-8 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
        >
          Open Full Job Card
        </Link>
        <Link
          href={`${detailHref}#parts`}
          className="inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
        >
          <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" /> View Materials
        </Link>
        {canPrint ? (
          <Link
            href={`${detailHref}/print`}
            className="inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
          >
            <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
          </Link>
        ) : null}
      </div>
    </section>
  );
}
