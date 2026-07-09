// Display label overrides for work order statuses and actions.
// DB stores canonical status strings (never changed). These map to user-facing text only.

export function displayStatus(status: string): string {
  const map: Record<string, string> = {
    "Pending Approval":        "Submitted",
    "Approved":                "Ready to Assign",
    "Waiting for Purchase":    "Waiting for Parts",
    "Parts Issued":            "In Progress",
    "Completed by Technician": "Completed",
    "Verified by Supervisor":  "Pending Closure",
    "Confirmed by Requester":  "Pending Closure",
  };
  return map[status] ?? status;
}

export function displayNextAction(status: string, canAct: boolean): string {
  switch (status) {
    case "Draft":                   return "Submit repair order";
    case "Submitted":
    case "Pending Approval":        return canAct ? "Proceed to assignment" : "Awaiting assignment";
    case "Rejected":                return "Needs correction";
    case "Approved":                return canAct ? "Assign technician" : "Awaiting assignment";
    case "Assigned":                return "Technician to start";
    case "In Progress":             return "Job in progress";
    case "Waiting for Parts":       return canAct ? "Issue parts" : "Awaiting parts";
    case "Waiting for Purchase":    return canAct ? "Process parts order" : "Awaiting parts";
    case "Parts Issued":            return "Resume work";
    case "Completed by Technician": return canAct ? "Close repair order" : "Awaiting closure";
    case "Verified by Supervisor":
    case "Confirmed by Requester":  return canAct ? "Close repair order" : "Awaiting closure";
    case "Closed":                  return "Closed";
    case "Cancelled":               return "Cancelled";
    default:                        return status;
  }
}
