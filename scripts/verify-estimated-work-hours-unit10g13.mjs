/**
 * Estimated Work Hours for Job Cards and Workers (Unit 10G.13) —
 * verification script.
 *
 * app/actions/maintenance.ts, app/actions/work-order-roster.ts,
 * lib/backend/work-orders/worker-roster.ts, and
 * lib/work-orders/work-session-totals.ts are all "server-only"/"use server"
 * and can't be imported into a standalone Node script — same limitation as
 * every prior *.mjs script in this directory. This script:
 *   1. Imports the one genuinely client-safe module this unit added
 *      (lib/work-orders/hours-variance.ts, no "server-only") directly, and
 *      exercises computeHoursVariance/hoursVarianceTone against the exact
 *      boundary values Task 5's spec defines (On Track / Slightly Over /
 *      Over Estimate / No Estimate).
 *   2. Mirrors parseWorkerEstimates' degrade-to-empty-object JSON parsing
 *      (app/actions/maintenance.ts) against malformed/missing input.
 *   3. Proves the new columns round-trip through Prisma against real rows —
 *      work_orders.estimated_labor_hours and
 *      work_order_worker_assignments.estimated_hours — including that an
 *      existing (pre-unit) row with no estimate still reads back NULL, all
 *      inside one transaction that is rolled back at the end.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-estimated-work-hours-unit10g13.mjs
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { computeHoursVariance, hoursVarianceTone } from "../lib/work-orders/hours-variance.ts";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// Mirrors parseWorkerEstimates (app/actions/maintenance.ts) — a hidden
// `assign_worker_estimates` FormData field, JSON-decoded, degrading to {}
// on any malformed/missing value rather than throwing/blocking the form.
function parseWorkerEstimatesMirror(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out = {};
    for (const [k, v] of Object.entries(parsed)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = n;
    }
    return out;
  } catch {
    return {};
  }
}

console.log("== 1. Task 5 — computeHoursVariance boundary behavior (Unit 10G.13 + 10G.21's added Under Estimate) ==");
{
  check("No estimate (null) -> status no_estimate, varianceHours null", computeHoursVariance(null, 5).status === "no_estimate" && computeHoursVariance(null, 5).varianceHours === null);
  check("No estimate (undefined) -> status no_estimate", computeHoursVariance(undefined, 5).status === "no_estimate");
  check("actual == estimated -> On Track (boundary, not Slightly Over)", computeHoursVariance(6, 6).status === "on_track");
  check("actual == estimated * 0.8 exactly -> On Track (boundary is inclusive, not Under Estimate)", computeHoursVariance(6, 4.8).status === "on_track");
  check("actual just under estimated * 0.8 -> Under Estimate (Unit 10G.21)", computeHoursVariance(6, 4.79).status === "under_estimate");
  check("actual well under estimated -> Under Estimate", computeHoursVariance(6, 4).status === "under_estimate" && computeHoursVariance(6, 4).varianceHours === -2);
  check("actual == estimated * 1.2 exactly -> Slightly Over (boundary is inclusive of the <= 1.2x band)", computeHoursVariance(5, 6).status === "slightly_over");
  check("actual just over estimated -> Slightly Over", computeHoursVariance(6, 7).status === "slightly_over" && computeHoursVariance(6, 7).varianceHours === 1);
  check("actual just over estimated * 1.2 -> Over Estimate", computeHoursVariance(5, 6.01).status === "over_estimate");
  check("actual way over estimated -> Over Estimate", computeHoursVariance(6, 7.5).status === "over_estimate" && computeHoursVariance(6, 7.5).varianceHours === 1.5);
  check("varianceHours rounds to 2 decimals", computeHoursVariance(3, 4.111).varianceHours === 1.11);

  check("tone(on_track) = green", hoursVarianceTone("on_track") === "green");
  check("tone(slightly_over) = amber", hoursVarianceTone("slightly_over") === "amber");
  check("tone(under_estimate) = amber", hoursVarianceTone("under_estimate") === "amber");
  check("tone(over_estimate) = red", hoursVarianceTone("over_estimate") === "red");
  check("tone(no_estimate) = gray", hoursVarianceTone("no_estimate") === "gray");
}

console.log("\n== 2. Task 2/4 — parseWorkerEstimates mirror: malformed input degrades to {} without throwing ==");
{
  check("Well-formed JSON parses correctly", JSON.stringify(parseWorkerEstimatesMirror('{"w1":2,"w2":3.5}')) === JSON.stringify({ w1: 2, w2: 3.5 }));
  check("Missing field (undefined) -> {}", JSON.stringify(parseWorkerEstimatesMirror(undefined)) === "{}");
  check("Empty string -> {}", JSON.stringify(parseWorkerEstimatesMirror("")) === "{}");
  check("Garbled JSON -> {} (never throws)", JSON.stringify(parseWorkerEstimatesMirror("{not json")) === "{}");
  check("JSON array (wrong shape) -> {}", JSON.stringify(parseWorkerEstimatesMirror("[1,2,3]")) === "{}");
  check("Negative worker estimate is dropped, not clamped/thrown", JSON.stringify(parseWorkerEstimatesMirror('{"w1":-2,"w2":3}')) === JSON.stringify({ w2: 3 }));
  check("Non-numeric value is dropped", JSON.stringify(parseWorkerEstimatesMirror('{"w1":"abc","w2":1}')) === JSON.stringify({ w2: 1 }));
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G13 verify script";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    console.log("\n== 3. Task 14 — existing (pre-unit) Job Card semantics: no estimate given -> reads back NULL ==");
    const legacyWo = await tx.work_orders.create({
      data: {
        ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
        status: "Created", asset_id: asset.id, created_by: user.id,
        operator_complaint: "Legacy Job Card, no estimate set.",
      },
      select: { id: true, estimated_labor_hours: true },
    });
    check("A newly created Job Card with no estimated_labor_hours given reads back null (additive, nullable)", legacyWo.estimated_labor_hours === null);

    console.log("\n== 4. Task 1/14 — work_orders.estimated_labor_hours round-trips through Prisma ==");
    const estimatedWo = await tx.work_orders.create({
      data: {
        ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
        status: "Created", asset_id: asset.id, created_by: user.id,
        operator_complaint: "Job Card with a 4.25h estimate.",
        estimated_labor_hours: new Prisma.Decimal("4.25"),
      },
      select: { id: true, estimated_labor_hours: true },
    });
    check("estimated_labor_hours persists as 4.25", estimatedWo.estimated_labor_hours?.toNumber() === 4.25);

    console.log("\n== 5. Task 2/4/14 — work_order_worker_assignments.estimated_hours round-trips, independent per row ==");
    const worker = await tx.workerProfile.findFirst({ where: { is_active: true }, select: { id: true } });
    if (!worker) throw new Error("SKIP: expected an active WorkerProfile row");

    const assignmentWithEstimate = await tx.workOrderWorkerAssignment.create({
      data: {
        work_order_id: estimatedWo.id, worker_id: worker.id, worker_role: "technician",
        status: "assigned", hourly_rate_snapshot: new Prisma.Decimal("2.500"),
        estimated_hours: new Prisma.Decimal("2.00"),
      },
      select: { id: true, estimated_hours: true },
    });
    check("Worker assignment estimated_hours persists as 2", assignmentWithEstimate.estimated_hours?.toNumber() === 2);

    const assignmentNoEstimate = await tx.workOrderWorkerAssignment.create({
      data: {
        work_order_id: estimatedWo.id, worker_id: worker.id, worker_role: "helper",
        status: "assigned", hourly_rate_snapshot: new Prisma.Decimal("2.000"),
      },
      select: { id: true, estimated_hours: true },
    });
    check("A second row on the same Job Card with no estimate given stays independently null (per-worker, not shared)", assignmentNoEstimate.estimated_hours === null);

    console.log("\n== 6. Task 5/6/8 — variance computed from real round-tripped rows matches the shared classifier ==");
    {
      const estimated = estimatedWo.estimated_labor_hours.toNumber(); // 4.25
      const actualOnTrack = computeHoursVariance(estimated, 4);
      const actualOver = computeHoursVariance(estimated, 6);
      check("Actual 4h vs estimated 4.25h -> On Track", actualOnTrack.status === "on_track");
      check("Actual 6h vs estimated 4.25h (> 1.2x = 5.1h) -> Over Estimate", actualOver.status === "over_estimate");
    }

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
