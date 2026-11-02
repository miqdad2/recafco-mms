import "server-only";

import type { prisma } from "@/lib/db/prisma";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import { getClosureReadinessForWorkOrders } from "@/lib/work-orders/closure-readiness-data";
import { computeJobCardDates, type JobCardDates } from "@/lib/work-orders/job-card-dates";
import { toIsoDateOnly } from "@/lib/work-orders/job-card-edit";
import { computeJobCardTiming, type JobCardTiming } from "@/lib/work-orders/job-card-timing";

type DbClient = typeof prisma | BackendTransaction;

// Audit actions that record "work started" / "work completed" for Job Cards
// worked without the worker timer (lib/backend/work-orders/service.ts:
// startTechnicianJob, startJobCardProgress, completeTechnicianJob,
// markExternalWorkCompleted).
const START_ACTIONS = ["work_order.start", "work_order.start_progress"];
const END_ACTIONS = ["work_order.complete", "work_order.external_completed"];

// The statuses that decide "has the team finished?": a Supervisor with no work
// recorded is overseeing, not working (closure-readiness.ts).
function workingTeamStatuses(
  assignments: Array<{ id: string; status: string; worker_role: string }>,
  sessions: Array<{ worker_assignment_id: string }>
): string[] {
  const worked = new Set(sessions.map((s) => s.worker_assignment_id));
  return assignments.filter((a) => a.worker_role !== "Supervisor" || a.status === "finished" || worked.has(a.id)).map((a) => a.status);
}

/**
 * Loads the recorded events behind a Job Card's Created / Work Start / Work
 * End dates. The caller has already checked that the user may see this Job
 * Card (visibility filter). Read-only; five small indexed queries.
 */
export async function getJobCardDates(
  db: DbClient,
  workOrder: {
    id: string;
    created_at: Date;
    status: string;
    starting_datetime: Date | null;
    ending_datetime: Date | null;
  }
): Promise<JobCardDates> {
  const [sessions, assignments, startLog, endLog, closedApproval] = await Promise.all([
    db.workOrderWorkSession.findMany({
      where: { work_order_id: workOrder.id, status: { not: "Cancelled" } },
      select: { worker_assignment_id: true, started_at: true, paused_at: true, stopped_at: true, status: true, start_time_known: true, end_time_known: true },
    }),
    db.workOrderWorkerAssignment.findMany({
      where: { work_order_id: workOrder.id, status: { in: ["active", "finished"] } },
      select: { id: true, status: true, worker_role: true },
    }),
    db.audit_logs.findFirst({
      where: { entity_type: "work_order", entity_id: workOrder.id, action: { in: START_ACTIONS } },
      orderBy: { created_at: "asc" },
      select: { created_at: true },
    }),
    db.audit_logs.findFirst({
      where: { entity_type: "work_order", entity_id: workOrder.id, action: { in: END_ACTIONS } },
      orderBy: { created_at: "desc" },
      select: { created_at: true },
    }),
    workOrder.status === "Closed"
      ? db.approvals.findFirst({
          where: { work_order_id: workOrder.id, status: "Closed" },
          orderBy: { decided_at: "desc" },
          select: { decided_at: true },
        })
      : Promise.resolve(null),
  ]);

  return computeJobCardDates({
    createdAt: workOrder.created_at.toISOString(),
    status: workOrder.status,
    sessions: sessions.map((s) => ({
      startedAt: s.started_at.toISOString(),
      endedAt: (s.stopped_at ?? s.paused_at)?.toISOString() ?? null,
      status: s.status,
      startTimeKnown: s.start_time_known,
      endTimeKnown: s.end_time_known,
    })),
    workerAssignmentStatuses: workingTeamStatuses(assignments, sessions),
    statusStartAt: startLog?.created_at.toISOString() ?? null,
    statusEndAt: endLog?.created_at.toISOString() ?? null,
    formStartAt: workOrder.starting_datetime?.toISOString() ?? null,
    formEndAt: workOrder.ending_datetime?.toISOString() ?? null,
    closedAt: closedApproval?.decided_at.toISOString() ?? null,
  });
}

/** The stored fields behind Job Card Time Details, plus readiness (see job-card-timing.ts). */
export function jobCardTimingFrom(
  workOrder: { status: string; job_card_start_date: Date | null; job_card_opened_at: Date | null; work_completed_at: Date | null },
  dates: JobCardDates,
  readyForClosure: boolean
): JobCardTiming {
  return computeJobCardTiming({
    status: workOrder.status,
    openDate: toIsoDateOnly(workOrder.job_card_start_date),
    openedAt: workOrder.job_card_opened_at?.toISOString() ?? null,
    workCompletedAt: workOrder.work_completed_at?.toISOString() ?? null,
    dates,
    readyForClosure,
  });
}

/** Dates and Time Details for one Job Card, with the same readiness as the closure guard. */
export async function getJobCardTiming(
  db: typeof prisma,
  workOrder: Parameters<typeof getJobCardDates>[1] & Parameters<typeof jobCardTimingFrom>[0]
): Promise<{ dates: JobCardDates; timing: JobCardTiming }> {
  const [dates, readiness] = await Promise.all([getJobCardDates(db, workOrder), getClosureReadinessForWorkOrders(db, [workOrder.id])]);
  return { dates, timing: jobCardTimingFrom(workOrder, dates, readiness.get(workOrder.id)?.ready ?? false) };
}

/**
 * Bulk variant for list pages (Daily Activity): the same five sources and
 * the same computeJobCardDates rules as getJobCardDates above, in five
 * queries for all Job Cards instead of five per card. Caller has applied the
 * visibility filter to `workOrders`.
 */
export async function getJobCardDatesBulk(
  db: DbClient,
  workOrders: Array<{ id: string; created_at: Date; status: string; starting_datetime: Date | null; ending_datetime: Date | null }>
): Promise<Map<string, JobCardDates>> {
  const out = new Map<string, JobCardDates>();
  if (workOrders.length === 0) return out;
  const ids = workOrders.map((w) => w.id);
  const closedIds = workOrders.filter((w) => w.status === "Closed").map((w) => w.id);
  const [sessions, assignments, startLogs, endLogs, closedApprovals] = await Promise.all([
    db.workOrderWorkSession.findMany({
      where: { work_order_id: { in: ids }, status: { not: "Cancelled" } },
      select: { work_order_id: true, worker_assignment_id: true, started_at: true, paused_at: true, stopped_at: true, status: true, start_time_known: true, end_time_known: true },
    }),
    db.workOrderWorkerAssignment.findMany({
      where: { work_order_id: { in: ids }, status: { in: ["active", "finished"] } },
      select: { id: true, work_order_id: true, status: true, worker_role: true },
    }),
    db.audit_logs.findMany({
      where: { entity_type: "work_order", entity_id: { in: ids }, action: { in: START_ACTIONS } },
      select: { entity_id: true, created_at: true },
    }),
    db.audit_logs.findMany({
      where: { entity_type: "work_order", entity_id: { in: ids }, action: { in: END_ACTIONS } },
      select: { entity_id: true, created_at: true },
    }),
    closedIds.length
      ? db.approvals.findMany({ where: { work_order_id: { in: closedIds }, status: "Closed" }, select: { work_order_id: true, decided_at: true } })
      : Promise.resolve([] as { work_order_id: string | null; decided_at: Date }[]),
  ]);
  const pick = (rows: { at: Date }[], mode: "min" | "max") =>
    rows.length ? rows.reduce((a, b) => ((mode === "min" ? b.at < a.at : b.at > a.at) ? b : a)).at.toISOString() : null;
  for (const w of workOrders) {
    out.set(
      w.id,
      computeJobCardDates({
        createdAt: w.created_at.toISOString(),
        status: w.status,
        sessions: sessions
          .filter((s) => s.work_order_id === w.id)
          .map((s) => ({ startedAt: s.started_at.toISOString(), endedAt: (s.stopped_at ?? s.paused_at)?.toISOString() ?? null, status: s.status, startTimeKnown: s.start_time_known, endTimeKnown: s.end_time_known })),
        workerAssignmentStatuses: workingTeamStatuses(assignments.filter((a) => a.work_order_id === w.id), sessions.filter((s) => s.work_order_id === w.id)),
        statusStartAt: pick(startLogs.filter((l) => l.entity_id === w.id).map((l) => ({ at: l.created_at })), "min"),
        statusEndAt: pick(endLogs.filter((l) => l.entity_id === w.id).map((l) => ({ at: l.created_at })), "max"),
        formStartAt: w.starting_datetime?.toISOString() ?? null,
        formEndAt: w.ending_datetime?.toISOString() ?? null,
        closedAt: pick(closedApprovals.filter((a) => a.work_order_id === w.id).map((a) => ({ at: a.decided_at })), "max"),
      })
    );
  }
  return out;
}
