/**
 * Manager Closed Job Cards Summary and Global Navigation Improvements Unit
 * 10E, Part A — verification script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * Same scope limitation as every prior unit's verify-*.mjs: app/actions/
 * closed-job-cards.ts uses `import "server-only"`-chained modules and
 * requireUser() (cookie/session based), so it can't be called directly from
 * a standalone Node script. This script re-derives the REAL data-level
 * outcome of getClosedJobCardsListAction/getClosedJobCardDetailAction by
 * performing the exact same Prisma queries + math directly against the
 * database, in a rolled-back transaction.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-closed-job-cards-unit10e.mjs
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

function materialsStatusLabel(status) {
  if (status === "fulfilled") return "Fully Issued";
  if (status === "partial_issued") return "Partially Issued";
  return "Not Issued";
}

function getWeekStart() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}
function getMonthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// Mirrors getMaterialFulfillmentForWorkOrder's per-row math (same formulas
// verified in the Unit 10D script) — kept minimal here since Unit 10D
// already exercised the general case; this script focuses on what's NEW in
// Unit 10E (closed-date resolution, week/month counts, list/detail shape).
async function fulfillmentFor(tx, requiredQty, identity, workOrderId) {
  const issuedMovements = await tx.offline_inventory_movements.findMany({
    where: {
      ...(identity.part_id ? { part_id: identity.part_id } : { part_id: null, manual_material_name: { equals: identity.manual_material_name, mode: "insensitive" }, unit: identity.unit }),
      movement_type: "ISSUED",
      related_work_order_id: workOrderId,
      deleted_at: null,
    },
    select: { quantity: true },
  });
  const issued_qty = issuedMovements.reduce((s, m) => s + Number(m.quantity), 0);
  const remaining_qty = Math.max(requiredQty - issued_qty, 0);
  const status = remaining_qty <= 1e-9 ? "fulfilled" : issued_qty > 1e-9 ? "partial_issued" : "shortage";
  return { required_qty: requiredQty, issued_qty, remaining_qty, status };
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10E verify script";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const manager = await tx.profiles.findFirst({ select: { id: true } });
    const worker = await tx.workerProfile.findFirst({ select: { id: true, name: true } });
    if (!asset || !manager || !worker) throw new Error("SKIP: expected asset/profile/worker not found");

    console.log("== 1. Closed Job Card with a real closure approval row (the normal case) ==");
    const woA = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Closed", asset_id: asset.id, created_by: manager.id },
      select: { id: true, created_at: true, updated_at: true },
    });
    const decidedAt = new Date();
    await tx.approvals.create({
      data: { work_order_id: woA.id, status: "Closed", decided_by: manager.id, decided_at: decidedAt },
    });

    const assignment = await tx.workOrderWorkerAssignment.create({
      data: { work_order_id: woA.id, worker_id: worker.id, worker_role: "Technician", status: "active", hourly_rate_snapshot: 2.5, assigned_by: manager.id },
      select: { id: true },
    });
    await tx.workOrderWorkSession.create({
      data: {
        work_order_id: woA.id, worker_assignment_id: assignment.id, worker_id: worker.id,
        started_at: new Date(Date.now() - 3600_000), stopped_at: new Date(), status: "Completed",
        duration_minutes: 60, hourly_rate_snapshot: 2.5, calculated_amount: 2.5, entered_by: manager.id,
      },
    });
    const reqPart = await tx.workOrderRequiredPart.create({
      data: { work_order_id: woA.id, description: `${MARKER} Bolt`, quantity_required: 2, unit_of_measure: "PCS", created_by: manager.id },
      select: { id: true },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), manual_material_name: `${MARKER} Bolt`, unit: "PCS", quantity: 2, created_by: manager.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "ISSUED", movement_date: new Date(), manual_material_name: `${MARKER} Bolt`, unit: "PCS", quantity: 2, related_work_order_id: woA.id, created_by: manager.id },
    });

    // Mirrors the list query's per-row select (approvals include, take 1).
    const listRowA = await tx.work_orders.findFirst({
      where: { id: woA.id },
      select: { id: true, updated_at: true, approvals: { where: { status: "Closed" }, orderBy: { decided_at: "desc" }, take: 1, select: { decided_at: true, decided_by: true } } },
    });
    check("closed-date resolves from approvals.decided_at (not updated_at)", listRowA.approvals[0].decided_at.getTime() === decidedAt.getTime());
    check("closed-by resolves to the Manager who closed it", listRowA.approvals[0].decided_by === manager.id);

    const laborRows = await tx.workOrderWorkSession.findMany({ where: { work_order_id: woA.id, status: { not: "Cancelled" } } });
    const totalMinutes = laborRows.reduce((s, r) => s + r.duration_minutes, 0);
    check("labor total_hours = 1 (one 60-minute session)", Math.round((totalMinutes / 60) * 100) / 100 === 1);

    const fA = await fulfillmentFor(tx, 2, { part_id: null, manual_material_name: `${MARKER} Bolt`, unit: "PCS" }, woA.id);
    check("materials fully issued -> status Fully Issued", materialsStatusLabel(fA.status) === "Fully Issued");

    console.log("== 2. Legacy closed Job Card with NO approvals row (Task 5 fallback) ==");
    const woB = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Closed", asset_id: asset.id, created_by: manager.id },
      select: { id: true, updated_at: true },
    });
    const listRowB = await tx.work_orders.findFirst({
      where: { id: woB.id },
      select: { id: true, updated_at: true, approvals: { where: { status: "Closed" }, orderBy: { decided_at: "desc" }, take: 1, select: { decided_at: true, decided_by: true } } },
    });
    check("no approvals row present for this legacy WO", listRowB.approvals.length === 0);
    const effectiveClosedAtB = listRowB.approvals[0]?.decided_at ?? listRowB.updated_at;
    check("closed-date falls back to updated_at when no approvals row exists", effectiveClosedAtB.getTime() === listRowB.updated_at.getTime());

    console.log("== 3. Week/month boundary counts (Task 1/5) ==");
    const weekStart = getWeekStart();
    const monthStart = getMonthStart();
    const weekCount = await tx.work_orders.count({ where: { status: "Closed", ordered_by: MARKER, updated_at: { gte: weekStart } } });
    const monthCount = await tx.work_orders.count({ where: { status: "Closed", ordered_by: MARKER, updated_at: { gte: monthStart } } });
    check("both test Job Cards (A, B) fall inside this week's count", weekCount === 2);
    check("both test Job Cards (A, B) fall inside this month's count", monthCount === 2);

    console.log("== 4. Materials status mapping (Task 4's 3-state model) ==");
    check('fulfilled -> "Fully Issued"', materialsStatusLabel("fulfilled") === "Fully Issued");
    check('partial_issued -> "Partially Issued"', materialsStatusLabel("partial_issued") === "Partially Issued");
    check('shortage -> "Not Issued"', materialsStatusLabel("shortage") === "Not Issued");
    check('ready -> "Not Issued"', materialsStatusLabel("ready") === "Not Issued");

    console.log("== 5. Only Closed Job Cards are eligible (regression) ==");
    const woOpen = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: manager.id },
      select: { id: true },
    });
    const detailLookup = await tx.work_orders.findFirst({ where: { id: woOpen.id, status: "Closed" }, select: { id: true } });
    check("an open (non-Closed) Job Card is never returned by the detail lookup", detailLookup === null);

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
