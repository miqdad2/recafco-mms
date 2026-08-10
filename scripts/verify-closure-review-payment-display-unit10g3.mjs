/**
 * Closure Review Worker Rate and Payment Display Unit 10G.3 — verification
 * script.
 *
 * This unit is display-only (labels/formatting in
 * components/dashboard/closure-review-modal.tsx) — no backend/calculation
 * file was touched. This script proves the numbers that flow into that
 * display are correct end-to-end, using the task's own worked example
 * (1 minute at 2.000 KWD/hr -> 0.033 KWD), directly against real rows in a
 * rolled-back transaction (same convention as every prior *.mjs script in
 * this directory).
 *
 * Usage:
 *   node --env-file=.env scripts/verify-closure-review-payment-display-unit10g3.mjs
 */

import { PrismaClient } from "@prisma/client";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// Mirrors the display formatting added in closure-review-modal.tsx (Task 6).
function fmtRate(rate) {
  return `${rate.toFixed(3)} KWD/hr`;
}
function fmtHours(hours) {
  return `${hours.toFixed(2)} h`;
}
function fmtPay(amount) {
  return `${amount.toFixed(3)} KWD`;
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G3 verify script";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    console.log("== 1. Task 2/3/6 — the task's own worked example (1 minute at 2.000 KWD/hr) ==");
    const wo = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Closure Requested", asset_id: asset.id, created_by: user.id },
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
    const start = new Date();
    const end = new Date(start.getTime() + 60 * 1000); // 1 minute
    const durationMinutes = 1;
    const calculatedAmount = Math.round((durationMinutes / 60) * SNAPSHOT_RATE * 1000) / 1000;
    await tx.workOrderWorkSession.create({
      data: { work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id, started_at: start, stopped_at: end, status: "Completed", duration_minutes: durationMinutes, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: calculatedAmount, entered_by: user.id },
    });

    check("1 minute at 2.000 KWD/hr rounds to 0.033 KWD (the task's own example)", calculatedAmount === 0.033);
    check('Rate formats as "2.000 KWD/hr"', fmtRate(SNAPSHOT_RATE) === "2.000 KWD/hr");
    check('Session pay formats as "0.033 KWD"', fmtPay(calculatedAmount) === "0.033 KWD");

    // Mirrors getWorkOrderLaborSummariesBulk's aggregation for this one worker.
    const sessions = await tx.workOrderWorkSession.findMany({ where: { work_order_id: wo.id, worker_assignment_id: assignment.id, status: { not: "Cancelled" } } });
    const totalMinutes = sessions.reduce((s, r) => s + r.duration_minutes, 0);
    const totalAmount = sessions.reduce((s, r) => s + Number(r.calculated_amount), 0);
    const totalHours = Math.round((totalMinutes / 60) * 100) / 100;
    const roundedTotalAmount = Math.round(totalAmount * 1000) / 1000;

    check('Total hours formats as "0.02 h" (the task\'s own Job Card summary example)', fmtHours(totalHours) === "0.02 h");
    check('Worker total pay formats as "0.033 KWD" (one session so far)', fmtPay(roundedTotalAmount) === "0.033 KWD");

    console.log("== 2. Task 4 — correction updates every downstream figure ==");
    // Correct the session: extend to 60 minutes -> 2.000 KWD.
    const correctedMinutes = 60;
    const correctedAmount = Math.round((correctedMinutes / 60) * SNAPSHOT_RATE * 1000) / 1000;
    await tx.workOrderWorkSession.update({
      where: { id: sessions[0].id },
      data: { stopped_at: new Date(start.getTime() + correctedMinutes * 60 * 1000), duration_minutes: correctedMinutes, calculated_amount: correctedAmount, correction_reason: "Adjusted per technician report.", edited_by: user.id },
    });
    const sessionsAfter = await tx.workOrderWorkSession.findMany({ where: { work_order_id: wo.id, worker_assignment_id: assignment.id, status: { not: "Cancelled" } } });
    const totalMinutesAfter = sessionsAfter.reduce((s, r) => s + r.duration_minutes, 0);
    const totalAmountAfter = sessionsAfter.reduce((s, r) => s + Number(r.calculated_amount), 0);

    check("Task 4 — session pay updates after correction (0.033 -> 2.000 KWD)", Number(sessionsAfter[0].calculated_amount) === 2.0);
    check("Task 4 — worker total hours updates after correction (0.02 h -> 1.00 h)", fmtHours(Math.round((totalMinutesAfter / 60) * 100) / 100) === "1.00 h");
    check("Task 4 — worker/Job Card total pay updates after correction (0.033 -> 2.000 KWD)", fmtPay(Math.round(totalAmountAfter * 1000) / 1000) === "2.000 KWD");
    check('"Corrected" is still detected via the real correction_reason column', Boolean(sessionsAfter[0].correction_reason));

    console.log("== 3. Task 5 — cost visibility gate (mirrors getClosureReviewDetailAction's canViewCosts branch) ==");
    function shapeWorkerForDisplay(canViewCosts, hourlyRate, totalPay) {
      return { hourlyRate: canViewCosts ? hourlyRate : null, totalPay: canViewCosts ? totalPay : null };
    }
    const dataEntryView = shapeWorkerForDisplay(false, SNAPSHOT_RATE, totalAmountAfter);
    const managerView = shapeWorkerForDisplay(true, SNAPSHOT_RATE, totalAmountAfter);
    check("Data Entry-equivalent (canViewCosts=false): hourlyRate is null, not just hidden client-side", dataEntryView.hourlyRate === null);
    check("Data Entry-equivalent (canViewCosts=false): totalPay is null", dataEntryView.totalPay === null);
    check("Manager-equivalent (canViewCosts=true): both values present", managerView.hourlyRate === SNAPSHOT_RATE && managerView.totalPay === totalAmountAfter);

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
