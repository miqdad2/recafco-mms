import "server-only";

import type { prisma } from "@/lib/db/prisma";
import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { dedupeRecipients, notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertActiveUser } from "@/lib/backend/security/guards";
import { withBackendTransaction, type BackendTransaction } from "@/lib/backend/shared/transaction";
import { getActiveUserIdsByRoleSlugs } from "@/lib/backend/work-orders/repository";
import { AppError } from "@/lib/errors/app-error";
import { formatDurationMinutes, parseKuwaitInputValue } from "@/lib/format/kuwait-time";
import { emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { hasPermission } from "@/lib/security/permissions";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import {
  checkTimeCorrection,
  checkWorkPeriod,
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTION_REASON_MIN_LENGTH,
  periodMinutes,
  type OtherWorkPeriod,
} from "@/lib/work-orders/work-time-correction-rules";

type DbClient = typeof prisma | BackendTransaction;

// Worker Time Corrections.
//
// Data Entry sends corrected start/end times for one finished work period
// (a Completed or Paused work_order_work_sessions row) with a reason; the
// Maintenance Manager approves or rejects it.
//
// Until approval nothing in the work period changes, so every hours/cost
// total keeps using the recorded time and the correction shows as "Waiting
// for Manager review". On approval, in one transaction:
//   - the period's original recorded start/end/duration are copied into its
//     original_* columns (only if still empty — the first recorded values
//     are never overwritten),
//   - started_at / stopped_at (or paused_at) / duration_minutes /
//     calculated_amount take the corrected values, priced with the period's
//     own frozen hourly_rate_snapshot (the same formula as Start/Pause/
//     Finish),
//   - the correction row moves Pending -> Approved under a row lock.
// Every labor total, cost, report and print reads that period row, so the
// approved time is counted exactly once, everywhere, with no second copy of
// the hours. The correction row keeps the before/after for audit.
//
// Manual work time entry (entry_kind "manual_entry", migration
// 20261027010000): Data Entry enters a NEW work period — start, end, reason —
// for a worker who did not use the timer. Pending, it is only this row (no
// work_order_work_sessions row), so it cannot reach hours, cost or reports.
// On approval ONE session row is created (status Completed, is_manual_entry,
// entered_by = the requester, the assignment's frozen hourly_rate_snapshot)
// and linked back through work_session_id — so it is counted once, like any
// other period. A recorded period is never overwritten by a manual entry;
// changing one is the "correction" kind above.
//
// Role checks follow work-sessions.ts (role slug): requesters are Data Entry
// with work_orders.assign (the timer permission) or Super Admin; reviewers
// are Maintenance Manager or Super Admin, never the requester. Managers can
// still correct a period directly with the existing Edit / Correct action.

const REVIEWER_ROLES = ["maintenance_manager"];
const CORRECTABLE_STATUSES = ["Completed", "Paused"];

export function canRequestTimeCorrection(context: CurrentUserContext) {
  if (context.role?.slug === "super_admin") return true;
  return context.role?.slug === "maintenance_data_entry" && hasPermission(context, "work_orders.assign");
}

export function canReviewTimeCorrection(context: CurrentUserContext) {
  return context.role?.slug === "super_admin" || REVIEWER_ROLES.includes(context.role?.slug ?? "");
}

function computeAmount(durationMinutes: number, hourlyRate: number): number {
  return Math.round((durationMinutes / 60) * hourlyRate * 1000) / 1000;
}

function periodEnd(session: { stopped_at: Date | null; paused_at: Date | null }): Date | null {
  return session.stopped_at ?? session.paused_at;
}

export async function lockWorkerTime(tx: BackendTransaction, workerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`worker-time:${workerId}`}, 0))`;
}

// excludeSessionId: the period being corrected (null for a brand-new manual entry).
export async function loadOtherPeriods(tx: BackendTransaction, workerId: string, excludeSessionId: string | null, now: Date): Promise<OtherWorkPeriod[]> {
  const rows = await tx.workOrderWorkSession.findMany({
    where: { worker_id: workerId, status: { not: "Cancelled" }, ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) },
    select: { started_at: true, stopped_at: true, paused_at: true, work_orders: { select: { work_order_number: true } } },
  });
  return rows.map((r) => ({
    start: r.started_at,
    // A running period occupies the time up to now.
    end: periodEnd(r) ?? now,
    jobCardNumber: r.work_orders.work_order_number,
  }));
}

export async function assertNoPendingTimeCorrections(db: DbClient, workOrderId: string) {
  const pending = await db.workSessionTimeCorrection.count({ where: { work_order_id: workOrderId, status: "Pending" } });
  if (pending > 0) {
    throw new AppError(
      `This Job Card has ${pending} worker time ${pending === 1 ? "entry" : "entries"} (manual time or correction) waiting for Manager review. Approve or reject ${pending === 1 ? "it" : "them"} before closing.`,
      { code: "WORKFLOW_ERROR" }
    );
  }
}

// ── Request ──────────────────────────────────────────────────────────────────

export type TimeCorrectionRequestInput = {
  sessionId: string;
  correctedStart: string; // Kuwait wall-clock "YYYY-MM-DDTHH:mm"
  correctedEnd: string;
  reason: string;
  // Required when the corrected period is unusually long (see
  // LONG_PERIOD_REVIEW_MINUTES); the Manager sees it flagged on review.
  confirmLongPeriod?: boolean;
};

export async function requestWorkTimeCorrection(context: CurrentUserContext, input: TimeCorrectionRequestInput) {
  assertActiveUser(context);
  if (!canRequestTimeCorrection(context)) {
    throw new AppError("Only Maintenance Data Entry can send a time correction. Managers can correct the time directly.", { code: "FORBIDDEN" });
  }
  const reason = input.reason.trim();
  if (reason.length < CORRECTION_REASON_MIN_LENGTH) {
    throw new AppError("Please write the reason for the correction (at least 5 letters).", { code: "VALIDATION_ERROR" });
  }
  if (reason.length > CORRECTION_REASON_MAX_LENGTH) {
    throw new AppError("The reason is too long. Please keep it under 500 letters.", { code: "VALIDATION_ERROR" });
  }
  const correctedStart = parseKuwaitInputValue(input.correctedStart);
  const correctedEnd = parseKuwaitInputValue(input.correctedEnd);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    await tx.$queryRaw`SELECT id FROM work_order_work_sessions WHERE id = ${input.sessionId}::uuid FOR UPDATE`;
    const session = await tx.workOrderWorkSession.findUnique({
      where: { id: input.sessionId },
      include: { worker_profiles: { select: { name: true } } },
    });
    if (!session) throw new AppError("Work period was not found.", { code: "NOT_FOUND" });
    await lockWorkerTime(tx, session.worker_id);

    const wo = await tx.work_orders.findFirst({
      where: { AND: [{ id: session.work_order_id }, { deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
      select: { id: true, work_order_number: true, status: true },
    });
    if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (wo.status === "Closed") {
      throw new AppError("This Job Card is closed. Its work time can no longer be changed.", { code: "WORKFLOW_ERROR" });
    }
    if (session.status === "Active") {
      throw new AppError("This worker is still working. Pause or finish the work first, then correct the time.", { code: "WORKFLOW_ERROR" });
    }
    if (!CORRECTABLE_STATUSES.includes(session.status)) {
      throw new AppError("This work period was cancelled and cannot be corrected.", { code: "WORKFLOW_ERROR" });
    }
    const originalEnd = periodEnd(session);
    if (!originalEnd) throw new AppError("This work period has no end time yet.", { code: "WORKFLOW_ERROR" });

    const pending = await tx.workSessionTimeCorrection.findFirst({ where: { work_session_id: session.id, status: "Pending" } });
    if (pending) {
      const sameRequest =
        pending.requested_by === context.userId &&
        correctedStart?.getTime() === pending.corrected_started_at.getTime() &&
        correctedEnd?.getTime() === pending.corrected_ended_at.getTime();
      if (sameRequest) return { correction: pending, workOrderNumber: wo.work_order_number, workerName: session.worker_profiles.name, alreadyPending: true };
      throw new AppError("A time correction for this work period is already waiting for Manager review.", { code: "CONFLICT" });
    }

    const now = new Date();
    const check = checkTimeCorrection({
      correctedStart,
      correctedEnd,
      originalStart: session.started_at,
      originalEnd,
      now,
      otherPeriods: [...(await loadOtherPeriods(tx, session.worker_id, session.id, now)), ...(await loadPendingManualPeriods(tx, session.worker_id))],
      longPeriodConfirmed: input.confirmLongPeriod === true,
    });
    if (!check.ok) throw new AppError(check.message, { code: "VALIDATION_ERROR" });

    const correction = await tx.workSessionTimeCorrection.create({
      data: {
        work_session_id: session.id,
        work_order_id: session.work_order_id,
        worker_id: session.worker_id,
        original_started_at: session.started_at,
        original_ended_at: originalEnd,
        original_duration_minutes: session.duration_minutes,
        corrected_started_at: correctedStart!,
        corrected_ended_at: correctedEnd!,
        corrected_duration_minutes: check.durationMinutes,
        reason,
        requested_by: context.userId,
      },
    });
    return { correction, workOrderNumber: wo.work_order_number, workerName: session.worker_profiles.name, alreadyPending: false };
  });

  if (!result.alreadyPending) {
    const c = result.correction;
    const recipients = await withBackendTransaction(context.userId, async (tx) =>
      dedupeRecipients(await getActiveUserIdsByRoleSlugs(tx, REVIEWER_ROLES), context.userId)
    );
    const number = result.workOrderNumber ?? "a Job Card";
    await Promise.all([
      recipients.length
        ? notifyWorkflowEvent({
            eventKey: "job_card.time_correction_requested",
            entityType: "work_order",
            entityId: c.work_order_id,
            actorId: context.userId,
            recipientUserIds: recipients,
            category: "Approvals",
            priority: "high",
            title: "Worker time correction to review",
            // A correction row always has original_* (DB shape check).
            message: `${context.profile.full_name} corrected ${result.workerName}'s time on ${number}: ${formatDurationMinutes(c.original_duration_minutes!)} recorded → ${formatDurationMinutes(c.corrected_duration_minutes)}. Reason: ${reason}`,
            metadata: { job_card_number: number, worker_name: result.workerName },
            actionUrl: `/maintenance/work-orders/${c.work_order_id}?tab=assignment`,
            actionLabel: "Review time",
          })
        : Promise.resolve(),
      writeAuditLog({
        actorId: context.userId,
        action: "work_order.time_correction_requested",
        entityType: "work_order",
        entityId: c.work_order_id,
        summary: `Time correction requested for ${result.workerName} on ${number}`,
        metadata: {
          correction_id: c.id,
          session_id: c.work_session_id,
          worker_name: result.workerName,
          original_started_at: c.original_started_at!.toISOString(),
          original_ended_at: c.original_ended_at!.toISOString(),
          original_duration_minutes: c.original_duration_minutes,
          corrected_started_at: c.corrected_started_at.toISOString(),
          corrected_ended_at: c.corrected_ended_at.toISOString(),
          corrected_duration_minutes: c.corrected_duration_minutes,
          reason,
        },
      }),
      emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_WORK_TIME_UPDATED, c.work_order_id, context.userId),
    ]);
  }

  return { correctionId: result.correction.id, workOrderId: result.correction.work_order_id, alreadyPending: result.alreadyPending };
}

// ── Manual work time entry (Data Entry → Manager) ───────────────────────────

export type ManualTimeEntryRequestInput = {
  workerAssignmentId: string;
  start: string; // Kuwait wall-clock "YYYY-MM-DDTHH:mm"
  end: string;
  reason: string;
  confirmLongPeriod?: boolean;
};

// Pending manual entries of this worker (any Job Card) also occupy their
// time, so two waiting entries can never overlap each other.
async function loadPendingManualPeriods(tx: BackendTransaction, workerId: string): Promise<OtherWorkPeriod[]> {
  const rows = await tx.workSessionTimeCorrection.findMany({
    where: { worker_id: workerId, entry_kind: "manual_entry", status: "Pending" },
    select: { corrected_started_at: true, corrected_ended_at: true, work_orders: { select: { work_order_number: true } } },
  });
  return rows.map((r) => ({ start: r.corrected_started_at, end: r.corrected_ended_at, jobCardNumber: r.work_orders.work_order_number }));
}

export async function requestManualWorkTimeEntry(context: CurrentUserContext, input: ManualTimeEntryRequestInput) {
  assertActiveUser(context);
  if (!canRequestTimeCorrection(context)) {
    throw new AppError("Only Maintenance Data Entry can enter worker time for Manager approval. Managers can add a manual entry directly.", { code: "FORBIDDEN" });
  }
  const reason = input.reason.trim();
  if (reason.length < CORRECTION_REASON_MIN_LENGTH) {
    throw new AppError("Please write the reason for entering the time manually (at least 5 letters).", { code: "VALIDATION_ERROR" });
  }
  if (reason.length > CORRECTION_REASON_MAX_LENGTH) {
    throw new AppError("The reason is too long. Please keep it under 500 letters.", { code: "VALIDATION_ERROR" });
  }
  const start = parseKuwaitInputValue(input.start);
  const end = parseKuwaitInputValue(input.end);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    await tx.$queryRaw`SELECT id FROM work_order_worker_assignments WHERE id = ${input.workerAssignmentId}::uuid FOR UPDATE`;
    const assignment = await tx.workOrderWorkerAssignment.findUnique({
      where: { id: input.workerAssignmentId },
      include: { worker_profiles: { select: { name: true } } },
    });
    if (!assignment || assignment.status === "removed") throw new AppError("This worker is not assigned to the Job Card.", { code: "NOT_FOUND" });
    await lockWorkerTime(tx, assignment.worker_id);

    const wo = await tx.work_orders.findFirst({
      where: { AND: [{ id: assignment.work_order_id }, { deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
      select: { id: true, work_order_number: true, status: true },
    });
    if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (wo.status === "Closed") throw new AppError("This Job Card is closed. Work time can no longer be added.", { code: "WORKFLOW_ERROR" });
    if (wo.status === "Closure Requested") {
      throw new AppError("Closure has already been requested for this Job Card. Work time can no longer be added.", { code: "WORKFLOW_ERROR" });
    }
    if (assignment.status === "finished") {
      throw new AppError("This worker's work is already marked Finished. Ask the Maintenance Manager to add the time.", { code: "WORKFLOW_ERROR" });
    }
    const running = await tx.workOrderWorkSession.findFirst({ where: { worker_assignment_id: assignment.id, status: "Active" }, select: { id: true } });
    if (running) {
      throw new AppError("This worker's timer is running. Pause or finish the timer first; manual time is only for work done without the timer.", { code: "WORKFLOW_ERROR" });
    }

    // Duplicate submission (double click, retry): the same person, worker and
    // times return the request already waiting instead of a second one.
    if (start && end) {
      const same = await tx.workSessionTimeCorrection.findFirst({
        where: {
          entry_kind: "manual_entry",
          status: "Pending",
          worker_assignment_id: assignment.id,
          requested_by: context.userId,
          corrected_started_at: start,
          corrected_ended_at: end,
        },
      });
      if (same) return { entry: same, workOrderNumber: wo.work_order_number, workerName: assignment.worker_profiles.name, alreadyPending: true };
    }

    const now = new Date();
    const check = checkWorkPeriod({
      start,
      end,
      now,
      otherPeriods: [...(await loadOtherPeriods(tx, assignment.worker_id, null, now)), ...(await loadPendingManualPeriods(tx, assignment.worker_id))],
      longPeriodConfirmed: input.confirmLongPeriod === true,
    });
    if (!check.ok) throw new AppError(check.message, { code: "VALIDATION_ERROR" });

    const entry = await tx.workSessionTimeCorrection.create({
      data: {
        entry_kind: "manual_entry",
        worker_assignment_id: assignment.id,
        work_order_id: assignment.work_order_id,
        worker_id: assignment.worker_id,
        corrected_started_at: start!,
        corrected_ended_at: end!,
        corrected_duration_minutes: check.durationMinutes,
        reason,
        requested_by: context.userId,
      },
    });
    return { entry, workOrderNumber: wo.work_order_number, workerName: assignment.worker_profiles.name, alreadyPending: false };
  });

  if (!result.alreadyPending) {
    const e = result.entry;
    const recipients = await withBackendTransaction(context.userId, async (tx) =>
      dedupeRecipients(await getActiveUserIdsByRoleSlugs(tx, REVIEWER_ROLES), context.userId)
    );
    const number = result.workOrderNumber ?? "a Job Card";
    await Promise.all([
      recipients.length
        ? notifyWorkflowEvent({
            eventKey: "job_card.time_correction_requested",
            entityType: "work_order",
            entityId: e.work_order_id,
            actorId: context.userId,
            recipientUserIds: recipients,
            category: "Approvals",
            priority: "high",
            title: "Manual work time to review",
            message: `${context.profile.full_name} entered ${formatDurationMinutes(e.corrected_duration_minutes)} of work for ${result.workerName} on ${number} (no timer used). Reason: ${reason}`,
            metadata: { job_card_number: number, worker_name: result.workerName },
            actionUrl: `/maintenance/work-orders/${e.work_order_id}?tab=assignment`,
            actionLabel: "Review time",
          })
        : Promise.resolve(),
      writeAuditLog({
        actorId: context.userId,
        action: "work_order.manual_time_entry_requested",
        entityType: "work_order",
        entityId: e.work_order_id,
        summary: `Manual work time entered for ${result.workerName} on ${number}`,
        metadata: {
          entry_id: e.id,
          worker_assignment_id: e.worker_assignment_id,
          worker_name: result.workerName,
          started_at: e.corrected_started_at.toISOString(),
          ended_at: e.corrected_ended_at.toISOString(),
          duration_minutes: e.corrected_duration_minutes,
          reason,
        },
      }),
      emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_WORK_TIME_UPDATED, e.work_order_id, context.userId),
    ]);
  }

  return { entryId: result.entry.id, workOrderId: result.entry.work_order_id, alreadyPending: result.alreadyPending };
}

// ── Review ───────────────────────────────────────────────────────────────────

function assertCanReview(context: CurrentUserContext) {
  assertActiveUser(context);
  if (!canReviewTimeCorrection(context)) {
    throw new AppError("Only the Maintenance Manager can approve or reject a time correction.", { code: "FORBIDDEN" });
  }
}

async function lockPendingCorrection(tx: BackendTransaction, context: CurrentUserContext, correctionId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string; requested_by: string }>>`
    SELECT id, status, requested_by FROM work_session_time_corrections WHERE id = ${correctionId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AppError("Time entry was not found.", { code: "NOT_FOUND" });
  if (row.status !== "Pending") {
    throw new AppError(`This time entry was already ${row.status.toLowerCase()}.`, { code: "CONFLICT" });
  }
  if (row.requested_by === context.userId) {
    throw new AppError("You cannot approve or reject your own time entry.", { code: "FORBIDDEN" });
  }
  const correction = await tx.workSessionTimeCorrection.findUnique({
    where: { id: correctionId },
    include: {
      worker_profiles: { select: { name: true } },
      work_orders: { select: { id: true, work_order_number: true, status: true, deleted_at: true } },
    },
  });
  return correction!;
}

type ReviewResult = {
  correctionId: string;
  kind: "correction" | "manual_entry";
  workOrderId: string;
  workOrderNumber: string | null;
  workerName: string;
  requestedBy: string;
  // null for a manual entry (there was no recorded period before it).
  originalMinutes: number | null;
  correctedMinutes: number;
};

type LockedEntry = Awaited<ReturnType<typeof lockPendingCorrection>>;

// Approving a manual entry: re-checks everything at decision time (the
// worker, the Job Card, overlaps with every period of the worker recorded
// since the request), then creates ONE Completed work period priced with the
// assignment's frozen rate snapshot and links the entry to it.
async function approveManualEntryInTx(tx: BackendTransaction, context: CurrentUserContext, c: LockedEntry, remarks: string | null): Promise<ReviewResult> {
  if (!c.worker_assignment_id) throw new AppError("This manual entry has no worker.", { code: "WORKFLOW_ERROR" });
  await tx.$queryRaw`SELECT id FROM work_order_worker_assignments WHERE id = ${c.worker_assignment_id}::uuid FOR UPDATE`;
  await lockWorkerTime(tx, c.worker_id);
  const assignment = await tx.workOrderWorkerAssignment.findUnique({ where: { id: c.worker_assignment_id } });
  if (!assignment || assignment.status === "removed") {
    throw new AppError("This worker was removed from the Job Card. Please reject this entry.", { code: "WORKFLOW_ERROR" });
  }
  const now = new Date();
  const check = checkWorkPeriod({
    start: c.corrected_started_at,
    end: c.corrected_ended_at,
    now,
    otherPeriods: await loadOtherPeriods(tx, c.worker_id, null, now),
    // Confirmed by the requester; approving is the Manager's review of it.
    longPeriodConfirmed: true,
  });
  if (!check.ok) throw new AppError(`${check.message} Please reject this entry.`, { code: "VALIDATION_ERROR" });

  const rate = Number(assignment.hourly_rate_snapshot);
  const session = await tx.workOrderWorkSession.create({
    data: {
      work_order_id: c.work_order_id,
      worker_assignment_id: assignment.id,
      worker_id: c.worker_id,
      started_at: c.corrected_started_at,
      stopped_at: c.corrected_ended_at,
      status: "Completed",
      duration_minutes: check.durationMinutes,
      hourly_rate_snapshot: assignment.hourly_rate_snapshot,
      calculated_amount: computeAmount(check.durationMinutes, rate),
      is_manual_entry: true,
      // Who entered it; the Manager who approved it is on the entry row.
      entered_by: c.requested_by,
      notes: `Entered manually (no timer): ${c.reason}`,
    },
    select: { id: true },
  });
  await tx.workSessionTimeCorrection.update({
    where: { id: c.id },
    data: { status: "Approved", work_session_id: session.id, reviewed_by: context.userId, reviewed_at: now, review_remarks: remarks, updated_at: now },
  });
  return {
    correctionId: c.id,
    kind: "manual_entry",
    workOrderId: c.work_order_id,
    workOrderNumber: c.work_orders.work_order_number,
    workerName: c.worker_profiles.name,
    requestedBy: c.requested_by,
    originalMinutes: null,
    correctedMinutes: check.durationMinutes,
  };
}

export async function approveWorkTimeCorrection(context: CurrentUserContext, input: { correctionId: string; remarks?: string }): Promise<ReviewResult> {
  assertCanReview(context);
  const remarks = input.remarks?.trim() || null;

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const c = await lockPendingCorrection(tx, context, input.correctionId);
    if (c.work_orders.deleted_at) throw new AppError("This Job Card has been deleted.", { code: "WORKFLOW_ERROR" });
    if (c.work_orders.status === "Closed") {
      throw new AppError("This Job Card is closed. Its work time can no longer be changed. Please reject this entry.", { code: "WORKFLOW_ERROR" });
    }
    if (c.entry_kind === "manual_entry") return approveManualEntryInTx(tx, context, c, remarks);

    // A correction row always has work_session_id + original_* (DB shape check).
    const sessionId = c.work_session_id!;
    const originalStart = c.original_started_at!;
    const originalEnd = c.original_ended_at!;
    await tx.$queryRaw`SELECT id FROM work_order_work_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    await lockWorkerTime(tx, c.worker_id);
    const session = await tx.workOrderWorkSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new AppError("Work period was not found.", { code: "NOT_FOUND" });
    if (!CORRECTABLE_STATUSES.includes(session.status)) {
      throw new AppError("This work period is no longer finished or was cancelled. Please reject this correction.", { code: "WORKFLOW_ERROR" });
    }
    const currentEnd = periodEnd(session);
    const unchanged =
      session.started_at.getTime() === originalStart.getTime() &&
      currentEnd?.getTime() === originalEnd.getTime() &&
      session.duration_minutes === c.original_duration_minutes;
    if (!unchanged) {
      throw new AppError(
        "The recorded time for this work period changed after the correction was sent. Please reject it and ask for a new correction.",
        { code: "CONFLICT" }
      );
    }

    const now = new Date();
    const check = checkTimeCorrection({
      correctedStart: c.corrected_started_at,
      correctedEnd: c.corrected_ended_at,
      originalStart,
      originalEnd,
      now,
      otherPeriods: await loadOtherPeriods(tx, c.worker_id, session.id, now),
      // The requester confirmed a long period when sending it; approving is
      // the Manager's review of it (the panel flags it as unusually long).
      longPeriodConfirmed: true,
    });
    if (!check.ok) throw new AppError(`${check.message} Please reject this correction.`, { code: "VALIDATION_ERROR" });

    const durationMinutes = periodMinutes(c.corrected_started_at, c.corrected_ended_at);
    await tx.workOrderWorkSession.update({
      where: { id: session.id },
      data: {
        original_started_at: session.original_started_at ?? session.started_at,
        original_ended_at: session.original_started_at ? session.original_ended_at : currentEnd,
        original_duration_minutes: session.original_started_at ? session.original_duration_minutes : session.duration_minutes,
        started_at: c.corrected_started_at,
        stopped_at: session.status === "Completed" ? c.corrected_ended_at : session.stopped_at,
        paused_at: session.status === "Paused" ? c.corrected_ended_at : session.paused_at,
        duration_minutes: durationMinutes,
        calculated_amount: computeAmount(durationMinutes, Number(session.hourly_rate_snapshot)),
        correction_reason: c.reason,
        edited_by: context.userId,
        updated_at: now,
      },
    });
    await tx.workSessionTimeCorrection.update({
      where: { id: c.id },
      data: { status: "Approved", reviewed_by: context.userId, reviewed_at: now, review_remarks: remarks, updated_at: now },
    });

    return {
      correctionId: c.id,
      kind: "correction" as const,
      workOrderId: c.work_order_id,
      workOrderNumber: c.work_orders.work_order_number,
      workerName: c.worker_profiles.name,
      requestedBy: c.requested_by,
      originalMinutes: c.original_duration_minutes,
      correctedMinutes: durationMinutes,
    };
  });

  await afterReview(context, result, "approved", remarks);
  return result;
}

export async function rejectWorkTimeCorrection(context: CurrentUserContext, input: { correctionId: string; remarks: string }): Promise<ReviewResult> {
  assertCanReview(context);
  const remarks = input.remarks.trim();
  if (remarks.length < 3) throw new AppError("Please write why it is rejected.", { code: "VALIDATION_ERROR" });

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const c = await lockPendingCorrection(tx, context, input.correctionId);
    const now = new Date();
    await tx.workSessionTimeCorrection.update({
      where: { id: c.id },
      data: { status: "Rejected", reviewed_by: context.userId, reviewed_at: now, review_remarks: remarks, updated_at: now },
    });
    return {
      correctionId: c.id,
      kind: (c.entry_kind === "manual_entry" ? "manual_entry" : "correction") as ReviewResult["kind"],
      workOrderId: c.work_order_id,
      workOrderNumber: c.work_orders.work_order_number,
      workerName: c.worker_profiles.name,
      requestedBy: c.requested_by,
      originalMinutes: c.original_duration_minutes,
      correctedMinutes: c.corrected_duration_minutes,
    };
  });

  await afterReview(context, result, "rejected", remarks);
  return result;
}

async function afterReview(context: CurrentUserContext, result: ReviewResult, decision: "approved" | "rejected", remarks: string | null) {
  const number = result.workOrderNumber ?? "a Job Card";
  const approved = decision === "approved";
  const manual = result.kind === "manual_entry";
  const title = manual
    ? approved
      ? "Manual work time approved"
      : "Manual work time not approved"
    : approved
      ? "Time correction approved"
      : "Time correction not approved";
  const message = manual
    ? approved
      ? `${formatDurationMinutes(result.correctedMinutes)} of work for ${result.workerName} on ${number} is now recorded.${remarks ? ` Remarks: ${remarks}` : ""}`
      : `The manual time for ${result.workerName} on ${number} was not added. Reason: ${remarks}`
    : approved
      ? `${result.workerName}'s time on ${number} is now ${formatDurationMinutes(result.correctedMinutes)}.${remarks ? ` Remarks: ${remarks}` : ""}`
      : `The recorded time for ${result.workerName} on ${number} stays at ${formatDurationMinutes(result.originalMinutes ?? 0)}. Reason: ${remarks}`;
  await Promise.all([
    notifyWorkflowEvent({
      eventKey: approved ? "job_card.time_correction_approved" : "job_card.time_correction_rejected",
      entityType: "work_order",
      entityId: result.workOrderId,
      actorId: context.userId,
      recipientUserIds: dedupeRecipients([result.requestedBy], context.userId),
      category: "Approvals",
      title,
      message,
      metadata: { job_card_number: number, worker_name: result.workerName },
      actionUrl: `/maintenance/work-orders/${result.workOrderId}?tab=assignment`,
    }),
    writeAuditLog({
      actorId: context.userId,
      action: manual
        ? approved
          ? "work_order.manual_time_entry_approved"
          : "work_order.manual_time_entry_rejected"
        : approved
          ? "work_order.time_correction_approved"
          : "work_order.time_correction_rejected",
      entityType: "work_order",
      entityId: result.workOrderId,
      summary: `${manual ? "Manual work time" : "Time correction"} ${decision} for ${result.workerName} on ${number}`,
      metadata: {
        correction_id: result.correctionId,
        entry_kind: result.kind,
        worker_name: result.workerName,
        original_duration_minutes: result.originalMinutes,
        corrected_duration_minutes: result.correctedMinutes,
        remarks,
      },
    }),
    emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_WORK_TIME_UPDATED, result.workOrderId, context.userId),
  ]);
}

// ── Read ─────────────────────────────────────────────────────────────────────

export type TimeCorrectionView = {
  id: string;
  kind: "correction" | "manual_entry";
  // The period it changed / created (null for a manual entry not yet approved).
  sessionId: string | null;
  workerAssignmentId: string;
  workerName: string;
  status: "Pending" | "Approved" | "Rejected";
  // Recorded values before a correction; null for a manual entry.
  originalStart: string | null;
  originalEnd: string | null;
  originalMinutes: number | null;
  correctedStart: string;
  correctedEnd: string;
  correctedMinutes: number;
  reason: string;
  requestedByName: string;
  requestedAt: string;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewRemarks: string | null;
  requestedByMe: boolean;
  // A Manager's own Edit / Correct (recorded and decided by the same Manager).
  directByManager: boolean;
  // Cost viewers only (null otherwise — never computed for Data Entry).
  costImpact: { hourlyRate: number; originalAmount: number; correctedAmount: number; difference: number } | null;
};

/** All corrections and manual entries on one Job Card, newest first. Caller has applied the visibility filter. */
export async function getTimeCorrectionsForWorkOrder(
  db: DbClient,
  workOrderId: string,
  viewer: { userId: string; canViewCosts: boolean }
): Promise<TimeCorrectionView[]> {
  const rows = await db.workSessionTimeCorrection.findMany({
    where: { work_order_id: workOrderId },
    orderBy: { requested_at: "desc" },
    include: {
      worker_profiles: { select: { name: true } },
      profiles_requested_by: { select: { full_name: true } },
      profiles_reviewed_by: { select: { full_name: true } },
      work_session: { select: { hourly_rate_snapshot: true, worker_assignment_id: true } },
      worker_assignment: { select: { hourly_rate_snapshot: true } },
    },
  });
  return rows.map((r) => {
    const kind: TimeCorrectionView["kind"] = r.entry_kind === "manual_entry" ? "manual_entry" : "correction";
    // The rate the period is (or will be) priced at: the period's own frozen
    // snapshot, or for a waiting manual entry the assignment's snapshot.
    const rate = Number(r.work_session?.hourly_rate_snapshot ?? r.worker_assignment?.hourly_rate_snapshot ?? 0);
    const originalAmount = computeAmount(r.original_duration_minutes ?? 0, rate);
    const correctedAmount = computeAmount(r.corrected_duration_minutes, rate);
    return {
      id: r.id,
      kind,
      sessionId: r.work_session_id,
      workerAssignmentId: r.worker_assignment_id ?? r.work_session?.worker_assignment_id ?? "",
      workerName: r.worker_profiles.name,
      status: r.status as TimeCorrectionView["status"],
      originalStart: r.original_started_at?.toISOString() ?? null,
      originalEnd: r.original_ended_at?.toISOString() ?? null,
      originalMinutes: r.original_duration_minutes,
      correctedStart: r.corrected_started_at.toISOString(),
      correctedEnd: r.corrected_ended_at.toISOString(),
      correctedMinutes: r.corrected_duration_minutes,
      reason: r.reason,
      requestedByName: r.profiles_requested_by.full_name,
      requestedAt: r.requested_at.toISOString(),
      reviewedByName: r.profiles_reviewed_by?.full_name ?? null,
      reviewedAt: r.reviewed_at?.toISOString() ?? null,
      reviewRemarks: r.review_remarks,
      requestedByMe: r.requested_by === viewer.userId,
      directByManager: r.status === "Approved" && r.reviewed_by === r.requested_by,
      costImpact: viewer.canViewCosts
        ? { hourlyRate: rate, originalAmount, correctedAmount, difference: Math.round((correctedAmount - originalAmount) * 1000) / 1000 }
        : null,
    };
  });
}

// ── Daily Activity / closure summary ─────────────────────────────────────────

export type WorkTimeSourceSummary = {
  // Non-cancelled periods recorded by the timer (never manually entered).
  automaticMinutes: number;
  // Approved manual entries (Data Entry, Manager-approved) and Manager manual entries.
  manualMinutes: number;
  // Recorded periods whose times were later corrected.
  correctedPeriods: number;
  // Waiting for Manager review (manual entries + corrections).
  pendingManualEntries: number;
  pendingCorrections: number;
  // Per worker assignment: manual entries waiting (shown on the worker row).
  pendingByAssignment: Record<string, { start: string; end: string; minutes: number }[]>;
  // Per worker assignment: approved/entered manual minutes (for the badge).
  manualMinutesByAssignment: Record<string, number>;
};

/** Bulk, read-only. Caller has already scoped workOrderIds by visibility. Minutes only — no money. */
export async function getWorkTimeSourceSummaries(db: DbClient, workOrderIds: string[]): Promise<Map<string, WorkTimeSourceSummary>> {
  const out = new Map<string, WorkTimeSourceSummary>();
  if (workOrderIds.length === 0) return out;
  const [sessions, pending] = await Promise.all([
    db.workOrderWorkSession.findMany({
      where: { work_order_id: { in: workOrderIds }, status: { not: "Cancelled" } },
      select: { work_order_id: true, worker_assignment_id: true, duration_minutes: true, is_manual_entry: true, original_started_at: true },
    }),
    db.workSessionTimeCorrection.findMany({
      where: { work_order_id: { in: workOrderIds }, status: "Pending" },
      select: { work_order_id: true, entry_kind: true, worker_assignment_id: true, corrected_started_at: true, corrected_ended_at: true, corrected_duration_minutes: true },
      orderBy: { corrected_started_at: "asc" },
    }),
  ]);
  const get = (id: string) => {
    let s = out.get(id);
    if (!s) {
      s = { automaticMinutes: 0, manualMinutes: 0, correctedPeriods: 0, pendingManualEntries: 0, pendingCorrections: 0, pendingByAssignment: {}, manualMinutesByAssignment: {} };
      out.set(id, s);
    }
    return s;
  };
  for (const id of workOrderIds) get(id);
  for (const s of sessions) {
    const sum = get(s.work_order_id);
    if (s.is_manual_entry) {
      sum.manualMinutes += s.duration_minutes;
      sum.manualMinutesByAssignment[s.worker_assignment_id] = (sum.manualMinutesByAssignment[s.worker_assignment_id] ?? 0) + s.duration_minutes;
    } else {
      sum.automaticMinutes += s.duration_minutes;
    }
    if (s.original_started_at) sum.correctedPeriods += 1;
  }
  for (const p of pending) {
    const sum = get(p.work_order_id);
    if (p.entry_kind === "manual_entry" && p.worker_assignment_id) {
      sum.pendingManualEntries += 1;
      (sum.pendingByAssignment[p.worker_assignment_id] ??= []).push({
        start: p.corrected_started_at.toISOString(),
        end: p.corrected_ended_at.toISOString(),
        minutes: p.corrected_duration_minutes,
      });
    } else {
      sum.pendingCorrections += 1;
    }
  }
  return out;
}
