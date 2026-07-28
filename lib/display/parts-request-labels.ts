import "server-only";

export type { MaterialsRequestJobCardHelper, MaterialsReceiptStatus } from "@/lib/display/parts-request-labels-display";
export {
  displayPartsRequestStatus,
  materialsRequestJobCardHelper,
  materialsReceiptStatus,
  materialsReceiptStatusTone,
} from "@/lib/display/parts-request-labels-display";

// Display label overrides for materials request statuses.
// DB stores canonical status strings (never changed). These map to user-facing text only.

// Data Entry Dashboard and Job Cards UX Simplification Task 5: a compact
// "Materials <Status>" badge label — e.g. "Materials Requested", "Materials
// Approved" — instead of the shorter, less-clear "Materials: Requested"
// colon form. "Waiting Stock" reads as "Waiting for Materials" (matches the
// wording already used elsewhere for this same state), everything else is a
// direct "Materials " + status concatenation.
import { displayPartsRequestStatus as _displayPartsRequestStatus } from "@/lib/display/parts-request-labels-display";

export function materialsRequestBadgeLabel(status: string): string {
  const display = _displayPartsRequestStatus(status);
  if (display === "Waiting Stock") return "Waiting for Materials";
  return `Materials ${display}`;
}

export function partsRequestStatusTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  switch (status) {
    case "Issued":
      return "green";
    case "Approved":
    case "Partially Issued":
      return "blue";
    case "Requested":
    case "Waiting Stock":
      return "amber";
    // Legacy pre-Unit3 statuses — defensive fallback only.
    case "Draft":
    case "Submitted":
    case "Pending Approval":
      return "amber";
    case "Waiting for Purchase":
      return "amber";
    case "Waiting for Store":
      return "blue";
    case "Closed":
      return "green";
    case "Rejected":
    case "Cancelled":
      return "red";
    default:
      return "gray";
  }
}

// ── Materials Request LIST-PAGE grouping ────────────────────────────────────
// Simplified Workflow Correction Unit Task 3: the list page (cards, tabs,
// row status badge) groups the real 5-value status into just 2 user-facing
// states — Requested (not yet fully received: Requested/Approved/Waiting
// Stock/Partially Issued) and Received (Issued) — Store is removed from the
// active workflow, so no Store-specific wording is shown here. The real
// 5-value status is untouched in the database and is still shown as-is
// elsewhere (detail page, quick-view previews, exports) via
// displayPartsRequestStatus/partsRequestStatusTone above.

export type MaterialsRequestListGroup = "Requested" | "Received";

// Expects an already-normalized display status (i.e. the output of
// displayPartsRequestStatus), so legacy pre-Unit3 values are handled once,
// in one place, rather than duplicated here.
export function materialsRequestListGroup(displayStatusValue: string): MaterialsRequestListGroup {
  return displayStatusValue === "Issued" ? "Received" : "Requested";
}

export function materialsRequestListGroupTone(
  group: MaterialsRequestListGroup
): "green" | "amber" | "blue" | "gray" {
  return group === "Received" ? "green" : "amber";
}

// Statuses that mean "the job doesn't have the material in hand yet" — a
// request that's merely Requested, Approved, or Waiting Stock still counts
// as the job "waiting for materials". Used for dashboard Waiting Materials
// counts and list "open" grouping.
export const OPEN_PR_STATUSES: string[] = [
  "Requested",
  "Approved",
  "Waiting Stock",
  "Partially Issued",
  // Legacy pre-Unit3 statuses — defensive fallback only.
  "Draft",
  "Submitted",
  "Pending Approval",
  "Waiting for Purchase",
  "Waiting for Store",
];
