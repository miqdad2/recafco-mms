export type WorkflowEntity = "work_order" | "parts_request" | "purchase_request";

const transitions: Record<WorkflowEntity, Record<string, string[]>> = {
  // Maintenance Workflow Redesign Unit 3 — simplified 9-status Job Card model.
  // No Draft/Submitted/Pending Approval/Rejected/Cancelled/Reopened/Completed
  // variants: corrections keep the record at "Under Review" (audit note only,
  // see lib/audit/log.ts callers), and closing is a single terminal step from
  // any in-flight status a caller reaches it from.
  // Simplified Job Card Approval Workflow Unit: Approved/Materials
  // Issued/Assigned can now go straight to In Progress/Closed — the
  // simplified flow has no required Store-issue/technician-assignment step,
  // so a Job Card can be worked on and closed directly from "Approved"
  // (displayed as "Open"). Additive only — every transition that was valid
  // before is still valid, so the old multi-step flow (Store, assignment)
  // keeps working exactly as it did for any in-flight record using it.
  // Approval Workflow Unit 4 — Closure Approval Only: no Manager approval
  // before starting a Job Card any more (Created now goes straight to
  // Approved/"Active" — see submitWorkOrder() in
  // lib/backend/work-orders/service.ts). "Under Review" stays in the map
  // only for backward compatibility with any pre-existing row still sitting
  // there; no new record reaches it going forward. Manager approval is now
  // required only to close — every "Active"-bucket status can move to the
  // new "Closure Requested" status (Data Entry requesting closure) in
  // addition to the existing direct "Closed" target (Manager closing
  // directly) — additive only, every transition valid before is still valid.
  work_order: {
    Created: ["Under Review", "Approved"],
    "Under Review": ["Approved", "Under Review"],
    Approved: ["Waiting Materials", "Partially Issued", "Materials Issued", "Assigned", "In Progress", "Closed", "Closure Requested"],
    "Waiting Materials": ["Partially Issued", "Materials Issued", "In Progress", "Closed", "Closure Requested"],
    "Partially Issued": ["Partially Issued", "Materials Issued", "Assigned", "In Progress", "Closed", "Closure Requested"],
    "Materials Issued": ["Assigned", "In Progress", "Closed", "Closure Requested"],
    Assigned: ["In Progress", "Assigned", "Closed", "Closure Requested"],
    "In Progress": ["Closed", "Assigned", "Closure Requested"],
    "Closure Requested": ["Closed"],
    Closed: []
  },
  // Simplified 5-status Materials Request model. "Issued" is terminal — no
  // Rejected/Cancelled/Closed/Returned; corrections keep the record at its
  // current status with an audit note instead of a status change.
  parts_request: {
    Requested: ["Approved", "Requested"],
    Approved: ["Waiting Stock", "Partially Issued", "Issued"],
    "Waiting Stock": ["Partially Issued", "Issued"],
    "Partially Issued": ["Partially Issued", "Issued"],
    Issued: []
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

// Enterprise Error Handling Audit Unit Task 10: this message reaches users
// verbatim via AppError.safeMessage — it was rendering "work order"/"parts
// request" (entity.replaceAll("_", " ")), the exact old wording every prior
// unit removed from user-facing text. Keeps the concrete from/to statuses
// (more actionable than a vague "not allowed at this stage") but with the
// current company-facing entity names.
const ENTITY_LABELS: Record<WorkflowEntity, string> = {
  work_order: "Job Card",
  parts_request: "Materials Request",
  purchase_request: "purchase request"
};

export function transitionError(entity: WorkflowEntity, fromStatus: string | null | undefined, toStatus: string) {
  const label = ENTITY_LABELS[entity];
  return `Cannot move ${label} from ${fromStatus ?? "unknown"} to ${toStatus}.`;
}
