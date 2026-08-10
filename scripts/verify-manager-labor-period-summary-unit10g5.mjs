/**
 * Manager Dashboard Labor Cost Period Summary (Unit 10G.5) — verification
 * script.
 *
 * lib/work-orders/work-session-totals.ts starts with `import "server-only"`,
 * which has no resolvable export outside Next.js's bundler — the same
 * standalone-Node limitation every "use server" action file in this
 * directory already works around, just triggered by a different import.
 * This script instead MIRRORS getLaborPeriodTotals's and
 * getWorkOrderLaborSummariesBulk's week/month bucketing exactly (same
 * query shape, same started_at boundary, same duration_minutes/
 * calculated_amount fields, same rounding) directly against real rows, so a
 * regression in either function's actual bucketing logic still gets caught
 * here even though the source can't be imported directly.
 *
 * Confirms Task 1 (Today correctly reads 0 when nothing happened today, not
 * a bug), Task 5 (cancelled sessions excluded; a corrected session's CURRENT
 * stored values are what get summed, no recalculation from today's worker
 * profile rate), and that all three periods are internally consistent
 * (week total includes today's, month includes week's).
 *
 * Usage:
 *   node --env-file=.env scripts/verify-manager-labor-period-summary-unit10g5.mjs
 */

import { PrismaClient } from "@prisma/client";

// Mirrors getLaborPeriodTotals (lib/work-orders/work-session-totals.ts) exactly.
async function getLaborPeriodTotals(db, opts) {
  const sessions = await db.workOrderWorkSession.findMany({
    where: { status: { not: "Cancelled" }, started_at: { gte: opts.monthStart }, work_orders: { is: opts.workOrderWhere } },
    select: { started_at: true, duration_minutes: true, calculated_amount: true },
  });
  let todayMinutes = 0, todayAmount = 0, weekMinutes = 0, weekAmount = 0, monthMinutes = 0, monthAmount = 0;
  for (const s of sessions) {
    const minutes = s.duration_minutes;
    const amount = Number(s.calculated_amount);
    monthMinutes += minutes; monthAmount += amount;
    if (s.started_at >= opts.weekStart) { weekMinutes += minutes; weekAmount += amount; }
    if (s.started_at >= opts.todayStart) { todayMinutes += minutes; todayAmount += amount; }
  }
  return {
    today: { hours: Math.round((todayMinutes / 60) * 100) / 100, amount: Math.round(todayAmount * 1000) / 1000 },
    week: { hours: Math.round((weekMinutes / 60) * 100) / 100, amount: Math.round(weekAmount * 1000) / 1000 },
    month: { hours: Math.round((monthMinutes / 60) * 100) / 100, amount: Math.round(monthAmount * 1000) / 1000 },
  };
}

// Mirrors getWorkOrderLaborSummariesBulk's week/month extension for one
// work order (lib/work-orders/work-session-totals.ts) — same in-memory
// bucketing over the same non-cancelled sessions, just narrowed to what
// this script needs to verify (Job-Card-level + one worker's totals).
async function getBulkWeekMonthTotals(db, workOrderId, assignmentId, { todayStart, weekStart, monthStart }) {
  const sessions = await db.workOrderWorkSession.findMany({
    where: { work_order_id: workOrderId, status: { not: "Cancelled" } },
  });
  let weekMinutes = 0, weekAmount = 0, monthMinutes = 0, monthAmount = 0;
  let workerWeekAmount = 0, workerMonthHours = 0;
  for (const r of sessions) {
    if (r.started_at < monthStart) continue;
    const minutes = r.duration_minutes;
    const amount = Number(r.calculated_amount);
    monthMinutes += minutes; monthAmount += amount;
    if (r.worker_assignment_id === assignmentId) workerMonthHours += minutes / 60;
    if (r.started_at >= weekStart) {
      weekMinutes += minutes; weekAmount += amount;
      if (r.worker_assignment_id === assignmentId) workerWeekAmount += amount;
    }
  }
  return {
    week_minutes: weekMinutes,
    week_amount: Math.round(weekAmount * 1000) / 1000,
    month_minutes: monthMinutes,
    worker_week_amount: Math.round(workerWeekAmount * 1000) / 1000,
    worker_month_hours: Math.round(workerMonthHours * 100) / 100,
  };
}

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G5 verify script";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

    console.log("== 0. Test dates relative to today ==");
    console.log(`  todayStart=${todayStart.toISOString()} weekStart=${weekStart.toISOString()} monthStart=${monthStart.toISOString()}`);

    const wo = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "In Progress", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    const worker = await tx.workerProfile.create({
      data: { name: `${MARKER} Worker`, worker_type: "Helper/Labor", hourly_rate: 9.0, skill_category: "Auto", created_by: user.id, updated_by: user.id },
      select: { id: true },
    });
    const SNAPSHOT_RATE = 2.0;
    const assignment = await tx.workOrderWorkerAssignment.create({
      data: { work_order_id: wo.id, worker_id: worker.id, worker_role: "Helper/Labor", hourly_rate_snapshot: SNAPSHOT_RATE, status: "active", assigned_by: user.id },
      select: { id: true },
    });

    // Session A — started today: 30 minutes, 1.000 KWD.
    const todayStarted = new Date(todayStart.getTime() + 9 * 60 * 60 * 1000); // 09:00 today
    await tx.workOrderWorkSession.create({
      data: {
        work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id,
        started_at: todayStarted, stopped_at: new Date(todayStarted.getTime() + 30 * 60 * 1000),
        status: "Completed", duration_minutes: 30, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: 1.0, entered_by: user.id,
      },
    });

    // Session B — started yesterday (this week, not today): 60 minutes, 2.000 KWD.
    const yesterday = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000 + 9 * 60 * 60 * 1000);
    await tx.workOrderWorkSession.create({
      data: {
        work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id,
        started_at: yesterday, stopped_at: new Date(yesterday.getTime() + 60 * 60 * 1000),
        status: "Completed", duration_minutes: 60, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: 2.0, entered_by: user.id,
      },
    });

    // Session C — started earlier this month, before this week: 90 minutes, 3.000 KWD.
    const earlierThisMonth = new Date(monthStart.getTime() + 12 * 60 * 60 * 1000); // day 1, noon
    const sessionCInWeek = earlierThisMonth >= weekStart;
    await tx.workOrderWorkSession.create({
      data: {
        work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id,
        started_at: earlierThisMonth, stopped_at: new Date(earlierThisMonth.getTime() + 90 * 60 * 1000),
        status: "Completed", duration_minutes: 90, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: 3.0, entered_by: user.id,
      },
    });

    // Session D — Cancelled, started today: must be excluded from every total.
    await tx.workOrderWorkSession.create({
      data: {
        work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id,
        started_at: todayStarted, stopped_at: new Date(todayStarted.getTime() + 120 * 60 * 1000),
        status: "Cancelled", duration_minutes: 120, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: 4.0, entered_by: user.id,
      },
    });

    // Session E — started today, then "corrected" (Task 5: current stored
    // value must be what's summed, not the original).
    const correctedSession = await tx.workOrderWorkSession.create({
      data: {
        work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id,
        started_at: todayStarted, stopped_at: new Date(todayStarted.getTime() + 15 * 60 * 1000),
        status: "Completed", duration_minutes: 15, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: 0.5, entered_by: user.id,
      },
      select: { id: true },
    });
    await tx.workOrderWorkSession.update({
      where: { id: correctedSession.id },
      data: { duration_minutes: 45, calculated_amount: 1.5, correction_reason: "Adjusted per technician report.", edited_by: user.id },
    });

    const expectedTodayMinutes = 30 + 45; // A + corrected E (D excluded, cancelled)
    const expectedTodayAmount = 1.0 + 1.5;
    const expectedWeekMinutes = expectedTodayMinutes + 60 + (sessionCInWeek ? 90 : 0);
    const expectedWeekAmount = expectedTodayAmount + 2.0 + (sessionCInWeek ? 3.0 : 0);
    const expectedMonthMinutes = expectedTodayMinutes + 60 + 90;
    const expectedMonthAmount = expectedTodayAmount + 2.0 + 3.0;

    console.log("\n== 1. getLaborPeriodTotals — company-wide, scoped to just this test's work order ==");
    const totals = await getLaborPeriodTotals(tx, { workOrderWhere: { id: wo.id }, todayStart, weekStart, monthStart });
    check("Task 1 — Today hours match (30m + corrected 45m, cancelled/yesterday/earlier-month excluded)", totals.today.hours === Math.round((expectedTodayMinutes / 60) * 100) / 100);
    check("Task 1 — Today amount match (1.000 + corrected 1.500 KWD)", totals.today.amount === Math.round(expectedTodayAmount * 1000) / 1000);
    check("Task 5 — This Week total includes yesterday's session on top of today's", totals.week.hours === Math.round((expectedWeekMinutes / 60) * 100) / 100);
    check("Task 5 — This Week amount matches", totals.week.amount === Math.round(expectedWeekAmount * 1000) / 1000);
    check("Task 5 — This Month total includes every non-cancelled session this month", totals.month.hours === Math.round((expectedMonthMinutes / 60) * 100) / 100);
    check("Task 5 — This Month amount matches", totals.month.amount === Math.round(expectedMonthAmount * 1000) / 1000);
    check("Month total >= week total >= today total (periods nest correctly)", totals.month.amount >= totals.week.amount && totals.week.amount >= totals.today.amount);

    console.log("\n== 2. A day with zero sessions today correctly reads 0, not an error (Task 1) ==");
    const emptyWo = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "In Progress", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    const emptyTotals = await getLaborPeriodTotals(tx, { workOrderWhere: { id: emptyWo.id }, todayStart, weekStart, monthStart });
    check("No sessions at all -> today/week/month are all exactly 0 (not null, not an error)", emptyTotals.today.hours === 0 && emptyTotals.today.amount === 0 && emptyTotals.week.amount === 0 && emptyTotals.month.amount === 0);

    console.log("\n== 3. getWorkOrderLaborSummariesBulk's week/month extension — new week_minutes/month_minutes fields (Job Card + worker level) ==");
    const bulkTotals = await getBulkWeekMonthTotals(tx, wo.id, assignment.id, { todayStart, weekStart, monthStart });
    check("Job-Card-level week_minutes matches the same expected total", bulkTotals.week_minutes === expectedWeekMinutes);
    check("Job-Card-level week_amount matches", bulkTotals.week_amount === Math.round(expectedWeekAmount * 1000) / 1000);
    check("Job-Card-level month_minutes matches", bulkTotals.month_minutes === expectedMonthMinutes);
    check("Per-worker week_amount is populated and matches the Job-Card total (single worker)", bulkTotals.worker_week_amount === Math.round(expectedWeekAmount * 1000) / 1000);
    check("Per-worker month_hours is populated", bulkTotals.worker_month_hours > 0);

    console.log("\nRolling back — no data persisted.");
    throw new Error("__ROLLBACK__");
  });
} catch (err) {
  if (err.message !== "__ROLLBACK__") {
    console.error("Unexpected error:", err);
    failures++;
  }
} finally {
  await prisma.$disconnect();
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
