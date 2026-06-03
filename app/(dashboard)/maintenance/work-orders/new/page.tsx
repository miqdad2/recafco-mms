import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function NewWorkOrderPage() {
  await requirePermission("work_orders.manage");
  const supabase = await createSupabaseServerClient();
  const [{ data: departments }, { data: assets }, { data: supervisors }] = await Promise.all([
    supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("assets").select("id, asset_code, asset_name, category, serial_number, plate_number").is("deleted_at", null).order("asset_code"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name")
  ]);

  return (
    <>
      <PageHeader title="New Work Order" description="Capture the RECAFCO paper work order as structured maintenance data. Numbering is generated on save." />
      <div className="p-4 lg:p-6">
        <WorkOrderForm
          departments={departments ?? []}
          assets={assets ?? []}
          supervisors={(supervisors ?? []).map((item) => ({ id: item.id, name: item.full_name }))}
        />
      </div>
    </>
  );
}
