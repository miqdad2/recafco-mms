import Link from "next/link";

import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function FinanceApprovalsPage() {
  const context = await requirePermission("finance.approve");
  const supabase = await createSupabaseServerClient();
  const { data: purchases } = await supabase.from("purchase_requests").select("*").in("status", ["Pending Finance Approval", "Pending CEO Approval"]).order("created_at", { ascending: true });
  return (
    <>
      <PageHeader title="Finance Approvals" description="Finance and CEO approval queue for purchase costs." />
      <div className="grid gap-4 p-4 lg:p-6">
        {purchases?.map((purchase) => <Link key={purchase.id} href={`/purchase/requests/${purchase.id}`} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm hover:border-[#ED1C24]"><div className="flex justify-between gap-3"><div><p className="font-black">{purchase.purchase_request_number}</p><p className="text-sm text-[#4B5563]">{purchase.supplier ?? "No supplier"}</p></div><StatusBadge label={purchase.status} tone="amber" /></div><p className="mt-3 text-sm">Estimated total: <CostVisibilityGuard context={context}>{purchase.estimated_total}</CostVisibilityGuard></p></Link>)}
      </div>
    </>
  );
}
