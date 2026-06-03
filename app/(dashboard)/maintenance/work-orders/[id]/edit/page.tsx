import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function EditWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("work_orders.manage");
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const [{ data: workOrder }, { data: departments }, { data: assets }, { data: supervisors }, { data: labor }, { data: materials }, { data: attachments }] = await Promise.all([
    supabase.from("work_orders").select("*").eq("id", id).single(),
    supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    supabase.from("assets").select("id, asset_code, asset_name, category, serial_number, plate_number").is("deleted_at", null).order("asset_code"),
    supabase.from("profiles").select("id, full_name").eq("is_active", true).order("full_name"),
    supabase.from("work_order_labor").select("*").eq("work_order_id", id),
    supabase.from("work_order_materials").select("*").eq("work_order_id", id),
    supabase.from("work_order_attachments").select("*").eq("work_order_id", id)
  ]);

  return (
    <>
      <PageHeader title="Edit Work Order" description={`Update ${workOrder?.work_order_number ?? "work order"} paper-form details.`} />
      <div className="p-4 lg:p-6">
        <WorkOrderForm
          workOrder={workOrder}
          departments={departments ?? []}
          assets={assets ?? []}
          supervisors={(supervisors ?? []).map((item) => ({ id: item.id, name: item.full_name }))}
          laborRows={labor ?? []}
          materialRows={materials ?? []}
          attachmentRows={attachments ?? []}
        />
      </div>
    </>
  );
}
