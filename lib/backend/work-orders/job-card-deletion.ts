import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { dedupeRecipients, notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertActiveUser } from "@/lib/backend/security/guards";
import { withBackendTransaction, type BackendTransaction } from "@/lib/backend/shared/transaction";
import { getActiveUserIdsByRoleSlugs, lockJobCardActivity } from "@/lib/backend/work-orders/repository";
import { AppError } from "@/lib/errors/app-error";
import { emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { hasPermission } from "@/lib/security/permissions";
import {
  DELETION_REASON_MAX_LENGTH,
  DELETION_REASON_MIN_LENGTH,
  evaluateJobCardDeletion,
  type JobCardDeletionEligibility,
} from "@/lib/work-orders/job-card-deletion-rules";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";

// Job Card Deletion Requests.
//
// Maintenance Data Entry asks to delete a Job Card (with a reason); the
// Maintenance Manager approves or rejects it. Approval is a soft delete —
// work_orders.deleted_at is set, the row, its number and every linked record
// stay, and the lists/dashboards/detail pages (which already filter
// deleted_at) stop showing it. Nothing is physically deleted.
//
// Eligibility (lib/work-orders/job-card-deletion-rules.ts) is checked when
// the request is sent and again inside the approval transaction, under the
// per-Job-Card activity lock (repository.ts lockJobCardActivity) that every
// work/stock/request write also takes — so work recorded between request
// and approval always blocks the approval.
//
// Role checks follow the closure-approval convention in service.ts (role
// slug, not a DB permission): requesters are Maintenance Data Entry (with
// work_orders.manage, so a deny override still blocks) or Super Admin;
// reviewers are Maintenance Manager or Super Admin, never the requester.

const REQUESTER_ROLES = ["maintenance_data_entry"];
const REVIEWER_ROLES = ["maintenance_manager"];

export function canRequestJobCardDeletion(context: CurrentUserContext) {
  if (context.role?.slug === "super_admin") return true;
  return REQUESTER_ROLES.includes(context.role?.slug ?? "") && hasPermission(context, "work_orders.manage");
}

export function canReviewJobCardDeletion(context: CurrentUserContext) {
  return context.role?.slug === "super_admin" || REVIEWER_ROLES.includes(context.role?.slug ?? "");
}

export type JobCardDeletionActivity = {
  workersAssigned: string[];
  workSessionCount: number;
  recordedMinutes: number;
  materialsRequestNumbers: string[];
  requiredMaterialsCount: number;
  stockMovementCount: number;
  materialsUsedCount: number;
  purchaseRequestCount: number;
  laborRecordCount: number;
  attachmentsCount: number;
};

async function loadDeletionFacts(db: BackendTransaction, workOrderId: string) {
  const wo = await db.work_orders.findUnique({
    where: { id: workOrderId },
    select: {
      id: true,
      work_order_number: true,
      status: true,
      created_by: true,
      deleted_at: true,
      assets: { select: { asset_code: true, asset_name: true } },
    },
  });
  if (!wo) return null;

  const [sessions, materialsRequests, offlineMovements, legacyMovements, materialsUsed, purchaseRequests, laborRows, notesWithHours, workers, requiredMaterials, attachments, pendingTimeEntries] =
    await Promise.all([
      db.workOrderWorkSession.findMany({
        where: { work_order_id: workOrderId, status: { not: "Cancelled" } },
        select: { duration_minutes: true },
      }),
      db.parts_requests.findMany({ where: { work_order_id: workOrderId }, select: { parts_request_number: true } }),
      db.offline_inventory_movements.count({ where: { related_work_order_id: workOrderId, deleted_at: null } }),
      db.inventory_movements.count({ where: { work_order_id: workOrderId } }),
      db.work_order_materials.count({ where: { work_order_id: workOrderId } }),
      db.purchase_requests.count({ where: { work_order_id: workOrderId } }),
      db.work_order_labor.count({ where: { work_order_id: workOrderId } }),
      db.work_order_technician_notes.count({ where: { work_order_id: workOrderId, labor_hours: { gt: 0 } } }),
      db.workOrderWorkerAssignment.findMany({
        where: { work_order_id: workOrderId, status: { in: ["active", "finished"] } },
        select: { worker_profiles: { select: { name: true } } },
      }),
      db.workOrderRequiredPart.count({ where: { work_order_id: workOrderId } }),
      db.work_order_attachments.count({ where: { work_order_id: workOrderId } }),
      db.workSessionTimeCorrection.count({ where: { work_order_id: workOrderId, status: "Pending" } }),
    ]);

  const activity: JobCardDeletionActivity = {
    workersAssigned: workers.map((w) => w.worker_profiles.name),
    workSessionCount: sessions.length,
    recordedMinutes: sessions.reduce((sum, s) => sum + s.duration_minutes, 0),
    materialsRequestNumbers: materialsRequests.map((r) => r.parts_request_number ?? "Materials Request"),
    requiredMaterialsCount: requiredMaterials,
    stockMovementCount: offlineMovements + legacyMovements,
    materialsUsedCount: materialsUsed,
    purchaseRequestCount: purchaseRequests,
    laborRecordCount: laborRows + notesWithHours,
    attachmentsCount: attachments,
  };

  const eligibility = evaluateJobCardDeletion({
    status: wo.status,
    deleted: wo.deleted_at !== null,
    workSessionCount: activity.workSessionCount,
    materialsRequestNumbers: activity.materialsRequestNumbers,
    stockMovementCount: activity.stockMovementCount,
    materialsUsedCount: activity.materialsUsedCount,
    purchaseRequestCount: activity.purchaseRequestCount,
    laborRecordCount: activity.laborRecordCount,
    pendingTimeEntryCount: pendingTimeEntries,
  });

  return { wo, activity, eligibility };
}

function assetLabel(assets: { asset_code: string | null; asset_name: string } | null) {
  if (!assets) return null;
  return assets.asset_code ? `${assets.asset_code} — ${assets.asset_name}` : assets.asset_name;
}

/** Read-only eligibility + activity summary for the Job Card page. */
export async function getJobCardDeletionStatus(context: CurrentUserContext, workOrderId: string) {
  return withBackendTransaction(null, async (tx) => {
    const visible = await tx.work_orders.findFirst({
      where: { AND: [{ id: workOrderId }, { deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
      select: { id: true },
    });
    if (!visible) return null;
    const facts = await loadDeletionFacts(tx, workOrderId);
    if (!facts) return null;
    const pending = await tx.jobCardDeletionRequest.findFirst({
      where: { work_order_id: workOrderId, status: "Pending" },
      include: { profiles_requested_by: { select: { full_name: true } } },
    });
    const lastRejected = pending
      ? null
      : await tx.jobCardDeletionRequest.findFirst({
          where: { work_order_id: workOrderId, status: "Rejected" },
          orderBy: { decided_at: "desc" },
          include: { profiles_decided_by: { select: { full_name: true } } },
        });
    return { eligibility: facts.eligibility, activity: facts.activity, pending, lastRejected };
  });
}

// ── Request ──────────────────────────────────────────────────────────────────

export type JobCardDeletionRequestResult = {
  requestId: string;
  workOrderId: string;
  workOrderNumber: string | null;
  alreadyPending: boolean;
};

export async function requestJobCardDeletion(
  context: CurrentUserContext,
  input: { workOrderId: string; reason: string }
): Promise<JobCardDeletionRequestResult> {
  assertActiveUser(context);
  if (!canRequestJobCardDeletion(context)) {
    throw new AppError("Only Maintenance Data Entry can ask to delete a Job Card.", { code: "FORBIDDEN" });
  }
  const reason = input.reason.trim();
  if (reason.length < DELETION_REASON_MIN_LENGTH) {
    throw new AppError("Please write the reason for deleting this Job Card (at least 5 letters).", { code: "VALIDATION_ERROR" });
  }
  if (reason.length > DELETION_REASON_MAX_LENGTH) {
    throw new AppError("The reason is too long. Please keep it under 500 letters.", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    await lockJobCardActivity(tx, input.workOrderId);

    const visible = await tx.work_orders.findFirst({
      where: { AND: [{ id: input.workOrderId }, { deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
      select: { id: true },
    });
    if (!visible) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });

    // A repeated click / retry returns the request already sent.
    const pending = await tx.jobCardDeletionRequest.findFirst({
      where: { work_order_id: input.workOrderId, status: "Pending" },
    });
    if (pending) {
      if (pending.requested_by !== context.userId) {
        throw new AppError("A delete request for this Job Card is already waiting for the Manager.", { code: "CONFLICT" });
      }
      return { request: pending, workOrderNumber: pending.work_order_number, createdBy: null as string | null, alreadyPending: true };
    }

    const facts = await loadDeletionFacts(tx, input.workOrderId);
    if (!facts) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (!facts.eligibility.eligible) {
      throw new AppError(`This Job Card cannot be deleted. ${facts.eligibility.reasons.join(" ")}`, { code: "WORKFLOW_ERROR" });
    }

    const request = await tx.jobCardDeletionRequest.create({
      data: {
        work_order_id: input.workOrderId,
        work_order_number: facts.wo.work_order_number,
        asset_label: assetLabel(facts.wo.assets),
        status_at_request: facts.wo.status,
        reason,
        requested_by: context.userId,
      },
    });
    return { request, workOrderNumber: facts.wo.work_order_number, createdBy: facts.wo.created_by, alreadyPending: false };
  });

  if (!result.alreadyPending) {
    const recipients = await withBackendTransaction(context.userId, async (tx) =>
      dedupeRecipients(await getActiveUserIdsByRoleSlugs(tx, REVIEWER_ROLES), context.userId)
    );
    const number = result.workOrderNumber ?? "a Job Card";
    await Promise.all([
      recipients.length
        ? notifyWorkflowEvent({
            eventKey: "job_card.deletion_requested",
            entityType: "work_order",
            entityId: input.workOrderId,
            actorId: context.userId,
            recipientUserIds: recipients,
            category: "Approvals",
            priority: "high",
            title: "Job Card delete request",
            message: `${context.profile.full_name} asked to delete Job Card ${number}. Reason: ${reason}`,
            metadata: { job_card_number: number },
            actionUrl: `/maintenance/work-orders/${input.workOrderId}`,
            actionLabel: "Review request",
          })
        : Promise.resolve(),
      writeAuditLog({
        actorId: context.userId,
        action: "work_order.deletion_requested",
        entityType: "work_order",
        entityId: input.workOrderId,
        summary: `Delete requested for ${number}`,
        metadata: { deletion_request_id: result.request.id, reason },
      }),
      emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, input.workOrderId, context.userId),
    ]);
  }

  return {
    requestId: result.request.id,
    workOrderId: input.workOrderId,
    workOrderNumber: result.workOrderNumber,
    alreadyPending: result.alreadyPending,
  };
}

// ── Review (approve / reject) ────────────────────────────────────────────────

type ReviewResult = {
  requestId: string;
  workOrderId: string;
  workOrderNumber: string | null;
  requestedBy: string;
  createdBy: string | null;
};

function assertCanReview(context: CurrentUserContext) {
  assertActiveUser(context);
  if (!canReviewJobCardDeletion(context)) {
    throw new AppError("Only the Maintenance Manager can approve or reject a delete request.", { code: "FORBIDDEN" });
  }
}

async function lockPendingRequest(tx: BackendTransaction, context: CurrentUserContext, requestId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; work_order_id: string; status: string; requested_by: string }>>`
    SELECT id, work_order_id, status, requested_by
    FROM job_card_deletion_requests
    WHERE id = ${requestId}::uuid
    FOR UPDATE`;
  const request = rows[0];
  if (!request) throw new AppError("Delete request was not found.", { code: "NOT_FOUND" });
  if (request.status !== "Pending") {
    throw new AppError(`This delete request was already ${request.status.toLowerCase()}.`, { code: "CONFLICT" });
  }
  if (request.requested_by === context.userId) {
    throw new AppError("You cannot approve or reject your own delete request.", { code: "FORBIDDEN" });
  }
  return request;
}

export async function approveJobCardDeletion(
  context: CurrentUserContext,
  input: { requestId: string; remarks?: string }
): Promise<ReviewResult> {
  assertCanReview(context);
  const remarks = input.remarks?.trim() || null;

  const result = await withBackendTransaction(context.userId, async (tx) => {
    // Activity lock first (same order as every activity write), then the
    // request row. The request's Job Card id is read without a lock to know
    // which activity lock to take, then re-read under the row lock.
    const peek = await tx.jobCardDeletionRequest.findUnique({ where: { id: input.requestId }, select: { work_order_id: true } });
    if (!peek) throw new AppError("Delete request was not found.", { code: "NOT_FOUND" });
    await lockJobCardActivity(tx, peek.work_order_id);
    const request = await lockPendingRequest(tx, context, input.requestId);
    // Holds off any status change (e.g. a closure request) until this
    // decision commits; a status update waiting on this lock then finds the
    // Job Card deleted (updateWorkOrderStatus filters deleted_at).
    await tx.$queryRaw`SELECT id FROM work_orders WHERE id = ${request.work_order_id}::uuid FOR UPDATE`;

    // Eligibility re-checked now, not trusted from request time.
    const facts = await loadDeletionFacts(tx, request.work_order_id);
    if (!facts) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (!facts.eligibility.eligible) {
      throw new AppError(
        `This Job Card can no longer be deleted. ${facts.eligibility.reasons.join(" ")} Please reject this request instead.`,
        { code: "WORKFLOW_ERROR" }
      );
    }

    const now = new Date();
    await tx.work_orders.update({
      where: { id: request.work_order_id },
      data: { deleted_at: now, updated_by: context.userId, updated_at: now },
    });
    // Workers planned on the Job Card (no time recorded — eligibility above
    // guarantees it) come off its roster so they no longer show as assigned.
    await tx.workOrderWorkerAssignment.updateMany({
      where: { work_order_id: request.work_order_id, status: "active" },
      data: { status: "removed", updated_at: now },
    });
    await tx.jobCardDeletionRequest.update({
      where: { id: request.id },
      data: { status: "Approved", decided_by: context.userId, decided_at: now, decision_remarks: remarks, updated_at: now },
    });

    return {
      requestId: request.id,
      workOrderId: request.work_order_id,
      workOrderNumber: facts.wo.work_order_number,
      requestedBy: request.requested_by,
      createdBy: facts.wo.created_by,
    };
  });

  const number = result.workOrderNumber ?? "a Job Card";
  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.deletion_approved",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: dedupeRecipients([result.requestedBy, result.createdBy], context.userId),
      category: "Approvals",
      title: "Job Card deleted",
      message: `The Manager approved your request. Job Card ${number} has been deleted.${remarks ? ` Remarks: ${remarks}` : ""}`,
      metadata: { job_card_number: number },
      actionUrl: "/maintenance/work-orders",
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "work_order.deleted",
      entityType: "work_order",
      entityId: result.workOrderId,
      summary: `Job Card ${number} deleted (delete request approved)`,
      metadata: { deletion_request_id: result.requestId, requested_by: result.requestedBy, remarks },
    }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, result.workOrderId, context.userId),
  ]);

  return result;
}

export async function rejectJobCardDeletion(
  context: CurrentUserContext,
  input: { requestId: string; remarks: string }
): Promise<ReviewResult> {
  assertCanReview(context);
  const remarks = input.remarks.trim();
  if (remarks.length < 3) {
    throw new AppError("Please write why the delete request is rejected.", { code: "VALIDATION_ERROR" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const request = await lockPendingRequest(tx, context, input.requestId);
    const wo = await tx.work_orders.findUnique({
      where: { id: request.work_order_id },
      select: { work_order_number: true, created_by: true },
    });
    const now = new Date();
    await tx.jobCardDeletionRequest.update({
      where: { id: request.id },
      data: { status: "Rejected", decided_by: context.userId, decided_at: now, decision_remarks: remarks, updated_at: now },
    });
    return {
      requestId: request.id,
      workOrderId: request.work_order_id,
      workOrderNumber: wo?.work_order_number ?? null,
      requestedBy: request.requested_by,
      createdBy: wo?.created_by ?? null,
    };
  });

  const number = result.workOrderNumber ?? "a Job Card";
  await Promise.all([
    notifyWorkflowEvent({
      eventKey: "job_card.deletion_rejected",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: dedupeRecipients([result.requestedBy], context.userId),
      category: "Approvals",
      title: "Delete request not approved",
      message: `The Manager did not approve deleting Job Card ${number}. Reason: ${remarks}`,
      metadata: { job_card_number: number },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
    }),
    writeAuditLog({
      actorId: context.userId,
      action: "work_order.deletion_rejected",
      entityType: "work_order",
      entityId: result.workOrderId,
      summary: `Delete request for ${number} rejected`,
      metadata: { deletion_request_id: result.requestId, remarks },
    }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_UPDATED, result.workOrderId, context.userId),
  ]);

  return result;
}

// ── Manager lists (Final Integration Review) ──────────────────────────────────
//
// Read-only. Both require the reviewer role (Manager / Super Admin) and still
// apply getWorkOrderVisibilityFilter (CLAUDE.md invariant 1).

export type PendingDeletionRequestRow = {
  requestId: string;
  workOrderId: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  reason: string;
  requestedByName: string;
  requestedAt: string;
  requestedByMe: boolean;
  // Preview of what Approve would refuse (the server re-checks on Approve).
  blockedReasons: string[];
};

export async function listPendingJobCardDeletionRequests(context: CurrentUserContext): Promise<PendingDeletionRequestRow[]> {
  if (!canReviewJobCardDeletion(context)) return [];
  return withBackendTransaction(null, async (tx) => {
    const rows = await tx.jobCardDeletionRequest.findMany({
      where: {
        status: "Pending",
        work_orders: { AND: [{ deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
      },
      orderBy: { requested_at: "asc" },
      take: 50,
      include: { profiles_requested_by: { select: { full_name: true } } },
    });
    const out: PendingDeletionRequestRow[] = [];
    for (const r of rows) {
      const facts = await loadDeletionFacts(tx, r.work_order_id);
      out.push({
        requestId: r.id,
        workOrderId: r.work_order_id,
        workOrderNumber: facts?.wo.work_order_number ?? r.work_order_number,
        assetLabel: (facts ? assetLabel(facts.wo.assets) : null) ?? r.asset_label,
        reason: r.reason,
        requestedByName: r.profiles_requested_by.full_name,
        requestedAt: r.requested_at.toISOString(),
        requestedByMe: r.requested_by === context.userId,
        blockedReasons: facts?.eligibility.reasons ?? [],
      });
    }
    return out;
  });
}

export type DeletedJobCardRow = {
  workOrderId: string;
  workOrderNumber: string | null;
  assetLabel: string | null;
  issue: string | null;
  statusWhenDeleted: string;
  createdAt: string;
  createdByName: string | null;
  deletedAt: string;
  history: {
    requestId: string;
    status: string;
    reason: string;
    statusAtRequest: string;
    requestedByName: string;
    requestedAt: string;
    decidedByName: string | null;
    decidedAt: string | null;
    decisionRemarks: string | null;
  }[];
};

/** Soft-deleted Job Cards with every deletion request and decision, newest deletion first. */
export async function listDeletedJobCards(context: CurrentUserContext, limit = 100): Promise<DeletedJobCardRow[]> {
  if (!canReviewJobCardDeletion(context)) return [];
  return withBackendTransaction(null, async (tx) => {
    const rows = await tx.work_orders.findMany({
      where: { AND: [{ deleted_at: { not: null } }, getWorkOrderVisibilityFilter(context)] },
      orderBy: { deleted_at: "desc" },
      take: limit,
      select: {
        id: true,
        work_order_number: true,
        status: true,
        operator_complaint: true,
        description_of_work: true,
        created_at: true,
        created_by: true,
        deleted_at: true,
        assets: { select: { asset_code: true, asset_name: true } },
        job_card_deletion_requests: {
          orderBy: { requested_at: "asc" },
          include: {
            profiles_requested_by: { select: { full_name: true } },
            profiles_decided_by: { select: { full_name: true } },
          },
        },
      },
    });
    const creatorIds = [...new Set(rows.map((r) => r.created_by).filter((id): id is string => Boolean(id)))];
    const creators = creatorIds.length
      ? await tx.profiles.findMany({ where: { id: { in: creatorIds } }, select: { id: true, full_name: true } })
      : [];
    const creatorName = new Map(creators.map((p) => [p.id, p.full_name]));
    return rows.map((r) => ({
      workOrderId: r.id,
      workOrderNumber: r.work_order_number,
      assetLabel: assetLabel(r.assets),
      issue: r.operator_complaint || r.description_of_work || null,
      statusWhenDeleted: r.status,
      createdAt: (r.created_at ?? r.deleted_at!).toISOString(),
      createdByName: r.created_by ? (creatorName.get(r.created_by) ?? null) : null,
      deletedAt: r.deleted_at!.toISOString(),
      history: r.job_card_deletion_requests.map((h) => ({
        requestId: h.id,
        status: h.status,
        reason: h.reason,
        statusAtRequest: h.status_at_request,
        requestedByName: h.profiles_requested_by.full_name,
        requestedAt: h.requested_at.toISOString(),
        decidedByName: h.profiles_decided_by?.full_name ?? null,
        decidedAt: h.decided_at?.toISOString() ?? null,
        decisionRemarks: h.decision_remarks,
      })),
    }));
  });
}

export type { JobCardDeletionEligibility };
