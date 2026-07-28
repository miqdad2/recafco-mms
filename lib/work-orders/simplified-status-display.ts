// Client-safe half of lib/work-orders/simplified-status.ts — pure display
// mapping only, no "server-only"/prisma import, so client components (e.g.
// the Job Card quick-view popup) can use the same simplified-status wording
// as every server-rendered page instead of re-deriving their own.
//
// Simplified Job Card Approval Workflow Unit Task 3: five plain, user-facing
// statuses replace the 9-value backend status for display purposes only.
// No DB value changes — work_orders.status keeps using its existing 9
// values (chk_work_orders_status is untouched); this is purely a display
// mapping, the same pattern already used for employeeStatusLabel()/
// displayStatus() elsewhere in the app.
//
// Job Card Status Simplification Task: "Open" split into "Approved"/"Active"
// and "Correction Requested" retired as a primary status value — a pending
// correction is now shown as a small secondary badge (NEEDS_UPDATE_LABEL)
// next to whatever the Job Card's real lifecycle status already is, never as
// a status of its own. See displaySimplifiedStatus below.
export type SimplifiedStatus = "Draft" | "Submitted" | "Approved" | "Active" | "Closed";

// Exported as a plain array (not just the Set below) so Prisma `status: { in: ... }`
// filters elsewhere (dashboard, Job Cards list) can reuse the same source of truth.
// This is the raw-backend "past approval, not yet closed" bucket — used for
// gating (e.g. can materials be received, can a correction still apply), not
// for display grouping. Kept unchanged so every existing caller relying on
// its meaning (canReceive, correction-lookup scope, etc.) is unaffected.
export const OPEN_JOB_CARD_STATUSES = [
  "Approved",
  "Waiting Materials",
  "Partially Issued",
  "Materials Issued",
  "Assigned",
  "In Progress",
];

// backend "Approved" is a real, distinct status (not a display trick) that
// sits between "Under Review" and the materials/assignment/in-progress
// statuses, so it gets its own UI label ("Approved"). Everything past it —
// materials moving, technician assigned, work actually started — collapses
// into "Active". This is OPEN_JOB_CARD_STATUSES minus "Approved".
export const ACTIVE_JOB_CARD_STATUSES = [
  "Waiting Materials",
  "Partially Issued",
  "Materials Issued",
  "Assigned",
  "In Progress",
];

const ACTIVE_BACKEND_STATUSES = new Set(ACTIVE_JOB_CARD_STATUSES);

export function displaySimplifiedStatus(status: string): SimplifiedStatus {
  if (status === "Closed") return "Closed";
  if (status === "Created") return "Draft";
  if (status === "Under Review") return "Submitted";
  if (status === "Approved") return "Approved";
  if (ACTIVE_BACKEND_STATUSES.has(status)) return "Active";
  // Legacy pre-Unit3 statuses — defensive fallback only, no live record can
  // hold these (see chk_work_orders_status), but old reports/exports might.
  return "Active";
}

export function simplifiedStatusTone(status: SimplifiedStatus): "green" | "amber" | "red" | "blue" | "gray" {
  switch (status) {
    case "Draft": return "gray";
    case "Submitted": return "amber";
    case "Approved": return "blue";
    case "Active": return "blue";
    case "Closed": return "green";
  }
}

// A pending Supervisor/Manager correction/clarification never changes the
// Job Card's primary status label above — callers show this as a small,
// separate badge alongside the primary one instead.
export const NEEDS_UPDATE_LABEL = "Needs Update";
export const NEEDS_UPDATE_TONE = "amber";
