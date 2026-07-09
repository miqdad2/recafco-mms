"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { logSystemError } from "@/lib/errors/logging";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { createMaintenanceWorkflowInstanceForWorkOrder } from "@/lib/backend/workflows/engine";
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
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}, z.date().optional());

const requiredDate = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}, z.date());

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
  notes: optionalString,
  condition: optionalString,
  criticality: optionalString,
  remarks: optionalString
});

const partSchema = z.object({
  id: optionalUuid,
  part_code: z.string().trim().max(60).optional().default(""),
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
  date_of_order: requiredDate,
  job_location: optionalString,
  starting_datetime: optionalDate,
  ending_datetime: optionalDate,
  maintenance_type: z.string().trim().min(2),
  worker_type: z.string().trim().min(2),
  running_hours: optionalNumber,
  kilometers: optionalNumber,
  operator_complaint: optionalString,
  description_of_work: optionalString,
  priority: z.string().trim().min(2),
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

function parseRequiredPartRows(formData: FormData) {
  return [0, 1, 2, 3, 4, 5, 6, 7]
    .map((index) => {
      const description = rowValue(formData, "req_part_description", index);
      if (!description) return null;
      const qty = numberValue(rowValue(formData, "req_part_quantity", index));
      return {
        description,
        part_number: rowValue(formData, "req_part_part_number", index) || null,
        quantity_required: qty > 0 ? qty : 1,
        unit_of_measure: rowValue(formData, "req_part_uom", index) || "PCS",
        notes: rowValue(formData, "req_part_notes", index) || null,
        availability_status: "unchecked"
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
  } catch (saveError) {
    const rawMessage = saveError instanceof Error ? saveError.message : "save failed";
    console.error("[maintenance.upsertAssetAction] Save failed:", {
      source: "maintenance.upsertAssetAction",
      severity: "error",
      code: (saveError as { code?: string } | null)?.code ?? null,
      message: rawMessage,
      meta: (saveError as { meta?: unknown } | null)?.meta ?? null,
      isEdit: !!id,
    });
    await logSystemError({
      source: "maintenance.upsertAssetAction",
      severity: "error",
      // Prisma's actual validation detail is usually at the END of the message
      // (after the pretty-printed query dump), so keep the tail, not the head.
      message: rawMessage.slice(-1500),
      userId: context.userId,
      route: "/assets",
      entityType: "asset",
      metadata: {
        code: (saveError as { code?: string } | null)?.code ?? null,
        meta: JSON.stringify((saveError as { meta?: unknown } | null)?.meta ?? null),
        isEdit: !!id,
      },
    });
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

  const { id, compatible_asset_categories, part_code: rawCode, ...values } = parsed.data;
  const categories = compatible_asset_categories?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];

  // Auto-generate part code if not supplied on create; leave undefined on edit (DB retains existing)
  const part_code: string | undefined = rawCode?.trim()
    ? rawCode.trim()
    : !id
      ? `PT-${Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, "0").toUpperCase()}`
      : undefined;

  let data: { id: string; part_code: string } | undefined;
  try {
    data = id
      ? await prisma.parts.update({ where: { id }, data: clean({ ...values, ...(part_code ? { part_code } : {}), compatible_asset_categories: categories, updated_by: context.userId }), select: { id: true, part_code: true } })
      : await prisma.parts.create({ data: clean({ ...values, part_code, compatible_asset_categories: categories, updated_by: context.userId, created_by: context.userId }), select: { id: true, part_code: true } });
  } catch (saveError) {
    console.error("[maintenance.upsertPartAction] Save failed:", {
      source: "maintenance.upsertPartAction",
      severity: "error",
      code: (saveError as { code?: string } | null)?.code ?? null,
      message: saveError instanceof Error ? saveError.message : "save failed",
      meta: (saveError as { meta?: unknown } | null)?.meta ?? null,
      isEdit: !!id,
    });
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

  // Read the intent flag — the form submits "save_draft" or "submit_for_approval",
  // never a raw status string. createStatus is derived here; any status field in
  // formData is ignored completely, so injecting status=Closed has no effect.
  const rawIntent = String(formData.get("intent") ?? "").trim();
  if (!isEdit && rawIntent !== "save_draft" && rawIntent !== "submit_for_approval") {
    redirect(`${formBackHref}?error=invalid-status`);
  }
  const createStatus = rawIntent === "submit_for_approval" ? "Pending Approval" : "Draft";

  const parsed = workOrderSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const firstField = String(parsed.error.issues[0]?.path?.[0] ?? "");
    const errKey = WO_FIELD_ERROR_KEYS[firstField] ?? "invalid-input";
    redirect(`${formBackHref}?error=${errKey}`);
  }

  // Status transitions must happen through dedicated workflow actions only.
  // This action only handles draft creation and metadata edits on Draft/Rejected WOs.
  const EDITABLE_STATUSES = ["Draft", "Rejected"];
  const { id, ...values } = parsed.data;

  if (!id) {
    // Submit-specific validation: department, complaint, and description are required
    // when the user clicks "Submit for Approval" (not required for Save Draft).
    if (createStatus === "Pending Approval") {
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
  const requiredPartRows = parseRequiredPartRows(formData);
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
    if (!id && createStatus === "Pending Approval") {
      // New WO submitted for approval: create WO + workflow tracking rows atomically.
      // If workflow rows cannot be created, the entire transaction rolls back so submitted
      // work orders are never left without a tracking record.
      data = await withBackendTransaction(context.userId, async (tx) => {
        const wo = await tx.work_orders.create({
          data: insertPayload,
          select: { id: true, work_order_number: true }
        });
        await createMaintenanceWorkflowInstanceForWorkOrder(tx, wo.id, context.userId);
        return wo;
      });
    } else {
      data = id
        ? await prisma.work_orders.update({ where: { id }, data: updatePayload, select: { id: true, work_order_number: true } })
        : await prisma.work_orders.create({ data: insertPayload, select: { id: true, work_order_number: true } });
    }
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
        if (requiredPartRows.length) {
          await prisma.workOrderRequiredPart.createMany({ data: requiredPartRows.map((row) => ({ ...row!, work_order_id: recoveredId, created_by: context.userId })) });
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
      prisma.work_order_attachments.deleteMany({ where: { work_order_id: id } }),
      prisma.workOrderRequiredPart.deleteMany({ where: { work_order_id: id } })
    ]);
  }

  const work_order_id = data.id;
  if (laborRows.length) await prisma.work_order_labor.createMany({ data: laborRows.map((row) => ({ ...row!, work_order_id })) });
  if (materialRows.length) await prisma.work_order_materials.createMany({ data: materialRows.map((row) => ({ ...row!, work_order_id })) });
  if (attachmentRows.length) await prisma.work_order_attachments.createMany({ data: attachmentRows.map((row) => ({ ...row!, work_order_id, uploaded_by: context.userId })) });
  if (requiredPartRows.length) await prisma.workOrderRequiredPart.createMany({ data: requiredPartRows.map((row) => ({ ...row!, work_order_id, created_by: context.userId })) });

  const auditStatus = id
    ? (existingStatus === "Rejected" ? "Rejected→Draft" : "(preserved)")
    : createStatus;

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "work_order.update" : "work_order.create",
    entityType: "work_order",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} work order ${data.work_order_number}`,
    metadata: { status: auditStatus, worker_type: parsed.data.worker_type }
  });

  if (!id && createStatus === "Pending Approval") {
    let asset_name = "unassigned asset";
    if (parsed.data.asset_id) {
      const asset = await prisma.assets.findUnique({ where: { id: parsed.data.asset_id }, select: { asset_name: true } }).catch(() => null);
      asset_name = asset?.asset_name ?? "unknown asset";
    }

    await notifyByEvent({
      eventKey: "work_order.submitted",
      entityType: "work_order",
      entityId: data.id,
      actorId: context.userId,
      recipientRoles: ["super_admin", "maintenance_manager"],
      metadata: {
        work_order_number: data.work_order_number,
        asset_name
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

// ── Record a material / part used on an existing work order ───────────────────

export async function addWorkOrderMaterialAction(formData: FormData) {
  const context = await requirePermission("work_orders.manage");

  const workOrderId = z.string().uuid().safeParse(formData.get("work_order_id"));
  if (!workOrderId.success) redirect("/maintenance/work-orders?error=invalid-input");

  const returnTo = `/maintenance/work-orders/${workOrderId.data}`;

  const partId = z.string().uuid().optional().safeParse(
    (() => { const v = String(formData.get("part_id") ?? "").trim(); return v || undefined; })()
  );
  const qty = z.preprocess((v) => Number(v), z.number().positive().finite()).safeParse(formData.get("quantity"));
  if (!qty.success) redirect(`${returnTo}?error=invalid-input`);

  const wo = await prisma.work_orders.findFirst({
    where: { id: workOrderId.data, deleted_at: null },
    select: { id: true, work_order_number: true, status: true },
  });
  if (!wo) redirect(`${returnTo}?error=not-found`);

  const TERMINAL = new Set(["Closed", "Cancelled", "Rejected"]);
  if (TERMINAL.has(wo.status)) redirect(`${returnTo}?error=invalid-status`);

  let materialName = String(formData.get("material_name") ?? "").trim();
  let partNumber: string | null = null;
  let ssRecCode: string | null = null;
  let resolvedPartId: string | null = null;

  if (partId.success && partId.data) {
    const part = await prisma.parts.findUnique({
      where: { id: partId.data },
      select: { part_name: true, part_number: true, ss_rec_code: true },
    });
    if (part) {
      materialName = part.part_name;
      partNumber = part.part_number ?? null;
      ssRecCode = part.ss_rec_code ?? null;
      resolvedPartId = partId.data;
    }
  }

  if (!materialName) redirect(`${returnTo}?error=invalid-input`);

  await prisma.work_order_materials.create({
    data: {
      work_order_id: wo.id,
      part_id: resolvedPartId,
      material_name: materialName,
      part_number: partNumber,
      ss_rec_code: ssRecCode,
      quantity: qty.data,
      unit_price: 0,
    },
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "work_order_materials.add",
    entityType: "work_order",
    entityId: wo.id,
    summary: `Recorded ${materialName} (qty ${qty.data}) used on ${wo.work_order_number}`,
    metadata: { material_name: materialName, quantity: qty.data },
  });

  revalidatePath(`/maintenance/work-orders/${wo.id}`);
  redirect(`${returnTo}?success=material-added`);
}
