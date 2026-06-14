import { PageHeader } from "@/components/ui/page-header";
import { LowStockBadge } from "@/components/store/stock-badges";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function LowStockPage() {
  await requirePermission("parts.view");
  const parts = await prisma.parts.findMany({
    where: { deleted_at: null },
    orderBy: { part_code: "asc" }
  });
  const low = (parts ?? []).filter((part) => Number(part.current_stock) <= Number(part.minimum_stock));
  return (
    <>
      <PageHeader title="Low Stock" description="Parts at or below minimum stock level." />
      <div className="grid gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
        {low.length ? low.map((part) => (
          <section key={part.id} className="rounded-md border border-[#E5E7EB] bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-black">{part.part_code}</p><p className="text-sm text-[#4B5563]">{part.part_name}</p></div>
              <LowStockBadge current={part.current_stock.toFixed(2)} minimum={part.minimum_stock.toFixed(2)} />
            </div>
            <p className="mt-4 text-sm">Current: <strong>{part.current_stock.toFixed(2)}</strong> | Minimum: <strong>{part.minimum_stock.toFixed(2)}</strong></p>
          </section>
        )) : <p className="rounded-md border bg-white p-5 text-sm text-[#4B5563]">No low stock parts.</p>}
      </div>
    </>
  );
}
