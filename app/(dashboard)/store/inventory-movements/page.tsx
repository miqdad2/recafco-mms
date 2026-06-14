import { InventoryMovementTable } from "@/components/store/inventory-movement-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function InventoryMovementsPage() {
  const context = await requirePermission("inventory.movements.view");
  const movements = await prisma.inventory_movements.findMany({
    include: { parts: { select: { part_code: true, part_name: true } } },
    orderBy: { created_at: "desc" },
    take: 200
  });
  const movementsForTable = movements.map((m) => ({
    ...m,
    quantity: m.quantity.toFixed(2),
    unit_price: m.unit_price.toFixed(3)
  }));
  return (
    <>
      <PageHeader title="Inventory Movements" description="Stock movement history for issues, adjustments, and purchase receipts." />
      <div className="p-4 lg:p-6"><InventoryMovementTable movements={movementsForTable} context={context} /></div>
    </>
  );
}
