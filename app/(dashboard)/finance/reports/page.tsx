import { CostVisibilityGuard } from "@/components/ui/cost-visibility-guard";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function FinanceReportsPage() {
  const context = await requirePermission("finance.reports.view");
  const [purchases, workOrders] = await Promise.all([
    prisma.purchase_requests.findMany({
      select: { estimated_total: true, status: true }
    }),
    prisma.work_orders.findMany({
      select: { total_work_order_cost: true, status: true }
    })
  ]);
  const purchaseTotal = (purchases ?? []).reduce((sum, row) => sum + Number(row.estimated_total ?? 0), 0);
  const maintenanceTotal = (workOrders ?? []).reduce((sum, row) => sum + Number(row.total_work_order_cost ?? 0), 0);
  return (
    <>
      <PageHeader title="Finance Reports" description="Cost report foundation for maintenance and purchase workflows." />
      <div className="grid gap-4 p-4 md:grid-cols-2 lg:p-6">
        <section className="rounded-md border bg-white p-5 shadow-sm"><p className="text-sm text-[#4B5563]">Purchase estimated total</p><p className="mt-2 text-3xl font-black text-[#ED1C24]"><CostVisibilityGuard context={context}>{purchaseTotal.toFixed(3)}</CostVisibilityGuard></p></section>
        <section className="rounded-md border bg-white p-5 shadow-sm"><p className="text-sm text-[#4B5563]">Maintenance work order total</p><p className="mt-2 text-3xl font-black text-[#111827]"><CostVisibilityGuard context={context}>{maintenanceTotal.toFixed(3)}</CostVisibilityGuard></p></section>
      </div>
    </>
  );
}
