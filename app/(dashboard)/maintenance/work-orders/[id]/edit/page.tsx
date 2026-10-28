import { WorkOrderForm } from "@/components/work-orders/work-order-form";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { isJobCardEditable, toIsoDateOnly } from "@/lib/work-orders/job-card-edit";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import { notFound, redirect } from "next/navigation";

const LINE_ITEM_ORDER = [{ created_at: "asc" as const }, { id: "asc" as const }];

export default async function EditWorkOrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from?: string }>;
}) {
  const context = await requirePermission("work_orders.manage");
  const { id } = await params;
  // Cancel Edit returns to Daily Activity when the editor was opened from
  // there (?from=daily-activity), otherwise to this Job Card. Only these two
  // fixed internal paths — the query value is a flag, never a URL.
  const from = (await searchParams)?.from;
  const cancelHref = from === "daily-activity" ? "/maintenance/daily-activity" : `/maintenance/work-orders/${id}`;
  // Same visibility filter as every other Job Card query, and only while the
  // Job Card can still be edited (not deleted, closure not yet requested) —
  // the save action re-checks both.
  const editable = await prisma.work_orders.findFirst({
    where: { AND: [{ id, deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
    select: { status: true },
  });
  if (!editable) notFound();
  if (!isJobCardEditable(editable.status)) redirect(`/maintenance/work-orders/${id}?error=not-editable`);
  const [rawWorkOrder, departments, assets, rawLabor, rawMaterials, rawAttachments, rawRequiredParts] = await Promise.all([
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
    // Line items in the same order upsertWorkOrderAction compares them, so an
    // untouched table is recognised as unchanged and kept as it is.
    prisma.work_order_labor.findMany({ where: { work_order_id: id }, orderBy: LINE_ITEM_ORDER }),
    prisma.work_order_materials.findMany({ where: { work_order_id: id }, orderBy: LINE_ITEM_ORDER }),
    prisma.work_order_attachments.findMany({ where: { work_order_id: id }, orderBy: LINE_ITEM_ORDER }),
    prisma.workOrderRequiredPart.findMany({ where: { work_order_id: id }, orderBy: LINE_ITEM_ORDER })
  ]);

  const workOrder = rawWorkOrder ? {
    ...rawWorkOrder,
    // <input type="date"> only accepts yyyy-mm-dd; a full ISO timestamp left
    // the field blank, so the required Date of order blocked every save and
    // Next service date was silently cleared on save. Both are @db.Date
    // (stored as UTC midnight), so the first 10 characters are the date.
    date_of_order: rawWorkOrder.date_of_order.toISOString().slice(0, 10),
    job_card_start_date: toIsoDateOnly(rawWorkOrder.job_card_start_date),
    job_card_end_date: toIsoDateOnly(rawWorkOrder.job_card_end_date),
    starting_datetime: rawWorkOrder.starting_datetime?.toISOString() ?? null,
    ending_datetime: rawWorkOrder.ending_datetime?.toISOString() ?? null,
    next_service_date: rawWorkOrder.next_service_date?.toISOString().slice(0, 10) ?? null,
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
    estimated_labor_hours: rawWorkOrder.estimated_labor_hours?.toNumber() ?? null,
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

  const requiredParts = rawRequiredParts.map((row) => ({
    ...row,
    quantity_required: row.quantity_required.toNumber(),
    // Snapshot columns added for the New Job Card wizard — plain numbers
    // for the client form (it does not use them).
    entered_quantity: row.entered_quantity !== null ? row.entered_quantity.toNumber() : null,
    conversion_quantity: row.conversion_quantity !== null ? row.conversion_quantity.toNumber() : null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    confirmed_at: row.confirmed_at?.toISOString() ?? null
  }));

  return (
    <>
      <PageHeader title="Edit Job Card" description={`Update ${workOrder?.work_order_number ?? "Job Card"} details.`} />
      <div className="p-4 lg:p-6">
        <WorkOrderForm
          workOrder={workOrder}
          departments={departments ?? []}
          assets={assets ?? []}
          laborRows={labor ?? []}
          materialRows={materials ?? []}
          attachmentRows={attachments ?? []}
          requiredPartRows={requiredParts ?? []}
          cancelHref={cancelHref}
        />
      </div>
    </>
  );
}
