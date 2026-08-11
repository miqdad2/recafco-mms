import Link from "next/link";
import {
  approveJobCardAndMaterialsAction,
  approveJobCardClosureAction,
  closeWorkOrderAction,
  markExternalWorkCompletedAction,
  requestJobCardClosureAction,
  startJobCardProgressAction,
  submitWorkOrderAction
} from "@/app/actions/workflow";
import { AssignmentForm } from "@/components/work-orders/assignment-form";
import { InternalTeamRosterForm } from "@/components/work-orders/internal-team-roster-form";
import { Button } from "@/components/ui/button";
import type { CurrentUserContext } from "@/lib/auth/context";
import { canViewCosts } from "@/lib/security/permissions";
import type { PermissionKey } from "@/types/database";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";

type Technician = { id: string; full_name: string };
type CurrentRosterRow = { worker_id: string; worker_role: string; estimated_hours: number | null };

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
  // Work Assignment and Worker Profiles Foundation Unit 7: worker profiles
  // available for the Internal Team roster, and the Job Card's current
  // active roster rows (for pre-selecting the picker).
  activeWorkers?: WorkerProfileRow[];
  internalTeamRoster?: CurrentRosterRow[];
  // Simplified Workflow UI Consistency Cleanup Task 3: whether this Job Card
  // has an unresolved correction request right now — suppresses every normal
  // status action below so the page's correction banner (with its own
  // Submit Response / Resubmit action) is the one clear thing to do,
  // regardless of what the raw status would otherwise allow.
  hasPendingCorrection?: boolean;
  // Job Card Detail Simplification Unit 8C: this component's forms are no
  // longer all rendered in one place in the sidebar. The page now decides
  // WHERE each group of actions appears (Next Action panel / Assignment
  // section+modal / Closure panel) and calls this component three times,
  // once per section, passing the same props each time. Every permission
  // check and form below is untouched from before Unit 8C — only which
  // group of blocks a given call renders has changed.
  section: "status" | "assignment" | "closure";
};

function can(context: CurrentUserContext, permission: PermissionKey) {
  return context.role?.slug === "super_admin" || context.permissions.includes(permission);
}

// Approval Workflow Unit 4: matches requestJobCardClosure/approveJobCardClosure/
// closeWorkOrder's own role checks in lib/backend/work-orders/service.ts —
// kept in sync manually since these are explicit role checks, not permission
// keys (no DB permission grant models "who can request/approve closure").
function isManagerRole(context: CurrentUserContext) {
  return context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
}
function canRequestClosureRole(context: CurrentUserContext) {
  return (
    context.role?.slug === "super_admin" ||
    ["maintenance_data_entry", "maintenance_manager", "maintenance_supervisor"].includes(context.role?.slug ?? "")
  );
}

const ACTIVE_BUCKET_STATUSES = ["Approved", "Waiting Materials", "Partially Issued", "Materials Issued", "Assigned", "In Progress"];

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
    case "Closure Requested":
      return { title: "Closure Requested", description: "Waiting for Manager approval to close this Job Card." };
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

export function WorkflowActions({
  workOrderId,
  status,
  context,
  technicians,
  currentAssignment,
  activeMaterialsRequest,
  activeWorkers = [],
  internalTeamRoster = [],
  hasPendingCorrection = false,
  section,
}: WorkflowActionsProps) {
  const canSubmit  = can(context, "work_orders.manage") && status === "Created";
  const canApprove = can(context, "work_orders.approve") && status === "Under Review" && !hasPendingCorrection;
  // Correction requests are only meaningful while a Job Card is Under Review
  // and no correction is already pending — this now uses
  // work_orders.request_correction (Engineer + Manager), not
  // work_orders.approve (Manager only), per the Unit 3 permission grants.
  // Manager Quick-View Action Simplification Task 6: kept as-is (still drives
  // hasStatusActions below) but no longer renders its own "Request
  // Correction"/"Ask to Add/Update Materials" panels — requestClarificationAction
  // and the ClarificationRequest mechanism it drives are untouched, just no
  // longer the default path shown here.
  const canRequestCorrection = can(context, "work_orders.request_correction") && status === "Under Review" && !hasPendingCorrection;
  // Whoever could request a correction here already holds work_orders.manage
  // in this codebase's current permission grants (Manager and Engineer both
  // do) — offering a direct Edit Job Card link instead is simpler than
  // routing a formal correction request through Data Entry. Gated
  // independently on work_orders.manage (not just canRequestCorrection) so
  // this never renders for a role that can request a correction but can't
  // actually edit.
  const canEditBeforeApproval =
    can(context, "work_orders.manage") && status === "Under Review" && !hasPendingCorrection;
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
  // Work Assignment and Worker Profiles Foundation Unit 7, Task 6: the
  // Internal Team labor roster can be created/edited any time the Job Card
  // is not Closed (wider than canAssign's status gate above, which is tied
  // to the materials-resolved workflow step) — Data Entry can update it
  // while the Job Card is open; blocked for everyone once Closed, since
  // Unit 4 removed every post-closure correction path.
  const canManageRoster =
    !hasPendingCorrection &&
    (can(context, "work_orders.assign") || isManagerRole(context)) &&
    status !== "Closed";
  // Approval Workflow Unit 4: direct Close is now Manager-only (business
  // rule 8 — Data Entry cannot final-close a Job Card directly any more, it
  // requests closure instead — see canRequestClosure below). Still available
  // from any "Active"-bucket status; not shown for "Closure Requested" —
  // Approve Closure is the one closing action there (Task 9: avoid a
  // duplicate button).
  const canClose =
    !hasPendingCorrection &&
    isManagerRole(context) &&
    ACTIVE_BUCKET_STATUSES.includes(status);
  // Approval Workflow Unit 4, Task 4: Data Entry (or Supervisor/Manager/
  // super_admin) marks work complete and asks Manager to approve closing.
  const canRequestClosure =
    !hasPendingCorrection &&
    canRequestClosureRole(context) &&
    ACTIVE_BUCKET_STATUSES.includes(status);
  // Approval Workflow Unit 4, Task 5: Manager (or super_admin) approves a
  // pending closure request.
  const canApproveClosure =
    !hasPendingCorrection &&
    isManagerRole(context) &&
    status === "Closure Requested";
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

  // ── section: "assignment" — Assign Work / Internal Team roster forms.
  // Job Card Detail Simplification Unit 8C: previously rendered inline and
  // always visible in the sidebar; now only rendered inside the "Edit
  // Assignment" modal opened from the read-only Assignment section. Same
  // exact forms/gates as before, just relocated.
  if (section === "assignment") {
    if (!canAssign && !canManageRoster) return null;
    return (
      <div className="space-y-4">
        {canAssign ? (
          <div className="space-y-3 rounded-md border border-[#E5E7EB] bg-gray-50 p-4">
            <p className="text-sm font-black text-[#111827]">{status === "Assigned" || status === "In Progress" ? "Reassign Work" : "Assign Work"}</p>
            <AssignmentForm workOrderId={workOrderId} technicians={technicians} />
          </div>
        ) : null}

        {/* Work Assignment and Worker Profiles Foundation Unit 7 — separate
            from Assign Work above: builds the role-differentiated Internal
            Team labor roster (Supervisor/Technicians/Helpers, sourced from
            Worker Profiles, hourly rate snapshotted at save time), not the
            single technician/freelancer/company assignment. */}
        {canManageRoster ? (
          <div className="space-y-3 rounded-md border border-[#E5E7EB] bg-gray-50 p-4">
            <p className="text-sm font-black text-[#111827]">
              {internalTeamRoster.length ? "Edit Internal Team" : "Assign Internal Team"}
            </p>
            <InternalTeamRosterForm
              workOrderId={workOrderId}
              workers={activeWorkers}
              currentRoster={internalTeamRoster}
              canViewCosts={canViewCosts(context)}
            />
          </div>
        ) : null}
      </div>
    );
  }

  // ── section: "closure" — Request Closure / Approve Closure / Close Job
  // Card forms. Job Card Detail Simplification Unit 8C: relocated from the
  // sidebar into the new Closure Panel, which also shows a readiness summary
  // above these same forms. Same exact gates/forms as before.
  if (section === "closure") {
    if (!canRequestClosure && !canApproveClosure && !canClose) return null;
    return (
      <div className="space-y-4">
        {/* Approval Workflow Unit 4, Task 4 — Data Entry (or Supervisor/
            Manager/super_admin) marks work complete and asks Manager to
            approve closing. Backend blocks this if any linked Materials
            Request is still Pending. */}
        {canRequestClosure ? (
          <form action={requestJobCardClosureAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            {/* Closure Request Modal Optional Note and Multiple Custom
                Attachments Unit 10F.6B, Task 9: note is optional — matches
                the Daily Activity closure modal's rule (requestJobCardClosure
                itself no longer requires one), so there is only one rule
                across both surfaces. */}
            <textarea
              className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              name="note"
              placeholder="Add remarks about completed work, if needed."
            />
            <p className="text-xs text-[#9CA3AF]">Optional. Add remarks if needed.</p>
            <Button type="submit" className="w-full">Request Closure</Button>
          </form>
        ) : null}

        {/* Approval Workflow Unit 4, Task 5 — Manager (or super_admin)
            approves a pending closure request. No reject/return path in this
            unit (Task 7) — Data Entry fixes anything before requesting
            closure, not after. */}
        {canApproveClosure ? (
          <form action={approveJobCardClosureAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <textarea
              className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              name="comments"
              placeholder="Approval notes (optional)"
            />
            <Button type="submit" className="w-full">Approve Closure</Button>
          </form>
        ) : null}

        {/* Manager — close directly without a closure request (Task 6). Same
            required closing note convention (min 10 characters) as before;
            now Manager-only (business rule 8) and blocked if any linked
            Materials Request is still Pending. */}
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
    );
  }

  // ── section: "status" (default) — Start/Approve/Start Progress/Edit
  // before approval/Mark External Complete, or a read-only description of
  // what's happening when none of those apply. Rendered inside the page's
  // Next Action panel now, instead of its own separate "Current Action"
  // sidebar card.
  const hasStatusActions =
    canSubmit || canApprove || canRequestCorrection || canEditBeforeApproval || canStartProgress || canMarkExternalComplete;

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

  if (!hasStatusActions) {
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
              title: "Waiting on Supervisor / Manager decision.",
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
      <div>
        <p className="text-sm font-black text-[#111827]">{ctx.title}</p>
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
      </div>
    );
  }

  return (
    <div className="grid gap-3">

      {/* Created — activate directly, no Manager approval needed (Unit 4).
          New Job Card Button Wording and Success Popup Clarity Unit 10F.2,
          Task 1/6: renamed from "Start Job Card" — this only moves the
          record Draft -> Active, never a worker timer; same
          submitWorkOrderAction, same hidden field. */}
      {canSubmit ? (
        <form action={submitWorkOrderAction}>
          <input type="hidden" name="work_order_id" value={workOrderId} />
          <Button type="submit" className="w-full">Activate Job Card</Button>
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
              ? "This will approve the Job Card and requested materials. Materials will be marked as Pending."
              : "This will approve the Job Card and make it Approved."}
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

      {/* Manager Quick-View Action Simplification Task 6 (Option A):
          replaces the old "Request Correction"/"Ask to Add/Update
          Materials" panels — whoever can edit the Job Card can just edit
          it directly instead of routing a formal correction request
          through Data Entry. requestClarificationAction and the
          ClarificationRequest mechanism it drives are untouched and still
          fully reachable (Data Entry's own correction-response flow above
          this component, and the quick-view popup's now-unused-by-button
          but still-present review panel) — this only changes which action
          is offered by default here. */}
      {canEditBeforeApproval ? (
        <div className="space-y-2 rounded-md border border-[#E5E7EB] bg-gray-50 p-3">
          <p className="text-xs font-black text-[#111827]">Need to change something before approving?</p>
          <p className="text-xs text-[#6B7280]">Use Edit Job Card if details or materials need changes before approval.</p>
          <Link
            href={`/maintenance/work-orders/${workOrderId}/edit`}
            className="focus-ring inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-semibold text-[#111827] transition hover:bg-gray-50"
          >
            Edit Job Card
          </Link>
        </div>
      ) : null}

    </div>
  );
}
