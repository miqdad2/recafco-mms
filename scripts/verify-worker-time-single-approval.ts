/**
 * Worker Time — automatic or manual, single closure approval: integration
 * checks that call the real backend services in-process (what the Server
 * Actions call). Replaces the retired verify-job-card-deletion-time-correction
 * harness, which asserted the old separate manual-time approval.
 *
 * DESTRUCTIVE: creates workers, Job Cards, assignments, work periods, manual
 * entries and closure decisions. Run it ONLY against a throw-away copy of the
 * database with migration 20261027030000_worker_time_single_closure_approval
 * applied:
 *
 *   createdb + pg_restore a dump of the dev DB into recafco_worker_time_test
 *   DATABASE_URL=<test db url> npx prisma migrate deploy
 *   DATABASE_URL=<test db url> node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --experimental-transform-types --import ./scripts/integration-register.mjs \
 *     scripts/verify-worker-time-single-approval.ts
 *
 * Refuses to run unless the database name contains "test".
 */

import { randomUUID } from "node:crypto";

import type { CurrentUserContext } from "@/lib/auth/context";
import type { PermissionKey, RoleSlug } from "@/types/database";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!/test/i.test(dbName)) {
  console.error(`Refusing to run against "${dbName}": the database name must contain "test".`);
  process.exit(2);
}

const { prisma } = await import("@/lib/db/prisma");
const time = await import("@/lib/backend/work-orders/work-time-corrections");
const sessions = await import("@/lib/backend/work-orders/work-sessions");
const service = await import("@/lib/backend/work-orders/service");
const totals = await import("@/lib/work-orders/work-session-totals");
const { kuwaitDateOf } = await import("@/lib/work-orders/work-time-correction-rules");

// ── Harness ──────────────────────────────────────────────────────────────────

const results: Array<{ id: string; pass: boolean }> = [];
async function check(id: string, name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    results.push({ id, pass: true });
    console.log(`PASS  ${id.padEnd(4)} ${name}${detail ? `  — ${detail}` : ""}`);
  } catch (error) {
    results.push({ id, pass: false });
    console.log(`FAIL  ${id.padEnd(4)} ${name}  — ${error instanceof Error ? error.message : String(error)}`);
  }
}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
async function rejects(promise: Promise<unknown>, pattern: RegExp, label = "call"): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    assert(pattern.test(msg), `${label} failed with unexpected message: ${msg}`);
    return msg;
  }
  throw new Error(`${label} should have been refused`);
}

async function contextFor(roleSlug: string): Promise<CurrentUserContext> {
  const p = await prisma.profiles.findFirst({
    where: { is_active: true, roles: { slug: roleSlug } },
    include: { roles: true, departments: true },
    orderBy: { created_at: "asc" },
  });
  if (!p || !p.roles) throw new Error(`No active ${roleSlug} user in the test database.`);
  const perms = await prisma.role_permissions.findMany({ where: { role_id: p.role_id! }, include: { permissions: true } });
  const set = new Set<string>(perms.map((rp) => rp.permissions.key));
  if (p.can_view_costs) set.add("costs.view");
  if (roleSlug !== "super_admin") {
    const overrides = await prisma.user_permission_overrides.findMany({ where: { profile_id: p.id } });
    for (const o of overrides) if (o.override_type === "allow") set.add(o.permission_key);
    for (const o of overrides) if (o.override_type === "deny") set.delete(o.permission_key);
  }
  return {
    userId: p.id,
    authUserId: p.id,
    email: null,
    mustResetPassword: false,
    profile: { id: p.id, full_name: p.full_name, employee_number: p.employee_number, phone: p.phone, job_title: p.job_title, department_id: p.department_id, role_id: p.role_id, is_active: p.is_active, can_view_costs: p.can_view_costs },
    department: p.departments ? { id: p.departments.id, name: p.departments.name, code: p.departments.code } : null,
    role: { id: p.roles.id, name: p.roles.name, slug: p.roles.slug as RoleSlug },
    permissions: [...set] as PermissionKey[],
  };
}

const dataEntry = await contextFor("maintenance_data_entry");
const manager = await contextFor("maintenance_manager");
const technician = await contextFor("technician");

const tag = `WT-${Date.now().toString(36)}`;
const assetId = (await prisma.assets.findFirstOrThrow({ where: { deleted_at: null }, select: { id: true } })).id;
const DAY = 24 * 3600_000;
const today = kuwaitDateOf(new Date());
const day = (offset: number) => kuwaitDateOf(new Date(Date.now() + offset * DAY));
const kuwait = (date: string, hm: string) => new Date(`${date}T${hm}:00+03:00`);

async function makeWorker(name: string, rate: string) {
  return prisma.workerProfile.create({ data: { name: `${tag} ${name}`, worker_type: "Technician", hourly_rate: rate }, select: { id: true } });
}
async function makeJobCard(label: string) {
  const wo = await prisma.work_orders.create({
    data: {
      ordered_by: `${tag} ${label}`,
      maintenance_type: "Repair",
      worker_type: "Mechanical",
      priority: "Normal",
      status: "Approved",
      asset_id: assetId,
      created_by: dataEntry.userId,
      operator_complaint: `${tag} ${label}`,
    },
    select: { id: true, work_order_number: true },
  });
  return wo;
}
async function assign(workOrderId: string, workerId: string, rate: string) {
  return prisma.workOrderWorkerAssignment.create({
    data: { work_order_id: workOrderId, worker_id: workerId, worker_role: "Technician", hourly_rate_snapshot: rate, assigned_by: dataEntry.userId },
    select: { id: true },
  });
}
const manual = (over: Partial<{ startDate: string; startTime: string; endDate: string; endTime: string; actualHours: string; reason: string; confirmLongPeriod: boolean; submissionId: string }>) => ({
  startDate: day(-1),
  startTime: "",
  endDate: day(-1),
  endTime: "",
  actualHours: "2",
  reason: "Timer not used — supervisor confirmed",
  submissionId: randomUUID(),
  ...over,
});
const minutesOf = async (assignmentId: string) =>
  (await prisma.workOrderWorkSession.aggregate({ where: { worker_assignment_id: assignmentId, status: { not: "Cancelled" } }, _sum: { duration_minutes: true } }))._sum.duration_minutes ?? 0;

const w1 = await makeWorker("Ahmed", "2.000");
const w2 = await makeWorker("Bader", "1.500");
const w3 = await makeWorker("Fahad", "3.000");
const jcA = await makeJobCard("A");
const jcB = await makeJobCard("B");
const jcC = await makeJobCard("C");
const aA1 = await assign(jcA.id, w1.id, "2.000");
const aB1 = await assign(jcB.id, w1.id, "2.000");
const aC1 = await assign(jcC.id, w1.id, "2.000");
const aA2 = await assign(jcA.id, w2.id, "1.500");

// ── 1. Automatic timer unchanged ─────────────────────────────────────────────

await check("T1", "automatic Start / Pause / Resume / Finish still work", async () => {
  await sessions.startWorkSession(dataEntry, { workOrderId: jcA.id, workerAssignmentId: aA2.id });
  await sessions.pauseWorkSession(dataEntry, { workOrderId: jcA.id, workerAssignmentId: aA2.id });
  await sessions.startWorkSession(dataEntry, { workOrderId: jcA.id, workerAssignmentId: aA2.id });
  const running = await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: aA2.id, status: "Active" } });
  assert(running === 1, `expected 1 running period, got ${running}`);
  await sessions.finishWorkSession(dataEntry, { workOrderId: jcA.id, workerAssignmentId: aA2.id });
  const a = await prisma.workOrderWorkerAssignment.findUniqueOrThrow({ where: { id: aA2.id } });
  const rows = await prisma.workOrderWorkSession.findMany({ where: { worker_assignment_id: aA2.id }, orderBy: { started_at: "asc" } });
  // Pause ends a period (it stays "Paused"); Resume opens a new one, which Finish completes.
  assert(
    a.status === "finished" && rows.length === 2 && rows[0].status === "Paused" && rows[1].status === "Completed" && rows.every((r) => !r.is_manual_entry),
    `timer flow broken: ${rows.map((r) => r.status).join(", ")}`
  );
  return `${rows.length} timer periods (Paused, Completed), worker finished`;
});

await check("T10", "one running timer per worker across Job Cards (no regression)", async () => {
  await sessions.startWorkSession(dataEntry, { workOrderId: jcB.id, workerAssignmentId: aB1.id });
  const msg = await rejects(sessions.startWorkSession(dataEntry, { workOrderId: jcC.id, workerAssignmentId: aC1.id }), /already working/i, "second timer");
  await sessions.pauseWorkSession(dataEntry, { workOrderId: jcB.id, workerAssignmentId: aB1.id });
  return msg.slice(0, 60);
});

// ── 2–7, 12. Manual entries ──────────────────────────────────────────────────

await check("T2", "single-day manual hours saved at once (exact period)", async () => {
  const r = await time.recordManualWorkTime(dataEntry, { ...manual({ startTime: "08:00", endTime: "10:30", actualHours: "2.5" }), workerAssignmentId: aA1.id });
  const s = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: r.sessionId } });
  assert(s.duration_minutes === 150 && !s.period_is_span && s.start_time_known && s.end_time_known, "wrong period");
  assert(s.started_at.getTime() === kuwait(day(-1), "08:00").getTime(), "start not Kuwait 08:00");
  return `150 min, ${s.started_at.toISOString()}`;
});

await check("T3/T4", "Start and End on different days: 9 h over 3 days saves 9 h", async () => {
  const r = await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-4), endDate: day(-2), actualHours: "9" }), workerAssignmentId: aB1.id });
  const s = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: r.sessionId } });
  assert(s.duration_minutes === 540, `expected 540, got ${s.duration_minutes}`);
  assert(s.period_is_span && !s.start_time_known && !s.end_time_known, "flags");
  assert(Number(s.calculated_amount) === 18, `cost ${s.calculated_amount} ≠ 9 h × 2.000`);
  return `540 min, 18.000 KWD at the 2.000 snapshot`;
});

await check("T5", "manual entry without exact times (date only) on one day", async () => {
  const r = await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-3), endDate: day(-3), actualHours: "3" }), workerAssignmentId: aC1.id });
  const s = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: r.sessionId } });
  assert(s.duration_minutes === 180 && s.period_is_span, "date-only entry");
  // Kuwait midnight boundaries.
  assert(s.started_at.getTime() === kuwait(day(-3), "00:00").getTime() && s.stopped_at!.getTime() === kuwait(day(-3), "23:59").getTime(), "Kuwait day bounds");
});

await check("T6", "manual records for one worker on several Job Cards (3 + 4 + 2 = 9 h)", async () => {
  const w = await makeWorker("Multi", "1.000");
  const cards = await Promise.all(["M1", "M2", "M3"].map((l) => makeJobCard(l)));
  const asg = await Promise.all(cards.map((c) => assign(c.id, w.id, "1.000")));
  const hours = ["3", "4", "2"];
  for (let i = 0; i < 3; i++) {
    await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-2), endDate: day(-2), actualHours: hours[i] }), workerAssignmentId: asg[i].id });
  }
  const sum = (await prisma.workOrderWorkSession.aggregate({ where: { worker_id: w.id }, _sum: { duration_minutes: true } }))._sum.duration_minutes;
  assert(sum === 540, `total ${sum}`);
  for (let i = 0; i < 3; i++) assert((await minutesOf(asg[i].id)) === Number(hours[i]) * 60, `card ${i}`);
  return "each record on its own Job Card; worker total 9 h";
});

await check("T7", "several manual records for one Job Card", async () => {
  const before = await minutesOf(aC1.id);
  await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-5), endDate: day(-5), actualHours: "1" }), workerAssignmentId: aC1.id });
  await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-6), endDate: day(-6), actualHours: "1.5" }), workerAssignmentId: aC1.id });
  const after = await minutesOf(aC1.id);
  assert(after - before === 150, `added ${after - before}`);
});

await check("T12", "saved without a separate Manager approval: status Recorded, counted at once, no approval notice", async () => {
  const notifBefore = await prisma.notifications.count();
  const before = await minutesOf(aA1.id);
  const r = await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-7), endDate: day(-7), actualHours: "1" }), workerAssignmentId: aA1.id });
  const entry = await prisma.workSessionTimeCorrection.findUniqueOrThrow({ where: { id: r.entryId } });
  assert(entry.status === "Recorded" && entry.work_session_id === r.sessionId && entry.requested_by === dataEntry.userId, "entry row");
  assert((await minutesOf(aA1.id)) - before === 60, "not counted once");
  assert((await prisma.notifications.count()) === notifBefore, "a notification was sent");
  const audit = await prisma.audit_logs.findFirst({ where: { action: "work_order.manual_time_recorded", entity_id: jcA.id }, orderBy: { created_at: "desc" } });
  assert(audit && audit.actor_id === dataEntry.userId, "audit row (creator) missing");
  return "Recorded, counted, audited, no approval task";
});

// ── 8. Automatic + manual ────────────────────────────────────────────────────

await check("T8", "automatic and manual records combined: totals = sum, never doubled", async () => {
  const rows = await prisma.workOrderWorkSession.findMany({ where: { worker_assignment_id: aB1.id, status: { not: "Cancelled" } } });
  const expected = rows.reduce((t, r) => t + r.duration_minutes, 0);
  const summary = await totals.getWorkOrderLaborSummary(prisma, jcB.id);
  const worker = summary.workers.find((x) => x.worker_assignment_id === aB1.id)!;
  assert(worker.total_minutes === expected && rows.some((r) => r.is_manual_entry) && rows.some((r) => !r.is_manual_entry), "mixed totals");
  // The paused timer stays visible as Paused even though a manual entry exists.
  assert(worker.status === "Paused", `status ${worker.status}`);
  return `${expected} min (timer + manual), state Paused`;
});

// ── 9. Overlap and possible conflicts ────────────────────────────────────────

await check("T9", "exact overlapping periods refused; date-range totals saved and flagged", async () => {
  // A timer period yesterday 13:00–15:00 on Job Card B.
  await prisma.workOrderWorkSession.create({
    data: {
      work_order_id: jcB.id, worker_assignment_id: aB1.id, worker_id: w1.id,
      started_at: kuwait(day(-1), "13:00"), stopped_at: kuwait(day(-1), "15:00"), status: "Completed",
      duration_minutes: 120, hourly_rate_snapshot: "2.000", calculated_amount: 4,
    },
  });
  const msg = await rejects(
    time.recordManualWorkTime(dataEntry, { ...manual({ startTime: "14:00", endTime: "16:00", actualHours: "2" }), workerAssignmentId: aC1.id }),
    /overlaps another work period/i,
    "exact overlap"
  );
  const r = await time.recordManualWorkTime(dataEntry, { ...manual({ actualHours: "2" }), workerAssignmentId: aC1.id });
  assert(r.possibleConflictCount > 0, "span overlap not flagged");
  const list = await totals.getSessionsForAssignment(aC1.id, { includeCosts: false });
  const row = list.find((x) => x.id === r.sessionId)!;
  assert(row.possible_conflicts.length > 0, "View Sessions / Closure Review flag missing");
  return `${msg.slice(0, 50)}… ; span flagged with ${[...new Set(row.possible_conflicts)].join(", ")}`;
});

// ── 11. Duplicate submissions ────────────────────────────────────────────────

await check("T11", "duplicate submission: same form id saves once (sequential and 5 at once)", async () => {
  const before = await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: aA1.id } });
  const fields = manual({ startDate: day(-8), endDate: day(-8), actualHours: "1" });
  const first = await time.recordManualWorkTime(dataEntry, { ...fields, workerAssignmentId: aA1.id });
  const again = await time.recordManualWorkTime(dataEntry, { ...fields, workerAssignmentId: aA1.id });
  assert(!first.alreadySaved && again.alreadySaved && again.sessionId === first.sessionId, "retry not recognised");
  const burst = manual({ startDate: day(-9), endDate: day(-9), actualHours: "1" });
  const settled = await Promise.allSettled(Array.from({ length: 5 }, () => time.recordManualWorkTime(dataEntry, { ...burst, workerAssignmentId: aA1.id })));
  const after = await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: aA1.id } });
  assert(after - before === 2, `expected 2 new periods, got ${after - before}`);
  assert(settled.every((s) => s.status === "fulfilled"), "a parallel duplicate failed instead of returning the first save");
  return "2 periods for 7 submissions";
});

// ── 13, 14. Daily Activity / Worker Activity totals ──────────────────────────

await check("T13", "Daily Activity totals (bulk) equal the stored periods", async () => {
  const bulk = await totals.getWorkOrderLaborSummariesBulk(prisma, [jcA.id, jcB.id, jcC.id]);
  for (const jc of [jcA, jcB, jcC]) {
    const stored = (await prisma.workOrderWorkSession.aggregate({ where: { work_order_id: jc.id, status: { not: "Cancelled" } }, _sum: { duration_minutes: true } }))._sum.duration_minutes ?? 0;
    assert(bulk.get(jc.id)!.total_minutes === stored, `${jc.work_order_number}: ${bulk.get(jc.id)!.total_minutes} ≠ ${stored}`);
  }
});

await check("T14", "Worker Activity month total includes manual hours once", async () => {
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const stored = (await prisma.workOrderWorkSession.aggregate({ where: { worker_id: w1.id, status: { not: "Cancelled" }, started_at: { gte: monthStart } }, _sum: { duration_minutes: true } }))._sum.duration_minutes ?? 0;
  const summary = (await totals.getWorkerActivitySummaries(prisma, [w1.id])).get(w1.id)!;
  assert(summary.month_minutes === stored, `${summary.month_minutes} ≠ ${stored}`);
  return `${stored} min this month`;
});

// ── 21. Corrections keep the original system values ──────────────────────────

await check("T21", "timer correction saved at once; first system values kept through two corrections", async () => {
  const s = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: aA2.id, is_manual_entry: false }, orderBy: { started_at: "asc" } });
  const firstStart = s.started_at.getTime();
  const firstMinutes = s.duration_minutes;
  // Move it to a clean slot two weeks ago (no overlaps), then correct it again:
  // the FIRST system-recorded values must survive both.
  const c1 = await time.correctRecordedWorkTime(dataEntry, { sessionId: s.id, correctedStart: `${day(-14)}T08:00`, correctedEnd: `${day(-14)}T09:00`, reason: "Worker forgot to stop", submissionId: randomUUID() });
  await time.correctRecordedWorkTime(dataEntry, { sessionId: s.id, correctedStart: `${day(-14)}T08:00`, correctedEnd: `${day(-14)}T09:30`, reason: "Second check", submissionId: randomUUID() });
  const after = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: s.id } });
  assert(after.duration_minutes === 90 && after.original_started_at?.getTime() === firstStart && after.original_duration_minutes === firstMinutes, "original values lost");
  const rows = await prisma.workSessionTimeCorrection.findMany({ where: { work_session_id: s.id }, orderBy: { requested_at: "asc" } });
  assert(rows.length === 2 && rows.every((r) => r.status === "Recorded") && rows[1].original_duration_minutes === 60, "audit rows");
  return `${c1.minutes} → 90 min; first recorded ${firstMinutes} min kept`;
});

// ── 22, 23. Costs ────────────────────────────────────────────────────────────

await check("T22", "labor cost uses the assignment rate snapshot and the entered hours", async () => {
  const rows = await prisma.workOrderWorkSession.findMany({ where: { worker_assignment_id: aB1.id, is_manual_entry: true } });
  assert(rows.length > 0 && rows.every((r) => Math.abs(Number(r.calculated_amount) - (r.duration_minutes / 60) * 2) < 0.001), "amount mismatch");
});

await check("T23", "Data Entry gets no rates or costs (sessions zeroed, no cost impact)", async () => {
  const list = await totals.getSessionsForAssignment(aB1.id, { includeCosts: false });
  assert(list.every((s) => s.calculated_amount === 0 && s.hourly_rate_snapshot === 0), "costs leaked");
  const views = await time.getTimeCorrectionsForWorkOrder(prisma, jcB.id, { userId: dataEntry.userId, canViewCosts: false });
  assert(views.length > 0 && views.every((v) => v.costImpact === null), "cost impact leaked");
});

// ── 15–20. Completion, closure, return, approval, protection ─────────────────

await check("T15", "saving hours does not finish the worker; explicit Mark Work Finished works without a timer", async () => {
  const a = await prisma.workOrderWorkerAssignment.findUniqueOrThrow({ where: { id: aA1.id } });
  assert(a.status === "active", "manual save finished the worker");
  await sessions.finishWorkSession(dataEntry, { workOrderId: jcA.id, workerAssignmentId: aA1.id });
  const b = await prisma.workOrderWorkerAssignment.findUniqueOrThrow({ where: { id: aA1.id } });
  const timers = await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: aA1.id, is_manual_entry: false } });
  assert(b.status === "finished" && timers === 0, "finish needed a timer");
});

await check("T16", "Request Closure works with manual time and no time approval", async () => {
  await service.requestJobCardClosure(dataEntry, jcA.id, "All done");
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jcA.id } });
  assert(wo.status === "Closure Requested", wo.status);
});

await check("T20a", "during Closure Review, Data Entry cannot add, change or correct time", async () => {
  const manualSession = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: aA1.id, is_manual_entry: true } });
  await rejects(time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-10), endDate: day(-10) }), workerAssignmentId: aA2.id }), /Closure has been requested/, "add");
  await rejects(time.changeManualWorkTime(dataEntry, { ...manual({ startDate: day(-10), endDate: day(-10) }), sessionId: manualSession.id }), /Closure has been requested/, "change");
  const timer = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: aA2.id, is_manual_entry: false } });
  await rejects(time.correctRecordedWorkTime(dataEntry, { sessionId: timer.id, correctedStart: `${day(-15)}T08:00`, correctedEnd: `${day(-15)}T09:00`, reason: "Late change" }), /Closure has been requested/, "correct");
});

await check("T17", "Manager review data: every manual entry with source, dates, by, reason", async () => {
  const list = await totals.getSessionsForAssignment(aA1.id, { includeCosts: true });
  const manuals = list.filter((s) => s.is_manual_entry);
  assert(manuals.length >= 4, `only ${manuals.length} manual rows`);
  assert(manuals.every((s) => s.entered_by_name && s.created_at && s.notes?.startsWith("Entered manually:")), "missing by/when/reason");
  const view = await time.getTimeCorrectionsForWorkOrder(prisma, jcA.id, { userId: manager.userId, canViewCosts: true });
  assert(view.some((v) => v.kind === "manual_entry" && v.status === "Recorded" && v.startTimeKnown === false), "date-only entry not in review list");
  return `${manuals.length} manual records`;
});

await check("T18", "Manager returns the closure for correction; Data Entry corrects and requests again", async () => {
  await rejects(service.returnJobCardClosure(manager, jcA.id, "x"), /at least 5 letters/, "short reason");
  await rejects(service.returnJobCardClosure(dataEntry, jcA.id, "Please check hours"), /permission/i, "Data Entry return");
  const r = await service.returnJobCardClosure(manager, jcA.id, "Ahmed's hours on day -7 look too high — check them");
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jcA.id } });
  assert(r.status === "Approved" && wo.status === "Approved", `back to ${wo.status}`);
  const approval = await prisma.approvals.findFirst({ where: { work_order_id: jcA.id, status: "Closure Returned" } });
  assert(approval?.comments?.includes("too high"), "approvals row");
  // Nothing recorded was deleted.
  assert((await prisma.workOrderWorkSession.count({ where: { work_order_id: jcA.id } })) > 0, "periods lost");
  // Data Entry fixes the disputed manual entry (finished worker: change, not add).
  const disputed = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: aA1.id, is_manual_entry: true, started_at: { gte: kuwait(day(-7), "00:00"), lt: kuwait(day(-6), "00:00") } } });
  await time.changeManualWorkTime(dataEntry, { ...manual({ startDate: day(-7), endDate: day(-7), actualHours: "0.5", reason: "Corrected after Manager review" }), sessionId: disputed.id });
  const fixed = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: disputed.id } });
  assert(fixed.duration_minutes === 30 && fixed.original_duration_minutes === 60 && Number(fixed.calculated_amount) === 1, "change not applied with history");
  await service.requestJobCardClosure(dataEntry, jcA.id, "Corrected");
  return "returned → Approved, corrected 60 → 30 min, closure requested again";
});

await check("T19", "Manager approves closure (the only approval stage)", async () => {
  await service.approveJobCardClosure(manager, jcA.id, "OK");
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jcA.id } });
  assert(wo.status === "Closed", wo.status);
});

await check("T20", "after closure, manual records are protected", async () => {
  const s = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: aA1.id, is_manual_entry: true } });
  await rejects(time.changeManualWorkTime(dataEntry, { ...manual({}), sessionId: s.id }), /closed/i, "change after close");
  await rejects(time.changeManualWorkTime(manager, { ...manual({}), sessionId: s.id }), /closed/i, "manager change after close");
  await rejects(sessions.editWorkSession(manager, { sessionId: s.id, startedAt: `${day(-20)}T08:00`, stoppedAt: `${day(-20)}T09:00`, correctionReason: "late edit" }), /closed|hours over dates/i, "manager edit after close");
});

// ── 24. Older Pending rows ───────────────────────────────────────────────────

await check("T24", "older Pending entries: not counted, closure waits, legacy Approve still works", async () => {
  const jc = await makeJobCard("Legacy");
  const a = await assign(jc.id, w3.id, "3.000");
  const legacy = await prisma.workSessionTimeCorrection.create({
    data: {
      entry_kind: "manual_entry", worker_assignment_id: a.id, work_order_id: jc.id, worker_id: w3.id,
      corrected_started_at: kuwait(day(-11), "08:00"), corrected_ended_at: kuwait(day(-11), "10:00"), corrected_duration_minutes: 120,
      reason: "Sent before the change", status: "Pending", requested_by: dataEntry.userId,
    },
  });
  assert((await minutesOf(a.id)) === 0, "pending counted");
  await rejects(sessions.finishWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id }), /older manual time entry/i, "finish while pending");
  await rejects(service.requestJobCardClosure(dataEntry, jc.id, ""), /not ready|older worker time/i, "closure while pending");
  await time.approveWorkTimeCorrection(manager, { correctionId: legacy.id });
  assert((await minutesOf(a.id)) === 120, "approved legacy entry not counted");
  const row = await prisma.workSessionTimeCorrection.findUniqueOrThrow({ where: { id: legacy.id } });
  assert(row.status === "Approved" && row.reviewed_by === manager.userId, "legacy decision not recorded");
  return "Pending kept, decided by Manager, then counted once";
});

// ── 26. Kuwait midnight ──────────────────────────────────────────────────────

await check("T26", "Kuwait midnight: 22:00 → 02:00 next day is 4 h, stored in UTC correctly", async () => {
  const jc = await makeJobCard("Night");
  const a = await assign(jc.id, w3.id, "3.000");
  const r = await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-13), startTime: "22:00", endDate: day(-12), endTime: "02:00", actualHours: "4" }), workerAssignmentId: a.id });
  const s = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: r.sessionId } });
  assert(s.duration_minutes === 240 && !s.period_is_span, "night period");
  assert(s.started_at.toISOString() === kuwait(day(-13), "22:00").toISOString() && s.stopped_at!.toISOString() === kuwait(day(-12), "02:00").toISOString(), "UTC storage");
  return `${s.started_at.toISOString()} → ${s.stopped_at!.toISOString()}`;
});

// ── Permissions ──────────────────────────────────────────────────────────────

await check("R1", "technician cannot enter or change manual time; Manager uses Add Manual Entry", async () => {
  await rejects(time.recordManualWorkTime(technician, { ...manual({}), workerAssignmentId: aC1.id }), /Only Maintenance Data Entry/, "technician");
  await rejects(time.recordManualWorkTime(manager, { ...manual({}), workerAssignmentId: aC1.id }), /Managers use Add Manual Entry/, "manager");
});

await check("R2", "Manager Edit / Correct refuses hours-over-dates entries (no silent recalculation)", async () => {
  const span = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: aB1.id, period_is_span: true } });
  await rejects(sessions.editWorkSession(manager, { sessionId: span.id, startedAt: `${day(-4)}T08:00`, stoppedAt: `${day(-2)}T17:00`, correctionReason: "edit" }), /Change Manual Time/, "edit span");
});

// ── Manual Time Recorded: per-assignment Start lock + Record Additional Work ─

{
  const wA = await makeWorker("Manual5", "2.000");
  const wB = await makeWorker("Timer3", "1.000");
  const card1 = await makeJobCard("MTR-1");
  const card2 = await makeJobCard("MTR-2");
  const a1 = await assign(card1.id, wA.id, "2.000"); // 5 h manual
  const b1 = await assign(card1.id, wB.id, "1.000"); // timer
  const a2 = await assign(card2.id, wA.id, "2.000"); // same worker, other Job Card

  await check("M1", "worker with no time: Start works", async () => {
    await sessions.startWorkSession(dataEntry, { workOrderId: card1.id, workerAssignmentId: b1.id });
    await sessions.finishWorkSession(dataEntry, { workOrderId: card1.id, workerAssignmentId: b1.id });
  });

  await check("M2", "5 h manual: plain Start refused by the server (not just a disabled button)", async () => {
    await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-2), endDate: day(-2), actualHours: "5" }), workerAssignmentId: a1.id });
    return (await rejects(sessions.startWorkSession(dataEntry, { workOrderId: card1.id, workerAssignmentId: a1.id }), /Record Additional Work/, "plain start")).slice(0, 70);
  });

  await check("M3", "state comes from stored data: labor summary shows 5 h manual, timer state Not Started", async () => {
    const w = (await totals.getWorkOrderLaborSummary(prisma, card1.id)).workers.find((x) => x.worker_assignment_id === a1.id)!;
    assert(w.manual_minutes === 300 && w.status === "Not Started" && w.assignment_status === "active", JSON.stringify(w));
  });

  await check("M6", "mixed methods on one Job Card sum once (5 h manual + timer)", async () => {
    const s = await totals.getWorkOrderLaborSummary(prisma, card1.id);
    const stored = (await prisma.workOrderWorkSession.aggregate({ where: { work_order_id: card1.id, status: { not: "Cancelled" } }, _sum: { duration_minutes: true } }))._sum.duration_minutes ?? 0;
    assert(s.total_minutes === stored && s.workers.reduce((t, w) => t + w.total_minutes, 0) === stored, "totals");
  });

  await check("M7", "same worker on another Job Card: Start there is NOT blocked", async () => {
    await sessions.startWorkSession(dataEntry, { workOrderId: card2.id, workerAssignmentId: a2.id });
  });

  await check("M11", "one running timer per worker still enforced (additional work on card 1 while running on card 2)", async () => {
    await rejects(sessions.startWorkSession(dataEntry, { workOrderId: card1.id, workerAssignmentId: a1.id, additionalWork: true }), /already working/i, "second timer");
    await sessions.pauseWorkSession(dataEntry, { workOrderId: card2.id, workerAssignmentId: a2.id });
  });

  await check("M8", "Record Additional Work starts a NEW timer; the 5 h manual record is unchanged", async () => {
    const before = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: a1.id, is_manual_entry: true } });
    await sessions.startWorkSession(dataEntry, { workOrderId: card1.id, workerAssignmentId: a1.id, additionalWork: true });
    await sessions.pauseWorkSession(dataEntry, { workOrderId: card1.id, workerAssignmentId: a1.id });
    const after = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: before.id } });
    assert(JSON.stringify(before) === JSON.stringify(after), "manual record changed");
    const audit = await prisma.audit_logs.findFirst({ where: { action: "work_order.work_session_started", entity_id: card1.id }, orderBy: { created_at: "desc" } });
    assert((audit?.metadata as Record<string, unknown> | null)?.additionalWork === "yes", "additional work not audited");
  });

  await check("M13", "paused timer after manual time: Resume is allowed (same timed work)", async () => {
    await sessions.startWorkSession(dataEntry, { workOrderId: card1.id, workerAssignmentId: a1.id });
    await sessions.pauseWorkSession(dataEntry, { workOrderId: card1.id, workerAssignmentId: a1.id });
  });

  await check("M9/M10", "additional manual entry is a new record; repeated submit saves once; exact overlap refused", async () => {
    const fields = manual({ startDate: day(-3), endDate: day(-3), actualHours: "1" });
    const r1 = await time.recordManualWorkTime(dataEntry, { ...fields, workerAssignmentId: a1.id });
    const r2 = await time.recordManualWorkTime(dataEntry, { ...fields, workerAssignmentId: a1.id });
    assert(!r1.alreadySaved && r2.alreadySaved && r1.sessionId === r2.sessionId, "duplicate");
    await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-4), startTime: "08:00", endDate: day(-4), endTime: "10:00", actualHours: "2" }), workerAssignmentId: a1.id });
    await rejects(
      time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-4), startTime: "09:00", endDate: day(-4), endTime: "10:00", actualHours: "1" }), workerAssignmentId: a2.id }),
      /overlaps another work period/i,
      "exact overlap on the worker's other Job Card"
    );
    const manualRows = await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: a1.id, is_manual_entry: true } });
    assert(manualRows === 3, `expected 3 manual records, got ${manualRows}`);
  });

  await check("M12", "concurrent plain Start + manual save on a fresh assignment: exactly one succeeds", async () => {
    const wC = await makeWorker("Race", "1.000");
    const card3 = await makeJobCard("MTR-3");
    const c3 = await assign(card3.id, wC.id, "1.000");
    const [start, save] = await Promise.allSettled([
      sessions.startWorkSession(dataEntry, { workOrderId: card3.id, workerAssignmentId: c3.id }),
      time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-1), endDate: day(-1), actualHours: "2" }), workerAssignmentId: c3.id }),
    ]);
    const ok = [start, save].filter((x) => x.status === "fulfilled").length;
    const rows = await prisma.workOrderWorkSession.findMany({ where: { worker_assignment_id: c3.id } });
    assert(ok === 1 && rows.length === 1, `fulfilled ${ok}, rows ${rows.length}`);
    return `${start.status === "fulfilled" ? "timer" : "manual save"} won; the other was refused`;
  });

  await check("M15", "Today vs Total: manual hours dated yesterday are in Total, not Today", async () => {
    const bulk = (await totals.getWorkOrderLaborSummariesBulk(prisma, [card1.id])).get(card1.id)!;
    const w = bulk.workers.find((x) => x.worker_assignment_id === a1.id)!;
    assert(w.total_minutes >= 300 + 60 + 120 && (w.today_minutes ?? 0) < w.total_minutes - 300, `today ${w.today_minutes}, total ${w.total_minutes}`);
    return `today ${w.today_minutes} min, total ${w.total_minutes} min`;
  });

  await check("M4/M16", "closure waits for 'mark work finished'; explicit Finish works without a timer; then closure can be requested", async () => {
    const wD = await makeWorker("ManualOnly", "2.000");
    const card4 = await makeJobCard("MTR-4");
    const d4 = await assign(card4.id, wD.id, "2.000");
    await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-2), endDate: day(-2), actualHours: "5" }), workerAssignmentId: d4.id });
    await rejects(service.requestJobCardClosure(dataEntry, card4.id, ""), /Manual time recorded - mark work finished/, "closure before finish");
    await sessions.finishWorkSession(dataEntry, { workOrderId: card4.id, workerAssignmentId: d4.id });
    await service.requestJobCardClosure(dataEntry, card4.id, "");
    const list = await totals.getSessionsForAssignment(d4.id, { includeCosts: false });
    assert(list.length === 1 && list[0].is_manual_entry && list[0].entered_by_name && list[0].calculated_amount === 0, "review data / cost hidden");
  });
}

// ── Paused workers: one definition for dashboards and Daily Activity ─────────

{
  const { getWorkOrderVisibilityFilter } = await import("@/lib/work-orders/visibility");
  const { classifyDailyActivity } = await import("@/lib/work-orders/daily-activity-status");
  const { ACTIVE_JOB_CARD_STATUSES } = await import("@/lib/work-orders/simplified-status-display");
  const deScope = getWorkOrderVisibilityFilter(dataEntry);
  const mgScope = { AND: [{ deleted_at: null }, getWorkOrderVisibilityFilter(manager)] };

  // The Daily Activity page's own Paused list for a scope (same base query + classification).
  async function dailyActivityPausedCards(scope: object) {
    const wos = await prisma.work_orders.findMany({
      where: {
        AND: [
          scope,
          { deleted_at: null },
          { status: { not: "Closed" } },
          { OR: [{ status: { in: ACTIVE_JOB_CARD_STATUSES } }, { status: "Closure Requested" }, { work_order_work_sessions: { some: { status: "Active" } } }] },
        ],
      },
      select: { id: true, status: true },
    });
    const bulk = await totals.getWorkOrderLaborSummariesBulk(prisma, wos.map((w) => w.id));
    return wos
      .filter((w) =>
        classifyDailyActivity({
          status: w.status,
          workers: (bulk.get(w.id)?.workers ?? []).map((x) => ({ assignmentStatus: x.assignment_status, sessionStatus: x.status, manualMinutes: x.manual_minutes })),
          closureReady: false,
          materialsPending: false,
        }).isPaused
      )
      .map((w) => w.id)
      .sort();
  }
  async function counts(scope: object) {
    const s = await totals.getPausedWorkSummary(prisma, scope);
    const da = await dailyActivityPausedCards(scope);
    assert(JSON.stringify([...s.pausedJobCardIds].sort()) === JSON.stringify(da), `dashboard cards ${s.pausedJobCardIds.length} ≠ Daily Activity ${da.length}`);
    return s;
  }

  await check("P1", "real cloned data: finished-from-paused workers are NOT paused (root cause); dashboard = Daily Activity", async () => {
    const s = await counts(deScope);
    const m = await counts(mgScope);
    return `Data Entry ${s.pausedWorkers} workers / ${s.pausedJobCards} cards; Manager ${m.pausedWorkers} / ${m.pausedJobCards}`;
  });

  const base = await counts(mgScope);
  const ws = await Promise.all(["P-A", "P-B", "P-C", "P-D"].map((n) => makeWorker(n, "1.000")));
  const jc1 = await makeJobCard("P-1");
  const jc2 = await makeJobCard("P-2");
  const a = {
    A1: await assign(jc1.id, ws[0].id, "1.000"),
    B1: await assign(jc1.id, ws[1].id, "1.000"),
    C2: await assign(jc2.id, ws[2].id, "1.000"),
  };
  const run = (jc: { id: string }, asg: { id: string }) => sessions.startWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: asg.id });
  const pause = (jc: { id: string }, asg: { id: string }) => sessions.pauseWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: asg.id });
  const delta = async () => {
    const s = await counts(mgScope);
    return { workers: s.pausedWorkers - base.pausedWorkers, cards: s.pausedJobCards - base.pausedJobCards };
  };
  const expect = async (workers: number, cards: number) => {
    const d = await delta();
    assert(d.workers === workers && d.cards === cards, `expected ${workers} workers / ${cards} cards, got ${d.workers} / ${d.cards}`);
    return `${workers} paused workers / ${cards} paused cards`;
  };

  await check("P2", "one paused worker → 1 worker / 1 card", async () => {
    await run(jc1, a.A1);
    await pause(jc1, a.A1);
    return expect(1, 1);
  });
  await check("P3", "two paused workers on one Job Card → 2 workers / 1 card", async () => {
    await run(jc1, a.B1);
    await pause(jc1, a.B1);
    return expect(2, 1);
  });
  await check("P4", "two Job Cards → 3 workers / 2 cards", async () => {
    await run(jc2, a.C2);
    await pause(jc2, a.C2);
    return expect(3, 2);
  });
  await check("P5", "pause then Resume → not paused", async () => {
    await run(jc2, a.C2);
    const r = await expect(2, 1);
    await pause(jc2, a.C2);
    return r;
  });
  await check("P6/P7", "pause then Finish → not paused (the period stays 'Paused' in history)", async () => {
    await sessions.finishWorkSession(dataEntry, { workOrderId: jc2.id, workerAssignmentId: a.C2.id });
    const last = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: a.C2.id }, orderBy: { started_at: "desc" } });
    assert(last.status === "Paused", "fixture: last period should still read Paused");
    return expect(2, 1);
  });
  await check("P8", "manual-only hours never create a paused state", async () => {
    const jc3 = await makeJobCard("P-3");
    const d3 = await assign(jc3.id, ws[3].id, "1.000");
    await time.recordManualWorkTime(dataEntry, { ...manual({ startDate: day(-1), endDate: day(-1), actualHours: "2" }), workerAssignmentId: d3.id });
    const r = await expect(2, 1);
    // Additional timer work after the manual entry, then a real pause → counted.
    await sessions.startWorkSession(dataEntry, { workOrderId: jc3.id, workerAssignmentId: d3.id, additionalWork: true });
    await sessions.pauseWorkSession(dataEntry, { workOrderId: jc3.id, workerAssignmentId: d3.id });
    await expect(3, 2);
    await sessions.finishWorkSession(dataEntry, { workOrderId: jc3.id, workerAssignmentId: d3.id });
    return `${r}; additional timer paused → counted, then finished → not`;
  });
  await check("P9", "worker paused on one card but working on another → not a paused worker; the card still lists as paused", async () => {
    const jc4 = await makeJobCard("P-4");
    const a4 = await assign(jc4.id, ws[0].id, "1.000");
    await run(jc4, a4);
    const r = await expect(1, 1);
    await pause(jc4, a4);
    await expect(2, 2); // A now paused on both cards: counted once as a worker
    return `${r} (A working elsewhere; card P-1 still has A and B paused); after A pauses: 2 workers / 2 cards`;
  });
  await check("P10/P11", "Closed and soft-deleted Job Cards with old pauses are not counted", async () => {
    const before = await delta();
    const jc5 = await makeJobCard("P-5");
    const jc6 = await makeJobCard("P-6");
    const w5 = await makeWorker("P-E", "1.000");
    const w6 = await makeWorker("P-F", "1.000");
    const a5 = await assign(jc5.id, w5.id, "1.000");
    const a6 = await assign(jc6.id, w6.id, "1.000");
    await run(jc5, a5); await pause(jc5, a5);
    await run(jc6, a6); await pause(jc6, a6);
    await prisma.work_orders.update({ where: { id: jc5.id }, data: { status: "Closed" } });
    await prisma.work_orders.update({ where: { id: jc6.id }, data: { deleted_at: new Date() } });
    const after = await delta();
    assert(after.workers === before.workers && after.cards === before.cards, `changed ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  });
  await check("P12", "visibility: a scope that cannot see the cards does not count them", async () => {
    const hidden = { id: { notIn: [jc1.id] } };
    const s = await totals.getPausedWorkSummary(prisma, { AND: [mgScope, hidden] });
    assert(!s.pausedJobCardIds.includes(jc1.id) && !s.pausedWorkerIds.includes(ws[1].id), "hidden card counted");
    const tech = await totals.getPausedWorkSummary(prisma, getWorkOrderVisibilityFilter(technician));
    assert(!tech.pausedJobCardIds.includes(jc1.id), "technician sees a card not assigned to them");
  });
  await check("P13/P14", "Data Entry and Manager scopes: dashboard paused cards = Daily Activity Paused list", async () => {
    const d = await counts(deScope);
    const m = await counts(mgScope);
    return `DE ${d.pausedWorkers}/${d.pausedJobCards}, Manager ${m.pausedWorkers}/${m.pausedJobCards}`;
  });
  await check("P18", "concurrent Pause and Resume on one worker leave one consistent state", async () => {
    await Promise.allSettled([run(jc1, a.B1), pause(jc1, a.B1)]);
    const active = await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: a.B1.id, status: "Active" } });
    assert(active <= 1, `${active} running periods`);
    const s = await counts(mgScope);
    const bPaused = s.pausedWorkerIds.includes(ws[1].id);
    assert(bPaused === (active === 0), "count disagrees with stored state");
    if (active) await pause(jc1, a.B1);
    return active ? "resume won (then paused again)" : "pause won";
  });
  await check("P19", "closure still refused while a worker is paused", async () => {
    await rejects(service.requestJobCardClosure(dataEntry, jc1.id, ""), /paused/i, "closure with paused worker");
  });
  await check("P20", "time totals unchanged: summary = stored periods", async () => {
    const s = await totals.getWorkOrderLaborSummary(prisma, jc1.id);
    const stored = (await prisma.workOrderWorkSession.aggregate({ where: { work_order_id: jc1.id, status: { not: "Cancelled" } }, _sum: { duration_minutes: true } }))._sum.duration_minutes ?? 0;
    assert(s.total_minutes === stored, `${s.total_minutes} ≠ ${stored}`);
  });
  await check("P15", "Worker Activity: paused worker shows Paused, working-elsewhere worker shows Working Now, finished shows not paused", async () => {
    const wa = await totals.getWorkerActivitySummaries(prisma, [ws[0].id, ws[1].id, ws[2].id]);
    const [A, B, C] = [wa.get(ws[0].id)!, wa.get(ws[1].id)!, wa.get(ws[2].id)!];
    assert(B.status === "Paused" && A.status === "Paused" && C.status !== "Paused", `A=${A.status} B=${B.status} C=${C.status}`);
    return `A=${A.status}, B=${B.status}, C=${C.status}`;
  });
}

// Release audit: a failed recipient lookup after a commit must not surface
// as an error for the user (the write already happened).
{
  const { resolveRecipientsSafely } = await import("@/lib/backend/notifications/safe-notifications");
  await check("N1", "Recipient lookup failure after a commit is logged and returns no recipients instead of throwing", async () => {
    const before = await prisma.system_error_logs.count({ where: { source: "audit.n1.recipients" } });
    const ids = await resolveRecipientsSafely("audit.n1.recipients", async () => {
      throw new Error("simulated connection drop");
    });
    const after = await prisma.system_error_logs.count({ where: { source: "audit.n1.recipients" } });
    assert(Array.isArray(ids) && ids.length === 0, `returned ${JSON.stringify(ids)}`);
    assert(after === before + 1, "not logged");
    assert((await resolveRecipientsSafely("audit.n1.recipients", async () => ["a", "b"])).length === 2, "normal lookup changed");
  });
}

// Release audit: closure gates and decision races.
{
  const { processJobCardMaterials } = await import("@/lib/backend/work-orders/material-processing");
  const status = async (id: string) => (await prisma.work_orders.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

  await check("C1", "Request Closure refused while a required material is not issued; allowed after Process Materials", async () => {
    const jc = await makeJobCard("C1 materials gate");
    await prisma.workOrderRequiredPart.create({
      data: { work_order_id: jc.id, description: `${tag} C1 gasket`, quantity_required: 2, unit_of_measure: "PCS", created_by: dataEntry.userId },
    });
    const msg = await rejects(service.requestJobCardClosure(dataEntry, jc.id, ""), /pending required materials/i, "closure with pending materials");
    assert((await status(jc.id)) === "Approved", "status changed after refusal");
    const done = await processJobCardMaterials(manager, jc.id);
    assert(done.issuedCount === 1, `issued ${done.issuedCount}`);
    await service.requestJobCardClosure(dataEntry, jc.id, "materials done");
    assert((await status(jc.id)) === "Closure Requested", await status(jc.id));
    return msg;
  });

  await check("C2", "Data Entry cannot approve or return a closure by calling the service directly", async () => {
    const jc = await makeJobCard("C2 permission");
    await service.requestJobCardClosure(dataEntry, jc.id, "");
    await rejects(service.approveJobCardClosure(dataEntry, jc.id), /permission/i, "Data Entry approve");
    await rejects(service.returnJobCardClosure(dataEntry, jc.id, "please fix this"), /permission/i, "Data Entry return");
    assert((await status(jc.id)) === "Closure Requested", "status changed");
  });

  await check("C3", "Approve + Approve + Return at the same moment → exactly one decision, consistent state", async () => {
    const jc = await makeJobCard("C3 race");
    await service.requestJobCardClosure(dataEntry, jc.id, "");
    const settled = await Promise.allSettled([
      service.approveJobCardClosure(manager, jc.id),
      service.approveJobCardClosure(manager, jc.id),
      service.returnJobCardClosure(manager, jc.id, "Race check: please review"),
    ]);
    const ok = settled.filter((s) => s.status === "fulfilled").length;
    const decisions = await prisma.approvals.count({ where: { work_order_id: jc.id, status: { in: ["Closed", "Closure Returned"] } } });
    const final = await status(jc.id);
    assert(ok === 1 && decisions === 1, `${ok} succeeded, ${decisions} decision rows`);
    assert(final === "Closed" || final === "Approved", final);
    return `winner → ${final}`;
  });

  await check("C5", "Mixed materials: stocked item issued directly (no receive), shortage received then issued; balances exact", async () => {
    const jc = await makeJobCard("C5 mixed materials");
    const stocked = `${tag} C5 stocked filter`;
    const missing = `${tag} C5 new hose`;
    const balance = async (name: string) => {
      const rows = await prisma.offline_inventory_movements.findMany({ where: { manual_material_name: name, part_id: null, deleted_at: null }, select: { movement_type: true, quantity: true } });
      return rows.reduce((s, m) => s + (m.movement_type === "ISSUED" ? -Number(m.quantity) : Number(m.quantity)), 0);
    };
    await prisma.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), manual_material_name: stocked, category: "Other", quantity: 5, unit: "PCS", created_by: dataEntry.userId },
    });
    await prisma.workOrderRequiredPart.createMany({
      data: [
        { work_order_id: jc.id, description: stocked, quantity_required: 2, unit_of_measure: "PCS", created_by: dataEntry.userId },
        { work_order_id: jc.id, description: missing, quantity_required: 3, unit_of_measure: "PCS", created_by: dataEntry.userId },
      ],
    });
    const done = await processJobCardMaterials(manager, jc.id);
    const moves = await prisma.offline_inventory_movements.findMany({ where: { related_work_order_id: jc.id }, select: { movement_type: true, manual_material_name: true, quantity: true } });
    const of = (name: string, type: string) => moves.filter((m) => m.manual_material_name === name && m.movement_type === type).map((m) => Number(m.quantity));
    assert(JSON.stringify(of(stocked, "RECEIVED")) === "[]" && JSON.stringify(of(stocked, "ISSUED")) === "[2]", `stocked moves ${JSON.stringify(moves)}`);
    assert(JSON.stringify(of(missing, "RECEIVED")) === "[3]" && JSON.stringify(of(missing, "ISSUED")) === "[3]", `missing moves ${JSON.stringify(moves)}`);
    assert((await balance(stocked)) === 3 && (await balance(missing)) === 0, `balances ${await balance(stocked)} / ${await balance(missing)}`);
    const again = await processJobCardMaterials(manager, jc.id);
    assert(again.issuedCount === 0 && again.receivedCount === 0, "second run moved stock again");
    await service.requestJobCardClosure(dataEntry, jc.id, "");
    return `received ${done.receivedCount}, issued ${done.issuedCount}; balances 3 / 0; repeat run moved nothing`;
  });

  // Database connection recovery: every connection of THIS test database is
  // terminated from a separate admin connection (the server keeps running).
  const { PrismaClient } = await import("@prisma/client");
  const { withBackendTransaction } = await import("@/lib/backend/shared/transaction");
  const adminUrl = new URL(process.env.DATABASE_URL!);
  adminUrl.pathname = "/postgres";
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const killConnections = async () => {
    // Fill the pool first so there are several dead connections to drain.
    await Promise.all(Array.from({ length: 12 }, () => prisma.work_orders.count()));
    const rows = await admin.$queryRawUnsafe<{ n: number }[]>(
      `select count(*)::int as n from (select pg_terminate_backend(pid) from pg_stat_activity where datname = '${dbName}' and pid <> pg_backend_pid()) t`
    );
    await new Promise((r) => setTimeout(r, 300));
    return rows[0].n;
  };

  await check("D1", "After every connection is killed: reads and a closure approval succeed (after one idle-lifetime wait), exactly one decision", async () => {
    const jc = await makeJobCard("D1 recovery");
    await service.requestJobCardClosure(dataEntry, jc.id, "");
    const killed = await killConnections();
    const reads = await Promise.all([prisma.work_orders.count(), prisma.profiles.findFirst({ select: { id: true } }), prisma.$queryRaw`select 1 as ok`]);
    assert(reads.length === 3, "reads failed");
    await killConnections();
    await service.approveJobCardClosure(manager, jc.id);
    assert((await status(jc.id)) === "Closed", await status(jc.id));
    const decisions = await prisma.approvals.count({ where: { work_order_id: jc.id, status: "Closed" } });
    assert(decisions === 1, `${decisions} Closed rows`);
    return `${killed} connections killed; reads + approval recovered, 1 decision`;
  });

  await check("D2", "A transaction whose work had started is NOT retried when its connection dies: runs once, nothing committed", async () => {
    const jc = await makeJobCard("D2 no blind retry");
    let runs = 0;
    const marker = `${tag} D2 uncommitted`;
    await rejects(
      withBackendTransaction(manager.userId, async (tx) => {
        runs++;
        await tx.work_orders.update({ where: { id: jc.id }, data: { job_location: marker } });
        await tx.$executeRawUnsafe(`select pg_terminate_backend(pg_backend_pid())`);
        return "unreachable";
      }),
      /.+/,
      "transaction with a dead connection"
    );
    assert(runs === 1, `operation ran ${runs} times`);
    const row = await prisma.work_orders.findUniqueOrThrow({ where: { id: jc.id }, select: { job_location: true } });
    assert(row.job_location !== marker, "the write was committed");
  });

  await check("D3", "Closure request right after the kill: committed once (transaction start recovered, no duplicate)", async () => {
    const jc = await makeJobCard("D3 request after kill");
    await killConnections();
    await service.requestJobCardClosure(dataEntry, jc.id, "after restart");
    const requests = await prisma.approvals.count({ where: { work_order_id: jc.id, status: "Closure Requested" } });
    assert((await status(jc.id)) === "Closure Requested" && requests === 1, `${await status(jc.id)}, ${requests} requests`);
  });
  await admin.$disconnect();

  await check("C4", "Direct Manager close (now under the Job Card lock) still closes a ready Job Card once", async () => {
    const jc = await makeJobCard("C4 direct close");
    const [a, b] = await Promise.allSettled([service.closeWorkOrder(manager, jc.id), service.closeWorkOrder(manager, jc.id)]);
    assert((await status(jc.id)) === "Closed", await status(jc.id));
    const rows = await prisma.approvals.count({ where: { work_order_id: jc.id, status: "Closed" } });
    assert(rows === 1, `${rows} Closed approval rows (${a.status}/${b.status})`);
  });
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed (today in Kuwait: ${today})`);
await prisma.$disconnect();
process.exit(failed.length ? 1 : 0);
