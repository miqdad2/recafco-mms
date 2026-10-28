import "server-only";

import type { prisma } from "@/lib/db/prisma";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import { computeJobCardDates, type JobCardDates } from "@/lib/work-orders/job-card-dates";

type DbClient = typeof prisma | BackendTransaction;

// Audit actions that record "work started" / "work completed" for Job Cards
// worked without the worker timer (lib/backend/work-orders/service.ts:
// startTechnicianJob, startJobCardProgress, completeTechnicianJob,
// markExternalWorkCompleted).
const START_ACTIONS = ["work_order.start", "work_order.start_progress"];
const END_ACTIONS = ["work_order.complete", "work_order.external_completed"];

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
      select: { started_at: true, paused_at: true, stopped_at: true, status: true, start_time_known: true, end_time_known: true },
    }),
    db.workOrderWorkerAssignment.findMany({
      where: { work_order_id: workOrder.id, status: { in: ["active", "finished"] } },
      select: { status: true },
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
    workerAssignmentStatuses: assignments.map((a) => a.status),
    statusStartAt: startLog?.created_at.toISOString() ?? null,
    statusEndAt: endLog?.created_at.toISOString() ?? null,
    formStartAt: workOrder.starting_datetime?.toISOString() ?? null,
    formEndAt: workOrder.ending_datetime?.toISOString() ?? null,
    closedAt: closedApproval?.decided_at.toISOString() ?? null,
  });
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
      select: { work_order_id: true, started_at: true, paused_at: true, stopped_at: true, status: true, start_time_known: true, end_time_known: true },
    }),
    db.workOrderWorkerAssignment.findMany({
      where: { work_order_id: { in: ids }, status: { in: ["active", "finished"] } },
      select: { work_order_id: true, status: true },
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
        workerAssignmentStatuses: assignments.filter((a) => a.work_order_id === w.id).map((a) => a.status),
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
