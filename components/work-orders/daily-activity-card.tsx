import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Hourglass,
  PackageSearch,
  PackageX,
  PauseCircle,
  PlayCircle,
  Printer,
  Users,
  type LucideIcon,
} from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { WorkerSessionRow } from "@/components/work-orders/worker-session-row";
import type { WorkOrderLaborSummary } from "@/lib/work-orders/work-session-totals";
import type { MaterialFulfillment } from "@/lib/work-orders/material-fulfillment";
// No-Confusion Material + Status Panel Unit 10G.56: the exact same pure
// state-derivation function the real closure guard (Unit 10G.53) already
// uses server-side, called here against the same laborSummary.workers data
// already on the card — never a re-guess from rendered text.
import { deriveSimpleWorkerState } from "@/lib/work-orders/hours-variance";

// Daily Activity Compact Control Board Unit 9C, polished in Final UI Polish
// Unit 9D.
//
// Two surfaces live here:
//  - DailyActivityListRow — a compact, low-height row for the left list.
//    Identity + a soft state-colored background/border and one color-matched
//    action line (Status Color Cards Unit 10G.55 — replaced the previous
//    white card + up to three mini chips). No worker controls, no buttons —
//    clicking it just selects the Job Card.
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
// pick the list row's left accent color. Unit 10G.54 added "waiting-approval".
type PriorityBucket = "working" | "paused" | "materials" | "closure" | "waiting-approval" | "assigned-idle" | "unassigned";

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
  // Daily Activity New Job Card Visibility and Timestamp Polish Unit 10F.5,
  // Task 2: true for the first 60 minutes after creation — drives the list
  // row's "NEW" badge only, not a workflow/status concept.
  isNewJobCard: boolean;
  workTeam: string | null;
  assignmentChip: DailyActivityChip;
  materialsChip: DailyActivityChip;
  workTimeChip: DailyActivityChip;
  closureChip: DailyActivityChip;
  closureReasons: string[];
  materialAlert: string | null;
  materialsActionLabel: string;
  materialsActionHref: string;
  // Unified Material Processing Flow Unit 10G.23 (replaces Unit 10D's
  // separate issue/receive modal-action split): true when the primary
  // materials action (both the Next Action button and the Materials
  // mini-section button, whichever one shows it) should open the one
  // Process Materials modal instead of navigating to materialsActionHref.
  // false means the existing navigation behavior is unchanged (e.g. "View
  // Materials" when there's no work_order_required_parts tracking yet, or
  // "Materials Completed").
  showProcessMaterials: boolean;
  materialsTotals: { required: number; issued: number; remaining: number };
  // Unit 10G.14, Task 4 — per-line Required/Available/Issued/Status, shown
  // under the totals line so each material's own state is clear (e.g. one
  // line "Ready to Issue" and another "Needs Receiving" on the same Job
  // Card) instead of only the summed totals across every line.
  fulfillment: MaterialFulfillment[];
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
  // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 7.
  estimatedHours: number | null;
};

// Anchor target inside the panel that the Next Action button scrolls to for
// the Paused/Not-Started cases (Task 7) — same panel, so this is a plain
// same-page hash link, not a new route. Exported so page.tsx's nextAction
// computation can build the exact matching href instead of duplicating the
// literal string.
export const WORKERS_SECTION_ID = "daily-activity-workers";
// Unit 10G.56, Task 5/9: same purpose as WORKERS_SECTION_ID above, for the
// "View Materials" quick link in the new Status Summary/Next Action guidance
// to jump straight to the existing Materials mini-section below it.
export const MATERIALS_SECTION_ID = "daily-activity-materials";

// Daily Activity Status Color Cards Unit 10G.55, Task 1/2/6.
//
// One soft, professional solid background per operational state, keyed off
// the exact same `priorityBucket` that already drives this page's sort
// order and Next Action ladder (app/(dashboard)/maintenance/daily-activity/
// page.tsx) — the established single source of truth for "the one most
// important thing about this card right now," so card color, list sort
// order, and the Next Action panel can never disagree about which state a
// card is in. A card that happens to satisfy two criteria at once (e.g.
// materials still pending while a worker is already actively working it)
// colors for whichever one that same ladder already ranks first — Working
// still outranks Materials Pending here exactly as it already did for
// sorting before this unit, so a green "someone's already on it" card
// showing up under the Materials Pending filter is accurate, not a bug.
//
// Each entry pairs a bg-*-50 (soft) with a full-strength left border and a
// -800/-700 label text color in the SAME hue — the left border and colored
// text are the color-blind-safe second signal Task 6 asks for ("red/green
// is not the only signal"), and every -50 background stays light enough
// that this file's existing gray/near-black text colors (asset/issue/
// created lines) keep their contrast unchanged.
type PriorityCardStyle = { bg: string; hoverBg: string; borderLeft: string; label: string };
const PRIORITY_CARD_STYLE: Record<PriorityBucket, PriorityCardStyle> = {
  working:            { bg: "bg-green-50",  hoverBg: "hover:bg-green-100",  borderLeft: "border-l-[#16A34A]", label: "text-green-800" },
  paused:             { bg: "bg-amber-50",  hoverBg: "hover:bg-amber-100",  borderLeft: "border-l-[#F59E0B]", label: "text-amber-800" },
  materials:          { bg: "bg-red-50",    hoverBg: "hover:bg-red-100",    borderLeft: "border-l-[#DC2626]", label: "text-red-800" },
  // "Ready for Closure" — soft blue/green (teal), distinct from both pure
  // green (Working) and pure blue (the neutral/default state below).
  closure:            { bg: "bg-teal-50",   hoverBg: "hover:bg-teal-100",   borderLeft: "border-l-[#0D9488]", label: "text-teal-800" },
  // "Waiting Manager Approval" — yellow, distinct enough from Paused's
  // amber/orange once paired with its own left border and label text.
  "waiting-approval": { bg: "bg-yellow-50", hoverBg: "hover:bg-yellow-100", borderLeft: "border-l-[#EAB308]", label: "text-yellow-800" },
  "assigned-idle":    { bg: "bg-slate-50",  hoverBg: "hover:bg-slate-100",  borderLeft: "border-l-[#94A3B8]", label: "text-slate-700" },
  // "Needs Assignment" / default — white with a light blue accent, same
  // neutral treatment this page has always used for "nothing urgent yet."
  unassigned:         { bg: "bg-white",     hoverBg: "hover:bg-blue-50",    borderLeft: "border-l-[#93C5FD]", label: "text-blue-700" },
};

// Job Card Card UI Polish Unit 10G.55A, Task 3/4: one small, already-
// available lucide-react icon per state, paired with the action line — no
// new dependency, just icons this project already ships. Chosen to be
// visually distinct from each other and from the unrelated AlertTriangle
// already used elsewhere on this row for "unusual active session".
const PRIORITY_ICON: Record<PriorityBucket, LucideIcon> = {
  working: PlayCircle,
  paused: PauseCircle,
  materials: PackageX,
  closure: CheckCircle2,
  "waiting-approval": Hourglass,
  "assigned-idle": Clock,
  unassigned: Users,
};

const chipToneClass: Record<DailyActivityChip["tone"], string> = {
  green: "border-green-200 bg-green-50 text-green-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  gray: "border-gray-200 bg-gray-50 text-gray-700",
};

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

// Daily Activity New Job Card Visibility and Timestamp Polish Unit 10F.5,
// Task 2: always blue, never red — a "new" Job Card is informational, not a
// problem. `animate-pulse` is Tailwind's built-in calm opacity fade (not a
// blink), applied only to this small badge, never the whole card; it stops
// being rendered at all once isNewJobCard turns false (60 minutes, Task 2),
// which is what actually "stops" it — the CSS animation itself doesn't need
// its own timer.
function NewBadge() {
  return (
    <span className="inline-flex shrink-0 animate-pulse items-center rounded border border-blue-300 bg-blue-100 px-1 py-0.5 text-[9px] font-black leading-none text-blue-700">
      NEW
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
  const style = PRIORITY_CARD_STYLE[card.priorityBucket];
  const ActionIcon = PRIORITY_ICON[card.priorityBucket];

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={isSelected}
      // Job Card Card UI Polish Unit 10G.55A, Task 2/5: rounded-lg (was -md)
      // + a full subtle border all around (not just the ring) + a resting
      // shadow-sm read as a real card, not a flat colored rectangle; the
      // left accent border stays the strong, full-color one from Unit
      // 10G.55. Selected keeps this exact background/border (never flips to
      // plain white/blue) and layers a thicker blue ring + deeper shadow on
      // top — obvious regardless of which state color the card already is.
      // Hover (not selected) is a one-step-darker same-hue shade plus a
      // slightly deeper shadow, never a flat gray swap.
      className={`block w-full min-w-0 rounded-lg border border-black/5 border-l-4 p-2.5 text-left shadow-sm transition ${style.bg} ${style.borderLeft} ${
        isSelected ? "shadow-md ring-2 ring-[#2563EB]" : `hover:shadow-md ${style.hoverBg}`
      }`}
    >
      {/* Top row — Job Card number (bold, left) + main status badge (right),
          neatly aligned (Task 1/6). min-w-0 + flex-1 + truncate on the
          number is what actually lets it shrink/truncate before the badge
          ever does on a narrow screen (Task 7) — the badge itself is
          shrink-0 so it never gets squeezed into overflow or wrapping. */}
      <div className="flex min-w-0 items-center justify-between gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-black leading-tight text-[#111827]">
          {card.workOrderNumber ?? "Job Card"}
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {card.isUnusualActiveSession ? <AlertTriangle className="h-3 w-3 text-amber-600" aria-hidden="true" /> : null}
          {card.isNewJobCard ? <NewBadge /> : null}
          <TinyStatusBadge label={card.displayStatus} tone={card.displayStatusTone} />
        </div>
      </div>

      {/* Second row — asset code/name (Task 1/6: readable but secondary; at
          most one line, never wraps). */}
      <p className="mt-1 truncate text-[11px] text-[#6B7280]">{card.assetLabel ?? "No asset linked"}</p>

      {/* Third row — complaint/problem, one line max (Task 1/6/7). */}
      <p className="mt-0.5 line-clamp-1 text-[11px] text-[#374151]">
        <span className="font-semibold text-[#4B5563]">Issue: </span>
        {card.issue}
      </p>

      {/* Bottom action row — Task 1/2/3/4: the one clear, icon-paired,
          color-matched action/status line (card.priorityLabel — computed
          once in page.tsx from the same priorityBucket the card's
          background/border already use, so text, icon, and color can never
          disagree). A hairline top rule gives it its own "footer band"
          instead of just being one more paragraph in the stack — this is
          deliberately the strongest text on the card after the Job Card
          number (Task 6), and the ONLY extra "badge-strength" signal here —
          Task 2's "avoid too many badges." Truncates rather than wraps so a
          long sentence (e.g. "Worker paused - resume or finish work") can
          never cause horizontal overflow on a narrow screen (Task 7). */}
      <div className={`mt-1.5 flex min-w-0 items-center gap-1.5 border-t border-black/10 pt-1.5 ${style.label}`}>
        <ActionIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate text-xs font-extrabold">{card.priorityLabel}</span>
      </div>

      {/* Footer — created date/time, small and muted (Task 1/6). */}
      <p className="mt-1 truncate text-[10px] text-[#9CA3AF]">Created: {card.createdLabel}</p>
    </button>
  );
}

// ── Status Summary + Next Action guidance (No-Confusion Material + Status
//    Panel Unit 10G.56) ───────────────────────────────────────────────────
//
// Everything below is derived purely from fields already on `card` — no new
// data, no re-query, nothing parsed from rendered text. Task 12: only the
// plain words the business asked for (Job Card, Materials, Workers,
// Finished, Waiting for Manager approval, Ready for closure, Not ready) —
// never "work_order", "session", "workflow instance", or a raw status code.

type SummaryTone = "green" | "amber" | "red" | "blue" | "gray";
const SUMMARY_TONE_CLASS: Record<SummaryTone, string> = {
  green: "border-green-200 bg-green-50 text-green-800",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-800",
  blue: "border-blue-200 bg-blue-50 text-blue-800",
  gray: "border-gray-200 bg-gray-50 text-gray-700",
};

// Task 5/6/9 — when `href` is given, the whole row IS the "View Materials"/
// "View Workers" action (a plain same-page anchor scroll to the existing
// mini-section below, via MATERIALS_SECTION_ID/WORKERS_SECTION_ID — no new
// modal, no duplicate material/worker logic). The trailing chevron is the
// only extra affordance; the row's own icon/value/detail are unchanged
// either way, so clicking to "view" never looks different from just reading it.
function StatusSummaryRow({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  href,
  linkLabel,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string | null;
  tone: SummaryTone;
  href?: string;
  linkLabel?: string;
}) {
  const inner = (
    <>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-black uppercase leading-none tracking-wide opacity-70">{label}</p>
        <p className="mt-0.5 truncate text-xs font-black leading-tight">{value}</p>
        {detail ? <p className="mt-0.5 truncate text-[10px] font-semibold leading-tight opacity-80">{detail}</p> : null}
      </div>
      {href ? <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50" aria-hidden="true" /> : null}
    </>
  );
  const className = `flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2 ${SUMMARY_TONE_CLASS[tone]}`;

  if (href) {
    return (
      <Link href={href} aria-label={linkLabel} className={`${className} transition hover:opacity-90`}>
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}

// Task 2 — reuses card.materialsChip (the exact same value the existing
// Materials mini-section badge already shows) collapsed to the 3 plain
// states the business asked for, and card.materialsTotals (the same
// quantity-based Required/Issued/Remaining sum the mini-section already
// shows) for the count line — never recalculated, never a new guess.
function summarizeMaterials(card: DailyActivityCardData) {
  const state: "none" | "pending" | "completed" =
    card.materialsChip.label === "No Materials" ? "none" : card.materialsChip.label === "Materials Completed" ? "completed" : "pending";
  const value = state === "none" ? "No materials required" : state === "completed" ? "Materials Completed" : "Materials Pending";
  // required_qty/issued_qty/remaining_qty are true quantities (e.g. "10
  // bolts"), not a line count (lib/work-orders/material-fulfillment.ts) —
  // Task 2's quantity-based wording applies.
  const detail =
    card.materialsTotals.required > 0
      ? `Required ${card.materialsTotals.required} items · Issued ${card.materialsTotals.issued} · Remaining ${card.materialsTotals.remaining}`
      : null;
  const icon = state === "pending" ? PackageX : PackageSearch;
  return { state, value, detail, tone: card.materialsChip.tone as SummaryTone, icon };
}

// Task 3 — counts derived from the exact same laborSummary.workers rows the
// Workers section below already renders, via the same deriveSimpleWorkerState
// the real server-side closure guard uses. Only Not Started/Working/Paused/
// Finished ever surface — no session/technical wording.
function summarizeWorkers(card: DailyActivityCardData) {
  const states = card.laborSummary.workers.map((w) => deriveSimpleWorkerState(w.assignment_status, w.status));
  const total = states.length;
  const working = states.filter((s) => s === "Working").length;
  const paused = states.filter((s) => s === "Paused").length;
  const notStarted = states.filter((s) => s === "Not Started").length;
  const finished = states.filter((s) => s === "Finished").length;

  let value: string;
  let icon: LucideIcon;
  if (total === 0) {
    value = "No workers assigned";
    icon = Users;
  } else if (working > 0) {
    value = `${working} worker${working > 1 ? "s" : ""} working`;
    icon = PlayCircle;
  } else if (paused > 0) {
    value = `${paused} worker${paused > 1 ? "s" : ""} paused`;
    icon = PauseCircle;
  } else if (notStarted > 0) {
    value = notStarted === total ? "Work not started" : `${notStarted} worker${notStarted > 1 ? "s" : ""} not started`;
    icon = Clock;
  } else {
    value = "All workers finished";
    icon = CheckCircle2;
  }
  const detail = total > 0 ? `Total ${total} · Finished ${finished} · Working ${working} · Paused ${paused} · Not started ${notStarted}` : null;
  // card.workTimeChip.tone is the exact same tone the existing list-row/
  // panel already use for this Job Card's work-time state — reused rather
  // than a second, possibly-disagreeing color opinion.
  return { total, working, paused, notStarted, finished, value, detail, tone: card.workTimeChip.tone as SummaryTone, icon };
}

// Task 1 (#3) — plain wording for card.closureChip.label, the exact same
// value the existing Closure mini-section badge already shows.
function summarizeClosure(card: DailyActivityCardData) {
  const label = card.closureChip.label;
  const value =
    label === "Closed" ? "Closed" : label === "Requested" ? "Waiting for Manager approval" : label === "Ready" ? "Ready for closure" : "Not ready for closure";
  const icon = label === "Closed" ? CheckCircle2 : label === "Requested" ? Hourglass : label === "Ready" ? CheckCircle2 : Clock;
  return { value, tone: card.closureChip.tone as SummaryTone, icon };
}

type GuidanceButton = "materials" | "workers" | "closure";
type Guidance = { message: string; button: GuidanceButton | null; urgent: boolean };

// Task 4 — the exact 8-case priority ladder and wording, in order. Every
// condition reads an already-computed field (card.status, the materials/
// worker summaries above) — no new server logic, no re-derivation of
// anything the real backend closure guard (Unit 10G.53) doesn't already
// decide. Task 7's button-per-state table is this same ladder's `button`
// field — message and button can never point at different states because
// they come from the same branch.
function computeGuidance(
  card: DailyActivityCardData,
  materials: ReturnType<typeof summarizeMaterials>,
  workers: ReturnType<typeof summarizeWorkers>
): Guidance {
  if (card.status === "Closure Requested") {
    return { message: "Waiting for Manager approval. This Job Card has been submitted for closure approval.", button: null, urgent: false };
  }
  if (card.status === "Closed") {
    return { message: "Job Card closed.", button: null, urgent: false };
  }
  if (materials.state === "pending") {
    return { message: "Materials are pending. Process remaining materials before closure.", button: "materials", urgent: true };
  }
  if (workers.working > 0) {
    return { message: "Worker is currently working. Finish work before requesting closure.", button: "workers", urgent: false };
  }
  if (workers.paused > 0) {
    return { message: "Worker is paused. Resume or Finish Work before requesting closure.", button: "workers", urgent: false };
  }
  if (workers.notStarted > 0) {
    return { message: "Worker not started. Start and finish work before requesting closure.", button: "workers", urgent: false };
  }
  if (workers.total > 0) {
    return { message: "Ready for closure. Submit to Manager for approval.", button: "closure", urgent: false };
  }
  return { message: "Review the Job Card details before requesting closure.", button: null, urgent: false };
}

// ── Right selected-card control panel (Task 6/7/8/9) ────────────────────────

export function DailyActivitySelectedPanel({
  card,
  canPrint,
  onProcessMaterials,
  onRequestClosure,
}: {
  card: DailyActivityCardData;
  canPrint: boolean;
  // Unified Material Processing Flow Unit 10G.23: opens the one Process
  // Materials modal for THIS card — only ever called when
  // card.showProcessMaterials says so (see the button rendering below).
  onProcessMaterials: () => void;
  // Daily Activity Closure Request Modal with Attachments Unit 10F.6, Task
  // 1: opens the closure request modal for THIS card instead of navigating
  // to the Job Card detail page's Closure tab — only ever called when
  // card.showRequestClosure says so (see the button rendering below).
  onRequestClosure: () => void;
}) {
  const detailHref = card.detailHref;
  // Task 6/12 — never repeat the same click as both the panel's one primary
  // Next Action button AND a mini-section/empty-state secondary button
  // (same "one main action" rule Unit 9B's card established).
  const materialsActionIsPrimary = card.nextAction.buttonLabel === card.materialsActionLabel;
  const materialsOnClick = card.showProcessMaterials ? onProcessMaterials : null;
  const assignWorkersIsPrimary = card.nextAction.buttonLabel === "Assign Workers";
  const requestClosureIsPrimary = card.nextAction.buttonLabel === "Request Closure";
  // Unit 10G.56 — Status Summary + Next Action guidance, computed once per
  // render from data already on `card` (see the functions above this
  // component). materialsOnClick (above) is the same Process Materials
  // modal opener the Materials mini-section already uses — not duplicated.
  const materialsSummary = summarizeMaterials(card);
  const workersSummary = summarizeWorkers(card);
  const closureSummary = summarizeClosure(card);
  const guidance = computeGuidance(card, materialsSummary, workersSummary);
  const guidanceBtnClass = `inline-flex min-h-8 items-center justify-center gap-1 rounded-md px-3.5 py-1.5 text-xs font-bold text-white transition ${
    guidance.urgent ? "bg-[#ED1C24] hover:bg-[#c8181e]" : "bg-[#2563EB] hover:bg-blue-700"
  }`;

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
            {/* Task 6 — reinforces "this is the new Job Card I just
                selected," the same badge/condition as the list row. */}
            {card.isNewJobCard ? <NewBadge /> : null}
            {card.isUnusualActiveSession ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-800">
                <AlertTriangle className="h-3 w-3" aria-hidden="true" /> Active work session
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-[#374151]">{card.issue}</p>
          {/* Task 6 — "Created: Today, 1:55 PM" in the selected panel header. */}
          <p className="mt-0.5 text-xs text-[#6B7280]">
            {card.assetLabel ?? "No asset linked"} · Created: {card.createdLabel}
            {card.workTeam ? ` · ${card.workTeam}` : ""}
          </p>
        </div>
      </div>

      {/* No-Confusion Material + Status Panel Unit 10G.56, Task 1/8 — Status
          Summary: 3 compact rows answering "materials completed or
          pending," "workers not started/working/paused/finished," and "is
          closure allowed" at a glance, before the user reads anything else.
          Each row's color reuses the exact tone the matching mini-section
          badge below already carries (materialsChip/workTimeChip/
          closureChip) — never a second, possibly-disagreeing opinion. */}
      <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <StatusSummaryRow
          icon={materialsSummary.icon}
          label="Materials"
          value={materialsSummary.value}
          detail={materialsSummary.detail}
          tone={materialsSummary.tone}
          href={`#${MATERIALS_SECTION_ID}`}
          linkLabel="View Materials"
        />
        <StatusSummaryRow
          icon={workersSummary.icon}
          label="Workers"
          value={workersSummary.value}
          detail={workersSummary.detail}
          tone={workersSummary.tone}
          href={`#${WORKERS_SECTION_ID}`}
          linkLabel="View Workers"
        />
        <StatusSummaryRow icon={closureSummary.icon} label="Closure" value={closureSummary.value} tone={closureSummary.tone} />
      </div>

      {/* Task 4/7 — Next Action: the one clear instruction (exact wording
          per state), plus only the buttons that make sense right now —
          the contextual action the ladder above points at (if any), always
          followed/preceded by "Open Job Card" exactly as each of the
          task's own worked examples order them, plus Print once this Job
          Card is Closure Requested/Closed and the viewer already has print
          permission. Red accent stays reserved for the one genuinely
          urgent case (materials pending). */}
      <div className={`mt-2 rounded-md border-l-4 p-2.5 ${guidance.urgent ? "border-[#ED1C24] bg-red-50/50" : "border-[#2563EB] bg-blue-50/40"}`}>
        <p className={`text-[10px] font-black uppercase tracking-wide ${guidance.urgent ? "text-[#B91C1C]" : "text-[#1D4ED8]"}`}>
          Next Action
        </p>
        <p className="mt-0.5 text-sm font-semibold text-[#111827]">{guidance.message}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {guidance.button === "materials" ? (
            // Task 5 — same Process Materials modal / materialsActionHref
            // the Materials mini-section below already uses; no duplicate
            // material-processing logic.
            materialsOnClick ? (
              <button type="button" onClick={materialsOnClick} className={guidanceBtnClass}>
                <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" /> {card.materialsActionLabel}
              </button>
            ) : (
              <Link href={card.materialsActionHref} className={guidanceBtnClass}>
                <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" /> {card.materialsActionLabel}
              </Link>
            )
          ) : null}
          {guidance.button === "workers" ? (
            // Task 6 — a plain scroll link to the existing Workers section
            // below; no new modal, no change to worker timer actions.
            <Link href={`#${WORKERS_SECTION_ID}`} className={guidanceBtnClass}>
              <Users className="h-3.5 w-3.5" aria-hidden="true" /> View Workers
            </Link>
          ) : null}
          {guidance.button === "closure" && card.showRequestClosure ? (
            // Task 7 — only rendered when card.showRequestClosure already
            // says this Job Card is actually ready AND this viewer has
            // permission — same gate/action the Closure mini-section below
            // already uses.
            <button type="button" onClick={onRequestClosure} className={guidanceBtnClass}>
              Request Closure
            </button>
          ) : null}
          <Link
            href={detailHref}
            className="inline-flex min-h-8 items-center justify-center rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
          >
            Open Job Card
          </Link>
          {(card.status === "Closure Requested" || card.status === "Closed") && canPrint ? (
            <Link
              href={`${detailHref}/print`}
              className="inline-flex min-h-8 items-center justify-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
            </Link>
          ) : null}
        </div>
      </div>

      {/* Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 7:
          a brief one-line summary only — no variance/status badge here
          (that's the fuller Job Card detail page's job); hidden entirely
          when there's no estimate, per Task 7's "do not overcrowd". */}
      {card.estimatedHours !== null && (
        <p className="mt-3 text-xs text-[#6B7280]">
          Estimated total: <strong className="text-[#111827]">{card.estimatedHours} h</strong>
          {" · "}Actual total: <strong className="text-[#111827]">{card.laborSummary.total_hours} h</strong>
        </p>
      )}

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

      {/* Materials mini-section (Task 9) — one compact card. id/scroll-mt
          added in Unit 10G.56 purely so the new guidance area's "View
          Materials" link can scroll here — content/logic unchanged. */}
      <div id={MATERIALS_SECTION_ID} className="mt-2.5 scroll-mt-3 rounded-md border border-[#EEF2F6] p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-wide text-[#6B7280]">Materials</p>
          <StatusBadge label={card.materialsChip.label} tone={card.materialsChip.tone} />
        </div>
        {card.materialsTotals.required > 0 ? (
          <p className="mt-1 text-xs text-[#4B5563]">
            Required {card.materialsTotals.required} · Issued {card.materialsTotals.issued} · Remaining {card.materialsTotals.remaining}
          </p>
        ) : null}
        {/* Unit 10G.14, Task 4 — per-line status, so a mixed Job Card (one
            material already in stock, another new/unavailable) reads
            clearly instead of only the summed totals above implying every
            line is in the same state. */}
        {card.fulfillment.length > 1 ? (
          <ul className="mt-1.5 space-y-1 border-t border-[#F3F4F6] pt-1.5">
            {card.fulfillment.map((f) => (
              <li key={f.id} className="text-[11px] text-[#4B5563]">
                <span className="font-semibold text-[#111827]">{f.description}</span>
                <br />
                Required {f.required_qty} {f.unit} · Available {f.available_now} {f.unit} · Issued {f.issued_qty} {f.unit}
                {" · "}
                <span
                  className={
                    f.status === "fulfilled"
                      ? "font-semibold text-green-700"
                      : f.status === "ready_to_issue"
                        ? "font-semibold text-blue-700"
                        : f.status === "partial_available"
                          ? "font-semibold text-amber-700"
                          : "font-semibold text-red-700"
                  }
                >
                  {f.status === "fulfilled"
                    ? "Fully Issued"
                    : f.status === "ready_to_issue"
                      ? "Ready to Issue"
                      : f.status === "partial_available"
                        ? "Partially Available"
                        : "Needs Receiving"}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        {card.materialAlert ? <p className="mt-0.5 text-xs font-semibold text-[#B45309]">{card.materialAlert}</p> : null}
        {!materialsActionIsPrimary ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {materialsOnClick ? (
              // Unified Material Processing Flow Unit 10G.23 — Process
              // Materials opens the one modal in place instead of
              // navigating away.
              <button
                type="button"
                onClick={materialsOnClick}
                className="inline-flex min-h-7 items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
              >
                <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" /> {card.materialsActionLabel}
              </button>
            ) : (
              <Link
                href={card.materialsActionHref}
                className="inline-flex min-h-7 items-center gap-1 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
              >
                <PackageSearch className="h-3.5 w-3.5" aria-hidden="true" /> {card.materialsActionLabel}
              </Link>
            )}
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
            {/* Unit 10F.6, Task 1 — opens the closure modal instead of
                navigating to the Job Card detail page's Closure tab. */}
            <button
              type="button"
              onClick={onRequestClosure}
              className="inline-flex min-h-7 items-center rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#111827] transition hover:bg-gray-50"
            >
              Request Closure
            </button>
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
