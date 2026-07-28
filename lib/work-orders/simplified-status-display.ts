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
export type SimplifiedStatus = "Draft" | "Submitted" | "Correction Requested" | "Open" | "Closed";

// Exported as a plain array (not just the Set below) so Prisma `status: { in: ... }`
// filters elsewhere (dashboard, Job Cards list) can reuse the same source of truth.
export const OPEN_JOB_CARD_STATUSES = [
  "Approved",
  "Waiting Materials",
  "Partially Issued",
  "Materials Issued",
  "Assigned",
  "In Progress",
];

const OPEN_BACKEND_STATUSES = new Set(OPEN_JOB_CARD_STATUSES);

export function displaySimplifiedStatus(status: string, hasPendingCorrection: boolean): SimplifiedStatus {
  if (status === "Closed") return "Closed";
  // A pending correction (unresolved maintenance_manager_review
  // clarification) always displays as "Correction Requested", regardless of
  // whether the backend status has since moved past "Under Review" — a Job
  // Card must never silently hide an outstanding ask from Data Entry just
  // because some other part of it (e.g. materials) already progressed.
  if (hasPendingCorrection) return "Correction Requested";
  if (status === "Created") return "Draft";
  if (status === "Under Review") return "Submitted";
  if (OPEN_BACKEND_STATUSES.has(status)) return "Open";
  // Legacy pre-Unit3 statuses — defensive fallback only, no live record can
  // hold these (see chk_work_orders_status), but old reports/exports might.
  return "Open";
}

export function simplifiedStatusTone(status: SimplifiedStatus): "green" | "amber" | "red" | "blue" | "gray" {
  switch (status) {
    case "Draft": return "gray";
    case "Submitted": return "amber";
    case "Correction Requested": return "red";
    case "Open": return "blue";
    case "Closed": return "green";
  }
}
