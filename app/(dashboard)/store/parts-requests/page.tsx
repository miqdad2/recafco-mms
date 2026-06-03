import Link from "next/link";

import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function PartsRequestsPage() {
  const context = await requirePermission("parts_requests.view");
  const supabase = await createSupabaseServerClient();
  const { data: requests } = await supabase.from("parts_requests").select("*, work_orders(work_order_number), departments(name), profiles(full_name)").order("created_at", { ascending: false });
  return (
    <>
      <PageHeader title="Parts Requests" description="Maintenance parts request queue for approval, store issue, and purchase follow-up." />
      <div className="p-4 lg:p-6">
        <section className="overflow-hidden rounded-md border border-[#E5E7EB] bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-[#4B5563]"><tr><th className="px-4 py-3">Request</th><th className="px-4 py-3">WO</th><th className="px-4 py-3">Department</th><th className="px-4 py-3">Requester</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Status</th></tr></thead>
              <tbody className="divide-y divide-[#E5E7EB]">
                {requests?.map((request) => {
                  const wo = Array.isArray(request.work_orders) ? request.work_orders[0] : request.work_orders;
                  const dept = Array.isArray(request.departments) ? request.departments[0] : request.departments;
                  const profile = Array.isArray(request.profiles) ? request.profiles[0] : request.profiles;
                  return (
                    <tr key={request.id}>
                      <td className="px-4 py-3"><Link className="font-bold hover:text-[#ED1C24]" href={`/store/parts-requests/${request.id}`}>{request.parts_request_number}</Link></td>
                      <td className="px-4 py-3">{wo?.work_order_number ?? "-"}</td>
                      <td className="px-4 py-3">{dept?.name ?? "-"}</td>
                      <td className="px-4 py-3">{profile?.full_name ?? "-"}</td>
                      <td className="px-4 py-3"><CostVisibilityGuard context={context}>{request.total_price}</CostVisibilityGuard></td>
                      <td className="px-4 py-3"><StatusBadge label={request.status} tone={request.status === "Rejected" ? "red" : request.status.includes("Issued") ? "green" : request.status.includes("Waiting") ? "amber" : "blue"} /></td>
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
