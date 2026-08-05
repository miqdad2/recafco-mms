"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { logSystemError } from "@/lib/errors/logging";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { createMaintenanceWorkflowInstanceForWorkOrder } from "@/lib/backend/workflows/engine";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { createPartsRequest } from "@/lib/backend/parts-requests/service";
import { emitRealtimeEvent, emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { prisma } from "@/lib/db/prisma";
import { parsePendingAttachments, saveAttachmentBatch } from "@/lib/files/attachment-form";
import { MAX_ATTACHMENT_ROWS } from "@/lib/files/attachment-constants";
import { ACTIVE_JOB_CARD_STATUSES } from "@/lib/work-orders/simplified-status-display";
import { resolveMaterialMatchByKey } from "@/lib/store/offline-inventory-data";

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

// Same bounds as the Excel importer's model-year validation (1970 to next
// year), so manual entry and bulk import agree on what a valid year is.
const optionalYear = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}, z.number().int().min(1970).max(new Date().getFullYear() + 1).optional());

const assetSchema = z.object({
  id: optionalUuid,
  asset_code: z.string().trim().min(2).max(60),
  asset_name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2),
  department_id: optionalUuid,
  location: optionalString,
  brand: optionalString,
  model: optionalString,
  model_year: optionalYear,
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

// Required Materials Inventory Matching Unit 5, Task 6: re-verifies each
// row's client-side Offline Inventory match at save time instead of trusting
// it blindly — the balance may have moved since the wizard fetched it, or
// (rarely) the match may no longer exist. Only rows the user actually
// selected from the autocomplete dropdown carry a `req_part_material_key_i`
// value; a row with no key (hand-typed, never matched, or edited after
// matching — the wizard clears the key on every name edit) is saved as plain
// manual text with availability_status "unchecked" ("New Material") and is
// never independently re-searched by name here, so this can never silently
// re-link a row to a different material than the one the user picked.
async function parseRequiredPartRows(formData: FormData) {
  const rows = await Promise.all(
    [0, 1, 2, 3, 4, 5, 6, 7].map(async (index) => {
      const description = rowValue(formData, "req_part_description", index);
      if (!description) return null;
      const qty = numberValue(rowValue(formData, "req_part_quantity", index));
      const unit = rowValue(formData, "req_part_uom", index) || "PCS";
      const matchedKey = rowValue(formData, "req_part_material_key", index) || null;

      let availability_status = "unchecked";
      let part_id: string | null = null;
      if (matchedKey) {
        const resolution = await resolveMaterialMatchByKey(matchedKey);
        if (resolution.matched) {
          part_id = resolution.part_id;
          if (resolution.balance <= 0) availability_status = "unavailable";
          else if (qty <= resolution.balance) availability_status = "available";
          else availability_status = "partial";
        }
      }

      return {
        description,
        part_number: rowValue(formData, "req_part_part_number", index) || null,
        quantity_required: qty,
        unit_of_measure: unit,
        notes: rowValue(formData, "req_part_notes", index) || null,
        availability_status,
        part_id
      };
    })
  );
  return rows.filter(Boolean);
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

  // Enterprise Real-Time Notifications Unit Task 2 item L: quiet,
  // non-critical awareness ping only — Super Admin / Maintenance Manager,
  // not every role, per "notifications must be useful, not noisy".
  await notifyWorkflowEvent({
    eventKey: "asset.updated",
    entityType: "asset",
    entityId: data.id,
    actorId: context.userId,
    recipientRoles: ["super_admin", "maintenance_manager"],
    metadata: { asset_code: data.asset_code }
  });

  revalidatePath("/assets");
  revalidatePath("/dashboard");
  revalidatePath("/maintenance/work-orders");
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
    const rawMessage = saveError instanceof Error ? saveError.message : "save failed";
    console.error("[maintenance.upsertPartAction] Save failed:", {
      source: "maintenance.upsertPartAction",
      severity: "error",
      code: (saveError as { code?: string } | null)?.code ?? null,
      message: rawMessage,
      meta: (saveError as { meta?: unknown } | null)?.meta ?? null,
      isEdit: !!id,
    });
    // Enterprise Error Handling Audit Unit Task 9: matches the sibling
    // upsertAssetAction pattern above — this catch previously only logged to
    // stdout, leaving no system_error_logs trace.
    await logSystemError({
      source: "maintenance.upsertPartAction",
      severity: "error",
      message: rawMessage.slice(-1500),
      userId: context.userId,
      route: "/store/parts",
      entityType: "part",
      metadata: {
        code: (saveError as { code?: string } | null)?.code ?? null,
        meta: JSON.stringify((saveError as { meta?: unknown } | null)?.meta ?? null),
        isEdit: !!id,
      },
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
  revalidatePath("/store/parts-requests");
  revalidatePath("/dashboard");
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
  // Maintenance Workflow Redesign Unit 3: "Draft"/"Pending Approval" renamed to
  // "Created"/"Under Review" (no Draft status in the new simplified model —
  // "Created" is the equivalent safe/editable holding status).
  // Approval Workflow Unit 4 — Closure Approval Only: "submit_for_approval"
  // (the wizard's "Start Job Card" button, form field name kept as-is — see
  // components/work-orders/work-order-wizard.tsx) now creates the Job Card
  // directly at "Approved" (displayed as "Active") instead of "Under Review"
  // — there is no Manager approval before starting a Job Card any more.
  const rawIntent = String(formData.get("intent") ?? "").trim();
  if (!isEdit && rawIntent !== "save_draft" && rawIntent !== "submit_for_approval") {
    redirect(`${formBackHref}?error=invalid-status`);
  }
  const createStatus = rawIntent === "submit_for_approval" ? "Approved" : "Created";

  const parsed = workOrderSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const firstField = String(parsed.error.issues[0]?.path?.[0] ?? "");
    const errKey = WO_FIELD_ERROR_KEYS[firstField] ?? "invalid-input";
    redirect(`${formBackHref}?error=${errKey}`);
  }

  // Status transitions must happen through dedicated workflow actions only.
  // Approval Workflow Unit 4, business rules 4/10: Data Entry can update Job
  // Card details after starting it (no more "locked once approved" — there
  // is no approval before start any more), and Manager can edit too if
  // needed — so every "Active"-bucket status is now editable here, not just
  // Created/Under Review (legacy). "Closure Requested" and "Closed" stay
  // non-editable through this form — once closure is requested, the only
  // remaining step is Manager's closing decision (Task 7: no reject/return
  // path in this unit to send a Closure Requested Job Card back for edits).
  const EDITABLE_STATUSES = ["Created", "Under Review", ...ACTIVE_JOB_CARD_STATUSES];
  const { id, ...values } = parsed.data;

  if (!id) {
    // Operator complaint is required when submitting — description_of_work is optional.
    if (createStatus === "Approved") {
      if (!parsed.data.operator_complaint) redirect(`${formBackHref}?error=missing-complaint`);
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
  const requiredPartRows = await parseRequiredPartRows(formData);
  if (requiredPartRows.some((row) => row && (!Number.isInteger(row.quantity_required) || row.quantity_required <= 0))) {
    redirect(`${formBackHref}?error=${encodeURIComponent("Quantity must be a whole number greater than 0.")}`);
  }
  // Attachments step — optional, files ride along in this same multipart submission.
  const pendingAttachments = parsePendingAttachments(formData, "doc_attachment", MAX_ATTACHMENT_ROWS);
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

  // Legacy pre-Unit3 defensive branch: "Rejected" is no longer a reachable status
  // (removed from chk_work_orders_status), so existingStatus can never equal it for
  // new data — this is inert unless an old, not-yet-migrated row is edited, in which
  // case it now falls into "Under Review" (the closest new-model equivalent of the
  // old auto-return-to-Draft behavior) rather than the invalid "Draft" value.
  const updatePayload = existingStatus === "Rejected"
    ? { ...basePayload, status: "Under Review" }
    : basePayload;

  // Status is set on create only — never changed by this action on updates (except the
  // legacy Rejected branch above).
  const insertPayload = { ...basePayload, status: createStatus };

  let data: { id: string; work_order_number: string | null } | null = null;
  try {
    if (!id && createStatus === "Approved") {
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
    } else if (id) {
      // Backend Reliability Fix Unit 1, Task 2: the Job Card update and its
      // full line-item replacement (deleteMany old rows + createMany new rows
      // for labor/materials/attachments/required parts) now run inside a
      // single transaction. Previously these were separate, unguarded
      // statements after this block — a createMany failure after the
      // deleteMany calls could leave an edited Job Card with its line items
      // wiped. Any failure below rolls back the update and every delete/
      // recreate together, so no partial edit can persist.
      data = await withBackendTransaction(context.userId, async (tx) => {
        const wo = await tx.work_orders.update({
          where: { id },
          data: updatePayload,
          select: { id: true, work_order_number: true }
        });

        await Promise.all([
          tx.work_order_labor.deleteMany({ where: { work_order_id: id } }),
          tx.work_order_materials.deleteMany({ where: { work_order_id: id } }),
          tx.work_order_attachments.deleteMany({ where: { work_order_id: id } }),
          tx.workOrderRequiredPart.deleteMany({ where: { work_order_id: id } })
        ]);

        if (laborRows.length) {
          await tx.work_order_labor.createMany({ data: laborRows.map((row) => ({ ...row!, work_order_id: id })) });
        }
        if (materialRows.length) {
          await tx.work_order_materials.createMany({ data: materialRows.map((row) => ({ ...row!, work_order_id: id })) });
        }
        if (attachmentRows.length) {
          await tx.work_order_attachments.createMany({ data: attachmentRows.map((row) => ({ ...row!, work_order_id: id, uploaded_by: context.userId })) });
        }
        if (requiredPartRows.length) {
          await tx.workOrderRequiredPart.createMany({ data: requiredPartRows.map((row) => ({ ...row!, work_order_id: id, created_by: context.userId })) });
        }

        return wo;
      });
    } else {
      data = await prisma.work_orders.create({ data: insertPayload, select: { id: true, work_order_number: true } });
    }
  } catch (saveError) {
    const rawMessage = saveError instanceof Error ? saveError.message : "save failed";
    console.error("[maintenance.upsertWorkOrderAction] Save failed:", {
      source: "maintenance.upsertWorkOrderAction",
      severity: "error",
      code: (saveError as { code?: string } | null)?.code ?? null,
      message: rawMessage,
      meta: (saveError as { meta?: unknown } | null)?.meta ?? null,
      isEdit: !!id,
    });
    // Enterprise Error Handling Audit Unit Task 9: matches the sibling
    // upsertAssetAction/upsertPartAction pattern — this previously only
    // logged to stdout, leaving no system_error_logs trace.
    await logSystemError({
      source: "maintenance.upsertWorkOrderAction",
      severity: "error",
      message: rawMessage.slice(-1500),
      userId: context.userId,
      route: formBackHref,
      entityType: "work_order",
      metadata: {
        code: (saveError as { code?: string } | null)?.code ?? null,
        meta: JSON.stringify((saveError as { meta?: unknown } | null)?.meta ?? null),
        isEdit: !!id,
      },
    });

    // Auto-recovery: if a new WO submit failed, try saving the data as Created so the
    // user does not lose their work. Redirect to the recovered Job Card with a warning banner.
    let recoveredWoId: string | null = null;
    if (!id && createStatus === "Approved") {
      try {
        const recovered = await prisma.work_orders.create({
          data: { ...insertPayload, status: "Created" },
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
          summary: `Recovery save after submit failure: ${recovered.work_order_number}`,
          metadata: { status: "Created", worker_type: parsed.data.worker_type }
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

  const work_order_id = data.id;

  // Backend Reliability Fix Unit 1, Task 2: for a new Job Card there are no
  // existing line items to wipe, so this create-then-insert sequence carries
  // no partial-wipe risk and is left as-is. The edit path's equivalent
  // delete+recreate now runs inside the transaction above instead (see the
  // `id` branch of the save block).
  if (!id) {
    if (laborRows.length) await prisma.work_order_labor.createMany({ data: laborRows.map((row) => ({ ...row!, work_order_id })) });
    if (materialRows.length) await prisma.work_order_materials.createMany({ data: materialRows.map((row) => ({ ...row!, work_order_id })) });
    if (attachmentRows.length) await prisma.work_order_attachments.createMany({ data: attachmentRows.map((row) => ({ ...row!, work_order_id, uploaded_by: context.userId })) });
    if (requiredPartRows.length) await prisma.workOrderRequiredPart.createMany({ data: requiredPartRows.map((row) => ({ ...row!, work_order_id, created_by: context.userId })) });
  }

  // Critical Workflow Bug Fix: a Job Card created with "Required Parts" lines
  // must produce a real, linked Materials Request — otherwise those lines
  // stay disconnected (only visible as "N materials listed — no requests
  // submitted yet" in the quick-view) and never reach Engineer, Manager, or
  // Store. New Job Card only (never on edit — edits already delete+recreate
  // the required-parts rows above on every save, so re-running this on edit
  // would spawn a duplicate Materials Request each time). Uses the existing
  // Unit 3/5 createPartsRequest service so the duplicate-active-request
  // guard, notifications, and audit log are identical to a manually created
  // request — no business rule is re-implemented here.
  //
  // createPartsRequest opens its own transaction and looks the work order up
  // by id, so it cannot be nested inside the work order's own create
  // transaction — it runs as a second step right after the Job Card commits.
  // If it fails, the Job Card is NOT rolled back (it already exists and is
  // valid on its own); the failure is logged and the user is redirected with
  // a warning so they can add the Materials Request manually from the Job
  // Card, which remains fully supported (Task 4).
  let materialsRequestAutoCreateFailed = false;
  if (!id && requiredPartRows.length > 0) {
    try {
      await createPartsRequest(context, {
        workOrderId: work_order_id,
        remarks: "Auto-created from the Job Card's Required Parts list at creation.",
        items: requiredPartRows.map((row) => ({
          part_id: null,
          description: row!.description,
          part_number: row!.part_number,
          ss_rec_code: null,
          quantity_requested: row!.quantity_required,
          unit_price: 0,
          remarks: row!.notes,
        })),
      });
    } catch (autoRequestError) {
      materialsRequestAutoCreateFailed = true;
      const message = autoRequestError instanceof Error ? autoRequestError.message : String(autoRequestError);
      console.error("[maintenance.upsertWorkOrderAction] Auto Materials Request creation failed:", {
        workOrderId: work_order_id,
        message,
      });
      await logSystemError({
        severity: "error",
        source: "maintenance.upsertWorkOrderAction.autoMaterialsRequest",
        message: message.slice(0, 1000),
        stack: autoRequestError instanceof Error ? (autoRequestError.stack ?? null) : null,
        userId: context.userId,
        entityType: "work_order",
        entityId: work_order_id,
      });
    }
  }

  // Attachments from the wizard — uploaded only now that the work order exists.
  // A partial or total upload failure never rolls back the work order itself.
  let attachmentUploadFailed = false;
  if (pendingAttachments.length) {
    const savedAttachments = await saveAttachmentBatch("work-order-files", work_order_id, pendingAttachments);
    if (savedAttachments.length) {
      await prisma.work_order_attachments.createMany({
        data: savedAttachments.map((a) => ({
          work_order_id,
          attachment_type: a.category,
          file_name: a.file.name,
          file_path: a.path,
          content_type: a.file.type,
          file_size: a.file.size,
          uploaded_by: context.userId,
        })),
      });
      for (const a of savedAttachments) {
        await writeAuditLog({
          actorId: context.userId,
          action: "file.upload",
          entityType: "work_order",
          entityId: work_order_id,
          summary: `Uploaded ${a.category} file to work order during creation`,
          metadata: { fileName: a.file.name, bucket: "work-order-files", remarks: a.remarks },
        });
      }
    }
    if (savedAttachments.length < pendingAttachments.length) attachmentUploadFailed = true;
  }

  const auditStatus = id
    ? (existingStatus === "Rejected" ? "Rejected→Under Review" : "(preserved)")
    : createStatus;

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "work_order.update" : "work_order.create",
    entityType: "work_order",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} work order ${data.work_order_number}`,
    metadata: { status: auditStatus, worker_type: parsed.data.worker_type }
  });

  if (!id && createStatus === "Approved") {
    let asset_name = "unassigned asset";
    if (parsed.data.asset_id) {
      const asset = await prisma.assets.findUnique({ where: { id: parsed.data.asset_id }, select: { asset_name: true } }).catch(() => null);
      asset_name = asset?.asset_name ?? "unknown asset";
    }

    // Approval Workflow Unit 4: Manager is notified for awareness — no
    // approval action is required from them to start a Job Card any more
    // (business rule 9: Manager can view all Job Cards and their status).
    await notifyWorkflowEvent({
      eventKey: "job_card.created",
      entityType: "work_order",
      entityId: data.id,
      actorId: context.userId,
      recipientRoles: ["maintenance_manager"],
      metadata: {
        job_card_number: data.work_order_number,
        asset_name
      },
      actionUrl: `/maintenance/work-orders/${data.id}`
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
  revalidatePath("/dashboard");
  revalidatePath("/technician/jobs");

  if (id) {
    // Edits keep landing on the full detail page — only the create flow below
    // moves to the list + quick-view, so this behavior is unchanged.
    redirect(
      `/maintenance/work-orders/${data.id}?success=work-order-saved${attachmentUploadFailed ? "&warning=attachments-failed" : ""}`
    );
  }

  // New Job Card: redirect to the list — never the full detail page — and show
  // the bigger "Job Card Created" success modal there (JobCard-Creation-
  // Visibility-HardFix-01 Task 5/7). `created` and `preview` carry the same id:
  // `preview` drives the existing quick-view/drawerData fetch (unchanged
  // mechanism shared with dashboard row clicks etc.), `created` is the
  // explicit marker this task's spec asks for and a redundant fallback source
  // for the id if `preview` is ever absent/stripped. `scope=created` is now
  // mostly a debug/log marker — getWorkOrderVisibilityFilter() itself
  // guarantees created_by visibility unconditionally (Task 3), so this URL can
  // never resolve to an empty-because-of-scope list or a 404 detail page.
  const createRedirectUrl =
    `/maintenance/work-orders?scope=created&success=job-card-created&created=${data.id}&preview=${data.id}&jc=${encodeURIComponent(data.work_order_number ?? "")}${attachmentUploadFailed ? "&warning=attachments-failed" : ""}${materialsRequestAutoCreateFailed ? "&mr_warning=1" : ""}`;

  console.log("[maintenance.upsertWorkOrderAction] Job Card created:", {
    id: data.id,
    work_order_number: data.work_order_number,
    created_by: context.userId,
    status: createStatus,
    department_id: parsed.data.requested_by_department_id ?? null,
    redirectUrl: createRedirectUrl,
  });

  redirect(createRedirectUrl);
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

  // "Closed" is the only terminal status in the simplified model (Unit 4).
  const TERMINAL = new Set(["Closed"]);
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
  } else {
    // Free-text entry: read optional part_number from form
    const freePartNumber = String(formData.get("part_number_free") ?? "").trim();
    if (freePartNumber) partNumber = freePartNumber;
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

  await emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, wo.id, context.userId);

  revalidatePath(`/maintenance/work-orders/${wo.id}`);
  redirect(`${returnTo}?success=material-added`);
}
