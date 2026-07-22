// Display label overrides for work order statuses and actions.
// DB stores canonical status strings (never changed). These map to user-facing text only.
//
// Maintenance Workflow Redesign Unit 3: the canonical status IS now the
// simplified user-facing label (Created, Under Review, Approved, Waiting
// Materials, Partially Issued, Materials Issued, Assigned, In Progress,
// Closed) — no lookup needed for current values, they fall through to the
// `status` default below. LEGACY_STATUS_LABELS exists only to keep old
// pre-Unit3 status strings (no longer valid per chk_work_orders_status, but
// possibly still present in historical reports/exports/production data not
// yet migrated) from rendering as a raw internal string.
const LEGACY_STATUS_LABELS: Record<string, string> = {
  Draft: "Created",
  Submitted: "Under Review",
  "Pending Approval": "Under Review",
  Rejected: "Under Review",
  Reopened: "Under Review",
  "Waiting for Parts": "Waiting Materials",
  "Waiting for Purchase": "Waiting Materials",
  "Parts Issued": "Materials Issued",
  "Completed by Technician": "Closed",
  "Verified by Supervisor": "Closed",
  "Confirmed by Requester": "Closed",
  Cancelled: "Closed",
};

export function displayStatus(status: string): string {
  return LEGACY_STATUS_LABELS[status] ?? status;
}

export function displayNextAction(status: string, canAct: boolean): string {
  switch (status) {
    case "Created":            return "Send for review";
    case "Under Review":       return canAct ? "Review job card" : "Awaiting review";
    case "Approved":           return canAct ? "Request materials or assign" : "Awaiting materials or assignment";
    case "Waiting Materials":  return canAct ? "Issue materials" : "Awaiting materials";
    case "Partially Issued":   return canAct ? "Issue remaining materials or assign" : "Awaiting materials or assignment";
    case "Materials Issued":   return canAct ? "Assign technician" : "Awaiting assignment";
    case "Assigned":           return "Technician to start";
    case "In Progress":        return canAct ? "Close job card" : "Job in progress";
    case "Closed":             return "Closed";
    // Legacy pre-Unit3 statuses — defensive fallback only, see LEGACY_STATUS_LABELS above.
    case "Draft":                   return "Send for review";
    case "Submitted":
    case "Pending Approval":        return canAct ? "Review job card" : "Awaiting review";
    case "Rejected":                return "Needs correction";
    case "Waiting for Parts":
    case "Waiting for Purchase":    return canAct ? "Issue materials" : "Awaiting materials";
    case "Parts Issued":            return canAct ? "Assign technician" : "Awaiting assignment";
    case "Completed by Technician":
    case "Verified by Supervisor":
    case "Confirmed by Requester":  return canAct ? "Close job card" : "Awaiting closure";
    case "Cancelled":               return "Closed";
    default:                        return status;
  }
}
