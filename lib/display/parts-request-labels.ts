// Display label overrides for materials request statuses.
// DB stores canonical status strings (never changed). These map to user-facing text only.

export function displayPartsRequestStatus(status: string): string {
  switch (status) {
    case "Pending Approval":
    case "Waiting for Store":
    case "Waiting for Purchase":
      return "Requested";
    case "Partially Issued":
      return "Partially Received";
    case "Issued":
    case "Closed":
      return "Received";
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
    case "Pending Approval":
    case "Waiting for Store":
    case "Waiting for Purchase":
    case "Partially Issued":
      return "amber";
    case "Rejected":
    case "Cancelled":
      return "red";
    default:
      return "gray";
  }
}

// Statuses that indicate an open / unresolved materials request.
export const OPEN_PR_STATUSES: string[] = [
  "Pending Approval",
  "Waiting for Store",
  "Waiting for Purchase",
  "Partially Issued",
];
