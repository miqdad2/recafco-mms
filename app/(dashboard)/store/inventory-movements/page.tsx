import { InventoryMovementTable } from "@/components/store/inventory-movement-table";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function InventoryMovementsPage() {
  const context = await requirePermission("inventory.movements.view");
  const supabase = await createSupabaseServerClient();
  const { data: movements } = await supabase.from("inventory_movements").select("*, parts(part_code, part_name)").order("created_at", { ascending: false }).limit(200);
  return (
    <>
      <PageHeader title="Inventory Movements" description="Stock movement history for issues, adjustments, and purchase receipts." />
      <div className="p-4 lg:p-6"><InventoryMovementTable movements={movements ?? []} context={context} /></div>
    </>
  );
}
