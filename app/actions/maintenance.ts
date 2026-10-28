"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";

import { requireAssetManage, requirePermission, requireUser } from "@/lib/auth/context";
import { ASSET_MANAGE_DENIED_MESSAGE, canManageAssets } from "@/lib/security/permissions";
import { writeAuditLog } from "@/lib/audit/log";
import { logSystemError } from "@/lib/errors/logging";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { emitRealtimeEvent, emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { prisma } from "@/lib/db/prisma";
import { parsePendingAttachments, saveAttachmentBatch } from "@/lib/files/attachment-form";
import { MAX_ATTACHMENT_ROWS } from "@/lib/files/attachment-constants";
import { createJobCardFromForm } from "@/lib/backend/work-orders/job-card-creation";
import { lockJobCardActivity } from "@/lib/backend/work-orders/repository";
import { formatKuwaitDateTime } from "@/lib/format/kuwait-time";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import {
  diffJobCardEdit,
  formatJobCardDate,
  isJobCardEditable,
  lineItemsUnchanged,
  type JobCardEditSnapshot,
} from "@/lib/work-orders/job-card-edit";
import type { Prisma } from "@prisma/client";
import {
  cleanPayload,
  parseAttachmentRows,
  parseLaborRows,
  parseMaterialRows,
  parseRequiredPartRows,
  RequiredPartRowError,
  workOrderSchema,
  type ParsedRequiredPartRow,
} from "@/lib/work-orders/job-card-form";
import { extractBrand, resolveModelAndYear, CODE_TOKEN, NEEDS_REVIEW_LEAF } from "@/lib/assets/asset-excel-mapping";

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

// Same bounds as the Excel importer's model-year validation (1970 to next
// year), so manual entry and bulk import agree on what a valid year is.
const optionalYear = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}, z.number().int().min(1970).max(new Date().getFullYear() + 1).optional());

// Asset Register Import Mapping and New Asset Form Update Unit 10G.34, Task
// 11/12: the simple asset form only submits Asset Type, Make / Asset Name,
// a single combined Model / Year field, File No., Colour, Plate No.,
// Expires On, Chassis No., Department / Location, Responsible Person /
// Driver, Remarks, and Status. `asset_code` is optional here and
// auto-generated server-side on create (never required from the user).
// `model_input` (the raw "Model / Year" text) and `file_number`/`colour`
// (composed into `notes`) are resolved in upsertAssetAction, not written
// directly — see lib/assets/asset-excel-mapping.ts's resolveModelAndYear,
// the same logic the Excel importer uses, so manual entry and bulk import
// agree on what counts as a year vs. a spec string. Every field this form
// no longer shows (brand, serial/engine number, purchase/warranty dates,
// kilometer/running-hour readings, next-service fields, condition,
// criticality) is preserved via hidden inputs on edit rather than being
// silently nulled out — `clean()` below turns any *missing* key into null.
const assetSchema = z.object({
  id: optionalUuid,
  asset_code: optionalString,
  asset_name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2),
  department_id: optionalUuid,
  location: optionalString,
  brand: optionalString,
  model: optionalString,
  model_input: optionalString,
  model_year: optionalYear,
  serial_number: optionalString,
  plate_number: optionalString,
  chassis_number: optionalString,
  engine_number: optionalString,
  file_number: optionalString,
  colour: optionalString,
  purchase_date: optionalDate,
  warranty_expiry_date: optionalDate,
  registration_expiry_date: optionalDate,
  insurance_expiry_date: optionalDate,
  current_kilometer_reading: optionalNumber,
  current_running_hours: optionalNumber,
  assigned_operator_driver: optionalString,
  status: z.string().trim().min(2).default("Active"),
  next_service_date: optionalDate,
  next_service_kilometer: optionalNumber,
  next_service_running_hours: optionalNumber,
  notes: optionalString,
  condition: optionalString,
  criticality: optionalString,
  remarks: optionalString,
  // New Asset Popup and Add Asset Type Unit 10G.38, Task 1/3: set only when
  // this form is rendered inside the Assets & Equipment page's New Asset
  // popup (never on the standalone /assets/new or /assets/[id]/edit pages,
  // which keep their existing "go to the asset's own detail page" redirect
  // unchanged) — on a successful CREATE, redirects back to this page
  // instead, with `?success=asset-added`, so the popup's parent page closes
  // the modal, refreshes its own data, and shows the toast in one step.
  redirect_to: optionalString
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function clean<T extends Record<string, unknown>>(input: T): any {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === undefined ? null : value]));
}

export async function upsertAssetAction(formData: FormData) {
  const context = await requireAssetManage();
  const parsed = assetSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/assets?error=invalid-input");

  const { id, model_input, file_number, colour, redirect_to, ...values } = parsed.data;

  // Task 12 — brand is always derived from Make / Asset Name, never a
  // separately-entered field; Model / Year is one combined input, split the
  // same way the Excel importer splits it (a 4-digit year -> model_year,
  // anything else -> model text).
  const brand = extractBrand(values.asset_name) ?? null;
  const { model, modelYear } = resolveModelAndYear(model_input ?? "");

  // File No. / Colour have no dedicated columns (Task 6/11) — composed into
  // `notes` fresh on every save, matching the Excel importer's own
  // "File #: X | Colour: Y" convention (see asset-excel-mapping.ts). Any
  // other structured notes an import may have written (Excel Sr#, month/
  // days-expired snapshot) are intentionally not preserved once a human
  // edits these two fields through this form — that snapshot data was
  // always non-authoritative reference-only text.
  const noteParts: string[] = [];
  if (file_number) noteParts.push(`File #: ${file_number}`);
  if (colour) noteParts.push(`Colour: ${colour}`);
  const composedNotes = noteParts.length > 0 ? noteParts.join(" | ") : values.notes;

  let assetCode = values.asset_code;
  if (!id && !assetCode) {
    const token = CODE_TOKEN[values.category] ?? CODE_TOKEN[NEEDS_REVIEW_LEAF];
    const existingCount = await prisma.assets.count({ where: { asset_code: { startsWith: `AST-${token}-` } } });
    assetCode = `AST-${token}-${String(existingCount + 1).padStart(4, "0")}`;
  }

  let data: { id: string; asset_code: string } | undefined;
  try {
    data = id
      ? await prisma.assets.update({ where: { id }, data: clean({ ...values, asset_code: assetCode, brand, model, model_year: modelYear, notes: composedNotes, updated_by: context.userId }), select: { id: true, asset_code: true } })
      : await prisma.assets.create({ data: clean({ ...values, asset_code: assetCode, brand, model, model_year: modelYear, notes: composedNotes, updated_by: context.userId, created_by: context.userId }), select: { id: true, asset_code: true } });
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
  // New Asset Popup and Add Asset Type Unit 10G.38, Task 3: when the New
  // Asset popup on the Assets & Equipment page submits this form, it sets
  // `redirect_to` (see assetSchema comment above) so the popup closes and
  // the Assets page itself refreshes with the success toast, instead of
  // navigating to the new asset's own detail page. Only applies to CREATE —
  // editing an existing asset always keeps the normal detail-page redirect.
  if (!id && redirect_to) redirect(`${redirect_to}?success=asset-added`);
  // Task 12 — "Asset added successfully." on create; edit keeps the
  // existing, more general "Asset saved" message.
  redirect(`/assets/${data.id}?success=${id ? "asset-saved" : "asset-added"}`);
}

// Title-case a free-typed name so casing/spacing variants ("water pump",
// "WATER PUMP", "  Water   Pump ") collapse to one canonical form ("Water
// Pump") before it is ever compared or stored — matches the naming style
// every existing asset type in this app already uses.
function titleCase(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(" ");
}

export type AddAssetTypeResult =
  | { ok: true; name: string; alreadyExisted: boolean }
  | { ok: false; error: string };

// New Asset Popup and Add Asset Type Unit 10G.38, Task 4/5/6/8: called
// directly from the New Asset popup's "+ Add new asset type" inline panel
// (not via a <form action>, since it needs a JSON-ish result back to update
// the dropdown in place rather than a page redirect). Reuses the existing
// `asset_categories` table — the same one the Excel importer already
// auto-creates unknown types into under "Other" — so there is exactly one
// place asset types live, per Task 8's "do not create a confusing new
// permission/data system".
export async function addAssetTypeAction(rawName: string): Promise<AddAssetTypeResult> {
  const context = await requireUser();
  if (!canManageAssets(context)) return { ok: false, error: ASSET_MANAGE_DENIED_MESSAGE };
  const canManageTypes = context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
  if (!canManageTypes) {
    return { ok: false, error: "You do not have permission to add asset types." };
  }

  const normalized = titleCase(typeof rawName === "string" ? rawName : "");
  if (normalized.length < 2) {
    return { ok: false, error: "Please enter an asset type name." };
  }

  const existing = await prisma.asset_categories.findFirst({
    where: { name: { equals: normalized, mode: "insensitive" } },
    select: { name: true }
  });
  if (existing) {
    return { ok: true, name: existing.name, alreadyExisted: true };
  }

  const otherParent = await prisma.asset_categories.findFirst({
    where: { parent_id: null, name: { equals: "Other", mode: "insensitive" } },
    select: { id: true }
  });

  await prisma.asset_categories.create({
    data: { name: normalized, parent_id: otherParent?.id ?? null, is_active: true }
  });

  revalidatePath("/assets");
  return { ok: true, name: normalized, alreadyExisted: false };
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

// Job Card edit audit trail: the request fields compared before/after an
// edit (lib/work-orders/job-card-edit.ts lists them). Display text only —
// names instead of ids, Kuwait time for date-times, no cost fields.
const JOB_CARD_EDIT_SNAPSHOT_SELECT = {
  ordered_by: true,
  asset_category: true,
  serial_number: true,
  plate_number: true,
  date_of_order: true,
  job_card_start_date: true,
  job_card_end_date: true,
  job_location: true,
  starting_datetime: true,
  ending_datetime: true,
  maintenance_type: true,
  worker_type: true,
  priority: true,
  running_hours: true,
  kilometers: true,
  estimated_labor_hours: true,
  operator_complaint: true,
  description_of_work: true,
  notes: true,
  next_service_date: true,
  next_service_kilometer: true,
  next_service_running_hours: true,
  departments: { select: { name: true } },
  assets: { select: { asset_code: true, asset_name: true } },
} satisfies Prisma.work_ordersSelect;

function jobCardEditSnapshot(row: Prisma.work_ordersGetPayload<{ select: typeof JOB_CARD_EDIT_SNAPSHOT_SELECT }>): JobCardEditSnapshot {
  const num = (value: Prisma.Decimal | null) => (value === null ? null : String(value.toNumber()));
  return {
    ordered_by: row.ordered_by,
    department: row.departments?.name ?? null,
    asset: row.assets ? `${row.assets.asset_code} - ${row.assets.asset_name}` : null,
    asset_category: row.asset_category,
    serial_number: row.serial_number,
    plate_number: row.plate_number,
    date_of_order: formatJobCardDate(row.date_of_order, ""),
    job_card_start_date: formatJobCardDate(row.job_card_start_date, ""),
    job_card_end_date: formatJobCardDate(row.job_card_end_date, ""),
    job_location: row.job_location,
    starting_datetime: formatKuwaitDateTime(row.starting_datetime, ""),
    ending_datetime: formatKuwaitDateTime(row.ending_datetime, ""),
    maintenance_type: row.maintenance_type,
    worker_type: row.worker_type,
    priority: row.priority,
    running_hours: num(row.running_hours),
    kilometers: num(row.kilometers),
    estimated_labor_hours: num(row.estimated_labor_hours),
    operator_complaint: row.operator_complaint,
    description_of_work: row.description_of_work,
    notes: row.notes,
    next_service_date: formatJobCardDate(row.next_service_date, ""),
    next_service_kilometer: num(row.next_service_kilometer),
    next_service_running_hours: num(row.next_service_running_hours),
  };
}

export async function upsertWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.manage");

  // Determine redirect target before parsing so we can send users back to the correct form.
  const rawId = String(formData.get("id") ?? "").trim();
  const isEdit = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawId);
  const formBackHref = isEdit
    ? `/maintenance/work-orders/${rawId}/edit`
    : "/maintenance/work-orders/new";
  if (rawId && !isEdit) redirect(`${formBackHref}?error=invalid-input`);

  // Job Card Creation Reliability: a NEW Job Card is created by the shared
  // create service (lib/backend/work-orders/job-card-creation.ts) — the
  // same one POST /api/job-cards uses for the New Job Card wizard — so there
  // is one create path with one transaction. This branch only serves the
  // legacy full-page create form (work-order-form.tsx), which has no
  // submission id of its own, so each post gets a fresh one. The intent
  // flag ("save_draft" / "submit_for_approval") is checked there; any status
  // field in formData is ignored, so injecting status=Closed has no effect.
  if (!isEdit) {
    const result = await createJobCardFromForm(context, formData, {
      submissionId: randomUUID(),
      correlationId: randomBytes(4).toString("hex").toUpperCase(),
      route: formBackHref,
    });
    if (!result.ok) {
      if (result.category === "validation") {
        const errKey = WO_FIELD_ERROR_KEYS[result.field ?? ""] ?? encodeURIComponent(result.message);
        redirect(`${formBackHref}?error=${errKey}`);
      }
      redirect(`${formBackHref}?error=${result.category === "bad_request" ? "invalid-status" : "save-failed"}`);
    }
    const { jobCard, warnings } = result;
    // New Job Card: the list + "Job Card Created" modal, never the full
    // detail page (JobCard-Creation-Visibility-HardFix-01 Task 5/7).
    redirect(
      `/maintenance/work-orders?scope=created&success=job-card-created&created=${jobCard.id}&preview=${jobCard.id}&jc=${encodeURIComponent(jobCard.number ?? "")}${warnings.attachmentsFailed ? "&warning=attachments-failed" : ""}${warnings.materialsRequestFailed ? "&mr_warning=1" : ""}${warnings.assignmentFailed ? "&assign_warning=1" : ""}`
    );
  }

  const parsed = workOrderSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const firstField = String(firstIssue?.path?.[0] ?? "");
    // Job Card Start / End Date: the range rule's own message ("End Date
    // cannot be earlier than the Start Date", ...) shown as the toast.
    if (firstField === "job_card_start_date" || firstField === "job_card_end_date") {
      redirect(`${formBackHref}?error=${encodeURIComponent(firstIssue?.message ?? "Please check the Job Card dates.")}`);
    }
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
  // The list lives in lib/work-orders/job-card-edit.ts (isJobCardEditable),
  // shared with the edit page and Daily Activity's Edit Job Card button.
  const id = rawId;
  const { id: _parsedId, ...values } = parsed.data;
  void _parsedId;

  // Existing work order: only allow metadata edits when WO is in an editable
  // state and the user may see it (same visibility filter as every other
  // Job Card query). Re-checked under the Job Card lock in the transaction.
  const visibilityFilter = getWorkOrderVisibilityFilter(context);
  let existing: { status: string } | null = null;
  try {
    existing = await prisma.work_orders.findFirst({ where: { AND: [{ id, deleted_at: null }, visibilityFilter] }, select: { status: true } });
  } catch {
    redirect("/maintenance/work-orders?error=not-found");
  }
  if (!existing) redirect("/maintenance/work-orders?error=not-found");
  if (!isJobCardEditable(existing.status)) {
    redirect(`/maintenance/work-orders/${id}?error=not-editable`);
  }
  const existingStatus = existing.status;

  const laborRows = parseLaborRows(formData);
  const materialRows = parseMaterialRows(formData);
  const attachmentRows = parseAttachmentRows(formData);
  let requiredPartRows: ParsedRequiredPartRow[];
  try {
    requiredPartRows = await parseRequiredPartRows(formData);
  } catch (error) {
    if (error instanceof RequiredPartRowError) redirect(`${formBackHref}?error=${encodeURIComponent(error.message)}`);
    throw error;
  }
  // The whole-number quantity rule applies only when required materials are
  // actually changed (checked in the transaction below) — re-saving rows the
  // wizard stored in a converted stock unit must not block a date edit.
  const requiredPartQuantityError = "Quantity must be a whole number greater than 0 (in the stock unit after conversion).";
  const pendingAttachments = parsePendingAttachments(formData, "doc_attachment", MAX_ATTACHMENT_ROWS);

  // The standalone edit form has no worker picker, so its own manual
  // estimated_labor_hours field (values.estimated_labor_hours) passes
  // through untouched. created_by is never changed by an edit (it used to be
  // overwritten with the editor, which misattributed the Job Card).
  // total_labor_cost / total_material_cost are set in the transaction from
  // the line-item rows the Job Card actually keeps.
  const basePayload = cleanPayload({
    ...values,
    starting_datetime: values.starting_datetime || null,
    ending_datetime: values.ending_datetime || null,
    job_card_start_date: values.job_card_start_date ?? null,
    job_card_end_date: values.job_card_end_date ?? null,
    updated_by: context.userId
  });

  // Legacy pre-Unit3 defensive branch: "Rejected" is no longer a reachable status
  // (removed from chk_work_orders_status), so existingStatus can never equal it for
  // new data — this is inert unless an old, not-yet-migrated row is edited, in which
  // case it now falls into "Under Review" (the closest new-model equivalent of the
  // old auto-return-to-Draft behavior) rather than the invalid "Draft" value.
  const updatePayload = existingStatus === "Rejected"
    ? { ...basePayload, status: "Under Review" }
    : basePayload;

  let data: { id: string; work_order_number: string | null } | null = null;
  // Set inside the transaction callback (a cast so TS doesn't narrow it to null).
  let refused = null as "not-found" | "not-editable" | "invalid-quantity" | null;
  try {
    // Backend Reliability Fix Unit 1, Task 2: the Job Card update and its
    // line-item replacement (deleteMany old rows + createMany new rows for
    // each changed labor/materials/attachments/required parts table) run
    // inside a single transaction, so no partial edit can persist.
    data = await withBackendTransaction(context.userId, async (tx) => {
      // Job Card lock first (same one deletion approval and closure-time
      // writes take), then re-read under it: a Job Card deleted or sent for
      // closure since the check above is refused, and the "before" values
      // for the audit trail are the ones this edit actually replaces.
      await lockJobCardActivity(tx, id);
      const before = await tx.work_orders.findFirst({
        where: { AND: [{ id, deleted_at: null }, visibilityFilter] },
        select: { status: true, ...JOB_CARD_EDIT_SNAPSHOT_SELECT },
      });
      if (!before) {
        refused = "not-found";
        return null;
      }
      if (!isJobCardEditable(before.status)) {
        refused = "not-editable";
        return null;
      }

      // Line items: replace a table only if the user changed what the form
      // showed (lib/work-orders/job-card-edit.ts lineItemsUnchanged). Same
      // order as the edit page, which pre-filled the form.
      const lineOrder = [{ created_at: "asc" as const }, { id: "asc" as const }];
      const [oldLabor, oldMaterials, oldAttachments, oldRequired] = await Promise.all([
        tx.work_order_labor.findMany({ where: { work_order_id: id }, orderBy: lineOrder }),
        tx.work_order_materials.findMany({ where: { work_order_id: id }, orderBy: lineOrder }),
        tx.work_order_attachments.findMany({ where: { work_order_id: id }, orderBy: lineOrder }),
        tx.workOrderRequiredPart.findMany({ where: { work_order_id: id }, orderBy: lineOrder }),
      ]);
      const laborKey = (r: { labor_name: string; employee_number: string | null; hours: unknown; rate: unknown }) =>
        [r.labor_name, r.employee_number || null, Number(r.hours), Number(r.rate)];
      const materialKey = (r: { material_name: string; part_number: string | null; ss_rec_code: string | null; quantity: unknown; unit_price: unknown }) =>
        [r.material_name, r.part_number || null, r.ss_rec_code || null, Number(r.quantity), Number(r.unit_price)];
      const attachmentKey = (r: { attachment_type: string; file_name: string; file_path: string }) => [r.attachment_type, r.file_name, r.file_path];
      const requiredKey = (r: { description: string; part_number: string | null; quantity_required: unknown; unit_of_measure: string; notes: string | null }) =>
        [r.description, r.part_number || null, Number(r.quantity_required), r.unit_of_measure, r.notes || null];
      const replaceLabor = !lineItemsUnchanged(laborRows.map((r) => laborKey(r!)), oldLabor.map(laborKey), 3);
      const replaceMaterials = !lineItemsUnchanged(materialRows.map((r) => materialKey(r!)), oldMaterials.map(materialKey), 3);
      const replaceAttachments = !lineItemsUnchanged(attachmentRows.map((r) => attachmentKey(r!)), oldAttachments.map(attachmentKey), 2);
      const replaceRequired = !lineItemsUnchanged(requiredPartRows.map(requiredKey), oldRequired.map(requiredKey), 8);
      if (replaceRequired && requiredPartRows.some((row) => !Number.isInteger(row.quantity_required) || row.quantity_required <= 0)) {
        refused = "invalid-quantity";
        return null;
      }
      const keptLabor = replaceLabor ? laborRows.map((r) => ({ hours: r!.hours, rate: r!.rate })) : oldLabor;
      const keptMaterials = replaceMaterials ? materialRows.map((r) => ({ quantity: r!.quantity, unit_price: r!.unit_price })) : oldMaterials;
      const totalLabor = keptLabor.reduce((sum, row) => sum + Number(row.hours) * Number(row.rate), 0);
      const totalMaterials = keptMaterials.reduce((sum, row) => sum + Number(row.quantity) * Number(row.unit_price), 0);

      const wo = await tx.work_orders.update({
        where: { id },
        data: { ...updatePayload, total_labor_cost: totalLabor, total_material_cost: totalMaterials },
        select: { id: true, work_order_number: true, ...JOB_CARD_EDIT_SNAPSHOT_SELECT }
      });

      // Edit audit trail (old → new, who, when) in the same transaction as
      // the edit, so an edit is never saved without its history row.
      const changes = diffJobCardEdit(jobCardEditSnapshot(before), jobCardEditSnapshot(wo));
      await tx.audit_logs.create({
        data: {
          actor_id: context.userId,
          action: "work_order.update",
          entity_type: "work_order",
          entity_id: id,
          summary: changes.length
            ? `Edited Job Card ${wo.work_order_number ?? ""}: ${changes.map((c) => c.label).join(", ")}`.slice(0, 500)
            : `Saved Job Card ${wo.work_order_number ?? ""} (no request details changed)`,
          metadata: {
            status: before.status === "Rejected" ? "Rejected→Under Review" : "(preserved)",
            worker_type: parsed.data.worker_type,
            changes,
            replacedLineItems: [
              ...(replaceLabor ? ["labor"] : []),
              ...(replaceMaterials ? ["materials"] : []),
              ...(replaceAttachments ? ["attachments"] : []),
              ...(replaceRequired ? ["required_materials"] : []),
            ],
          },
        },
      });

      if (replaceLabor) {
        await tx.work_order_labor.deleteMany({ where: { work_order_id: id } });
        if (laborRows.length) {
          await tx.work_order_labor.createMany({ data: laborRows.map((row) => ({ ...row!, work_order_id: id })) });
        }
      }
      if (replaceMaterials) {
        await tx.work_order_materials.deleteMany({ where: { work_order_id: id } });
        if (materialRows.length) {
          await tx.work_order_materials.createMany({ data: materialRows.map((row) => ({ ...row!, work_order_id: id })) });
        }
      }
      if (replaceAttachments) {
        await tx.work_order_attachments.deleteMany({ where: { work_order_id: id } });
        if (attachmentRows.length) {
          await tx.work_order_attachments.createMany({ data: attachmentRows.map((row) => ({ ...row!, work_order_id: id, uploaded_by: context.userId })) });
        }
      }
      if (replaceRequired) {
        await tx.workOrderRequiredPart.deleteMany({ where: { work_order_id: id } });
        if (requiredPartRows.length) {
          await tx.workOrderRequiredPart.createMany({ data: requiredPartRows.map((row) => ({ ...row!, work_order_id: id, created_by: context.userId })) });
        }
      }

      return { id: wo.id, work_order_number: wo.work_order_number };
    });
  } catch (saveError) {
    const rawMessage = saveError instanceof Error ? saveError.message : "save failed";
    console.error("[maintenance.upsertWorkOrderAction] Save failed:", {
      source: "maintenance.upsertWorkOrderAction",
      severity: "error",
      code: (saveError as { code?: string } | null)?.code ?? null,
      message: rawMessage,
      meta: (saveError as { meta?: unknown } | null)?.meta ?? null,
      isEdit: true,
    });
    // Enterprise Error Handling Audit Unit Task 9: matches the sibling
    // upsertAssetAction/upsertPartAction pattern.
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
        isEdit: true,
      },
    });
    redirect(`${formBackHref}?error=save-failed`);
  }
  if (refused === "not-found") redirect("/maintenance/work-orders?error=not-found");
  if (refused === "not-editable") redirect(`/maintenance/work-orders/${id}?error=not-editable`);
  if (refused === "invalid-quantity") redirect(`${formBackHref}?error=${encodeURIComponent(requiredPartQuantityError)}`);
  if (!data) redirect(`${formBackHref}?error=save-failed`);

  // Attachments posted with the edit — a partial or total upload failure
  // never rolls back the saved edit itself.
  let attachmentUploadFailed = false;
  if (pendingAttachments.length) {
    const savedAttachments = await saveAttachmentBatch("work-order-files", id, pendingAttachments);
    if (savedAttachments.length) {
      await prisma.work_order_attachments.createMany({
        data: savedAttachments.map((a) => ({
          work_order_id: id,
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
          entityId: id,
          summary: `Uploaded ${a.category} file to work order during creation`,
          metadata: { fileName: a.file.name, bucket: "work-order-files", remarks: a.remarks },
        });
      }
    }
    if (savedAttachments.length < pendingAttachments.length) attachmentUploadFailed = true;
  }

  // The work_order.update audit row (with old → new values) was written in
  // the edit transaction above.

  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.WORK_ORDER_SAVED,
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

  redirect(
    `/maintenance/work-orders/${data.id}?success=work-order-saved${attachmentUploadFailed ? "&warning=attachments-failed" : ""}`
  );
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
