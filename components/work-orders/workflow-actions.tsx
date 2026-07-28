import Link from "next/link";
import {
  approveJobCardAndMaterialsAction,
  closeWorkOrderAction,
  markExternalWorkCompletedAction,
  requestClarificationAction,
  startJobCardProgressAction,
  submitWorkOrderAction
} from "@/app/actions/workflow";
import { AssignmentForm } from "@/components/work-orders/assignment-form";
import { Button } from "@/components/ui/button";
import type { CurrentUserContext } from "@/lib/auth/context";
import type { PermissionKey } from "@/types/database";

type Technician = { id: string; full_name: string };

type CurrentAssignment = {
  type: string;
  externalName?: string | null;
  externalCompany?: string | null;
} | null;

// Data Entry Job Card Action Clarity Fix Task 3: the Job Card's current
// active Materials Request (if any), so the Quick actions link here can tell
// "nothing requested yet" apart from "one is already open" instead of always
// offering Request Materials.
type ActiveMaterialsRequest = { id: string; number: string | null; status: string } | null;

type WorkflowActionsProps = {
  workOrderId: string;
  status: string;
  context: CurrentUserContext;
  technicians: Technician[];
  currentAssignment?: CurrentAssignment;
  activeMaterialsRequest?: ActiveMaterialsRequest;
  // Simplified Workflow UI Consistency Cleanup Task 3: whether this Job Card
  // has an unresolved correction request right now — suppresses every normal
  // status action below so the page's correction banner (with its own
  // Submit Response / Resubmit action) is the one clear thing to do,
  // regardless of what the raw status would otherwise allow.
  hasPendingCorrection?: boolean;
};

function can(context: CurrentUserContext, permission: PermissionKey) {
  return context.role?.slug === "super_admin" || context.permissions.includes(permission);
}

// "Closed" is the only terminal status in the simplified model (Unit 4).
const TERMINAL = ["Closed"];

// Maintenance Workflow Redesign Unit 4: current (simplified) statuses first;
// legacy pre-Unit3/4 statuses kept below as a defensive fallback only — no Job
// Card can reach them anymore, but old reports/exports may still reference them.
function getStepContext(status: string): { title: string; description: string } | null {
  switch (status) {
    case "Created":
      return { title: "Created", description: "Fill in all details and send for review when ready." };
    case "Under Review":
      return { title: "Under Review", description: "Awaiting Supervisor / Manager review and approval." };
    case "Approved":
      return { title: "Approved", description: "Approved and awaiting materials or technician assignment." };
    case "Waiting Materials":
      return { title: "Waiting Materials", description: "On hold while materials are sourced from the store." };
    case "Partially Issued":
      return { title: "Partially Issued", description: "Some materials issued — remainder pending from the store." };
    case "Materials Issued":
      return { title: "Materials Issued", description: "Materials issued and awaiting technician assignment." };
    case "Assigned":
      return { title: "Technician Assigned", description: "Work will begin once the technician starts the job." };
    case "In Progress":
      return { title: "Work In Progress", description: "The technician is actively working on this job card." };
    case "Closed":
      return { title: "Closed", description: "This job card has been completed and closed." };
    // Legacy — defensive fallback only.
    case "Draft":
      return { title: "Draft", description: "Fill in all details and submit when ready." };
    case "Submitted":
    case "Pending Approval":
      return { title: "Awaiting Manager Review", description: "The Maintenance Manager will review and assign a technician." };
    case "Parts Issued":
      return { title: "Parts Issued", description: "Parts have been issued. Technician continuing work." };
    case "Waiting for Parts":
    case "Waiting for Purchase":
      return { title: "Waiting for Materials", description: "On hold while materials are sourced or procured." };
    case "Completed by Technician":
    case "Verified by Supervisor":
    case "Confirmed by Requester":
      return { title: "Awaiting Closure", description: "Work reported complete — waiting to be closed." };
    case "Rejected":
      return { title: "Returned for Fix", description: "This status is no longer used — see Correction notes on the timeline." };
    case "Cancelled":
      return { title: "Cancelled", description: "This job card was cancelled under the previous workflow." };
    case "Reopened":
      return { title: "Reopened", description: "This job card has been reopened and is awaiting action." };
    default:
      return null;
  }
}

export function WorkflowActions({ workOrderId, status, context, technicians, currentAssignment, activeMaterialsRequest, hasPendingCorrection = false }: WorkflowActionsProps) {
  const canSubmit  = can(context, "work_orders.manage") && status === "Created";
  const canApprove = can(context, "work_orders.approve") && status === "Under Review" && !hasPendingCorrection;
  // Correction requests are only meaningful while a Job Card is Under Review
  // and no correction is already pending — this now uses
  // work_orders.request_correction (Engineer + Manager), not
  // work_orders.approve (Manager only), per the Unit 3 permission grants.
  const canRequestCorrection = can(context, "work_orders.request_correction") && status === "Under Review" && !hasPendingCorrection;
  // Assignment (and reassignment) is available once materials are resolved or
  // not needed, and while work is still open — matches the Unit 3 transition
  // map. Unified Manager Job Card + Materials Approval Flow Fix Task 4: the
  // status list alone never actually checked whether materials were
  // resolved — a Job Card could be "Approved" with its Materials Request
  // still sitting Requested and this would still offer Assign Work. Now
  // requires no active (in-progress) Materials Request at all, matching the
  // same gate applied to the quick-view popup's Assign Work button.
  const canAssign =
    !hasPendingCorrection &&
    (can(context, "work_orders.approve") || can(context, "work_orders.assign")) &&
    ["Approved", "Partially Issued", "Materials Issued", "Assigned", "In Progress"].includes(status) &&
    (status === "Assigned" || status === "In Progress" || !activeMaterialsRequest);
  // Simplified Job Card Approval Workflow Unit Task 4: Close is now available
  // directly from any "Open"-bucket status (Approved/Waiting Materials/
  // Partially Issued/Materials Issued/Assigned/In Progress), matching the
  // widened transitions.work_order map in lib/workflows/status-rules.ts — the
  // simplified flow has no required Store-issue/assignment step before work
  // can be closed.
  const canClose =
    !hasPendingCorrection &&
    can(context, "work_orders.close") &&
    ["Approved", "Waiting Materials", "Partially Issued", "Materials Issued", "Assigned", "In Progress"].includes(status);
  // Data Entry Job Card Action Clarity Fix Task 4: the same generic (non-
  // technician) Assigned -> In Progress step already offered in the quick-view
  // (Data Entry Job Card Progress Update and Close Action Unit) was missing
  // here on the Full Details page — Technician keeps its own separate,
  // assignment-checked Start Work/Mark Completed flow on /technician/jobs.
  const isTechnician = context.role?.slug === "technician";
  const isExternalAssignment =
    currentAssignment?.type === "FREELANCER" || currentAssignment?.type === "EXTERNAL_COMPANY" || currentAssignment?.type === "OTHER";
  // Excludes external assignments — those already have a direct "Mark
  // External Work Completed" shortcut from Assigned straight to Closed below,
  // so this generic step would otherwise offer a redundant second button.
  const canStartProgress =
    !hasPendingCorrection && !isTechnician && !isExternalAssignment && can(context, "work_orders.update") && status === "Assigned";

  const canMarkExternalComplete =
    !hasPendingCorrection &&
    can(context, "work_orders.close") &&
    ["Assigned", "In Progress"].includes(status) &&
    isExternalAssignment;

  const hasActions =
    canSubmit || canApprove || canRequestCorrection || canAssign || canClose ||
    canMarkExternalComplete || canStartProgress;

  // Data Entry Job Card Action Clarity Fix Task 3: a Job Card can only ever
  // have one active Materials Request at a time — offering "Request
  // Materials" while one is already open just fails with a duplicate-request
  // error, so show a read-only "View Materials Request" link instead.
  const materialsQuickAction = activeMaterialsRequest ? (
    <Link
      href={`/store/parts-requests/${activeMaterialsRequest.id}`}
      className="text-sm font-bold text-[#ED1C24] hover:underline"
    >
      View Materials Request ({activeMaterialsRequest.number ?? activeMaterialsRequest.status}) →
    </Link>
  ) : null;

  if (!hasActions) {
    // Data Entry Job Card Action Clarity Fix Task 4: Under Review gets its
    // own explicit explanation instead of the generic step description —
    // only roles without work_orders.approve/request_correction ever reach
    // this branch while Under Review, so this always means "not your turn
    // yet", not "nothing will ever happen here".
    const canActLaterOnApproval =
      can(context, "work_orders.assign") || can(context, "work_orders.update") || can(context, "work_orders.close");
    // Unified Manager Job Card + Materials Approval Flow Fix Task 4: a Job
    // Card that would otherwise be assignable (Approved/Partially Issued/
    // Materials Issued) but is blocked by an active Materials Request gets
    // its own explicit message, instead of the generic "awaiting materials
    // or technician assignment" step text.
    const ctx =
      hasPendingCorrection
        ? {
            title: "Correction Requested — Waiting on Data Entry.",
            description: "See the correction request above for what needs to change and to respond.",
          }
        : status === "Under Review"
          ? {
              title: "Waiting for Supervisor / Manager review.",
              description: canActLaterOnApproval
                ? "You can assign/start/close after approval."
                : "No update available until approval.",
            }
          : activeMaterialsRequest && ["Approved", "Partially Issued", "Materials Issued"].includes(status)
            ? {
                title: "Waiting for materials before assignment.",
                description: `${activeMaterialsRequest.number ?? "The Materials Request"} must be received before this Job Card can be assigned.`,
              }
            : getStepContext(status);
    if (!ctx) return null;
    const canCreatePartsRequest =
      can(context, "parts_requests.create") || can(context, "work_orders.manage");
    const isActive = !TERMINAL.includes(status);
    return (
      <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Current Action</p>
        <p className="mt-2 text-sm font-black text-[#111827]">{ctx.title}</p>
        <p className="mt-1 text-sm leading-5 text-[#4B5563]">{ctx.description}</p>
        {!hasPendingCorrection && (materialsQuickAction || (canCreatePartsRequest && isActive)) ? (
          <div className="mt-4 border-t border-[#E5E7EB] pt-3">
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Quick actions</p>
            {materialsQuickAction ?? (
              <Link
                href={`/store/parts-requests/new?repair_order_id=${workOrderId}`}
                className="text-sm font-bold text-[#ED1C24] hover:underline"
              >
                Request materials →
              </Link>
            )}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Current Action</p>
      <div className="mt-4 grid gap-3">

        {/* Created — submit for review */}
        {canSubmit ? (
          <form action={submitWorkOrderAction}>
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <Button type="submit" className="w-full">Submit Job Card</Button>
          </form>
        ) : null}

        {/* Under Review — Supervisor / Manager approves and opens. Simplified
            Job Card Approval Workflow Unit Task 4: uses the combined
            approve-Job-Card-and-materials action (already existed for the
            quick-view) so any linked Requested Materials Request is approved
            in the same step — no separate Materials Request approval task. */}
        {canApprove ? (
          <form action={approveJobCardAndMaterialsAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <p className="text-xs text-[#6B7280]">
              {activeMaterialsRequest?.status === "Requested"
                ? "This will approve the Job Card and requested materials. Materials will be marked as Awaiting Receipt."
                : "This will approve the Job Card and make it Open."}
            </p>
            <textarea
              className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              name="comments"
              placeholder="Approval notes (optional)"
            />
            <Button type="submit" className="w-full">Approve</Button>
          </form>
        ) : null}

        {/* Data Entry / Engineer / Manager — generic Start Work (Assigned -> In
            Progress). Technician keeps its own separate, assignment-checked
            flow on /technician/jobs; external assignments use the direct
            "Mark External Work Completed" shortcut below instead. */}
        {canStartProgress ? (
          <form action={startJobCardProgressAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <textarea
              className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              name="note"
              placeholder="Progress note (optional)"
            />
            <Button type="submit" className="w-full">Mark Work Started</Button>
          </form>
        ) : null}

        {/* Manager / Engineer — assign or reassign (internal / freelancer / external company / other) */}
        {canAssign ? (
          <div className="space-y-3 rounded-md border border-[#E5E7EB] bg-gray-50 p-4">
            <p className="text-sm font-black text-[#111827]">{status === "Assigned" || status === "In Progress" ? "Reassign Work" : "Assign Work"}</p>
            <AssignmentForm workOrderId={workOrderId} technicians={technicians} />
          </div>
        ) : null}

        {/* Manager/Engineer/Data Entry — mark external work completed (closes directly) */}
        {canMarkExternalComplete ? (
          <div className="space-y-3 rounded-md border border-[#E5E7EB] bg-blue-50 p-4">
            <div>
              <p className="text-sm font-black text-[#1D4ED8]">Mark External Work Completed</p>
              <p className="mt-1 text-xs text-[#1D4ED8]">
                Confirm that the{" "}
                {currentAssignment?.type === "FREELANCER"
                  ? `freelancer (${currentAssignment.externalName ?? ""})`
                  : currentAssignment?.type === "EXTERNAL_COMPANY"
                    ? `company (${currentAssignment?.externalCompany ?? ""})`
                    : `assignee (${currentAssignment?.externalName ?? ""})`}{" "}
                has completed the work. This closes the Job Card.
              </p>
            </div>
            <form action={markExternalWorkCompletedAction} className="space-y-2">
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <textarea
                name="completion_notes"
                placeholder="Completion notes (optional)"
                className="w-full rounded-md border border-[#BFDBFE] bg-white px-3 py-2 text-sm placeholder:text-[#93C5FD] focus:outline-none focus:ring-1 focus:ring-[#1D4ED8]"
                rows={2}
              />
              <Button type="submit" className="w-full bg-[#1D4ED8] hover:bg-blue-700">Mark Work Completed &amp; Close</Button>
            </form>
          </div>
        ) : null}

        {/* Manager/Engineer — request correction (keeps status Under Review) */}
        {canRequestCorrection ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-black text-amber-800">Need a correction before approving?</p>
            <form action={requestClarificationAction} className="space-y-2">
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <input type="hidden" name="kind" value="correction" />
              <textarea
                className="focus-ring min-h-20 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
                name="question"
                placeholder="What needs to be corrected? (min 10 characters)"
                required
                minLength={10}
              />
              <Button type="submit" variant="secondary" className="w-full">Request Correction</Button>
            </form>
          </div>
        ) : null}

        {/* Supervisor/Manager — ask Data Entry to add/change materials. Same
            requestClarificationAction/ClarificationRequest mechanism as
            Request Correction above, just a second, materials-framed entry
            point (Simplified Job Card Approval Workflow Unit Task 4). */}
        {canRequestCorrection ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-black text-amber-800">Need materials added or changed before approving?</p>
            <form action={requestClarificationAction} className="space-y-2">
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <input type="hidden" name="kind" value="materials" />
              <textarea
                className="focus-ring min-h-20 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
                name="question"
                placeholder="What materials need to be added or changed? (min 10 characters)"
                required
                minLength={10}
              />
              <Button type="submit" variant="secondary" className="w-full">Ask to Add/Update Materials</Button>
            </form>
          </div>
        ) : null}

        {/* Manager/Data Entry — close directly (no separate verify/confirm step).
            Simplified Job Card Approval Workflow Unit Task 4: closing note is
            now required (min 10 characters, matching the request-correction
            convention), not optional. */}
        {canClose ? (
          <form action={closeWorkOrderAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <textarea
              className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              name="comments"
              placeholder="Describe the work completed (required, min 10 characters)"
              required
              minLength={10}
            />
            <Button type="submit" className="w-full">Close Job Card</Button>
          </form>
        ) : null}

      </div>
    </section>
  );
}
