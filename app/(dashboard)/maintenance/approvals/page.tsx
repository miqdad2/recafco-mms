import Link from "next/link";

import { approveWorkOrderAction, rejectWorkOrderAction, requestClarificationAction } from "@/app/actions/workflow";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function ApprovalsPage() {
  await requirePermission("work_orders.approve");
  const workOrders = await prisma.work_orders.findMany({
    select: {
      id: true,
      work_order_number: true,
      ordered_by: true,
      priority: true,
      status: true,
      date_of_order: true,
      operator_complaint: true,
      assets: { select: { asset_code: true, asset_name: true } },
      departments: { select: { name: true } }
    },
    where: { status: { in: ["Submitted", "Pending Approval"] } },
    orderBy: { created_at: "asc" }
  });

  return (
    <>
      <PageHeader title="Work Order Approvals" description="Maintenance Manager review queue for submitted and pending approval work orders." />
      <div className="grid gap-4 p-4 lg:p-6">
        {workOrders?.length ? workOrders.map((wo) => {
          const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
          const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
          return (
            <section key={wo.id} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <Link href={`/maintenance/work-orders/${wo.id}`} className="text-lg font-black text-[#111827] hover:text-[#ED1C24]">{wo.work_order_number}</Link>
                  <p className="mt-1 text-sm text-[#4B5563]">{asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset"} | {department?.name ?? "No department"}</p>
                  <p className="mt-3 text-sm">{wo.operator_complaint || "No complaint recorded."}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <StatusBadge label={wo.priority} tone={wo.priority === "Urgent" ? "red" : wo.priority === "High" ? "amber" : "gray"} />
                  <StatusBadge label={wo.status} tone="amber" />
                </div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                <form action={approveWorkOrderAction} className="space-y-2">
                  <input type="hidden" name="work_order_id" value={wo.id} />
                  <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="comments" placeholder="Approval comments" />
                  <Button type="submit" className="w-full">Approve</Button>
                </form>
                <form action={rejectWorkOrderAction} className="space-y-2">
                  <input type="hidden" name="work_order_id" value={wo.id} />
                  <textarea className="focus-ring min-h-20 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm" name="comments" placeholder="Rejection reason" required />
                  <Button type="submit" variant="danger" className="w-full">Reject</Button>
                </form>
                <form action={requestClarificationAction} className="space-y-2">
                  <input type="hidden" name="work_order_id" value={wo.id} />
                  <textarea className="focus-ring min-h-20 w-full rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm" name="question" placeholder="What information is needed? (min 10 characters)" required minLength={10} />
                  <Button type="submit" variant="secondary" className="w-full">Request Clarification</Button>
                </form>
              </div>
            </section>
          );
        }) : <EmptyState title="No pending approvals" message="Submitted work orders that need maintenance manager review will appear here." />}
      </div>
    </>
  );
}
