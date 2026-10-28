import "server-only";

import type { prisma } from "@/lib/db/prisma";
import type { CurrentUserContext } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { dedupeRecipients, notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { assertActiveUser } from "@/lib/backend/security/guards";
import { withBackendTransaction, type BackendTransaction } from "@/lib/backend/shared/transaction";
import { lockJobCardActivity } from "@/lib/backend/work-orders/repository";
import { AppError } from "@/lib/errors/app-error";
import { formatDurationMinutes, parseKuwaitInputValue } from "@/lib/format/kuwait-time";
import { emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { hasPermission } from "@/lib/security/permissions";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import {
  checkManualHoursEntry,
  checkTimeCorrection,
  checkWorkPeriod,
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTION_REASON_MIN_LENGTH,
  periodMinutes,
  possibleConflicts,
  type OtherWorkPeriod,
} from "@/lib/work-orders/work-time-correction-rules";

type DbClient = typeof prisma | BackendTransaction;

// Worker Time — manual entries and corrections, single closure approval
// (migration 20261027030000).
//
// There is ONE Manager approval stage for worker time: the Job Card's
// Closure Review. Data Entry's entries are saved at once (status "Recorded")
// and the Manager reviews them there, approving the closure or returning it
// for correction (lib/backend/work-orders/service.ts returnJobCardClosure).
//
// Manual entry (recordManualWorkTime): the dates the work happened on (times
// when known) and the ACTUAL hours worked. In one transaction it creates ONE
// work_order_work_sessions row (Completed, is_manual_entry, duration_minutes
// = the actual hours, priced with the assignment's frozen hourly_rate_snapshot,
// started_at → stopped_at = the dates, period_is_span when not one continuous
// stretch) and one audit row here (entry_kind "manual_entry", status
// "Recorded", linked through work_session_id). Every total reads the session
// row, so the hours count exactly once, everywhere.
//
// Correction of a timer period (correctRecordedWorkTime) and change of a
// manual entry (changeManualWorkTime): applied at once to the period row.
// The FIRST values are kept in the row's original_* columns (written only
// while still empty) and every change is one audit row here (entry_kind
// "correction", original_* = the values before THIS change, status
// "Recorded"). A timer period is never overwritten by a manual entry.
//
// Older rows still "Pending" (sent before this change) keep their old
// meaning: not counted, decided by the Manager with Approve / Reject
// (approveWorkTimeCorrection / rejectWorkTimeCorrection below), and closure
// waits for them (assertNoPendingTimeCorrections). No new Pending rows are
// created.
//
// Role checks follow work-sessions.ts (role slug): Data Entry with
// work_orders.assign (the timer permission) or Super Admin enter and correct
// time; Maintenance Manager or Super Admin may also change a manual entry and
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
// Span periods (hours entered over a date range) are not continuous work, so
// they never block another period; Closure Review flags possible overlaps.
export async function loadOtherPeriods(tx: BackendTransaction, workerId: string, excludeSessionId: string | null, now: Date): Promise<OtherWorkPeriod[]> {
  const rows = await tx.workOrderWorkSession.findMany({
    where: { worker_id: workerId, status: { not: "Cancelled" }, period_is_span: false, ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}) },
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
    // Only older entries (sent before single closure approval) can still be Pending.
    throw new AppError(
      `This Job Card has ${pending} older worker time ${pending === 1 ? "entry" : "entries"} waiting for the Manager's decision. The Manager must approve or reject ${pending === 1 ? "it" : "them"} in the Job Card's Worker Time section before closing.`,
      { code: "WORKFLOW_ERROR" }
    );
  }
}

// ── Shared ───────────────────────────────────────────────────────────────────

// Worker time may be entered or changed until closure is requested. After
// that the Manager reviews it (and can return the request for correction);
// after closure it is fixed.
const TIME_LOCKED_MESSAGES: Record<string, string> = {
  Closed: "This Job Card is closed. Its work time can no longer be changed.",
  "Closure Requested":
    "Closure has been requested for this Job Card, so its work time can no longer be changed. If the time is wrong, the Manager can return the closure request for correction.",
};

async function loadTimeEditableJobCard(tx: BackendTransaction, context: CurrentUserContext, workOrderId: string) {
  const wo = await tx.work_orders.findFirst({
    where: { AND: [{ id: workOrderId }, { deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
    select: { id: true, work_order_number: true, status: true },
  });
  if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
  const locked = TIME_LOCKED_MESSAGES[wo.status];
  if (locked) throw new AppError(locked, { code: "WORKFLOW_ERROR" });
  return wo;
}

function cleanReason(raw: string, what: string): string {
  const reason = raw.trim();
  if (reason.length < CORRECTION_REASON_MIN_LENGTH) {
    throw new AppError(`Please write the reason for ${what} (at least 5 letters).`, { code: "VALIDATION_ERROR" });
  }
  if (reason.length > CORRECTION_REASON_MAX_LENGTH) {
    throw new AppError("The reason is too long. Please keep it under 500 letters.", { code: "VALIDATION_ERROR" });
  }
  return reason;
}

// Duplicate submission (double click, retry, refresh): the same form's id
// returns what was already saved instead of saving twice. Checked after the
// worker lock, so a parallel second request waits for the first to commit.
async function findSavedSubmission(tx: BackendTransaction, submissionId: string | null | undefined, userId: string) {
  if (!submissionId) return null;
  const row = await tx.workSessionTimeCorrection.findUnique({ where: { client_submission_id: submissionId } });
  if (row && row.requested_by !== userId) {
    throw new AppError("This form was already used by someone else. Close it and open it again.", { code: "CONFLICT" });
  }
  return row;
}

// Lock order as every work/time write (repository.ts lockJobCardActivity):
// Job Card first, then the period row, then the worker — so a time entry,
// a roster save and a closure request/decision can never deadlock or cross.
async function lockJobCardForSession(tx: BackendTransaction, sessionId: string) {
  const target = await tx.workOrderWorkSession.findUnique({ where: { id: sessionId }, select: { work_order_id: true } });
  if (!target) throw new AppError("Work period was not found.", { code: "NOT_FOUND" });
  await lockJobCardActivity(tx, target.work_order_id);
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "P2002";
}

// Older Pending entries of this worker (any Job Card) still occupy their time.
async function loadPendingManualPeriods(tx: BackendTransaction, workerId: string): Promise<OtherWorkPeriod[]> {
  const rows = await tx.workSessionTimeCorrection.findMany({
    where: { worker_id: workerId, entry_kind: "manual_entry", status: "Pending" },
    select: { corrected_started_at: true, corrected_ended_at: true, work_orders: { select: { work_order_number: true } } },
  });
  return rows.map((r) => ({ start: r.corrected_started_at, end: r.corrected_ended_at, jobCardNumber: r.work_orders.work_order_number }));
}

async function assertNoOlderPendingOnSession(tx: BackendTransaction, sessionId: string) {
  const pending = await tx.workSessionTimeCorrection.findFirst({ where: { work_session_id: sessionId, status: "Pending" }, select: { id: true } });
  if (pending) {
    throw new AppError("An older correction of this work period is waiting for the Manager's decision. Ask the Manager to approve or reject it first.", { code: "CONFLICT" });
  }
}

// ── Correct a timer period (saved at once) ───────────────────────────────────

export type TimeCorrectionInput = {
  sessionId: string;
  correctedStart: string; // Kuwait wall-clock "YYYY-MM-DDTHH:mm"
  correctedEnd: string;
  reason: string;
  // Required when the corrected period is unusually long (see
  // LONG_PERIOD_REVIEW_MINUTES); the Manager sees it in Closure Review.
  confirmLongPeriod?: boolean;
  submissionId?: string | null;
};

export async function correctRecordedWorkTime(context: CurrentUserContext, input: TimeCorrectionInput) {
  assertActiveUser(context);
  if (!canRequestTimeCorrection(context)) {
    throw new AppError("Only Maintenance Data Entry can correct worker time here. Managers use Edit / Correct.", { code: "FORBIDDEN" });
  }
  const reason = cleanReason(input.reason, "the correction");
  const correctedStart = parseKuwaitInputValue(input.correctedStart);
  const correctedEnd = parseKuwaitInputValue(input.correctedEnd);

  const run = () =>
    withBackendTransaction(context.userId, async (tx) => {
      await lockJobCardForSession(tx, input.sessionId);
      await tx.$queryRaw`SELECT id FROM work_order_work_sessions WHERE id = ${input.sessionId}::uuid FOR UPDATE`;
      const session = await tx.workOrderWorkSession.findUnique({
        where: { id: input.sessionId },
        include: { worker_profiles: { select: { name: true } } },
      });
      if (!session) throw new AppError("Work period was not found.", { code: "NOT_FOUND" });
      await lockWorkerTime(tx, session.worker_id);
      const saved = await findSavedSubmission(tx, input.submissionId, context.userId);
      if (saved) return { correction: saved, workerName: session.worker_profiles.name, workOrderNumber: null as string | null, alreadySaved: true };

      const wo = await loadTimeEditableJobCard(tx, context, session.work_order_id);
      if (session.status === "Active") {
        throw new AppError("This worker is still working. Pause or finish the work first, then correct the time.", { code: "WORKFLOW_ERROR" });
      }
      if (!CORRECTABLE_STATUSES.includes(session.status)) {
        throw new AppError("This work period was cancelled and cannot be corrected.", { code: "WORKFLOW_ERROR" });
      }
      if (session.is_manual_entry) {
        throw new AppError("This time was entered manually. Use Change Manual Time to change it.", { code: "WORKFLOW_ERROR" });
      }
      const originalEnd = periodEnd(session);
      if (!originalEnd) throw new AppError("This work period has no end time yet.", { code: "WORKFLOW_ERROR" });
      await assertNoOlderPendingOnSession(tx, session.id);

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
          status: "Recorded",
          requested_by: context.userId,
          client_submission_id: input.submissionId ?? null,
        },
      });
      // The first system-recorded values stay in original_* (only written while empty).
      await tx.workOrderWorkSession.update({
        where: { id: session.id },
        data: {
          original_started_at: session.original_started_at ?? session.started_at,
          original_ended_at: session.original_started_at ? session.original_ended_at : originalEnd,
          original_duration_minutes: session.original_started_at ? session.original_duration_minutes : session.duration_minutes,
          started_at: correctedStart!,
          stopped_at: session.status === "Completed" ? correctedEnd! : session.stopped_at,
          paused_at: session.status === "Paused" ? correctedEnd! : session.paused_at,
          duration_minutes: check.durationMinutes,
          calculated_amount: computeAmount(check.durationMinutes, Number(session.hourly_rate_snapshot)),
          correction_reason: reason,
          edited_by: context.userId,
          updated_at: now,
        },
      });
      return { correction, workerName: session.worker_profiles.name, workOrderNumber: wo.work_order_number, alreadySaved: false };
    });

  const result = await runOnce(run, input.submissionId, context.userId);
  const c = result.correction;
  if (!result.alreadySaved) {
    await Promise.all([
      writeAuditLog({
        actorId: context.userId,
        action: "work_order.time_correction_recorded",
        entityType: "work_order",
        entityId: c.work_order_id,
        summary: `Worker time corrected for ${result.workerName} on ${result.workOrderNumber ?? "a Job Card"}`,
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
  return { correctionId: c.id, workOrderId: c.work_order_id, alreadySaved: result.alreadySaved, workerName: result.workerName, minutes: c.corrected_duration_minutes };
}

// A unique-index race on client_submission_id (two identical requests at the
// same instant) is answered with the row the other request saved.
async function runOnce<T extends { correction: { requested_by: string }; alreadySaved: boolean }>(
  run: () => Promise<T>,
  submissionId: string | null | undefined,
  userId: string
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (submissionId && isUniqueViolation(error)) {
      const again = await run();
      if (again.alreadySaved && again.correction.requested_by === userId) return again;
    }
    throw error;
  }
}

// ── Manual work time (saved at once) ─────────────────────────────────────────

export type ManualWorkTimeFields = {
  startDate: string; // YYYY-MM-DD, Kuwait
  startTime: string; // HH:mm or "" when not known
  endDate: string;
  endTime: string;
  actualHours: string;
  reason: string;
  confirmLongPeriod?: boolean;
  submissionId: string;
};

function checkManualFields(input: ManualWorkTimeFields, now: Date) {
  const check = checkManualHoursEntry({
    startDate: input.startDate,
    startTime: input.startTime,
    endDate: input.endDate,
    endTime: input.endTime,
    actualHours: input.actualHours,
    now,
    longPeriodConfirmed: input.confirmLongPeriod === true,
  });
  if (!check.ok) throw new AppError(check.message, { code: "VALIDATION_ERROR" });
  return check;
}

export async function recordManualWorkTime(context: CurrentUserContext, input: ManualWorkTimeFields & { workerAssignmentId: string }) {
  assertActiveUser(context);
  if (!canRequestTimeCorrection(context)) {
    throw new AppError("Only Maintenance Data Entry can enter worker time manually here. Managers use Add Manual Entry.", { code: "FORBIDDEN" });
  }
  const reason = cleanReason(input.reason, "entering the time manually");

  const run = () =>
    withBackendTransaction(context.userId, async (tx) => {
      // Lock order as every work/time write: Job Card, then the row, then the worker.
      const target = await tx.workOrderWorkerAssignment.findUnique({ where: { id: input.workerAssignmentId }, select: { work_order_id: true } });
      if (!target) throw new AppError("This worker is not assigned to the Job Card.", { code: "NOT_FOUND" });
      await lockJobCardActivity(tx, target.work_order_id);
      await tx.$queryRaw`SELECT id FROM work_order_worker_assignments WHERE id = ${input.workerAssignmentId}::uuid FOR UPDATE`;
      const assignment = await tx.workOrderWorkerAssignment.findUnique({
        where: { id: input.workerAssignmentId },
        include: { worker_profiles: { select: { name: true } } },
      });
      if (!assignment || assignment.status === "removed") throw new AppError("This worker is not assigned to the Job Card.", { code: "NOT_FOUND" });
      await lockWorkerTime(tx, assignment.worker_id);
      const saved = await findSavedSubmission(tx, input.submissionId, context.userId);
      if (saved) return { correction: saved, workerName: assignment.worker_profiles.name, workOrderNumber: null as string | null, alreadySaved: true, conflicts: [] as OtherWorkPeriod[] };

      const wo = await loadTimeEditableJobCard(tx, context, assignment.work_order_id);
      if (assignment.status === "finished") {
        throw new AppError(
          "This worker's work is already marked Finished. To change hours already entered, use View Sessions → Change Manual Time, or ask the Maintenance Manager to add the time.",
          { code: "WORKFLOW_ERROR" }
        );
      }
      // A running timer is never changed by a manual entry.
      const running = await tx.workOrderWorkSession.findFirst({ where: { worker_assignment_id: assignment.id, status: "Active" }, select: { id: true } });
      if (running) {
        throw new AppError("This worker's timer is running on this Job Card. Pause or finish the timer first; manual time is for work done without the timer.", { code: "WORKFLOW_ERROR" });
      }

      const now = new Date();
      const check = checkManualFields(input, now);
      const others = [...(await loadOtherPeriods(tx, assignment.worker_id, null, now)), ...(await loadPendingManualPeriods(tx, assignment.worker_id))];
      if (!check.isSpan) {
        // An exact, continuous period may not overlap another period of the worker.
        const overlap = checkWorkPeriod({ start: check.start, end: check.end, now, otherPeriods: others, longPeriodConfirmed: true });
        if (!overlap.ok) throw new AppError(overlap.message, { code: "VALIDATION_ERROR" });
      }

      const rate = Number(assignment.hourly_rate_snapshot);
      const session = await tx.workOrderWorkSession.create({
        data: {
          work_order_id: assignment.work_order_id,
          worker_assignment_id: assignment.id,
          worker_id: assignment.worker_id,
          started_at: check.start,
          stopped_at: check.end,
          status: "Completed",
          duration_minutes: check.actualMinutes,
          hourly_rate_snapshot: assignment.hourly_rate_snapshot,
          calculated_amount: computeAmount(check.actualMinutes, rate),
          is_manual_entry: true,
          entered_by: context.userId,
          notes: `Entered manually: ${reason}`,
          start_time_known: check.startTimeKnown,
          end_time_known: check.endTimeKnown,
          period_is_span: check.isSpan,
        },
        select: { id: true },
      });
      const entry = await tx.workSessionTimeCorrection.create({
        data: {
          entry_kind: "manual_entry",
          worker_assignment_id: assignment.id,
          work_order_id: assignment.work_order_id,
          worker_id: assignment.worker_id,
          work_session_id: session.id,
          corrected_started_at: check.start,
          corrected_ended_at: check.end,
          corrected_duration_minutes: check.actualMinutes,
          reason,
          status: "Recorded",
          requested_by: context.userId,
          client_submission_id: input.submissionId,
        },
      });
      return {
        correction: entry,
        workerName: assignment.worker_profiles.name,
        workOrderNumber: wo.work_order_number,
        alreadySaved: false,
        conflicts: check.isSpan ? possibleConflicts(check, others) : [],
      };
    });

  const result = await runOnce(run, input.submissionId, context.userId);
  const e = result.correction;
  if (!result.alreadySaved) {
    await Promise.all([
      writeAuditLog({
        actorId: context.userId,
        action: "work_order.manual_time_recorded",
        entityType: "work_order",
        entityId: e.work_order_id,
        summary: `Manual work time saved for ${result.workerName} on ${result.workOrderNumber ?? "a Job Card"}: ${formatDurationMinutes(e.corrected_duration_minutes)}`,
        metadata: {
          entry_id: e.id,
          session_id: e.work_session_id,
          worker_assignment_id: e.worker_assignment_id,
          worker_name: result.workerName,
          started_at: e.corrected_started_at.toISOString(),
          ended_at: e.corrected_ended_at.toISOString(),
          actual_minutes: e.corrected_duration_minutes,
          possible_conflicts: result.conflicts.map((p) => p.jobCardNumber ?? "another Job Card").join(", ") || null,
          reason,
        },
      }),
      emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_WORK_TIME_UPDATED, e.work_order_id, context.userId),
    ]);
  }
  return {
    entryId: e.id,
    sessionId: e.work_session_id!,
    workOrderId: e.work_order_id,
    alreadySaved: result.alreadySaved,
    workerName: result.workerName,
    minutes: e.corrected_duration_minutes,
    possibleConflictCount: result.conflicts.length,
  };
}

// Change a manual entry (Data Entry, or the Manager): the period row takes
// the new dates and hours; its first values stay in original_*, and this
// change is one audit row (entry_kind "correction").
export async function changeManualWorkTime(context: CurrentUserContext, input: ManualWorkTimeFields & { sessionId: string }) {
  assertActiveUser(context);
  if (!canRequestTimeCorrection(context) && !canReviewTimeCorrection(context)) {
    throw new AppError("You do not have permission to change worker time.", { code: "FORBIDDEN" });
  }
  const reason = cleanReason(input.reason, "the change");

  const run = () =>
    withBackendTransaction(context.userId, async (tx) => {
      await lockJobCardForSession(tx, input.sessionId);
      await tx.$queryRaw`SELECT id FROM work_order_work_sessions WHERE id = ${input.sessionId}::uuid FOR UPDATE`;
      const session = await tx.workOrderWorkSession.findUnique({
        where: { id: input.sessionId },
        include: { worker_profiles: { select: { name: true } } },
      });
      if (!session) throw new AppError("Work period was not found.", { code: "NOT_FOUND" });
      await lockWorkerTime(tx, session.worker_id);
      const saved = await findSavedSubmission(tx, input.submissionId, context.userId);
      if (saved) return { correction: saved, workerName: session.worker_profiles.name, workOrderNumber: null as string | null, alreadySaved: true };

      const wo = await loadTimeEditableJobCard(tx, context, session.work_order_id);
      if (!session.is_manual_entry || session.status !== "Completed") {
        throw new AppError("Only manually entered time can be changed here. Use Correct Time for timer periods.", { code: "WORKFLOW_ERROR" });
      }
      await assertNoOlderPendingOnSession(tx, session.id);

      const now = new Date();
      const check = checkManualFields(input, now);
      if (!check.isSpan) {
        const overlap = checkWorkPeriod({
          start: check.start,
          end: check.end,
          now,
          otherPeriods: [...(await loadOtherPeriods(tx, session.worker_id, session.id, now)), ...(await loadPendingManualPeriods(tx, session.worker_id))],
          longPeriodConfirmed: true,
        });
        if (!overlap.ok) throw new AppError(overlap.message, { code: "VALIDATION_ERROR" });
      }
      const previousEnd = session.stopped_at ?? session.started_at;
      const unchanged =
        session.started_at.getTime() === check.start.getTime() &&
        previousEnd.getTime() === check.end.getTime() &&
        session.duration_minutes === check.actualMinutes &&
        session.start_time_known === check.startTimeKnown &&
        session.end_time_known === check.endTimeKnown;
      if (unchanged) throw new AppError("Nothing was changed. Change the dates, times or hours, or close the form.", { code: "VALIDATION_ERROR" });

      const correction = await tx.workSessionTimeCorrection.create({
        data: {
          work_session_id: session.id,
          work_order_id: session.work_order_id,
          worker_id: session.worker_id,
          original_started_at: session.started_at,
          original_ended_at: previousEnd,
          original_duration_minutes: session.duration_minutes,
          corrected_started_at: check.start,
          corrected_ended_at: check.end,
          corrected_duration_minutes: check.actualMinutes,
          reason,
          status: "Recorded",
          requested_by: context.userId,
          client_submission_id: input.submissionId,
        },
      });
      await tx.workOrderWorkSession.update({
        where: { id: session.id },
        data: {
          original_started_at: session.original_started_at ?? session.started_at,
          original_ended_at: session.original_started_at ? session.original_ended_at : previousEnd,
          original_duration_minutes: session.original_started_at ? session.original_duration_minutes : session.duration_minutes,
          started_at: check.start,
          stopped_at: check.end,
          duration_minutes: check.actualMinutes,
          calculated_amount: computeAmount(check.actualMinutes, Number(session.hourly_rate_snapshot)),
          start_time_known: check.startTimeKnown,
          end_time_known: check.endTimeKnown,
          period_is_span: check.isSpan,
          correction_reason: reason,
          edited_by: context.userId,
          updated_at: now,
        },
      });
      return { correction, workerName: session.worker_profiles.name, workOrderNumber: wo.work_order_number, alreadySaved: false };
    });

  const result = await runOnce(run, input.submissionId, context.userId);
  const c = result.correction;
  if (!result.alreadySaved) {
    await Promise.all([
      writeAuditLog({
        actorId: context.userId,
        action: "work_order.manual_time_changed",
        entityType: "work_order",
        entityId: c.work_order_id,
        summary: `Manual work time changed for ${result.workerName} on ${result.workOrderNumber ?? "a Job Card"}: ${formatDurationMinutes(c.original_duration_minutes ?? 0)} → ${formatDurationMinutes(c.corrected_duration_minutes)}`,
        metadata: {
          correction_id: c.id,
          session_id: c.work_session_id,
          worker_name: result.workerName,
          original_started_at: c.original_started_at?.toISOString() ?? null,
          original_ended_at: c.original_ended_at?.toISOString() ?? null,
          original_minutes: c.original_duration_minutes,
          corrected_started_at: c.corrected_started_at.toISOString(),
          corrected_ended_at: c.corrected_ended_at.toISOString(),
          corrected_minutes: c.corrected_duration_minutes,
          reason,
        },
      }),
      emitJobCardRealtimeEvent(REALTIME_EVENTS.JOB_CARD_WORK_TIME_UPDATED, c.work_order_id, context.userId),
    ]);
  }
  return { correctionId: c.id, workOrderId: c.work_order_id, alreadySaved: result.alreadySaved, workerName: result.workerName, minutes: c.corrected_duration_minutes };
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
  // "Recorded" = saved at once, reviewed in Closure Review. "Pending" only
  // for older entries sent before single closure approval.
  status: "Pending" | "Approved" | "Rejected" | "Recorded";
  // Recorded values before a correction; null for a manual entry.
  originalStart: string | null;
  originalEnd: string | null;
  originalMinutes: number | null;
  correctedStart: string;
  correctedEnd: string;
  correctedMinutes: number;
  // The period's start/end times were entered (false = date only, a manual
  // entry without times; then show the date only).
  startTimeKnown: boolean;
  endTimeKnown: boolean;
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
      work_session: { select: { hourly_rate_snapshot: true, worker_assignment_id: true, start_time_known: true, end_time_known: true } },
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
      startTimeKnown: r.work_session?.start_time_known ?? true,
      endTimeKnown: r.work_session?.end_time_known ?? true,
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
