import "server-only";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { logSystemError } from "@/lib/errors/logging";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { createMaintenanceWorkflowInstanceForWorkOrder } from "@/lib/backend/workflows/engine";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { createPartsRequest } from "@/lib/backend/parts-requests/service";
import { assignTechnicians } from "@/lib/backend/work-orders/service";
import { assignInternalTeamRoster } from "@/lib/backend/work-orders/worker-roster";
import { emitRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { prisma } from "@/lib/db/prisma";
import { parsePendingAttachments, saveAttachmentBatch, type PendingAttachment } from "@/lib/files/attachment-form";
import { MAX_ATTACHMENT_ROWS } from "@/lib/files/attachment-constants";
import { getFileSecuritySettings } from "@/lib/files/settings";
import { validatePrivateFileWithOptions } from "@/lib/files/validation";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import {
  cleanPayload,
  parseAttachmentRows,
  parseLaborRows,
  parseMaterialRows,
  parseRequiredPartRows,
  parseWizardAssignment,
  RequiredPartRowError,
  sumWorkerEstimates,
  workOrderSchema,
  type ParsedRequiredPartRow,
  type WizardAssignment,
} from "@/lib/work-orders/job-card-form";
import type {
  JobCardCreatedSummary,
  JobCardCreateResponse,
  JobCardCreateWarnings,
  JobCardFailureCategory,
  JobCardWizardStep,
} from "@/lib/work-orders/job-card-create-result";

// Job Card Creation Reliability — the one place a New Job Card is created
// (POST /api/job-cards for the wizard; upsertWorkOrderAction's create branch
// for the legacy full-page form). Rules:
//
//  - Everything is validated before anything is written, and a validation
//    problem comes back as { step, field, message } so the wizard can send
//    the user to the right step with the form intact.
//  - The Job Card and all its own rows (workflow instance, required
//    materials, legacy labor/material/attachment rows) are written in ONE
//    transaction, together with the caller's submission id. A retry with the
//    same id — a double click, or a resubmit after the connection dropped —
//    waits on a per-submission advisory lock, finds that Job Card and
//    returns it instead of creating a second one. The unique index on
//    work_orders.client_submission_id is the backstop.
//  - Success is only reported after that transaction commits. The follow-up
//    steps that have their own transactions (auto Materials Request, work
//    assignment, attachment files) run after it, exactly as before; a
//    failure there never undoes the Job Card and is returned as a warning.
//  - Every attempt writes one structured log line ("[job-card.create]")
//    carrying the reference shown to the user.

export class JobCardValidationError extends Error {
  constructor(
    readonly step: JobCardWizardStep,
    readonly field: string,
    message: string
  ) {
    super(message);
    this.name = "JobCardValidationError";
  }
}

type Intent = "save_draft" | "submit_for_approval";

type PreparedJobCard = {
  createStatus: "Created" | "Approved";
  values: Record<string, unknown>;
  insertPayload: Record<string, unknown>;
  laborRows: ReturnType<typeof parseLaborRows>;
  materialRows: ReturnType<typeof parseMaterialRows>;
  attachmentRows: ReturnType<typeof parseAttachmentRows>;
  requiredPartRows: ParsedRequiredPartRow[];
  wizardAssignment: WizardAssignment | null;
  pendingAttachments: PendingAttachment[];
  assetName: string | null;
};

// First failing schema field -> where it lives in the wizard and what to say.
const FIELD_PROBLEMS: Record<string, { step: JobCardWizardStep; message: string }> = {
  asset_id: { step: 1, message: "Please select an asset." },
  ordered_by: { step: 2, message: "Please enter who took the order (at least 2 letters)." },
  date_of_order: { step: 2, message: "Please enter the date of order." },
  maintenance_type: { step: 2, message: "Please select the maintenance type." },
  kilometers: { step: 2, message: "Please check the kilometer reading. It must be a number, 0 or more." },
  running_hours: { step: 2, message: "Please check the running hours. It must be a number, 0 or more." },
  job_location: { step: 2, message: "Please check the job location." },
  operator_complaint: { step: 2, message: "Please enter the operator complaint." },
  description_of_work: { step: 2, message: "Please check the description of work." },
  priority: { step: 2, message: "Please check the request details." },
  worker_type: { step: 3, message: "Please select a maintenance team." },
  estimated_labor_hours: { step: 3, message: "Please check the estimated worker hours." },
};

const WORKER_UNAVAILABLE_MESSAGE =
  "One selected worker is no longer available. Please review Work Team & Assignment.";

async function prepareJobCard(formData: FormData, intent: Intent, canAssign: boolean): Promise<PreparedJobCard> {
  const createStatus = intent === "submit_for_approval" ? "Approved" : "Created";

  // A create never carries an id or a status — whatever is posted is ignored.
  const raw = Object.fromEntries(formData);
  delete raw.id;
  delete raw.status;

  const parsed = workOrderSchema.safeParse(raw);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? "");
    const problem = FIELD_PROBLEMS[field];
    throw new JobCardValidationError(
      problem?.step ?? 6,
      field || "form",
      problem?.message ?? "Some information is not valid. Please review the Job Card."
    );
  }
  const { id: _ignoredId, ...values } = parsed.data;
  void _ignoredId;

  if (!values.asset_id) throw new JobCardValidationError(1, "asset_id", FIELD_PROBLEMS.asset_id.message);
  const asset = await prisma.assets.findFirst({
    where: { id: values.asset_id, deleted_at: null },
    select: { asset_name: true },
  });
  if (!asset) {
    throw new JobCardValidationError(1, "asset_id", "The selected asset is no longer available. Please select the asset again.");
  }

  if (createStatus === "Approved" && !values.operator_complaint) {
    throw new JobCardValidationError(2, "operator_complaint", FIELD_PROBLEMS.operator_complaint.message);
  }

  const wizardAssignment = parseWizardAssignment(formData);
  // Assignment is only applied when the Job Card is started (see below), so
  // it is only checked then too — a Draft never saves it.
  if (createStatus === "Approved" && wizardAssignment) {
    // Same permission the assignment services enforce — refused here, before
    // anything is saved, instead of failing after the Job Card exists.
    if (!canAssign) {
      throw new JobCardValidationError(3, "assignment", "You do not have permission to assign workers. Turn off Assign work now; a supervisor can assign later.");
    }
    if (wizardAssignment.kind === "INTERNAL_TEAM") {
      const ids = [
        ...(wizardAssignment.supervisorId ? [wizardAssignment.supervisorId] : []),
        ...wizardAssignment.technicianIds,
        ...wizardAssignment.helperIds,
      ];
      if (new Set(ids).size !== ids.length) {
        throw new JobCardValidationError(3, "assignment", "The same worker is selected twice. Please review Work Team & Assignment.");
      }
      const active = await prisma.workerProfile.count({ where: { id: { in: ids }, is_active: true } });
      if (active !== ids.length) throw new JobCardValidationError(3, "assignment", WORKER_UNAVAILABLE_MESSAGE);
    } else if (wizardAssignment.amount !== undefined && !(Number.isFinite(wizardAssignment.amount) && wizardAssignment.amount >= 0)) {
      throw new JobCardValidationError(3, "assignment", "Please check the agreed amount.");
    }
  }

  let requiredPartRows: ParsedRequiredPartRow[];
  try {
    requiredPartRows = await parseRequiredPartRows(formData);
  } catch (error) {
    if (error instanceof RequiredPartRowError) throw new JobCardValidationError(4, "required_parts", error.message);
    throw error;
  }
  if (requiredPartRows.some((row) => !Number.isInteger(row.quantity_required) || row.quantity_required <= 0)) {
    throw new JobCardValidationError(
      4,
      "required_parts",
      "Please check the required material quantity. It must be a whole number greater than 0 (in the stock unit after conversion)."
    );
  }

  // Checked up front so a file that would be refused sends the user back to
  // Attachments instead of being dropped silently after the Job Card is saved.
  const pendingAttachments = parsePendingAttachments(formData, "doc_attachment", MAX_ATTACHMENT_ROWS);
  if (pendingAttachments.length) {
    const settings = await getFileSecuritySettings();
    for (const item of pendingAttachments) {
      const problem = validatePrivateFileWithOptions(item.file, {
        maxSizeBytes: settings.maxUploadSizeBytes,
        allowedTypes: settings.allowedFileTypes,
      });
      if (problem) throw new JobCardValidationError(5, "attachments", `"${item.file.name}": ${problem}`);
    }
  }

  const laborRows = parseLaborRows(formData);
  const materialRows = parseMaterialRows(formData);
  const attachmentRows = parseAttachmentRows(formData);
  const totalLabor = laborRows.reduce((sum, row) => sum + (row?.hours ?? 0) * (row?.rate ?? 0), 0);
  const totalMaterials = materialRows.reduce((sum, row) => sum + (row?.quantity ?? 0) * (row?.unit_price ?? 0), 0);

  // Job Card Estimated Hours UX Simplification Unit 10G.22, Task 4: the Job
  // Card total is always the sum of the per-worker estimates the server
  // parsed itself, never the wizard's own computed hidden field.
  const basePayload = cleanPayload({
    ...values,
    ...(wizardAssignment?.kind === "INTERNAL_TEAM"
      ? { estimated_labor_hours: sumWorkerEstimates(wizardAssignment.estimatedHoursByWorkerId) }
      : {}),
    starting_datetime: values.starting_datetime || null,
    ending_datetime: values.ending_datetime || null,
    total_labor_cost: totalLabor,
    total_material_cost: totalMaterials,
  });

  return {
    createStatus,
    values,
    insertPayload: { ...basePayload, status: createStatus },
    laborRows,
    materialRows,
    attachmentRows,
    requiredPartRows,
    wizardAssignment,
    pendingAttachments,
    assetName: asset.asset_name,
  };
}

function toIsoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

async function loadSummary(where: Prisma.work_ordersWhereInput): Promise<JobCardCreatedSummary | null> {
  const wo = await prisma.work_orders.findFirst({
    where,
    select: {
      id: true,
      work_order_number: true,
      status: true,
      operator_complaint: true,
      description_of_work: true,
      maintenance_type: true,
      worker_type: true,
      date_of_order: true,
      assets: { select: { asset_name: true, asset_code: true } },
      work_order_worker_assignments: {
        where: { status: { not: "removed" } },
        orderBy: { assigned_at: "asc" },
        select: { worker_role: true, worker_profiles: { select: { name: true } } },
      },
      work_order_assignments: {
        orderBy: { assigned_at: "asc" },
        select: { external_name: true, external_company: true },
      },
      parts_requests: { orderBy: { created_at: "asc" }, select: { parts_request_number: true, status: true } },
      _count: { select: { work_order_required_parts: true, work_order_attachments: true } },
    },
  });
  if (!wo) return null;
  // The create request writes its "work_order.create" audit row only after
  // the assignment, Materials Request and attachment steps have finished.
  const finalized = (await prisma.audit_logs.count({ where: { action: "work_order.create", entity_id: wo.id } })) > 0;
  const team = [
    ...wo.work_order_worker_assignments.map((a) => `${a.worker_profiles.name} (${a.worker_role})`),
    ...wo.work_order_assignments
      .map((a) => a.external_company ?? a.external_name)
      .filter((name): name is string => Boolean(name)),
  ];
  return {
    id: wo.id,
    number: wo.work_order_number,
    status: wo.status,
    isDraft: wo.status === "Created",
    assetName: wo.assets?.asset_name ?? null,
    assetCode: wo.assets?.asset_code ?? null,
    issue: wo.operator_complaint || wo.description_of_work || null,
    maintenanceType: wo.maintenance_type,
    dateOfOrder: toIsoDate(wo.date_of_order),
    workerTeam: wo.worker_type,
    assignedTeam: team,
    requiredMaterialsCount: wo._count.work_order_required_parts,
    materialsRequests: wo.parts_requests.map((r) => ({ number: r.parts_request_number, status: r.status })),
    attachmentsCount: wo._count.work_order_attachments,
    finalized,
  };
}

// The Job Card a submission id created, if any — only ever the caller's own.
export async function findJobCardBySubmission(
  context: CurrentUserContext,
  submissionId: string
): Promise<JobCardCreatedSummary | null> {
  return loadSummary({
    AND: [
      { client_submission_id: submissionId, created_by: context.userId, deleted_at: null },
      getWorkOrderVisibilityFilter(context),
    ],
  });
}

function prismaCode(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

function isSubmissionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? "");
  return text.includes("client_submission_id");
}

// Prisma codes for "the database did not answer / was busy / the
// transaction did not get through" — nothing was committed, retrying is safe.
const RETRYABLE_DB_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2028", "P2034"]);

function classifyFailure(error: unknown): { category: JobCardFailureCategory; message: string; retryable: boolean } {
  const code = prismaCode(error);
  // Postgres lock_timeout / statement_timeout / deadlock / serialization,
  // surfaced by Prisma as a raw database error.
  const pgBusy = /\b(55P03|57014|40P01|40001)\b|lock timeout|deadlock detected/i.test(
    error instanceof Error ? error.message : String(error)
  );
  if (
    pgBusy ||
    (code && RETRYABLE_DB_CODES.has(code)) ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return {
      category: "database",
      message: "The server could not reach the database in time. Nothing was saved. Please press Retry.",
      retryable: true,
    };
  }
  if (code === "P2003") {
    return {
      category: "validation",
      message: "A selected record (asset or department) no longer exists. Please review the Job Card.",
      retryable: false,
    };
  }
  // The database is missing a table / column this code needs (a migration
  // was not applied — e.g. work_orders.client_submission_id). Nothing was
  // saved, and pressing Retry cannot help until an administrator updates
  // the database, so say that instead of inviting endless retries.
  if (code === "P2021" || code === "P2022") {
    return {
      category: "unexpected",
      message:
        "Job Cards cannot be saved right now because the system needs an update. Your information is safe. Please tell the system administrator and give them the reference below.",
      retryable: false,
    };
  }
  return {
    category: "unexpected",
    message: "Something went wrong on the server. Nothing was saved. Please press Retry.",
    retryable: true,
  };
}

type LogFields = {
  outcome: "created" | "replayed" | "failed";
  category?: JobCardFailureCategory;
  step?: JobCardWizardStep;
  field?: string;
  dbCode?: string | null;
  workOrderId?: string;
  jobCardNumber?: string | null;
  status?: string;
  warnings?: JobCardCreateWarnings;
};

export function logJobCardAttempt(
  base: { correlationId: string; submissionId: string | null; userId: string | null; roleSlug: string | null; startedAt: number; attachments?: { count: number; bytes: number } },
  fields: LogFields
) {
  const line = JSON.stringify({
    event: "job_card.create",
    at: new Date().toISOString(),
    reference: base.correlationId,
    // First block of the random submission id: enough to match a retry to
    // its first attempt, nothing secret.
    submissionRef: base.submissionId ? base.submissionId.slice(0, 8) : null,
    userId: base.userId,
    role: base.roleSlug,
    durationMs: Date.now() - base.startedAt,
    attachments: base.attachments,
    ...fields,
  });
  if (fields.outcome === "failed" && fields.category !== "validation") console.error("[job-card.create]", line);
  else console.info("[job-card.create]", line);
}

const NO_WARNINGS: JobCardCreateWarnings = { attachmentsFailed: false, materialsRequestFailed: false, assignmentFailed: false };

export async function createJobCardFromForm(
  context: CurrentUserContext,
  formData: FormData,
  meta: { submissionId: string; correlationId: string; route: string; startedAt?: number }
): Promise<JobCardCreateResponse> {
  const { submissionId, correlationId } = meta;
  const attachmentFiles = [...formData.values()].filter((v): v is File => v instanceof File && v.size > 0);
  const logBase = {
    correlationId,
    submissionId,
    userId: context.userId,
    roleSlug: context.role?.slug ?? null,
    startedAt: meta.startedAt ?? Date.now(),
    attachments: { count: attachmentFiles.length, bytes: attachmentFiles.reduce((s, f) => s + f.size, 0) },
  };

  const replay = async (): Promise<JobCardCreateResponse | null> => {
    const existing = await loadSummary({ client_submission_id: submissionId });
    if (!existing) return null;
    // Only the original submitter's own retry is answered with it.
    const owner = await prisma.work_orders.findUnique({ where: { id: existing.id }, select: { created_by: true } });
    if (owner?.created_by !== context.userId) {
      logJobCardAttempt(logBase, { outcome: "failed", category: "bad_request", field: "submission_id" });
      return {
        ok: false,
        category: "bad_request",
        message: "This form can no longer be submitted. Please close it and start a new Job Card.",
        retryable: false,
        reference: correlationId,
      };
    }
    logJobCardAttempt(logBase, { outcome: "replayed", workOrderId: existing.id, jobCardNumber: existing.number, status: existing.status });
    return { ok: true, replayed: true, jobCard: existing, warnings: NO_WARNINGS, reference: correlationId };
  };

  const rawIntent = String(formData.get("intent") ?? "").trim();
  if (rawIntent !== "save_draft" && rawIntent !== "submit_for_approval") {
    logJobCardAttempt(logBase, { outcome: "failed", category: "bad_request", field: "intent" });
    return {
      ok: false,
      category: "bad_request",
      message: "Please press Create Job Card or Save Draft again.",
      retryable: true,
      reference: correlationId,
    };
  }

  let prepared: PreparedJobCard;
  let created: { id: string; number: string | null; replayed: boolean };
  try {
    // A retry of a submission that already went through skips validation —
    // its inputs (a worker, a material) may have changed since it committed.
    const already = await replay();
    if (already) return already;

    prepared = await prepareJobCard(
      formData,
      rawIntent,
      context.role?.slug === "super_admin" || context.permissions.includes("work_orders.assign")
    );
    const p = prepared;

    created = await withBackendTransaction(context.userId, async (tx) => {
      // A row lock held elsewhere (numbering, a stuck session) fails this
      // save in seconds with a "press Retry" answer instead of leaving the
      // user waiting for as long as the other transaction runs.
      await tx.$executeRaw`SET LOCAL lock_timeout = '10s'`;
      // Same-submission requests queue here; the second one then sees the
      // first one's committed Job Card below.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`job-card-submission:${submissionId}`}, 0))`;
      const duplicate = await tx.work_orders.findUnique({
        where: { client_submission_id: submissionId },
        select: { id: true, work_order_number: true },
      });
      if (duplicate) return { id: duplicate.id, number: duplicate.work_order_number, replayed: true };

      const wo = await tx.work_orders.create({
        data: {
          ...(p.insertPayload as Prisma.work_ordersUncheckedCreateInput),
          client_submission_id: submissionId,
          created_by: context.userId,
          updated_by: context.userId,
        },
        select: { id: true, work_order_number: true },
      });
      // If the workflow tracking rows cannot be created, the whole Job Card
      // rolls back, so a started Job Card is never left without them.
      if (p.createStatus === "Approved") {
        await createMaintenanceWorkflowInstanceForWorkOrder(tx, wo.id, context.userId);
      }
      const work_order_id = wo.id;
      if (p.laborRows.length) await tx.work_order_labor.createMany({ data: p.laborRows.map((row) => ({ ...row!, work_order_id })) });
      if (p.materialRows.length) await tx.work_order_materials.createMany({ data: p.materialRows.map((row) => ({ ...row!, work_order_id })) });
      if (p.attachmentRows.length) {
        await tx.work_order_attachments.createMany({ data: p.attachmentRows.map((row) => ({ ...row!, work_order_id, uploaded_by: context.userId })) });
      }
      if (p.requiredPartRows.length) {
        await tx.workOrderRequiredPart.createMany({ data: p.requiredPartRows.map((row) => ({ ...row, work_order_id, created_by: context.userId })) });
      }
      return { id: wo.id, number: wo.work_order_number, replayed: false };
    });
  } catch (error) {
    if (error instanceof JobCardValidationError) {
      logJobCardAttempt(logBase, { outcome: "failed", category: "validation", step: error.step, field: error.field });
      return {
        ok: false,
        category: "validation",
        message: error.message,
        step: error.step,
        field: error.field,
        retryable: false,
        reference: correlationId,
      };
    }
    // Lost the race to an identical request that committed first.
    if (isSubmissionConflict(error)) {
      const already = await replay().catch(() => null);
      if (already) return already;
    }

    const failure = classifyFailure(error);
    const dbCode = prismaCode(error);
    logJobCardAttempt(logBase, { outcome: "failed", category: failure.category, dbCode });
    const rawMessage = error instanceof Error ? error.message : String(error);
    await logSystemError({
      source: "jobCard.create",
      severity: "error",
      message: rawMessage.slice(-1500),
      stack: error instanceof Error ? (error.stack ?? null) : null,
      userId: context.userId,
      route: meta.route,
      entityType: "work_order",
      metadata: { reference: correlationId, submissionRef: submissionId.slice(0, 8), code: dbCode, category: failure.category },
    });
    return { ok: false, ...failure, reference: correlationId };
  }

  if (created.replayed) {
    const already = await replay().catch(() => null);
    if (already) return already;
  }

  const warnings = await runAfterCommit(context, prepared, created.id, created.number);
  revalidatePath("/maintenance/work-orders");
  revalidatePath("/dashboard");
  revalidatePath("/technician/jobs");

  const summary = (await loadSummary({ id: created.id }).catch(() => null)) ?? {
    id: created.id,
    number: created.number,
    status: prepared.createStatus,
    isDraft: prepared.createStatus === "Created",
    assetName: prepared.assetName,
    assetCode: null,
    issue: String(prepared.values.operator_complaint ?? "") || String(prepared.values.description_of_work ?? "") || null,
    maintenanceType: String(prepared.values.maintenance_type ?? "") || null,
    dateOfOrder: toIsoDate(prepared.values.date_of_order as Date | undefined),
    workerTeam: String(prepared.values.worker_type ?? "") || null,
    assignedTeam: [],
    requiredMaterialsCount: prepared.requiredPartRows.length,
    materialsRequests: [],
    attachmentsCount: 0,
    finalized: true,
  };

  logJobCardAttempt(logBase, {
    outcome: "created",
    workOrderId: created.id,
    jobCardNumber: created.number,
    status: prepared.createStatus,
    warnings,
  });
  return { ok: true, replayed: false, jobCard: summary, warnings, reference: correlationId };
}

// Follow-up steps that run after the Job Card has committed. Each has its
// own error handling; none of them can undo or hide the created Job Card.
async function runAfterCommit(
  context: CurrentUserContext,
  p: PreparedJobCard,
  work_order_id: string,
  jobCardNumber: string | null
): Promise<JobCardCreateWarnings> {
  const warnings: JobCardCreateWarnings = { ...NO_WARNINGS };
  const departmentId = (p.values.requested_by_department_id as string | undefined) ?? null;

  // Critical Workflow Bug Fix: Required Materials lines produce a real,
  // linked Materials Request through the normal service (duplicate guard,
  // notifications, audit identical to a manual request). It opens its own
  // transaction, so it runs after the Job Card commits; a failure leaves the
  // Job Card as is and the user adds the request from the Job Card.
  if (p.requiredPartRows.length > 0) {
    try {
      await createPartsRequest(context, {
        workOrderId: work_order_id,
        remarks: "Auto-created from the Job Card's Required Parts list at creation.",
        items: p.requiredPartRows.map((row) => ({
          part_id: null,
          description: row.description,
          part_number: row.part_number,
          ss_rec_code: null,
          quantity_requested: row.quantity_required,
          unit_price: 0,
          remarks: row.notes,
          unit: row.unit_of_measure,
          inventory_material_key: null,
          purchase_unit: null,
          conversion_quantity: null,
          entered_unit_price: null,
          price_basis: null,
        })),
      });
    } catch (error) {
      warnings.materialsRequestFailed = true;
      await logSystemError({
        severity: "error",
        source: "jobCard.create.autoMaterialsRequest",
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        stack: error instanceof Error ? (error.stack ?? null) : null,
        userId: context.userId,
        entityType: "work_order",
        entityId: work_order_id,
      });
    }
  }

  // Optional Work Assignment During Job Card Creation Unit 7C: only when the
  // Job Card is started (never on Draft), through the same functions the Job
  // Card page's own assignment panels call.
  const a = p.wizardAssignment;
  if (p.createStatus === "Approved" && a) {
    try {
      if (a.kind === "INTERNAL_TEAM") {
        await assignInternalTeamRoster(context, {
          workOrderId: work_order_id,
          supervisorId: a.supervisorId,
          technicianIds: a.technicianIds,
          helperIds: a.helperIds,
          notes: a.notes,
          estimatedHoursByWorkerId: a.estimatedHoursByWorkerId,
        });
      } else if (a.kind === "FREELANCER") {
        await assignTechnicians(context, {
          workOrderId: work_order_id,
          assignmentType: "FREELANCER",
          technicianIds: [],
          externalName: a.name,
          externalPhone: a.phone,
          externalTrade: a.trade,
          agreedAmount: a.amount,
          notes: a.notes,
        });
      } else {
        await assignTechnicians(context, {
          workOrderId: work_order_id,
          assignmentType: "EXTERNAL_COMPANY",
          technicianIds: [],
          externalCompany: a.company,
          externalContactPerson: a.contact,
          externalPhone: a.phone,
          externalTrade: a.trade,
          agreedAmount: a.amount,
          notes: a.notes,
        });
      }
    } catch (error) {
      warnings.assignmentFailed = true;
      await logSystemError({
        severity: "error",
        source: "jobCard.create.autoAssignment",
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        stack: error instanceof Error ? (error.stack ?? null) : null,
        userId: context.userId,
        entityType: "work_order",
        entityId: work_order_id,
      });
    }
  }

  // Attachment files are written only now that the Job Card exists; a
  // partial or total failure never rolls the Job Card back.
  if (p.pendingAttachments.length) {
    try {
      const saved = await saveAttachmentBatch("work-order-files", work_order_id, p.pendingAttachments);
      if (saved.length) {
        await prisma.work_order_attachments.createMany({
          data: saved.map((f) => ({
            work_order_id,
            attachment_type: f.category,
            file_name: f.file.name,
            file_path: f.path,
            content_type: f.file.type,
            file_size: f.file.size,
            uploaded_by: context.userId,
          })),
        });
        for (const f of saved) {
          await writeAuditLog({
            actorId: context.userId,
            action: "file.upload",
            entityType: "work_order",
            entityId: work_order_id,
            summary: `Uploaded ${f.category} file to work order during creation`,
            metadata: { fileName: f.file.name, bucket: "work-order-files", remarks: f.remarks },
          });
        }
      }
      if (saved.length < p.pendingAttachments.length) warnings.attachmentsFailed = true;
    } catch (error) {
      warnings.attachmentsFailed = true;
      await logSystemError({
        severity: "error",
        source: "jobCard.create.attachments",
        message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        userId: context.userId,
        entityType: "work_order",
        entityId: work_order_id,
      });
    }
  }

  // Audit, notification and realtime run after the Job Card has committed:
  // a failure in any of them is logged and never turns the saved Job Card
  // into an error response (CLAUDE.md invariant 3).
  await afterCommitSideEffect(context, work_order_id, "jobCard.create.audit", () =>
    writeAuditLog({
      actorId: context.userId,
      action: "work_order.create",
      entityType: "work_order",
      entityId: work_order_id,
      summary: `Created work order ${jobCardNumber}`,
      metadata: { status: p.createStatus, worker_type: p.values.worker_type as string },
    })
  );

  if (p.createStatus === "Approved") {
    // Approval Workflow Unit 4: Manager is notified for awareness only.
    await afterCommitSideEffect(context, work_order_id, "jobCard.create.notify", () =>
      notifyWorkflowEvent({
        eventKey: "job_card.created",
        entityType: "work_order",
        entityId: work_order_id,
        actorId: context.userId,
        recipientRoles: ["maintenance_manager"],
        metadata: { job_card_number: jobCardNumber, asset_name: p.assetName ?? "unassigned asset" },
        actionUrl: `/maintenance/work-orders/${work_order_id}`,
      })
    );
  }

  await afterCommitSideEffect(context, work_order_id, "jobCard.create.realtime", () =>
    emitRealtimeEvent({
      eventType: REALTIME_EVENTS.WORK_ORDER_CREATED,
      entityType: "work_order",
      entityId: work_order_id,
      actorProfileId: context.userId,
      departmentId,
      payload: {
        work_order_number: jobCardNumber ?? undefined,
        maintenance_type: p.values.maintenance_type as string,
        worker_type: p.values.worker_type as string,
        priority: p.values.priority as string,
      },
    })
  );

  return warnings;
}

async function afterCommitSideEffect(context: CurrentUserContext, workOrderId: string, source: string, run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    console.error(`[${source}]`, error);
    await logSystemError({
      severity: "error",
      source,
      message: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      stack: error instanceof Error ? (error.stack ?? null) : null,
      userId: context.userId,
      entityType: "work_order",
      entityId: workOrderId,
    }).catch(() => undefined);
  }
}
