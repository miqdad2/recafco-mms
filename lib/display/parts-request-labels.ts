// Display label overrides for materials request statuses.
// DB stores canonical status strings (never changed). These map to user-facing text only.
//
// Simple 4-state model (MaterialsRequest-DataEntryReceiveIssue-01 Task 2):
// Requested -> Received -> Issued, with Cancelled/Rejected as terminal side
// states. "Waiting for Store" is an existing, otherwise-unused DB status
// value repurposed here to mean "received into the Maintenance Store, not
// yet issued" — no schema change needed since it was already an allowed
// value with zero live rows using it.

export function displayPartsRequestStatus(status: string): string {
  switch (status) {
    case "Draft":
    case "Submitted":
    case "Pending Approval":
    case "Waiting for Purchase":
      return "Requested";
    case "Waiting for Store":
    case "Partially Issued":
      return "Received";
    case "Issued":
    case "Closed":
      return "Issued";
    case "Rejected":
      return "Rejected";
    case "Cancelled":
      return "Cancelled";
    default:
      return status;
  }
}

export function partsRequestStatusTone(status: string): "green" | "amber" | "red" | "blue" | "gray" {
  switch (status) {
    case "Issued":
    case "Closed":
      return "green";
    case "Waiting for Store":
    case "Partially Issued":
      return "blue";
    case "Draft":
    case "Submitted":
    case "Pending Approval":
    case "Waiting for Purchase":
      return "amber";
    case "Rejected":
    case "Cancelled":
      return "red";
    default:
      return "gray";
  }
}

// Statuses that mean "the job doesn't have the material in hand yet" — a
// request that's merely Requested OR Received-but-not-issued both still
// count as the job "waiting for materials". Used for dashboard Waiting
// Materials counts and list "open" grouping.
export const OPEN_PR_STATUSES: string[] = [
  "Draft",
  "Submitted",
  "Pending Approval",
  "Waiting for Purchase",
  "Waiting for Store",
  "Partially Issued",
];
