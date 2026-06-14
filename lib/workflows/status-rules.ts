export type WorkflowEntity = "work_order" | "parts_request" | "purchase_request";

const transitions: Record<WorkflowEntity, Record<string, string[]>> = {
  work_order: {
    Draft: ["Submitted", "Pending Approval", "Cancelled"],
    Submitted: ["Pending Approval", "Cancelled"],
    "Pending Approval": ["Approved", "Rejected", "Cancelled"],
    Approved: ["Assigned", "Cancelled"],
    Assigned: ["In Progress", "Waiting for Parts", "Cancelled"],
    "In Progress": ["Waiting for Parts", "Completed by Technician", "Cancelled"],
    "Waiting for Parts": ["Parts Issued", "Waiting for Purchase", "In Progress", "Cancelled"],
    "Waiting for Purchase": ["Parts Issued", "Cancelled"],
    "Parts Issued": ["In Progress", "Completed by Technician", "Cancelled"],
    "Completed by Technician": ["Verified by Supervisor", "Reopened"],
    "Verified by Supervisor": ["Confirmed by Requester", "Closed", "Reopened"],
    "Confirmed by Requester": ["Closed", "Reopened"],
    Closed: ["Reopened"],
    Rejected: ["Draft", "Reopened"],
    Reopened: ["Pending Approval", "Assigned", "Cancelled"],
    Cancelled: ["Reopened"]
  },
  parts_request: {
    Draft: ["Submitted", "Pending Approval", "Cancelled"],
    Submitted: ["Pending Approval", "Cancelled"],
    "Pending Approval": ["Waiting for Store", "Approved", "Rejected", "Cancelled"],
    Approved: ["Waiting for Store", "Rejected", "Cancelled"],
    "Waiting for Store": ["Partially Issued", "Issued", "Waiting for Purchase", "Cancelled"],
    "Partially Issued": ["Issued", "Waiting for Purchase", "Closed", "Cancelled"],
    Issued: ["Closed"],
    "Waiting for Purchase": ["Partially Issued", "Issued", "Closed", "Cancelled"],
    Rejected: ["Draft"],
    Closed: [],
    Cancelled: []
  },
  purchase_request: {
    Draft: ["Submitted", "Pending Purchase", "Pending Finance Approval", "Pending CEO Approval", "Cancelled"],
    Submitted: ["Pending Purchase", "Pending Finance Approval", "Pending CEO Approval", "Rejected", "Cancelled"],
    "Pending Purchase": ["Approved", "Ordered", "Pending Finance Approval", "Pending CEO Approval", "Rejected", "Cancelled"],
    "Pending Finance Approval": ["Pending CEO Approval", "Approved", "Rejected", "Cancelled"],
    "Pending CEO Approval": ["Approved", "Rejected", "Cancelled"],
    Approved: ["Ordered", "Received", "Cancelled"],
    Ordered: ["Received", "Cancelled"],
    Received: [],
    Rejected: [],
    Cancelled: []
  }
};

export function canTransition(entity: WorkflowEntity, fromStatus: string | null | undefined, toStatus: string) {
  if (!fromStatus || fromStatus === toStatus) return true;
  return transitions[entity][fromStatus]?.includes(toStatus) ?? false;
}

export function transitionError(entity: WorkflowEntity, fromStatus: string | null | undefined, toStatus: string) {
  const label = entity.replaceAll("_", " ");
  return `Cannot move ${label} from ${fromStatus ?? "unknown"} to ${toStatus}.`;
}
