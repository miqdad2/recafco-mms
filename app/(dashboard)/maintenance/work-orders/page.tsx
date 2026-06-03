import Link from "next/link";
import { Plus, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function WorkOrdersPage() {
  await requirePermission("work_orders.view");
  const supabase = await createSupabaseServerClient();
  const { data: workOrders } = await supabase
    .from("work_orders")
    .select("id, work_order_number, date_of_order, ordered_by, maintenance_type, worker_type, priority, status, job_location, total_work_order_cost, assets(asset_code, asset_name), departments(name)")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  return (
    <>
      <PageHeader
        title="Work Orders"
        description="Maintenance work orders with automatic numbering, asset linkage, status foundation, labor, materials, and print layout."
        actions={
          <Link href="/maintenance/work-orders/new">
            <Button>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New work order
            </Button>
          </Link>
        }
      />
      <div className="p-4 lg:p-6">
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]">
                <tr>
                  <th className="px-4 py-3">Work order</th>
                  <th className="px-4 py-3">Asset</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Worker</th>
                  <th className="px-4 py-3">Priority</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Print</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {workOrders?.map((wo) => {
                  const asset = Array.isArray(wo.assets) ? wo.assets[0] : wo.assets;
                  const department = Array.isArray(wo.departments) ? wo.departments[0] : wo.departments;
                  return (
                    <tr key={wo.id}>
                      <td className="px-4 py-3">
                        <Link href={`/maintenance/work-orders/${wo.id}`} className="font-bold text-[#111827] hover:text-[#ED1C24]">
                          {wo.work_order_number}
                        </Link>
                        <p className="text-[#4B5563]">{wo.ordered_by}</p>
                      </td>
                      <td className="px-4 py-3">{asset ? `${asset.asset_code} - ${asset.asset_name}` : "No asset"}</td>
                      <td className="px-4 py-3">{department?.name ?? "Not assigned"}</td>
                      <td className="px-4 py-3">{wo.maintenance_type}</td>
                      <td className="px-4 py-3">{wo.worker_type}</td>
                      <td className="px-4 py-3"><StatusBadge label={wo.priority} tone={wo.priority === "Urgent" ? "red" : wo.priority === "High" ? "amber" : "gray"} /></td>
                      <td className="px-4 py-3"><StatusBadge label={wo.status} tone={wo.status === "Closed" ? "green" : wo.status.includes("Waiting") ? "amber" : wo.status === "Rejected" ? "red" : "blue"} /></td>
                      <td className="px-4 py-3">{wo.date_of_order}</td>
                      <td className="px-4 py-3">
                        <Link href={`/maintenance/work-orders/${wo.id}/print`} className="inline-flex rounded-md border border-[#E5E7EB] p-2 hover:bg-gray-50" title="Print">
                          <Printer className="h-4 w-4" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
