import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export default async function EditWorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermission("work_orders.manage");
  const { id } = await params;
  const [rawWorkOrder, departments, assets, supervisors, rawLabor, rawMaterials, rawAttachments] = await Promise.all([
    prisma.work_orders.findUnique({ where: { id } }),
    prisma.departments.findMany({
      where: { is_active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    }),
    prisma.assets.findMany({
      where: { deleted_at: null },
      select: { id: true, asset_code: true, asset_name: true, category: true, serial_number: true, plate_number: true },
      orderBy: { asset_code: "asc" }
    }),
    prisma.profiles.findMany({
      where: { is_active: true },
      select: { id: true, full_name: true },
      orderBy: { full_name: "asc" }
    }),
    prisma.work_order_labor.findMany({ where: { work_order_id: id } }),
    prisma.work_order_materials.findMany({ where: { work_order_id: id } }),
    prisma.work_order_attachments.findMany({ where: { work_order_id: id } })
  ]);

  const workOrder = rawWorkOrder ? {
    ...rawWorkOrder,
    date_of_order: rawWorkOrder.date_of_order.toISOString(),
    starting_datetime: rawWorkOrder.starting_datetime?.toISOString() ?? null,
    ending_datetime: rawWorkOrder.ending_datetime?.toISOString() ?? null,
    next_service_date: rawWorkOrder.next_service_date?.toISOString() ?? null,
    created_at: rawWorkOrder.created_at.toISOString(),
    updated_at: rawWorkOrder.updated_at.toISOString(),
    deleted_at: rawWorkOrder.deleted_at?.toISOString() ?? null,
    running_hours: rawWorkOrder.running_hours?.toNumber() ?? null,
    kilometers: rawWorkOrder.kilometers?.toNumber() ?? null,
    total_labor_cost: rawWorkOrder.total_labor_cost.toNumber(),
    total_material_cost: rawWorkOrder.total_material_cost.toNumber(),
    total_work_order_cost: rawWorkOrder.total_work_order_cost?.toNumber() ?? null,
    next_service_kilometer: rawWorkOrder.next_service_kilometer?.toNumber() ?? null,
    next_service_running_hours: rawWorkOrder.next_service_running_hours?.toNumber() ?? null,
  } : null;

  const labor = rawLabor.map((row) => ({
    ...row,
    hours: row.hours.toNumber(),
    rate: row.rate.toNumber(),
    amount: row.amount?.toNumber() ?? null,
    created_at: row.created_at.toISOString()
  }));

  const materials = rawMaterials.map((row) => ({
    ...row,
    quantity: row.quantity.toNumber(),
    unit_price: row.unit_price.toNumber(),
    amount: row.amount?.toNumber() ?? null,
    created_at: row.created_at.toISOString()
  }));

  const attachments = rawAttachments.map((row) => ({
    ...row,
    created_at: row.created_at.toISOString()
  }));

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
