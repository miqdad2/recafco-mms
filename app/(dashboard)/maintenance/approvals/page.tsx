import Link from "next/link";

import { approveWorkOrderAction, rejectWorkOrderAction } from "@/app/actions/workflow";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function ApprovalsPage() {
  await requirePermission("work_orders.approve");
  const supabase = await createSupabaseServerClient();
  const { data: workOrders } = await supabase
    .from("work_orders")
    .select("id, work_order_number, ordered_by, priority, status, date_of_order, operator_complaint, assets(asset_code, asset_name), departments(name)")
    .in("status", ["Submitted", "Pending Approval"])
    .order("created_at", { ascending: true });

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
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
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
              </div>
            </section>
          );
        }) : <EmptyState title="No pending approvals" message="Submitted work orders that need maintenance manager review will appear here." />}
      </div>
    </>
  );
}
