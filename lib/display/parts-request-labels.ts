// Display label overrides for materials request statuses.
// DB stores canonical status strings (never changed). These map to user-facing text only.
//
// Maintenance Workflow Redesign Unit 3: canonical statuses are now the
// simplified 5-value set (Requested, Approved, Waiting Stock, Partially
// Issued, Issued) — status IS the display label, so current values fall
// through to the `status` default below. The legacy branches (Draft,
// Submitted, Pending Approval, Waiting for Store, Waiting for Purchase,
// Rejected, Closed, Cancelled) are no longer valid per
// chk_parts_requests_status but are kept as a defensive fallback for
// historical reports/exports/production data not yet migrated.

export function displayPartsRequestStatus(status: string): string {
  switch (status) {
    case "Requested":
    case "Approved":
    case "Waiting Stock":
    case "Partially Issued":
    case "Issued":
      return status;
    // Legacy pre-Unit3 statuses — defensive fallback only.
    case "Draft":
    case "Submitted":
    case "Pending Approval":
      return "Requested";
    case "Waiting for Purchase":
      return "Waiting Stock";
    case "Waiting for Store":
      return "Approved";
    case "Closed":
      return "Issued";
    case "Rejected":
      return "Requested";
    case "Cancelled":
      return "Issued";
    default:
      return status;
  }
}

// Data Entry Dashboard and Job Cards UX Simplification Task 5: a compact
// "Materials <Status>" badge label — e.g. "Materials Requested", "Materials
// Approved" — instead of the shorter, less-clear "Materials: Requested"
// colon form. "Waiting Stock" reads as "Waiting for Materials" (matches the
// wording already used elsewhere for this same state), everything else is a
// direct "Materials " + status concatenation.
export function materialsRequestBadgeLabel(status: string): string {
  const display = displayPartsRequestStatus(status);
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
// Materials Request list/dashboard simplification: the list page (cards,
// tabs, row status badge) groups Waiting Stock + Partially Issued into one
// "Store Follow-up" bucket so daily users aren't exposed to internal Store
// states — Store will arrange/update materials, so this reads as a
// follow-up queue rather than a technical stock state. The real 5-value
// status is untouched in the database and is still shown as-is everywhere
// else (detail page, quick-view previews, exports) via
// displayPartsRequestStatus/partsRequestStatusTone above.

export type MaterialsRequestListGroup = "Requested" | "Approved" | "Store Follow-up" | "Issued";

// Expects an already-normalized display status (i.e. the output of
// displayPartsRequestStatus), so legacy pre-Unit3 values are handled once,
// in one place, rather than duplicated here.
export function materialsRequestListGroup(displayStatusValue: string): MaterialsRequestListGroup {
  switch (displayStatusValue) {
    case "Waiting Stock":
    case "Partially Issued":
      return "Store Follow-up";
    case "Approved":
      return "Approved";
    case "Issued":
      return "Issued";
    default:
      return "Requested";
  }
}

export function materialsRequestListGroupTone(
  group: MaterialsRequestListGroup
): "green" | "amber" | "blue" | "gray" {
  switch (group) {
    case "Issued":
      return "green";
    case "Approved":
      return "blue";
    default:
      return "amber";
  }
}

// Small helper text shown only under the "Store Follow-up" badge — explains
// why without exposing the raw backend status word on the list page.
export function materialsRequestStoreFollowUpHint(status: string): string | null {
  if (status === "Waiting Stock") return "Store arranging materials";
  if (status === "Partially Issued") return "Store updating materials";
  return null;
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
