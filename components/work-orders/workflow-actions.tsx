import Link from "next/link";
import {
  cancelWorkOrderAction,
  closeWorkOrderAction,
  markExternalWorkCompletedAction,
  rejectWorkOrderAction,
  requestClarificationAction,
  returnWorkOrderToDraftAction,
  submitWorkOrderAction,
  verifyWorkOrderAction
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

type WorkflowActionsProps = {
  workOrderId: string;
  status: string;
  context: CurrentUserContext;
  technicians: Technician[];
  currentAssignment?: CurrentAssignment;
};

function can(context: CurrentUserContext, permission: PermissionKey) {
  return context.role?.slug === "super_admin" || context.permissions.includes(permission);
}

const TERMINAL = ["Closed", "Cancelled", "Rejected"];

function getStepContext(status: string): { title: string; description: string } | null {
  switch (status) {
    case "Draft":
      return { title: "Draft", description: "Fill in all details and submit when ready." };
    case "Submitted":
    case "Pending Approval":
      return { title: "Awaiting Manager Review", description: "The Maintenance Manager will review and assign a technician." };
    case "Approved":
      return { title: "Approved", description: "Approved and awaiting technician assignment." };
    case "Assigned":
      return { title: "Technician Assigned", description: "Work will begin once the technician starts the job." };
    case "In Progress":
      return { title: "Work In Progress", description: "The technician is actively working on this job card." };
    case "Parts Issued":
      return { title: "Parts Issued", description: "Parts have been issued. Technician continuing work." };
    case "Waiting for Parts":
      return { title: "Waiting for Materials", description: "On hold while materials are sourced from the store." };
    case "Waiting for Purchase":
      return { title: "Waiting for Materials", description: "On hold while materials are being procured." };
    case "Completed by Technician":
      return { title: "Awaiting Verification", description: "Technician completed work. A supervisor needs to verify." };
    case "Verified by Supervisor":
      return { title: "Awaiting Closure", description: "Verified by supervisor. Waiting for manager to close." };
    case "Confirmed by Requester":
      return { title: "Ready to Close", description: "Confirmed by requester. Waiting for manager to close." };
    case "Closed":
      return { title: "Closed", description: "This job card has been completed and closed." };
    case "Rejected":
      return { title: "Returned for Fix", description: "Review the manager's comments and resubmit after making corrections." };
    case "Cancelled":
      return { title: "Cancelled", description: "This job card has been cancelled." };
    case "Reopened":
      return { title: "Reopened", description: "This job card has been reopened and is awaiting action." };
    default:
      return null;
  }
}

export function WorkflowActions({ workOrderId, status, context, technicians, currentAssignment }: WorkflowActionsProps) {
  const canReturnToDraft = can(context, "work_orders.manage") && status === "Rejected";
  const canSubmit        = can(context, "work_orders.manage") && ["Draft", "Submitted"].includes(status);
  const canAssign        = (can(context, "work_orders.approve") || can(context, "work_orders.assign")) &&
                           ["Submitted", "Pending Approval", "Approved"].includes(status);
  const canSendBack      = can(context, "work_orders.approve") && ["Submitted", "Pending Approval"].includes(status);
  const canClarify       = can(context, "work_orders.approve") && ["Submitted", "Pending Approval"].includes(status);
  const canVerify        = can(context, "work_orders.assign") && status === "Completed by Technician";
  const canClose         = can(context, "work_orders.approve") &&
                           ["Completed by Technician", "Verified by Supervisor", "Confirmed by Requester"].includes(status);
  const canCancel        = can(context, "work_orders.approve") && !TERMINAL.includes(status);

  const isExternalAssignment =
    currentAssignment?.type === "FREELANCER" || currentAssignment?.type === "EXTERNAL_COMPANY";
  const canMarkExternalComplete =
    can(context, "work_orders.assign") &&
    ["Assigned", "In Progress"].includes(status) &&
    isExternalAssignment;

  const hasActions = canReturnToDraft || canSubmit || canAssign || canVerify || canClose || canCancel || canMarkExternalComplete;

  if (!hasActions) {
    const ctx = getStepContext(status);
    if (!ctx) return null;
    const canCreatePartsRequest =
      can(context, "parts_requests.create") || can(context, "work_orders.manage");
    const isActive = !TERMINAL.includes(status);
    return (
      <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Current Action</p>
        <p className="mt-2 text-sm font-black text-[#111827]">{ctx.title}</p>
        <p className="mt-1 text-sm leading-5 text-[#4B5563]">{ctx.description}</p>
        {canCreatePartsRequest && isActive ? (
          <div className="mt-4 border-t border-[#E5E7EB] pt-3">
            <p className="mb-2 text-xs font-black uppercase tracking-wide text-[#4B5563]">Quick actions</p>
            <Link
              href={`/store/parts-requests/new?repair_order_id=${workOrderId}`}
              className="text-sm font-bold text-[#ED1C24] hover:underline"
            >
              Request materials →
            </Link>
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <p className="text-xs font-black uppercase tracking-wide text-[#ED1C24]">Current Action</p>
      <div className="mt-4 grid gap-3">

        {/* Rejected — return to draft */}
        {canReturnToDraft ? (
          <div className="space-y-3 rounded-md border border-[#ED1C24] bg-red-50 p-4">
            <div>
              <p className="text-sm font-black text-[#ED1C24]">Job card was returned for fix</p>
              <p className="mt-1 text-sm leading-5 text-[#4B5563]">
                Return it to Draft, update the details, then resubmit.
              </p>
            </div>
            <form action={returnWorkOrderToDraftAction}>
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <Button type="submit" className="w-full">Return to Draft &amp; Edit</Button>
            </form>
          </div>
        ) : null}

        {/* Draft/Submitted — submit */}
        {canSubmit ? (
          <form action={submitWorkOrderAction}>
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <Button type="submit" className="w-full">Submit Job Card</Button>
          </form>
        ) : null}

        {/* Manager — assign (internal / freelancer / external company) */}
        {canAssign ? (
          <div className="space-y-3 rounded-md border border-[#E5E7EB] bg-gray-50 p-4">
            <p className="text-sm font-black text-[#111827]">Assign Work</p>
            <AssignmentForm workOrderId={workOrderId} technicians={technicians} />
          </div>
        ) : null}

        {/* Manager — mark external work completed */}
        {canMarkExternalComplete ? (
          <div className="space-y-3 rounded-md border border-[#E5E7EB] bg-blue-50 p-4">
            <div>
              <p className="text-sm font-black text-[#1D4ED8]">Mark External Work Completed</p>
              <p className="mt-1 text-xs text-[#1D4ED8]">
                Confirm that the{" "}
                {currentAssignment?.type === "FREELANCER"
                  ? `freelancer (${currentAssignment.externalName ?? ""})`
                  : `company (${currentAssignment?.externalCompany ?? ""})`}{" "}
                has completed the work.
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
              <Button type="submit" className="w-full bg-[#1D4ED8] hover:bg-blue-700">Mark Work Completed</Button>
            </form>
          </div>
        ) : null}

        {/* Manager — send back for fix */}
        {canSendBack ? (
          <form action={rejectWorkOrderAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <textarea
              className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              name="comments"
              placeholder="Reason for sending back (required)"
              required
            />
            <Button type="submit" variant="danger" className="w-full">Send Back for Fix</Button>
          </form>
        ) : null}

        {/* Manager — request clarification */}
        {canClarify ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-black text-amber-800">Need more information?</p>
            <form action={requestClarificationAction} className="space-y-2">
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <textarea
                className="focus-ring min-h-20 w-full rounded-md border border-amber-200 bg-white px-3 py-2 text-sm"
                name="question"
                placeholder="What information do you need before assigning? (min 10 characters)"
                required
                minLength={10}
              />
              <Button type="submit" variant="secondary" className="w-full">Request Clarification</Button>
            </form>
          </div>
        ) : null}

        {/* Supervisor — verify completed work */}
        {canVerify ? (
          <form action={verifyWorkOrderAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <textarea
              className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              name="comments"
              placeholder="Verification notes (optional)"
            />
            <Button type="submit" className="w-full">Mark as Verified</Button>
          </form>
        ) : null}

        {/* Manager — close */}
        {canClose ? (
          <form action={closeWorkOrderAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <textarea
              className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm"
              name="comments"
              placeholder="Closure notes (optional)"
            />
            <Button type="submit" className="w-full">Close Job Card</Button>
          </form>
        ) : null}

        {/* Manager — cancel */}
        {canCancel ? (
          <div className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
            <p className="text-xs font-black text-[#4B5563]">Cancel this job card</p>
            <form action={cancelWorkOrderAction} className="space-y-2">
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <textarea
                className="focus-ring min-h-16 w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
                name="comments"
                placeholder="Reason for cancellation (required, min 5 chars)"
                required
                minLength={5}
              />
              <Button type="submit" variant="secondary" className="w-full">Cancel Job Card</Button>
            </form>
          </div>
        ) : null}

      </div>
    </section>
  );
}
