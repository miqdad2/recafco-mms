import "server-only";

import { prisma } from "@/lib/db/prisma";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";

// Work Session Time Tracking and Labor Cost Calculation Unit 8, Task 8.
//
// Reports/aggregation foundation — used today for the Job Card detail
// page's Work Time Tracking section, and available for a future Manager
// dashboard/reports unit without re-deriving this logic. Cancelled sessions
// are excluded from every total (soft-cancel removes a session from cost/
// hours, but the row itself is kept for audit history).

type DbClient = typeof prisma | BackendTransaction;

export type WorkerSessionStatus = "Not Started" | "Active" | "Paused" | "Completed";

export type WorkerLaborRow = {
  worker_assignment_id: string;
  worker_id: string;
  worker_name: string;
  worker_role: string;
  hourly_rate_snapshot: number;
  status: WorkerSessionStatus;
  total_minutes: number;
  total_hours: number;
  total_amount: number;
  active_session_id: string | null;
  // Premium Job Card Detail Page Redesign Unit 8C.2, Task 7: passthrough of
  // the active session's already-fetched started_at, purely for a
  // client-side ticking display timer — not used in any duration/cost
  // calculation (that's still duration_minutes/calculated_amount, computed
  // server-side exactly as before).
  active_session_started_at: string | null;
  // Daily Activity / Active Job Cards Work Tracking Unit 9, Task 5: optional
  // — only populated by getWorkOrderLaborSummariesBulk() below (the single-
  // work-order getWorkOrderLaborSummary() leaves these undefined, matching
  // its existing return shape exactly so the Job Card detail page's call
  // site is unaffected).
  today_minutes?: number;
  today_hours?: number;
};

export type WorkOrderLaborSummary = {
  workers: WorkerLaborRow[];
  total_minutes: number;
  total_hours: number;
  total_amount: number;
  has_active_session: boolean;
};

// Job Card-level totals + per-worker breakdown, for the Job Card detail page
// and (Task 10) the closure-blocking guard's "any active session" check.
export async function getWorkOrderLaborSummary(db: DbClient, workOrderId: string): Promise<WorkOrderLaborSummary> {
  const [assignments, sessions] = await Promise.all([
    db.workOrderWorkerAssignment.findMany({
      where: { work_order_id: workOrderId, status: "active" },
      include: { worker_profiles: { select: { id: true, name: true } } },
      orderBy: [{ worker_role: "asc" }, { assigned_at: "asc" }],
    }),
    db.workOrderWorkSession.findMany({
      where: { work_order_id: workOrderId, status: { not: "Cancelled" } },
      orderBy: { started_at: "desc" },
    }),
  ]);

  const sessionsByAssignment = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = sessionsByAssignment.get(s.worker_assignment_id) ?? [];
    list.push(s);
    sessionsByAssignment.set(s.worker_assignment_id, list);
  }

  let totalMinutes = 0;
  let totalAmount = 0;
  let hasActiveSession = false;

  const workers: WorkerLaborRow[] = assignments.map((a) => {
    const rows = sessionsByAssignment.get(a.id) ?? [];
    const minutes = rows.reduce((sum, r) => sum + r.duration_minutes, 0);
    const amount = rows.reduce((sum, r) => sum + Number(r.calculated_amount), 0);
    totalMinutes += minutes;
    totalAmount += amount;

    const activeSession = rows.find((r) => r.status === "Active") ?? null;
    if (activeSession) hasActiveSession = true;
    const latest = rows[0] ?? null; // rows ordered started_at desc

    let status: WorkerSessionStatus = "Not Started";
    if (activeSession) status = "Active";
    else if (latest) status = latest.status === "Paused" ? "Paused" : "Completed";

    return {
      worker_assignment_id: a.id,
      worker_id: a.worker_id,
      worker_name: a.worker_profiles.name,
      worker_role: a.worker_role,
      hourly_rate_snapshot: Number(a.hourly_rate_snapshot),
      status,
      total_minutes: minutes,
      total_hours: Math.round((minutes / 60) * 100) / 100,
      total_amount: Math.round(amount * 1000) / 1000,
      active_session_id: activeSession?.id ?? null,
      active_session_started_at: activeSession?.started_at.toISOString() ?? null,
    };
  });

  return {
    workers,
    total_minutes: totalMinutes,
    total_hours: Math.round((totalMinutes / 60) * 100) / 100,
    total_amount: Math.round(totalAmount * 1000) / 1000,
    has_active_session: hasActiveSession,
  };
}

// Daily Activity / Active Job Cards Work Tracking Unit 9, Task 11: bulk
// variant of getWorkOrderLaborSummary above, for a page listing up to ~50
// active Job Cards — calling the single-work-order version in a loop would
// be 2 queries PER Job Card (N+1). This runs the same 2 queries once, scoped
// across every requested Job Card, then applies the EXACT same per-worker
// computation loop as the single-work-order version (copied, not
// reimplemented) so the numbers can never drift between the two pages.
// Adds today_minutes/today_amount per Job Card (Task 2's "Total Labor Hours
// Today"/"Labor Cost Today" summary cards) — a session's duration/amount
// still comes from the same stored duration_minutes/calculated_amount
// (Unit 8, untouched); "today" only filters WHICH sessions get summed, nothing
// about how a session's own duration is calculated.
export type DailyActivityLaborSummary = WorkOrderLaborSummary & {
  today_minutes: number;
  today_amount: number;
};

export async function getWorkOrderLaborSummariesBulk(
  db: DbClient,
  workOrderIds: string[]
): Promise<Map<string, DailyActivityLaborSummary>> {
  const result = new Map<string, DailyActivityLaborSummary>();
  if (workOrderIds.length === 0) return result;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [assignments, sessions] = await Promise.all([
    db.workOrderWorkerAssignment.findMany({
      where: { work_order_id: { in: workOrderIds }, status: "active" },
      include: { worker_profiles: { select: { id: true, name: true } } },
      orderBy: [{ worker_role: "asc" }, { assigned_at: "asc" }],
    }),
    db.workOrderWorkSession.findMany({
      where: { work_order_id: { in: workOrderIds }, status: { not: "Cancelled" } },
      orderBy: { started_at: "desc" },
    }),
  ]);

  const assignmentsByWorkOrder = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByWorkOrder.get(a.work_order_id) ?? [];
    list.push(a);
    assignmentsByWorkOrder.set(a.work_order_id, list);
  }
  const sessionsByAssignment = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const list = sessionsByAssignment.get(s.worker_assignment_id) ?? [];
    list.push(s);
    sessionsByAssignment.set(s.worker_assignment_id, list);
  }

  for (const workOrderId of workOrderIds) {
    const woAssignments = assignmentsByWorkOrder.get(workOrderId) ?? [];
    let totalMinutes = 0;
    let totalAmount = 0;
    let todayMinutes = 0;
    let todayAmount = 0;
    let hasActiveSession = false;

    const workers: WorkerLaborRow[] = woAssignments.map((a) => {
      const rows = sessionsByAssignment.get(a.id) ?? [];
      const minutes = rows.reduce((sum, r) => sum + r.duration_minutes, 0);
      const amount = rows.reduce((sum, r) => sum + Number(r.calculated_amount), 0);
      totalMinutes += minutes;
      totalAmount += amount;

      // "Today" — sessions that started today, same simple day-boundary
      // convention as every other "today" figure in this app (e.g. KPI
      // cards elsewhere use created_at >= start-of-day). Tracked per worker
      // (Task 5's "Today's worked time" row) as well as summed into the
      // Job Card-level today_minutes/today_amount below (Task 2's KPI card).
      let workerTodayMinutes = 0;
      for (const r of rows) {
        if (r.started_at >= todayStart) {
          workerTodayMinutes += r.duration_minutes;
          todayAmount += Number(r.calculated_amount);
        }
      }
      todayMinutes += workerTodayMinutes;

      const activeSession = rows.find((r) => r.status === "Active") ?? null;
      if (activeSession) hasActiveSession = true;
      const latest = rows[0] ?? null;

      let status: WorkerSessionStatus = "Not Started";
      if (activeSession) status = "Active";
      else if (latest) status = latest.status === "Paused" ? "Paused" : "Completed";

      return {
        worker_assignment_id: a.id,
        worker_id: a.worker_id,
        worker_name: a.worker_profiles.name,
        worker_role: a.worker_role,
        hourly_rate_snapshot: Number(a.hourly_rate_snapshot),
        status,
        total_minutes: minutes,
        total_hours: Math.round((minutes / 60) * 100) / 100,
        total_amount: Math.round(amount * 1000) / 1000,
        active_session_id: activeSession?.id ?? null,
        active_session_started_at: activeSession?.started_at.toISOString() ?? null,
        today_minutes: workerTodayMinutes,
        today_hours: Math.round((workerTodayMinutes / 60) * 100) / 100,
      };
    });

    result.set(workOrderId, {
      workers,
      total_minutes: totalMinutes,
      total_hours: Math.round((totalMinutes / 60) * 100) / 100,
      total_amount: Math.round(totalAmount * 1000) / 1000,
      has_active_session: hasActiveSession,
      today_minutes: todayMinutes,
      today_amount: Math.round(todayAmount * 1000) / 1000,
    });
  }

  return result;
}

export type SessionRow = {
  id: string;
  started_at: string;
  paused_at: string | null;
  stopped_at: string | null;
  status: string;
  duration_minutes: number;
  hourly_rate_snapshot: number;
  calculated_amount: number;
  is_manual_entry: boolean;
  notes: string | null;
  correction_reason: string | null;
  entered_by_name: string | null;
  edited_by_name: string | null;
};

// "View Sessions" — full session history for one worker assignment,
// including cancelled rows (so a correction trail stays visible), newest
// first.
export async function getSessionsForAssignment(workerAssignmentId: string): Promise<SessionRow[]> {
  const rows = await prisma.workOrderWorkSession.findMany({
    where: { worker_assignment_id: workerAssignmentId },
    include: {
      profiles_entered_by: { select: { full_name: true } },
      profiles_edited_by: { select: { full_name: true } },
    },
    orderBy: { started_at: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    started_at: r.started_at.toISOString(),
    paused_at: r.paused_at?.toISOString() ?? null,
    stopped_at: r.stopped_at?.toISOString() ?? null,
    status: r.status,
    duration_minutes: r.duration_minutes,
    hourly_rate_snapshot: Number(r.hourly_rate_snapshot),
    calculated_amount: Number(r.calculated_amount),
    is_manual_entry: r.is_manual_entry,
    notes: r.notes,
    correction_reason: r.correction_reason,
    entered_by_name: r.profiles_entered_by?.full_name ?? null,
    edited_by_name: r.profiles_edited_by?.full_name ?? null,
  }));
}

// Future Manager dashboard/reports foundation (Task 8) — not wired to any
// page yet, but ready: totals per worker across every Job Card, optionally
// scoped to a date range, plus a live "who's working right now" list.

export async function getWorkerLaborTotals(opts?: { workerId?: string; from?: Date; to?: Date }) {
  const rows = await prisma.workOrderWorkSession.groupBy({
    by: ["worker_id"],
    where: {
      status: { not: "Cancelled" },
      ...(opts?.workerId ? { worker_id: opts.workerId } : {}),
      ...(opts?.from || opts?.to
        ? { started_at: { ...(opts?.from ? { gte: opts.from } : {}), ...(opts?.to ? { lte: opts.to } : {}) } }
        : {}),
    },
    _sum: { duration_minutes: true, calculated_amount: true },
  });
  const workerIds = rows.map((r) => r.worker_id);
  const workers = workerIds.length
    ? await prisma.workerProfile.findMany({ where: { id: { in: workerIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(workers.map((w) => [w.id, w.name]));

  return rows
    .map((r) => ({
      worker_id: r.worker_id,
      worker_name: nameById.get(r.worker_id) ?? "Unknown",
      total_minutes: r._sum.duration_minutes ?? 0,
      total_hours: Math.round(((r._sum.duration_minutes ?? 0) / 60) * 100) / 100,
      total_amount: Math.round(Number(r._sum.calculated_amount ?? 0) * 1000) / 1000,
    }))
    .sort((a, b) => b.total_minutes - a.total_minutes);
}

export async function getActiveWorkSessions() {
  const rows = await prisma.workOrderWorkSession.findMany({
    where: { status: "Active" },
    include: {
      worker_profiles: { select: { name: true } },
      work_orders: { select: { work_order_number: true } },
    },
    orderBy: { started_at: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    work_order_id: r.work_order_id,
    work_order_number: r.work_orders.work_order_number,
    worker_name: r.worker_profiles.name,
    started_at: r.started_at.toISOString(),
  }));
}

// Worker Activity Dashboard Unit 9F, Task 7/12: the "future Manager
// dashboard/reports foundation" comment above (Task 8, Unit 8) is now wired
// up — this is the first real consumer. Bulk, per-worker version of the
// same status derivation getWorkOrderLaborSummary already uses (Active
// session -> Working Now, latest open session Paused -> Paused, an active
// assignment with no open session -> Assigned, otherwise -> Available),
// plus today/month-to-date totals and which Job Card (if any) each worker
// is currently on. Four queries total regardless of worker count — no
// per-worker loop, no N+1.
export type WorkerActivityStatus = "Working Now" | "Paused" | "Assigned" | "Available";

export type WorkerCurrentJobCard = {
  work_order_id: string;
  work_order_number: string | null;
  status: string;
  issue: string;
  asset_label: string | null;
};

export type WorkerActivitySummary = {
  status: WorkerActivityStatus;
  current_job_card: WorkerCurrentJobCard | null;
  active_session_started_at: string | null;
  today_minutes: number;
  today_hours: number;
  today_amount: number;
  month_minutes: number;
  month_hours: number;
  month_amount: number;
  active_assignment_count: number;
};

export async function getWorkerActivitySummaries(
  db: DbClient,
  workerIds: string[]
): Promise<Map<string, WorkerActivitySummary>> {
  const result = new Map<string, WorkerActivitySummary>();
  if (workerIds.length === 0) return result;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  const [assignments, todayTotals, monthTotals] = await Promise.all([
    db.workOrderWorkerAssignment.findMany({
      where: { worker_id: { in: workerIds }, status: "active" },
      orderBy: { assigned_at: "desc" },
      select: {
        id: true,
        worker_id: true,
        work_orders: {
          select: {
            id: true,
            work_order_number: true,
            status: true,
            operator_complaint: true,
            description_of_work: true,
            assets: { select: { asset_name: true, plate_number: true } },
          },
        },
      },
    }),
    db.workOrderWorkSession.groupBy({
      by: ["worker_id"],
      where: { worker_id: { in: workerIds }, status: { not: "Cancelled" }, started_at: { gte: todayStart } },
      _sum: { duration_minutes: true, calculated_amount: true },
    }),
    db.workOrderWorkSession.groupBy({
      by: ["worker_id"],
      where: { worker_id: { in: workerIds }, status: { not: "Cancelled" }, started_at: { gte: monthStart } },
      _sum: { duration_minutes: true, calculated_amount: true },
    }),
  ]);

  const assignmentIds = assignments.map((a) => a.id);
  // Only Active/Paused sessions matter for "what is this worker doing right
  // now" — Completed/Cancelled history is irrelevant here and never fetched.
  const openSessions = assignmentIds.length
    ? await db.workOrderWorkSession.findMany({
        where: { worker_assignment_id: { in: assignmentIds }, status: { in: ["Active", "Paused"] } },
        orderBy: { started_at: "desc" },
        select: { worker_assignment_id: true, status: true, started_at: true },
      })
    : [];
  const sessionByAssignment = new Map(openSessions.map((s) => [s.worker_assignment_id, s]));

  const todayByWorker = new Map(todayTotals.map((t) => [t.worker_id, t]));
  const monthByWorker = new Map(monthTotals.map((t) => [t.worker_id, t]));

  const assignmentsByWorker = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = assignmentsByWorker.get(a.worker_id) ?? [];
    list.push(a);
    assignmentsByWorker.set(a.worker_id, list);
  }

  for (const workerId of workerIds) {
    const workerAssignments = assignmentsByWorker.get(workerId) ?? [];
    // Prefer whichever assignment currently has an open session (Working
    // Now beats a second, dormant assignment); otherwise the most recently
    // assigned one (already the fetch order).
    const chosen = workerAssignments.find((a) => sessionByAssignment.has(a.id)) ?? workerAssignments[0] ?? null;
    const openSession = chosen ? sessionByAssignment.get(chosen.id) ?? null : null;

    const status: WorkerActivityStatus =
      openSession?.status === "Active" ? "Working Now" : openSession?.status === "Paused" ? "Paused" : chosen ? "Assigned" : "Available";

    const currentJobCard: WorkerCurrentJobCard | null = chosen
      ? {
          work_order_id: chosen.work_orders.id,
          work_order_number: chosen.work_orders.work_order_number,
          status: chosen.work_orders.status,
          issue: chosen.work_orders.operator_complaint || chosen.work_orders.description_of_work || "No issue description",
          asset_label: chosen.work_orders.assets
            ? `${chosen.work_orders.assets.asset_name}${chosen.work_orders.assets.plate_number ? ` (${chosen.work_orders.assets.plate_number})` : ""}`
            : null,
        }
      : null;

    const todayRow = todayByWorker.get(workerId);
    const monthRow = monthByWorker.get(workerId);
    const todayMinutes = todayRow?._sum.duration_minutes ?? 0;
    const monthMinutes = monthRow?._sum.duration_minutes ?? 0;

    result.set(workerId, {
      status,
      current_job_card: currentJobCard,
      active_session_started_at: openSession?.status === "Active" ? openSession.started_at.toISOString() : null,
      today_minutes: todayMinutes,
      today_hours: Math.round((todayMinutes / 60) * 100) / 100,
      today_amount: Math.round(Number(todayRow?._sum.calculated_amount ?? 0) * 1000) / 1000,
      month_minutes: monthMinutes,
      month_hours: Math.round((monthMinutes / 60) * 100) / 100,
      month_amount: Math.round(Number(monthRow?._sum.calculated_amount ?? 0) * 1000) / 1000,
      active_assignment_count: workerAssignments.length,
    });
  }

  return result;
}
