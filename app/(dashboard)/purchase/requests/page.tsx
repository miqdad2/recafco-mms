import Link from "next/link";

import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PurchaseRequestsPage() {
  const context = await requirePermission("purchase_requests.view");
  const supabase = await createSupabaseServerClient();
  const { data: purchases } = await supabase.from("purchase_requests").select("*, parts_requests(parts_request_number), work_orders(work_order_number)").order("created_at", { ascending: false });
  return (
    <>
      <PageHeader title="Purchase Requests" description="Purchase queue for unavailable parts, supplier updates, approvals, ordered, and received status." />
      <div className="p-4 lg:p-6">
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr><th className="px-4 py-3">Purchase</th><th className="px-4 py-3">Parts Request</th><th className="px-4 py-3">WO</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Estimate</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {purchases?.map((purchase) => {
                  const pr = Array.isArray(purchase.parts_requests) ? purchase.parts_requests[0] : purchase.parts_requests;
                  const wo = Array.isArray(purchase.work_orders) ? purchase.work_orders[0] : purchase.work_orders;
                  return <tr key={purchase.id}><td className="px-4 py-3"><Link href={`/purchase/requests/${purchase.id}`} className="font-bold hover:text-[#ED1C24]">{purchase.purchase_request_number}</Link></td><td className="px-4 py-3">{pr?.parts_request_number ?? "-"}</td><td className="px-4 py-3">{wo?.work_order_number ?? "-"}</td><td className="px-4 py-3">{purchase.supplier ?? "-"}</td><td className="px-4 py-3"><CostVisibilityGuard context={context}>{purchase.estimated_total}</CostVisibilityGuard></td><td className="px-4 py-3"><StatusBadge label={purchase.status} tone={purchase.status === "Rejected" ? "red" : purchase.status === "Received" ? "green" : purchase.status.includes("Pending") ? "amber" : "blue"} /></td></tr>;
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
