import {
  approveWorkOrderAction,
  closeWorkOrderAction,
  rejectWorkOrderAction,
  submitWorkOrderAction,
  verifyWorkOrderAction
} from "@/app/actions/workflow";
import { Button } from "@/components/ui/button";
import type { CurrentUserContext } from "@/lib/auth/context";
import type { PermissionKey } from "@/types/database";

type WorkflowActionsProps = {
  workOrderId: string;
  status: string;
  context: CurrentUserContext;
};

function can(context: CurrentUserContext, permission: PermissionKey) {
  return context.role?.slug === "super_admin" || context.permissions.includes(permission);
}

export function WorkflowActions({ workOrderId, status, context }: WorkflowActionsProps) {
  const canSubmit = can(context, "work_orders.manage") && ["Draft", "Submitted"].includes(status);
  const canApprove = can(context, "work_orders.approve") && ["Submitted", "Pending Approval"].includes(status);
  const canVerify = can(context, "work_orders.assign") && status === "Completed by Technician";
  const canClose = can(context, "work_orders.approve") && status === "Verified by Supervisor";

  if (!canSubmit && !canApprove && !canVerify && !canClose) return null;

  return (
    <section className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
      <h2 className="text-lg font-bold text-[#111827]">Role-Based Actions</h2>
      <div className="mt-4 grid gap-3">
        {canSubmit ? (
          <form action={submitWorkOrderAction}>
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <Button type="submit" className="w-full">Submit for approval</Button>
          </form>
        ) : null}
        {canApprove ? (
          <div className="grid gap-3">
            <form action={approveWorkOrderAction} className="space-y-2">
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="comments" placeholder="Approval comments" />
              <Button type="submit" className="w-full">Approve work order</Button>
            </form>
            <form action={rejectWorkOrderAction} className="space-y-2">
              <input type="hidden" name="work_order_id" value={workOrderId} />
              <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="comments" placeholder="Rejection reason" required />
              <Button type="submit" variant="danger" className="w-full">Reject work order</Button>
            </form>
          </div>
        ) : null}
        {canVerify ? (
          <form action={verifyWorkOrderAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="comments" placeholder="Supervisor verification notes" />
            <Button type="submit" className="w-full">Verify completed work</Button>
          </form>
        ) : null}
        {canClose ? (
          <form action={closeWorkOrderAction} className="space-y-2">
            <input type="hidden" name="work_order_id" value={workOrderId} />
            <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="comments" placeholder="Closure comments" />
            <Button type="submit" className="w-full">Close work order</Button>
          </form>
        ) : null}
      </div>
    </section>
  );
}
