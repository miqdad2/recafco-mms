// Display label overrides for work order statuses and actions.
// DB stores canonical status strings (never changed). These map to user-facing text only.

export function displayStatus(status: string): string {
  const map: Record<string, string> = {
    "Pending Approval":        "Manager Review",
    "Approved":                "Ready to Assign",
    "Waiting for Parts":       "Waiting Materials",
    "Waiting for Purchase":    "Waiting Materials",
    "Parts Issued":            "In Progress",
    "Completed by Technician": "Completed",
    "Verified by Supervisor":  "Pending Closure",
    "Confirmed by Requester":  "Pending Closure",
    "Rejected":                "Returned for Fix",
  };
  return map[status] ?? status;
}

export function displayNextAction(status: string, canAct: boolean): string {
  switch (status) {
    case "Draft":                   return "Submit job card";
    case "Submitted":
    case "Pending Approval":        return canAct ? "Proceed to assignment" : "Awaiting assignment";
    case "Rejected":                return "Needs correction";
    case "Approved":                return canAct ? "Assign technician" : "Awaiting assignment";
    case "Assigned":                return "Technician to start";
    case "In Progress":             return "Job in progress";
    case "Waiting for Parts":       return canAct ? "Issue materials" : "Awaiting materials";
    case "Waiting for Purchase":    return canAct ? "Process materials order" : "Awaiting materials";
    case "Parts Issued":            return "Resume work";
    case "Completed by Technician": return canAct ? "Close job card" : "Awaiting closure";
    case "Verified by Supervisor":
    case "Confirmed by Requester":  return canAct ? "Close job card" : "Awaiting closure";
    case "Closed":                  return "Closed";
    case "Cancelled":               return "Cancelled";
    default:                        return status;
  }
}
