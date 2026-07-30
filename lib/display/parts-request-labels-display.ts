// Client-safe half of lib/display/parts-request-labels.ts — pure display
// mapping only, no "server-only" import, so client components (e.g. the Job
// Card quick-view popup) can use the exact same Materials Request status
// wording as every server-rendered page instead of re-deriving their own.
// Mirrors the lib/work-orders/simplified-status.ts /
// simplified-status-display.ts split.

import { OPEN_JOB_CARD_STATUSES } from "@/lib/work-orders/simplified-status-display";

// DB stores canonical status strings (never changed). These map to
// user-facing text only.
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

// ── Job-Card-driven status text ─────────────────────────────────────────────
// Simplified Workflow UI Consistency Cleanup Task 4: a Materials Request's
// user-facing "what's next" text is driven by its LINKED Job Card's status,
// not by any Materials-Request-side "approval" concept — Materials Requests
// are approved implicitly, together with their Job Card
// (approveJobCardAndMaterialsAction), so there is no separate Materials
// Request approval step to describe here.
export type MaterialsRequestJobCardHelper = {
  label: string;
  // Whether the primary action for this request right now is "Receive
  // Materials" (Job Card is Open) as opposed to just waiting.
  canReceive: boolean;
};

export function materialsRequestJobCardHelper(
  jobCardStatus: string | null,
  jobCardHasPendingCorrection: boolean,
  isReceived: boolean
): MaterialsRequestJobCardHelper {
  // Materials Requests Status Wording Simplification: helper text uses
  // plain, simple wording — "Waiting for material" (approved, not yet
  // received), "Material received" (completed), "Job Card not submitted
  // yet" (Draft), "Waiting for Job Card approval" (Submitted).
  if (isReceived) return { label: "Material received", canReceive: false };
  if (!jobCardStatus) return { label: "No linked Job Card", canReceive: false };
  if (jobCardHasPendingCorrection) return { label: "Waiting on Data Entry correction", canReceive: false };
  if (jobCardStatus === "Under Review") return { label: "Waiting for Job Card approval", canReceive: false };
  if (jobCardStatus === "Closed") return { label: "Job Card is closed", canReceive: false };
  if (OPEN_JOB_CARD_STATUSES.includes(jobCardStatus)) return { label: "Waiting for material", canReceive: true };
  // Created (Draft) or anything else not yet submitted for review.
  return { label: "Job Card not submitted yet", canReceive: false };
}

// ── Manager Approval Success Popup and Materials Awaiting Receipt Flow ─────
// Task 4: a short, three-value status word for the badge/KPI/tab surfaces —
// distinct from materialsRequestJobCardHelper's longer "what's next"
// sentence above, which still drives the banner/helper text. Built directly
// on top of that same helper's canReceive signal so the two never disagree
// about when a request counts as ready to receive. Display mapping only —
// the underlying parts_requests.status value (Requested/Approved/Waiting
// Stock/Partially Issued/Issued) is never changed.
//
// Materials Requests Status Wording Simplification: the middle and completed
// values' labels changed from "To Receive"/"Received" to "Pending"/"Completed"
// (plain request-completion wording) — this is the literal display string
// (the type IS the label), so this one edit propagates everywhere the
// function's return value is rendered directly. Every call site that
// separately compared a result against the literal "To Receive"/"Received"
// strings was updated alongside this change. "Requested" (linked Job Card
// not yet approved) is unchanged.
export type MaterialsReceiptStatus = "Requested" | "Pending" | "Completed";

export function materialsReceiptStatus(
  prStatus: string,
  jobCardStatus: string | null,
  jobCardHasPendingCorrection: boolean
): MaterialsReceiptStatus {
  const isReceived = displayPartsRequestStatus(prStatus) === "Issued";
  if (isReceived) return "Completed";
  const helper = materialsRequestJobCardHelper(jobCardStatus, jobCardHasPendingCorrection, false);
  return helper.canReceive ? "Pending" : "Requested";
}

export function materialsReceiptStatusTone(status: MaterialsReceiptStatus): "green" | "amber" | "gray" {
  switch (status) {
    case "Completed":
      return "green";
    case "Pending":
      return "amber";
    case "Requested":
      return "gray";
  }
}
