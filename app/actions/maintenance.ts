"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyByEvent } from "@/lib/notifications/service";
import { emitRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { prisma } from "@/lib/db/prisma";

const optionalString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}, z.string().optional());

const optionalUuid = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.trim().length ? value : undefined;
}, z.string().uuid().optional());

const optionalNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return undefined;
  return Number(value);
}, z.number().finite().nonnegative().optional());

const optionalDate = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value;
}, z.string().optional());

const assetSchema = z.object({
  id: optionalUuid,
  asset_code: z.string().trim().min(2).max(60),
  asset_name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2),
  department_id: optionalUuid,
  location: optionalString,
  brand: optionalString,
  model: optionalString,
  serial_number: optionalString,
  plate_number: optionalString,
  chassis_number: optionalString,
  engine_number: optionalString,
  purchase_date: optionalDate,
  warranty_expiry_date: optionalDate,
  registration_expiry_date: optionalDate,
  insurance_expiry_date: optionalDate,
  current_kilometer_reading: optionalNumber,
  current_running_hours: optionalNumber,
  assigned_operator_driver: optionalString,
  status: z.string().trim().min(2),
  next_service_date: optionalDate,
  next_service_kilometer: optionalNumber,
  next_service_running_hours: optionalNumber,
  notes: optionalString
});

const partSchema = z.object({
  id: optionalUuid,
  part_code: z.string().trim().min(2).max(60),
  part_name: z.string().trim().min(2).max(160),
  description: optionalString,
  category: optionalString,
  part_number: optionalString,
  ss_rec_code: optionalString,
  unit_of_measure: z.string().trim().min(1).max(20),
  current_stock: optionalNumber.default(0),
  minimum_stock: optionalNumber.default(0),
  unit_price: optionalNumber.default(0),
  supplier: optionalString,
  store_location_bin: optionalString,
  compatible_asset_categories: optionalString,
  status: z.string().trim().min(2),
  notes: optionalString
});

const workOrderSchema = z.object({
  id: optionalUuid,
  ordered_by: z.string().trim().min(2).max(160),
  requested_by_department_id: optionalUuid,
  asset_id: optionalUuid,
  asset_category: optionalString,
  serial_number: optionalString,
  plate_number: optionalString,
  date_of_order: z.string().min(8),
  job_location: optionalString,
  starting_datetime: optionalString,
  ending_datetime: optionalString,
  maintenance_type: z.string().trim().min(2),
  worker_type: z.string().trim().min(2),
  running_hours: optionalNumber,
  kilometers: optionalNumber,
  operator_complaint: optionalString,
  description_of_work: optionalString,
  priority: z.string().trim().min(2),
  status: z.string().trim().min(2).optional(),
  assigned_supervisor_id: optionalUuid,
  operator_requester_confirmation: optionalString,
  supervisor_verification: optionalString,
  maintenance_manager_closure: optionalString,
  next_service_date: optionalDate,
  next_service_kilometer: optionalNumber,
  next_service_running_hours: optionalNumber,
  notes: optionalString
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clean<T extends Record<string, unknown>>(input: T): any {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === undefined ? null : value]));
}

function rowValue(formData: FormData, name: string, index: number) {
  return String(formData.get(`${name}_${index}`) ?? "").trim();
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLaborRows(formData: FormData) {
  return [0, 1, 2, 3, 4]
    .map((index) => {
      const labor_name = rowValue(formData, "labor_name", index);
      if (!labor_name) return null;
      return {
        labor_name,
        employee_number: rowValue(formData, "labor_employee_number", index) || null,
        hours: numberValue(rowValue(formData, "labor_hours", index)),
        rate: numberValue(rowValue(formData, "labor_rate", index))
      };
    })
    .filter(Boolean);
}

function parseMaterialRows(formData: FormData) {
  return [0, 1, 2, 3, 4]
    .map((index) => {
      const material_name = rowValue(formData, "material_name", index);
      if (!material_name) return null;
      return {
        material_name,
        part_number: rowValue(formData, "material_part_number", index) || null,
        ss_rec_code: rowValue(formData, "material_ss_rec_code", index) || null,
        quantity: numberValue(rowValue(formData, "material_quantity", index)),
        unit_price: numberValue(rowValue(formData, "material_unit_price", index))
      };
    })
    .filter(Boolean);
}

function parseAttachmentRows(formData: FormData) {
  return [0, 1]
    .map((index) => {
      const file_name = rowValue(formData, "attachment_file_name", index);
      const file_path = rowValue(formData, "attachment_file_path", index);
      if (!file_name || !file_path) return null;
      return {
        attachment_type: rowValue(formData, "attachment_type", index) || "Photo",
        file_name,
        file_path
      };
    })
    .filter(Boolean);
}

export async function upsertAssetAction(formData: FormData) {
  const context = await requirePermission("assets.manage");
  const parsed = assetSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/assets?error=invalid-input");

  const { id, ...values } = parsed.data;
  let data: { id: string; asset_code: string } | undefined;
  try {
    data = id
      ? await prisma.assets.update({ where: { id }, data: clean({ ...values, updated_by: context.userId }), select: { id: true, asset_code: true } })
      : await prisma.assets.create({ data: clean({ ...values, updated_by: context.userId, created_by: context.userId }), select: { id: true, asset_code: true } });
  } catch {
    redirect("/assets?error=save-failed");
  }
  if (!data) redirect("/assets?error=save-failed");

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "asset.update" : "asset.create",
    entityType: "asset",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} asset ${data.asset_code}`,
    metadata: { category: parsed.data.category, status: parsed.data.status }
  });

  revalidatePath("/assets");
  redirect(`/assets/${data.id}?success=asset-saved`);
}

export async function upsertPartAction(formData: FormData) {
  const context = await requirePermission("parts.manage");
  const parsed = partSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/store/parts?error=invalid-input");

  const { id, compatible_asset_categories, ...values } = parsed.data;
  const categories = compatible_asset_categories?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  let data: { id: string; part_code: string } | undefined;
  try {
    data = id
      ? await prisma.parts.update({ where: { id }, data: clean({ ...values, compatible_asset_categories: categories, updated_by: context.userId }), select: { id: true, part_code: true } })
      : await prisma.parts.create({ data: clean({ ...values, compatible_asset_categories: categories, updated_by: context.userId, created_by: context.userId }), select: { id: true, part_code: true } });
  } catch {
    redirect("/store/parts?error=save-failed");
  }
  if (!data) redirect("/store/parts?error=save-failed");

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "part.update" : "part.create",
    entityType: "part",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} part ${data.part_code}`,
    metadata: { stock: parsed.data.current_stock, status: parsed.data.status }
  });

  revalidatePath("/store/parts");
  redirect("/store/parts?success=part-saved");
}

// Maps the first failing Zod field path to a user-readable error key shown in the form.
const WO_FIELD_ERROR_KEYS: Record<string, string> = {
  ordered_by:                   "missing-ordered-by",
  requested_by_department_id:   "missing-department",
  operator_complaint:           "missing-complaint",
  description_of_work:          "missing-description",
  maintenance_type:             "missing-type",
  worker_type:                  "missing-team",
  priority:                     "missing-priority",
  date_of_order:                "missing-date",
};

export async function upsertWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.manage");

  // Determine redirect target before parsing so we can send users back to the correct form.
  const rawId = String(formData.get("id") ?? "").trim();
  const isEdit = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
  const formBackHref = isEdit
    ? `/maintenance/work-orders/${rawId}/edit`
    : "/maintenance/work-orders/new";

  const parsed = workOrderSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const firstField = String(parsed.error.issues[0]?.path?.[0] ?? "");
    const errKey = WO_FIELD_ERROR_KEYS[firstField] ?? "invalid-input";
    redirect(`${formBackHref}?error=${errKey}`);
  }

  // Status transitions must happen through dedicated workflow actions only.
  // This action only handles draft creation and metadata edits on Draft/Rejected WOs.
  const ALLOWED_CREATE_STATUSES = ["Draft", "Pending Approval"];
  const EDITABLE_STATUSES = ["Draft", "Rejected"];
  const { id, status, ...values } = parsed.data;
  // Hoist createStatus so recovery draft logic can reference it outside the if block.
  const createStatus = !id ? (status ?? "Draft") : "Draft";

  if (!id) {
    // New work order: only allow safe initial statuses from the submit buttons.
    if (!ALLOWED_CREATE_STATUSES.includes(createStatus)) {
      redirect(`${formBackHref}?error=invalid-status`);
    }
    // Submit-specific validation: department, complaint, and description are required
    // when the user clicks "Submit for Approval" (not required for Save Draft).
    if (createStatus === "Pending Approval") {
      if (!parsed.data.requested_by_department_id) redirect(`${formBackHref}?error=missing-department`);
      if (!parsed.data.operator_complaint) redirect(`${formBackHref}?error=missing-complaint`);
      if (!parsed.data.description_of_work) redirect(`${formBackHref}?error=missing-description`);
    }
  }

  let existingStatus: string | null = null;

  if (id) {
    // Existing work order: only allow metadata edits when WO is in a draft/rejected state.
    let existing: { status: string } | null = null;
    try {
      existing = await prisma.work_orders.findUnique({ where: { id }, select: { status: true } });
    } catch {
      redirect("/maintenance/work-orders?error=not-found");
    }
    if (!existing) redirect("/maintenance/work-orders?error=not-found");
    if (!EDITABLE_STATUSES.includes(existing.status)) {
      redirect(`/maintenance/work-orders/${id}?error=not-editable`);
    }
    existingStatus = existing.status;
  }

  const laborRows = parseLaborRows(formData);
  const materialRows = parseMaterialRows(formData);
  const attachmentRows = parseAttachmentRows(formData);
  const totalLabor = laborRows.reduce((sum, row) => sum + (row?.hours ?? 0) * (row?.rate ?? 0), 0);
  const totalMaterials = materialRows.reduce((sum, row) => sum + (row?.quantity ?? 0) * (row?.unit_price ?? 0), 0);

  const basePayload = clean({
    ...values,
    starting_datetime: values.starting_datetime || null,
    ending_datetime: values.ending_datetime || null,
    total_labor_cost: totalLabor,
    total_material_cost: totalMaterials,
    updated_by: context.userId,
    created_by: context.userId
  });

  // When editing a Rejected WO, auto-return it to Draft so "Submit for approval"
  // becomes available immediately — without requiring a separate "Return to Draft" step.
  // The DB trigger (work_orders_status_change) writes the status history entry automatically.
  const updatePayload = existingStatus === "Rejected"
    ? { ...basePayload, status: "Draft" }
    : basePayload;

  // Status is set on create only — never changed by this action on updates (except Rejected→Draft above).
  const insertPayload = { ...basePayload, status: createStatus };

  let data: { id: string; work_order_number: string | null } | null = null;
  try {
    data = id
      ? await prisma.work_orders.update({ where: { id }, data: updatePayload, select: { id: true, work_order_number: true } })
      : await prisma.work_orders.create({ data: insertPayload, select: { id: true, work_order_number: true } });
  } catch (saveError) {
    console.error("[maintenance.upsertWorkOrderAction] Save failed:", {
      source: "maintenance.upsertWorkOrderAction",
      severity: "error",
      code: (saveError as { code?: string } | null)?.code ?? null,
      message: saveError instanceof Error ? saveError.message : "save failed",
      meta: (saveError as { meta?: unknown } | null)?.meta ?? null,
      isEdit: !!id,
    });

    // Auto-recovery: if a new WO submit failed, try saving the data as a Draft so the
    // user does not lose their work. Redirect to the recovered draft with a warning banner.
    let recoveredWoId: string | null = null;
    if (!id && createStatus === "Pending Approval") {
      try {
        const recovered = await prisma.work_orders.create({
          data: { ...insertPayload, status: "Draft" },
          select: { id: true, work_order_number: true }
        });
        const recoveredId = recovered.id;
        if (laborRows.length) {
          await prisma.work_order_labor.createMany({ data: laborRows.map((row) => ({ ...row!, work_order_id: recoveredId })) });
        }
        if (materialRows.length) {
          await prisma.work_order_materials.createMany({ data: materialRows.map((row) => ({ ...row!, work_order_id: recoveredId })) });
        }
        await writeAuditLog({
          actorId: context.userId,
          action: "work_order.create",
          entityType: "work_order",
          entityId: recoveredId,
          summary: `Recovery draft saved after submit failure: ${recovered.work_order_number}`,
          metadata: { status: "Draft", worker_type: parsed.data.worker_type }
        });
        await emitRealtimeEvent({
          eventType: REALTIME_EVENTS.WORK_ORDER_CREATED,
          entityType: "work_order",
          entityId: recoveredId,
          actorProfileId: context.userId,
          departmentId: parsed.data.requested_by_department_id ?? null,
          payload: {
            work_order_number: recovered.work_order_number ?? undefined,
            maintenance_type: parsed.data.maintenance_type,
            worker_type: parsed.data.worker_type,
            priority: parsed.data.priority,
          },
        });
        recoveredWoId = recoveredId;
      } catch {
        // Recovery attempt failed — fall through to save-failed redirect
      }
    }

    if (recoveredWoId) {
      redirect(`/maintenance/work-orders/${recoveredWoId}?warning=recovery-draft-saved`);
    }
    redirect(`${formBackHref}?error=save-failed`);
  }
  if (!data) redirect(`${formBackHref}?error=save-failed`);

  if (id) {
    await Promise.all([
      prisma.work_order_labor.deleteMany({ where: { work_order_id: id } }),
      prisma.work_order_materials.deleteMany({ where: { work_order_id: id } }),
      prisma.work_order_attachments.deleteMany({ where: { work_order_id: id } })
    ]);
  }

  const work_order_id = data.id;
  if (laborRows.length) await prisma.work_order_labor.createMany({ data: laborRows.map((row) => ({ ...row!, work_order_id })) });
  if (materialRows.length) await prisma.work_order_materials.createMany({ data: materialRows.map((row) => ({ ...row!, work_order_id })) });
  if (attachmentRows.length) await prisma.work_order_attachments.createMany({ data: attachmentRows.map((row) => ({ ...row!, work_order_id, uploaded_by: context.userId })) });

  const auditStatus = id
    ? (existingStatus === "Rejected" ? "Rejected→Draft" : "(preserved)")
    : (status ?? "Draft");

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "work_order.update" : "work_order.create",
    entityType: "work_order",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} work order ${data.work_order_number}`,
    metadata: { status: auditStatus, worker_type: parsed.data.worker_type }
  });

  if (!id && status && ["Submitted", "Pending Approval"].includes(status)) {
    await notifyByEvent({
      eventKey: "work_order.submitted",
      entityType: "work_order",
      entityId: data.id,
      actorId: context.userId,
      recipientRoles: ["super_admin", "maintenance_manager"],
      metadata: {
        work_order_number: data.work_order_number,
        asset_name: parsed.data.asset_id ? "selected asset" : "unassigned asset"
      },
      actionUrl: `/maintenance/work-orders/${data.id}`,
      actionLabel: "Review work order"
    });
  }

  await emitRealtimeEvent({
    eventType: id ? REALTIME_EVENTS.WORK_ORDER_SAVED : REALTIME_EVENTS.WORK_ORDER_CREATED,
    entityType: "work_order",
    entityId: data.id,
    actorProfileId: context.userId,
    departmentId: parsed.data.requested_by_department_id ?? null,
    payload: {
      work_order_number: data.work_order_number ?? undefined,
      maintenance_type: parsed.data.maintenance_type,
      worker_type: parsed.data.worker_type,
      priority: parsed.data.priority,
    },
  });

  revalidatePath("/maintenance/work-orders");
  redirect(`/maintenance/work-orders/${data.id}?success=work-order-saved`);
}
