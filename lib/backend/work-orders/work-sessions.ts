import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import { withBackendTransaction, type BackendTransaction } from "@/lib/backend/shared/transaction";
import { writeAuditLog } from "@/lib/audit/log";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import { dedupeRecipients } from "@/lib/backend/notifications/safe-notifications";
import { getActiveUserIdsByRoleSlugs, lockOpenJobCardForActivity } from "@/lib/backend/work-orders/repository";
import { loadOtherPeriods, lockWorkerTime } from "@/lib/backend/work-orders/work-time-corrections";
import { parseKuwaitInputValue } from "@/lib/format/kuwait-time";
import { checkWorkPeriod } from "@/lib/work-orders/work-time-correction-rules";
import { emitJobCardRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import type {
  StartWorkSessionInput,
  PauseOrStopWorkSessionInput,
  ManualTimeEntryInput,
  EditWorkSessionInput,
  CancelWorkSessionInput,
} from "@/lib/backend/workers/work-session-validators";

// Work Session Time Tracking and Labor Cost Calculation Unit 8.
//
// Start/Resume/Pause/Stop reuse work_orders.assign (same audience as Unit
// 7's Internal Team roster — Data Entry, Manager, Engineer, super_admin) —
// the real timer flow, which stays open to whoever can assign/track work.
// Manual time entry, editing/correcting an existing session, and
// soft-cancelling one are all Manager-only (Daily Activity Timer
// Reliability and Remove Data Entry Manual Entry Unit 10G.24, Task 5/6 —
// manual entry moved here from the broader check above, since a typed
// start/stop time is exactly the kind of correction the other two already
// restrict this way), matching the isManagerRole() pattern already
// established in lib/backend/work-orders/service.ts and
// components/work-orders/workflow-actions.tsx (kept in sync manually here,
// same as those — this is a role check, not a DB permission grant).

function assertCanManageSessions(context: CurrentUserContext) {
  assertActiveUser(context);
  assertBackendPermission(context, "work_orders.assign");
}

function isManagerRole(context: CurrentUserContext) {
  return context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
}

function assertIsManager(context: CurrentUserContext) {
  assertActiveUser(context);
  if (!isManagerRole(context)) {
    throw new AppError("Only a Manager can edit or correct a work session.", { code: "FORBIDDEN" });
  }
}

function diffMinutes(startedAt: Date, endedAt: Date): number {
  const ms = endedAt.getTime() - startedAt.getTime();
  return Math.max(0, Math.round(ms / 60000));
}

function computeAmount(durationMinutes: number, hourlyRate: number): number {
  const amount = (durationMinutes / 60) * hourlyRate;
  return Math.round(amount * 1000) / 1000;
}

async function loadOpenWorkOrder(tx: BackendTransaction, workOrderId: string) {
  // Job Card Deletion: takes the per-Job-Card activity lock and refuses a
  // deleted Job Card, so a timer can never start on a card being deleted.
  const wo = await lockOpenJobCardForActivity(tx, workOrderId);
  if (wo.status === "Closed") {
    throw new AppError("This Job Card is closed. Work sessions can no longer be changed.", { code: "WORKFLOW_ERROR" });
  }
  return wo;
}

async function loadActiveAssignment(tx: BackendTransaction, workOrderId: string, workerAssignmentId: string) {
  const assignment = await tx.workOrderWorkerAssignment.findUnique({
    where: { id: workerAssignmentId },
    include: { worker_profiles: { select: { name: true } } },
  });
  if (!assignment || assignment.work_order_id !== workOrderId) {
    throw new AppError("Worker assignment was not found on this Job Card.", { code: "NOT_FOUND" });
  }
  if (assignment.status !== "active") {
    throw new AppError("This worker is no longer on the Internal Team roster for this Job Card.", { code: "WORKFLOW_ERROR" });
  }
  return assignment;
}

type SessionMutationResult = {
  workOrderId: string;
  workOrderNumber: string | null;
  createdBy: string | null;
  workerName: string;
  sessionId: string;
  durationMinutes: number;
  calculatedAmount: number;
};

async function notifyAndAudit(
  context: CurrentUserContext,
  eventType: (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS],
  notifyEventKey: string,
  auditAction: string,
  title: string,
  message: string,
  result: SessionMutationResult,
  extraMetadata: Record<string, string | number | undefined> = {}
) {
  const recipients = await withBackendTransaction(context.userId, async (tx) => {
    const roleIds = await getActiveUserIdsByRoleSlugs(tx, ["maintenance_manager"]);
    return dedupeRecipients([result.createdBy, ...roleIds], context.userId);
  });

  await Promise.all([
    recipients.length
      ? notifyWorkflowEvent({
          eventKey: notifyEventKey,
          entityType: "work_order",
          entityId: result.workOrderId,
          actorId: context.userId,
          recipientUserIds: recipients,
          category: "Work Orders",
          title,
          message,
          metadata: { job_card_number: result.workOrderNumber ?? "Job Card", worker_name: result.workerName },
          actionUrl: `/maintenance/work-orders/${result.workOrderId}`,
        })
      : Promise.resolve([]),
    writeAuditLog({
      actorId: context.userId,
      action: auditAction,
      entityType: "work_order",
      entityId: result.workOrderId,
      summary: `${title}: ${result.workerName} on ${result.workOrderNumber ?? "work order"}`,
      metadata: {
        worker_assignment_id: extraMetadata.workerAssignmentId ?? undefined,
        worker_name: result.workerName,
        session_id: result.sessionId,
        duration_minutes: result.durationMinutes,
        calculated_amount: result.calculatedAmount,
        ...extraMetadata,
      },
    }),
    emitJobCardRealtimeEvent(eventType, result.workOrderId, context.userId),
  ]);
}

// ── Start / Resume ───────────────────────────────────────────────────────────
// Resume Work is Start Work with a pre-existing (non-active) history — same
// function, same rules: exactly one Active session per worker assignment.

export async function startWorkSession(context: CurrentUserContext, input: StartWorkSessionInput) {
  assertCanManageSessions(context);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const wo = await loadOpenWorkOrder(tx, input.workOrderId);
    const assignment = await loadActiveAssignment(tx, input.workOrderId, input.workerAssignmentId);

    const existingActive = await tx.workOrderWorkSession.findFirst({
      where: { worker_assignment_id: input.workerAssignmentId, status: "Active" },
      select: { id: true },
    });
    if (existingActive) {
      throw new AppError("This worker already has an active work session. Pause or stop it first.", { code: "WORKFLOW_ERROR" });
    }

    // Worker Timer and Closure Logic Hardening Unit 10G.53, Task 5: one
    // worker, one running timer at a time, across every Job Card — checked
    // by worker_id (not worker_assignment_id), since the same worker_profiles
    // row can have a separate WorkOrderWorkerAssignment per Job Card. Applies
    // to both Start (Not Started -> Working) and Resume (Paused -> Working),
    // since Resume calls this exact same function. Deliberately does NOT
    // block a worker who is merely Paused on another Job Card — the task's
    // own "preferred" rule only blocks a genuinely-running (Active) session
    // elsewhere; paused work on another card is left for the user to resume/
    // finish later, on their own schedule.
    const activeElsewhere = await tx.workOrderWorkSession.findFirst({
      where: { worker_id: assignment.worker_id, status: "Active", work_order_id: { not: input.workOrderId } },
      include: { work_orders: { select: { work_order_number: true } } },
    });
    if (activeElsewhere) {
      throw new AppError(
        `This worker is already working on Job Card ${activeElsewhere.work_orders.work_order_number ?? "another Job Card"}. Pause or finish that work before starting another Job Card.`,
        { code: "WORKFLOW_ERROR" }
      );
    }

    const session = await tx.workOrderWorkSession.create({
      data: {
        work_order_id: input.workOrderId,
        worker_assignment_id: input.workerAssignmentId,
        worker_id: assignment.worker_id,
        started_at: new Date(),
        status: "Active",
        hourly_rate_snapshot: assignment.hourly_rate_snapshot,
        notes: input.notes?.trim() || null,
        entered_by: context.userId,
      },
    });

    return {
      workOrderId: wo.id,
      workOrderNumber: wo.work_order_number,
      createdBy: wo.created_by,
      workerName: assignment.worker_profiles.name,
      sessionId: session.id,
      durationMinutes: 0,
      calculatedAmount: 0,
    } satisfies SessionMutationResult;
  });

  await notifyAndAudit(
    context,
    REALTIME_EVENTS.JOB_CARD_WORK_STARTED,
    "job_card.work_started",
    "work_order.work_session_started",
    "Work session started",
    `${result.workerName} started work on ${result.workOrderNumber ?? "a Job Card"}.`,
    result,
    { workerAssignmentId: input.workerAssignmentId }
  );

  return result;
}

// ── Pause / Stop ─────────────────────────────────────────────────────────────

async function endActiveSession(
  context: CurrentUserContext,
  input: PauseOrStopWorkSessionInput,
  targetStatus: "Paused" | "Completed"
) {
  assertCanManageSessions(context);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const wo = await loadOpenWorkOrder(tx, input.workOrderId);
    const assignment = await loadActiveAssignment(tx, input.workOrderId, input.workerAssignmentId);

    const active = await tx.workOrderWorkSession.findFirst({
      where: { worker_assignment_id: input.workerAssignmentId, status: "Active" },
    });
    if (!active) {
      throw new AppError("This worker has no active work session.", { code: "WORKFLOW_ERROR" });
    }

    const now = new Date();
    const durationMinutes = diffMinutes(active.started_at, now);
    const calculatedAmount = computeAmount(durationMinutes, Number(active.hourly_rate_snapshot));

    const updated = await tx.workOrderWorkSession.update({
      where: { id: active.id },
      data: {
        status: targetStatus,
        paused_at: targetStatus === "Paused" ? now : active.paused_at,
        stopped_at: targetStatus === "Completed" ? now : active.stopped_at,
        duration_minutes: durationMinutes,
        calculated_amount: calculatedAmount,
      },
    });

    return {
      workOrderId: wo.id,
      workOrderNumber: wo.work_order_number,
      createdBy: wo.created_by,
      workerName: assignment.worker_profiles.name,
      sessionId: updated.id,
      durationMinutes,
      calculatedAmount,
    } satisfies SessionMutationResult;
  });

  const isPause = targetStatus === "Paused";
  await notifyAndAudit(
    context,
    isPause ? REALTIME_EVENTS.JOB_CARD_WORK_PAUSED : REALTIME_EVENTS.JOB_CARD_WORK_STOPPED,
    isPause ? "job_card.work_paused" : "job_card.work_stopped",
    isPause ? "work_order.work_session_paused" : "work_order.work_session_stopped",
    isPause ? "Work session paused" : "Work session stopped",
    `${result.workerName} ${isPause ? "paused" : "stopped"} work on ${result.workOrderNumber ?? "a Job Card"} — ${result.durationMinutes} min.`,
    result,
    { workerAssignmentId: input.workerAssignmentId }
  );

  return result;
}

export function pauseWorkSession(context: CurrentUserContext, input: PauseOrStopWorkSessionInput) {
  return endActiveSession(context, input, "Paused");
}

export function stopWorkSession(context: CurrentUserContext, input: PauseOrStopWorkSessionInput) {
  return endActiveSession(context, input, "Completed");
}

// ── Finish Work (Worker Timer and Closure Logic Hardening Unit 10G.53,
//    Task 3) ───────────────────────────────────────────────────────────────
//
// Finish Work replaces plain Stop in the UI (components/work-orders/
// worker-session-row.tsx no longer renders a bare "Stop" button) — it does
// everything Stop used to do (end a currently-running session, exactly the
// same duration/amount math as endActiveSession above) AND marks the worker
// assignment itself "finished," which is the one thing plain Stop never did.
// That distinction is the whole point of this unit: a "Completed" session on
// its own never meant "this worker is done for good" (Resume Work could
// always start a fresh session afterward) — "finished" is a new, separate,
// explicit assignment-level state the closure-readiness guard (Task 4) can
// actually rely on.
//
// Reachable from both simple UI states that offer a "Finish Work" button:
// Working (an Active session exists — end it, then finish) and Paused (no
// Active session — nothing to end, just finish). Never reachable from
// Not Started (no button offered there — see worker-session-row.tsx) or an
// already-Finished worker (loadActiveAssignment's status === "active" gate
// already rejects a "finished" assignment, exactly like it already rejects
// "removed").
export async function finishWorkSession(context: CurrentUserContext, input: PauseOrStopWorkSessionInput) {
  assertCanManageSessions(context);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const wo = await loadOpenWorkOrder(tx, input.workOrderId);
    const assignment = await loadActiveAssignment(tx, input.workOrderId, input.workerAssignmentId);

    const active = await tx.workOrderWorkSession.findFirst({
      where: { worker_assignment_id: input.workerAssignmentId, status: "Active" },
    });

    // Manual Worker Time Entry: Finish is also how a worker whose time was
    // entered manually (no timer) is marked done — but only on verified time:
    // never with no recorded time at all, and never while this worker's
    // manual time is still waiting for the Manager (submitting it does not
    // finish the worker; approval of it is what makes it recorded time).
    if (!active) {
      const [recorded, pendingManual] = await Promise.all([
        tx.workOrderWorkSession.count({ where: { worker_assignment_id: input.workerAssignmentId, status: { not: "Cancelled" } } }),
        tx.workSessionTimeCorrection.count({ where: { worker_assignment_id: input.workerAssignmentId, entry_kind: "manual_entry", status: "Pending" } }),
      ]);
      if (pendingManual > 0) {
        throw new AppError("This worker's manually entered time is waiting for Manager review. Mark the work finished after it is approved.", { code: "WORKFLOW_ERROR" });
      }
      if (recorded === 0) {
        throw new AppError("No work time is recorded for this worker yet. Start the timer, or enter the time manually first.", { code: "WORKFLOW_ERROR" });
      }
    }

    let durationMinutes = 0;
    let calculatedAmount = 0;
    let sessionId = "";

    if (active) {
      const now = new Date();
      durationMinutes = diffMinutes(active.started_at, now);
      calculatedAmount = computeAmount(durationMinutes, Number(active.hourly_rate_snapshot));
      const updated = await tx.workOrderWorkSession.update({
        where: { id: active.id },
        data: { status: "Completed", stopped_at: now, duration_minutes: durationMinutes, calculated_amount: calculatedAmount },
      });
      sessionId = updated.id;
    }

    // The one new write this action adds beyond plain Stop — see the
    // module-level comment on this function.
    await tx.workOrderWorkerAssignment.update({
      where: { id: input.workerAssignmentId },
      data: { status: "finished" },
    });

    return {
      workOrderId: wo.id,
      workOrderNumber: wo.work_order_number,
      createdBy: wo.created_by,
      workerName: assignment.worker_profiles.name,
      sessionId,
      durationMinutes,
      calculatedAmount,
    } satisfies SessionMutationResult;
  });

  await notifyAndAudit(
    context,
    REALTIME_EVENTS.JOB_CARD_WORK_FINISHED,
    "job_card.work_finished",
    "work_order.work_assignment_finished",
    "Worker finished work",
    `${result.workerName} finished work on ${result.workOrderNumber ?? "a Job Card"}${result.durationMinutes > 0 ? ` — ${result.durationMinutes} min this session.` : "."}`,
    result,
    { workerAssignmentId: input.workerAssignmentId }
  );

  return result;
}

// ── Manual time entry (Task 5) ───────────────────────────────────────────────
//
// Daily Activity Timer Reliability and Remove Data Entry Manual Entry Unit
// 10G.24, Task 5/6: manual entry moved from assertCanManageSessions (the
// same broad work_orders.assign audience as Start/Pause/Stop — Data Entry
// included) to assertIsManager, the same Manager/Super Admin-only check
// editWorkSession/cancelWorkSession below already use. A typed start/stop
// time is exactly the kind of correction those two already gate this way —
// manual entry was the one path left ungated, which is what let Data Entry
// fabricate hours never actually worked via the real timer. The UI button
// (components/work-orders/worker-session-row.tsx) is hidden from Data Entry
// too, but this is the enforcement that actually matters.

export async function addManualTimeEntry(context: CurrentUserContext, input: ManualTimeEntryInput) {
  assertIsManager(context);

  // Final Integration Review: the form sends Kuwait wall-clock times; parse
  // them explicitly as Asia/Kuwait, never in the server's own time zone.
  const startedAt = parseKuwaitInputValue(input.startedAt);
  const stoppedAt = parseKuwaitInputValue(input.stoppedAt);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const wo = await loadOpenWorkOrder(tx, input.workOrderId);
    const assignment = await loadActiveAssignment(tx, input.workOrderId, input.workerAssignmentId);

    const existingActive = await tx.workOrderWorkSession.findFirst({
      where: { worker_assignment_id: input.workerAssignmentId, status: "Active" },
      select: { id: true },
    });
    if (existingActive) {
      throw new AppError(
        "This worker has an active work session right now. Stop or pause it before adding a manual entry.",
        { code: "WORKFLOW_ERROR" }
      );
    }

    // Same checks as every hand-entered period: order, not in the future,
    // no overlap with this worker's other periods (any Job Card), and an
    // explicit confirmation for an unusually long period.
    await lockWorkerTime(tx, assignment.worker_id);
    const now = new Date();
    const check = checkWorkPeriod({
      start: startedAt,
      end: stoppedAt,
      now,
      otherPeriods: await loadOtherPeriods(tx, assignment.worker_id, null, now),
      longPeriodConfirmed: input.confirmLongPeriod === true,
    });
    if (!check.ok) throw new AppError(check.message, { code: "VALIDATION_ERROR" });
    if (!startedAt || !stoppedAt) throw new AppError("Enter valid start and end times.", { code: "VALIDATION_ERROR" });

    const durationMinutes = diffMinutes(startedAt, stoppedAt);
    const calculatedAmount = computeAmount(durationMinutes, Number(assignment.hourly_rate_snapshot));

    const session = await tx.workOrderWorkSession.create({
      data: {
        work_order_id: input.workOrderId,
        worker_assignment_id: input.workerAssignmentId,
        worker_id: assignment.worker_id,
        started_at: startedAt,
        stopped_at: stoppedAt,
        status: "Completed",
        duration_minutes: durationMinutes,
        hourly_rate_snapshot: assignment.hourly_rate_snapshot,
        calculated_amount: calculatedAmount,
        is_manual_entry: true,
        notes: input.notes?.trim() || null,
        entered_by: context.userId,
      },
    });

    return {
      workOrderId: wo.id,
      workOrderNumber: wo.work_order_number,
      createdBy: wo.created_by,
      workerName: assignment.worker_profiles.name,
      sessionId: session.id,
      durationMinutes,
      calculatedAmount,
    } satisfies SessionMutationResult;
  });

  await notifyAndAudit(
    context,
    REALTIME_EVENTS.JOB_CARD_WORK_TIME_UPDATED,
    "job_card.work_time_updated",
    "work_order.work_session_manual_entry",
    "Manual time entry added",
    `${result.workerName}: manual time entry added on ${result.workOrderNumber ?? "a Job Card"} — ${result.durationMinutes} min.`,
    result,
    { workerAssignmentId: input.workerAssignmentId }
  );

  return result;
}

// ── Manager edit / correction (Task 7) ───────────────────────────────────────

export async function editWorkSession(context: CurrentUserContext, input: EditWorkSessionInput) {
  assertIsManager(context);

  // Final Integration Review: Kuwait wall-clock times, parsed explicitly.
  const parsedStart = parseKuwaitInputValue(input.startedAt);
  const parsedStop = parseKuwaitInputValue(input.stoppedAt);
  if (!parsedStart || !parsedStop) {
    throw new AppError("Enter valid start and end dates and times.", { code: "VALIDATION_ERROR" });
  }
  const startedAt = parsedStart;
  const stoppedAt = parsedStop;
  const reason = input.correctionReason.trim();

  const result = await withBackendTransaction(context.userId, async (tx) => {
    await tx.$queryRaw`SELECT id FROM work_order_work_sessions WHERE id = ${input.sessionId}::uuid FOR UPDATE`;
    const existing = await tx.workOrderWorkSession.findUnique({
      where: { id: input.sessionId },
      include: { worker_profiles: { select: { name: true } } },
    });
    if (!existing) throw new AppError("Work session was not found.", { code: "NOT_FOUND" });
    if (existing.status === "Active") {
      throw new AppError("Stop or pause this session before editing it.", { code: "WORKFLOW_ERROR" });
    }

    const wo = await tx.work_orders.findFirst({
      where: { id: existing.work_order_id, deleted_at: null },
      select: { id: true, work_order_number: true, status: true, created_by: true },
    });
    if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (wo.status === "Closed") {
      throw new AppError("This Job Card is closed. Work sessions can no longer be changed.", { code: "WORKFLOW_ERROR" });
    }

    // Manager Worker Time Correction Enhancement Unit 10C.1, Task 6: captured
    // here (before the update overwrites the row) so the audit log can record
    // the full before/after trail, not just the corrected values — the row
    // itself only ever holds its current (latest) values, so this is the only
    // place the "original" side of a correction can still be read. Returned
    // as part of the transaction result (rather than an outer `let` captured
    // by this closure) so it's plain, un-narrowed data at the call site.
    const original = {
      startedAt: existing.started_at.toISOString(),
      endedAt: (existing.stopped_at ?? existing.paused_at)?.toISOString() ?? null,
      durationMinutes: existing.duration_minutes,
      calculatedAmount: Number(existing.calculated_amount),
    };

    // Final Integration Review: the Manager's direct correction follows the
    // same rules as a Data Entry correction — order, not in the future, no
    // overlap with the worker's other periods, long periods confirmed — and
    // waits for any pending Data Entry correction of this period to be
    // decided first (approving that one later would overwrite this edit).
    await lockWorkerTime(tx, existing.worker_id);
    const pendingCorrection = await tx.workSessionTimeCorrection.findFirst({
      where: { work_session_id: existing.id, status: "Pending" },
      select: { id: true },
    });
    if (pendingCorrection) {
      throw new AppError(
        "A time correction for this work period is waiting for review. Approve or reject it in Time Corrections first.",
        { code: "CONFLICT" }
      );
    }
    const now = new Date();
    const check = checkWorkPeriod({
      start: startedAt,
      end: stoppedAt,
      now,
      otherPeriods: await loadOtherPeriods(tx, existing.worker_id, existing.id, now),
      longPeriodConfirmed: input.confirmLongPeriod === true,
    });
    if (!check.ok) throw new AppError(check.message, { code: "VALIDATION_ERROR" });

    const durationMinutes = diffMinutes(startedAt, stoppedAt);
    const calculatedAmount = computeAmount(durationMinutes, Number(existing.hourly_rate_snapshot));

    // Correction history: one row per Manager correction, so the Time
    // Corrections panel lists it beside Data Entry corrections — the values
    // before THIS edit, the new values, reason, who and when. Requested and
    // decided by the same Manager (a direct correction needs no second
    // approval; that rule only applies to Data Entry requests).
    const previousEnd = existing.stopped_at ?? existing.paused_at;
    if (previousEnd) {
      await tx.workSessionTimeCorrection.create({
        data: {
          work_session_id: existing.id,
          work_order_id: existing.work_order_id,
          worker_id: existing.worker_id,
          original_started_at: existing.started_at,
          original_ended_at: previousEnd,
          original_duration_minutes: existing.duration_minutes,
          corrected_started_at: startedAt,
          corrected_ended_at: stoppedAt,
          corrected_duration_minutes: durationMinutes,
          reason,
          status: "Approved",
          requested_by: context.userId,
          requested_at: now,
          reviewed_by: context.userId,
          reviewed_at: now,
          review_remarks: "Corrected directly by the Manager.",
        },
      });
    }

    const updated = await tx.workOrderWorkSession.update({
      where: { id: input.sessionId },
      data: {
        // Job Card Deletion and Worker Time Correction: the first recorded
        // values are kept (written only while still empty).
        ...(existing.original_started_at
          ? {}
          : {
              original_started_at: existing.started_at,
              original_ended_at: existing.stopped_at ?? existing.paused_at,
              original_duration_minutes: existing.duration_minutes,
            }),
        started_at: startedAt,
        stopped_at: existing.status === "Completed" ? stoppedAt : existing.stopped_at,
        paused_at: existing.status === "Paused" ? stoppedAt : existing.paused_at,
        duration_minutes: durationMinutes,
        calculated_amount: calculatedAmount,
        correction_reason: reason,
        edited_by: context.userId,
      },
    });

    return {
      workOrderId: wo.id,
      workOrderNumber: wo.work_order_number,
      createdBy: wo.created_by,
      workerName: existing.worker_profiles.name,
      sessionId: updated.id,
      durationMinutes,
      calculatedAmount,
      original,
    } satisfies SessionMutationResult & { original: typeof original };
  });

  // Task 6 — full before/after correction trail: original start/end/
  // duration/amount alongside the corrected values already captured by
  // notifyAndAudit's own audit metadata (duration_minutes/calculated_amount
  // = the new/corrected figures), plus the reason, actor, and timestamp
  // writeAuditLog already records for every audit entry.
  await notifyAndAudit(
    context,
    REALTIME_EVENTS.JOB_CARD_WORK_TIME_UPDATED,
    "job_card.work_time_updated",
    "work_order.work_session_edited",
    "Work session corrected",
    `Manager corrected ${result.workerName}'s session on ${result.workOrderNumber ?? "a Job Card"} — ${result.durationMinutes} min.`,
    result,
    {
      correctionReason: input.correctionReason.trim(),
      original_started_at: result.original.startedAt,
      original_ended_at: result.original.endedAt ?? undefined,
      original_duration_minutes: result.original.durationMinutes,
      original_calculated_amount: result.original.calculatedAmount,
      corrected_started_at: startedAt.toISOString(),
      corrected_ended_at: stoppedAt.toISOString(),
    }
  );

  return result;
}

// ── Manager soft-cancel (Task 7/13) ──────────────────────────────────────────

export async function cancelWorkSession(context: CurrentUserContext, input: CancelWorkSessionInput) {
  assertIsManager(context);

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const existing = await tx.workOrderWorkSession.findUnique({
      where: { id: input.sessionId },
      include: { worker_profiles: { select: { name: true } } },
    });
    if (!existing) throw new AppError("Work session was not found.", { code: "NOT_FOUND" });
    if (existing.status === "Cancelled") {
      throw new AppError("This work session is already cancelled.", { code: "WORKFLOW_ERROR" });
    }

    const wo = await tx.work_orders.findFirst({
      where: { id: existing.work_order_id, deleted_at: null },
      select: { id: true, work_order_number: true, status: true, created_by: true },
    });
    if (!wo) throw new AppError("Job Card was not found.", { code: "NOT_FOUND" });
    if (wo.status === "Closed") {
      throw new AppError("This Job Card is closed. Work sessions can no longer be changed.", { code: "WORKFLOW_ERROR" });
    }

    const updated = await tx.workOrderWorkSession.update({
      where: { id: input.sessionId },
      data: { status: "Cancelled", correction_reason: input.correctionReason.trim(), edited_by: context.userId },
    });

    return {
      workOrderId: wo.id,
      workOrderNumber: wo.work_order_number,
      createdBy: wo.created_by,
      workerName: existing.worker_profiles.name,
      sessionId: updated.id,
      durationMinutes: Number(existing.duration_minutes),
      calculatedAmount: Number(existing.calculated_amount),
    } satisfies SessionMutationResult;
  });

  await notifyAndAudit(
    context,
    REALTIME_EVENTS.JOB_CARD_WORK_TIME_UPDATED,
    "job_card.work_time_updated",
    "work_order.work_session_cancelled",
    "Work session cancelled",
    `Manager cancelled ${result.workerName}'s session on ${result.workOrderNumber ?? "a Job Card"}.`,
    result,
    { correctionReason: input.correctionReason.trim() }
  );

  return result;
}
