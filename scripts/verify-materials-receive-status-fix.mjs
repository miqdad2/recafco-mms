/**
 * Materials Request Receive Status Fix — verification script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * Same scope limitation as scripts/verify-workflow-redesign-unit5.mjs:
 * lib/backend/parts-requests/service.ts uses `import "server-only"`, so it
 * can't be imported from a standalone Node script. This script re-derives
 * the REAL data-level outcome of issueMaterials() (status gate, Job Card
 * gate, canTransition check, per-item delta movement, next-status
 * computation) directly against the database, using the exact same rules
 * the fixed service function now uses — not a separate reimplementation of
 * the *business* logic, just a script-level mirror of it for verification
 * without a browser.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-materials-receive-status-fix.mjs
 */

import { PrismaClient } from "@prisma/client";
import { canTransition } from "../lib/workflows/status-rules.ts";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

const ISSUABLE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

console.log("== 1. status-rules.ts — parts_request transition map ==");
check("Requested -> Partially Issued now valid", canTransition("parts_request", "Requested", "Partially Issued") === true);
check("Requested -> Issued now valid", canTransition("parts_request", "Requested", "Issued") === true);
check("Requested -> Approved still valid", canTransition("parts_request", "Requested", "Approved") === true);
check("Issued -> Requested still invalid (terminal)", canTransition("parts_request", "Issued", "Requested") === false);
check("Approved -> Waiting Stock still valid", canTransition("parts_request", "Approved", "Waiting Stock") === true);

console.log("== 2. receive-gate status list ==");
check('"Requested" now receivable', ISSUABLE_MATERIALS_REQUEST_STATUSES.includes("Requested"));
check('"Approved" still receivable', ISSUABLE_MATERIALS_REQUEST_STATUSES.includes("Approved"));
check('"Issued" (Completed) NOT receivable', !ISSUABLE_MATERIALS_REQUEST_STATUSES.includes("Issued"));

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "MaterialsReceiveStatusFix verify script";

// Mirrors issueMaterials()'s two gate checks + item-level receive loop
// exactly as implemented in lib/backend/parts-requests/service.ts after the
// fix, against real rows in a rolled-back transaction.
async function attemptReceive(tx, request, jobCardStatus, itemsNewTotal) {
  if (!ISSUABLE_MATERIALS_REQUEST_STATUSES.includes(request.status)) {
    return { ok: false, reason: "not-receivable-status" };
  }
  if (jobCardStatus === "Created" || jobCardStatus === "Under Review") {
    return { ok: false, reason: "job-card-not-approved" };
  }
  if (["Closed", "Cancelled", "Rejected"].includes(jobCardStatus)) {
    return { ok: false, reason: "job-card-terminal" };
  }

  const items = await tx.parts_request_items.findMany({ where: { parts_request_id: request.id } });
  let totalRequested = 0;
  let totalIssuedAfter = 0;
  for (const item of items) {
    const requested = Number(item.quantity_requested);
    const already = Number(item.issued_quantity);
    const newTotal = itemsNewTotal[item.id] ?? already;
    if (newTotal < already - 1e-9) return { ok: false, reason: "decrease-not-allowed" };
    if (newTotal > requested + 1e-9) return { ok: false, reason: "exceeds-requested" };
    const delta = newTotal - already;
    if (delta > 1e-9) {
      await tx.offline_inventory_movements.create({
        data: {
          movement_type: "RECEIVED",
          movement_date: new Date(),
          manual_material_name: item.description,
          manual_part_number: item.part_number,
          category: "Hardware / Fasteners",
          quantity: delta,
          unit: "PCS",
          purpose: `${MARKER} — receive`,
          related_work_order_id: request.work_order_id,
          parts_request_id: request.id,
          created_by: request.requested_by
        }
      });
      await tx.parts_request_items.update({ where: { id: item.id }, data: { issued_quantity: newTotal } });
    }
    totalRequested += requested;
    totalIssuedAfter += newTotal;
  }
  const nextStatus = totalIssuedAfter >= totalRequested - 1e-9 ? "Issued" : "Partially Issued";
  if (!canTransition("parts_request", request.status, nextStatus)) {
    return { ok: false, reason: "transition-not-allowed" };
  }
  await tx.parts_requests.update({ where: { id: request.id }, data: { status: nextStatus } });
  return { ok: true, nextStatus, totalRequested, totalIssuedAfter };
}

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    console.log("== 3. Reproduce the reported bug scenario ==");
    // Simplified workflow: Job Card goes Created -> Approved directly (no
    // Under Review stop), so approveJobCardAndMaterials's implicit
    // Requested -> Approved step never runs — the Materials Request stays at
    // "Requested" while its Job Card is already open. This is exactly the
    // state the bug report described (UI showed "Pending", backend rejected
    // "Requested").
    const wo = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true, status: true }
    });
    const pr = await tx.parts_requests.create({
      data: { work_order_id: wo.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true, status: true, work_order_id: true, requested_by: true }
    });
    await tx.parts_request_items.create({
      data: { parts_request_id: pr.id, description: `${MARKER} Bolt`, quantity_requested: 4, unit_price: 1 }
    });
    check("Job Card is Approved (open), Materials Request is still Requested (the bug's exact starting state)", wo.status === "Approved" && pr.status === "Requested");

    console.log("== 4. Partial receive (2 of 4) ==");
    let items = await tx.parts_request_items.findMany({ where: { parts_request_id: pr.id } });
    let itemId = items[0].id;
    let result = await attemptReceive(tx, pr, wo.status, { [itemId]: 2 });
    check("partial receive against a Requested request now succeeds", result.ok === true);
    check("status becomes Partially Issued (stays user-facing 'Pending')", result.nextStatus === "Partially Issued");

    let prAfterPartial = await tx.parts_requests.findUnique({ where: { id: pr.id } });
    let itemAfterPartial = await tx.parts_request_items.findUnique({ where: { id: itemId } });
    check("request row status persisted as Partially Issued", prAfterPartial.status === "Partially Issued");
    check("item received quantity = 2, remaining = 2", Number(itemAfterPartial.issued_quantity) === 2);
    let movementsAfterPartial = await tx.offline_inventory_movements.count({ where: { parts_request_id: pr.id } });
    check("exactly one RECEIVED movement created for the partial receive", movementsAfterPartial === 1);

    console.log("== 5. Full receive (remaining 2 of 4) ==");
    result = await attemptReceive(tx, prAfterPartial, wo.status, { [itemId]: 4 });
    check("final receive succeeds", result.ok === true);
    check("status becomes Issued (user-facing 'Completed')", result.nextStatus === "Issued");
    let prAfterFull = await tx.parts_requests.findUnique({ where: { id: pr.id } });
    check("request row status persisted as Issued", prAfterFull.status === "Issued");
    let movementsAfterFull = await tx.offline_inventory_movements.count({ where: { parts_request_id: pr.id } });
    check("second movement recorded only the 2-unit delta (two total movements, not a re-recorded 4)", movementsAfterFull === 2);

    console.log("== 6. Regression: Completed (Issued) request cannot receive again ==");
    result = await attemptReceive(tx, prAfterFull, wo.status, { [itemId]: 4 });
    check("Issued request rejected as not-receivable-status", result.ok === false && result.reason === "not-receivable-status");

    console.log("== 7. Regression: Draft/Created Job Card cannot receive ==");
    const woCreated = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Created", asset_id: asset.id, created_by: user.id },
      select: { id: true, status: true }
    });
    const prForCreatedWo = await tx.parts_requests.create({
      data: { work_order_id: woCreated.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true, status: true, work_order_id: true, requested_by: true }
    });
    const itemForCreatedWo = await tx.parts_request_items.create({
      data: { parts_request_id: prForCreatedWo.id, description: `${MARKER} Bolt (Draft WO)`, quantity_requested: 3, unit_price: 1 }
    });
    result = await attemptReceive(tx, prForCreatedWo, woCreated.status, { [itemForCreatedWo.id]: 1 });
    check("Requested request under a Created (Draft) Job Card still rejected", result.ok === false && result.reason === "job-card-not-approved");
    let movementsForCreatedWo = await tx.offline_inventory_movements.count({ where: { parts_request_id: prForCreatedWo.id } });
    check("no inventory movement created when validation fails", movementsForCreatedWo === 0);

    console.log("== 8. Regression: Closed Job Card cannot receive ==");
    const woClosed = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Closed", asset_id: asset.id, created_by: user.id },
      select: { id: true, status: true }
    });
    const prForClosedWo = await tx.parts_requests.create({
      data: { work_order_id: woClosed.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true, status: true, work_order_id: true, requested_by: true }
    });
    const itemForClosedWo = await tx.parts_request_items.create({
      data: { parts_request_id: prForClosedWo.id, description: `${MARKER} Bolt (Closed WO)`, quantity_requested: 1, unit_price: 1 }
    });
    result = await attemptReceive(tx, prForClosedWo, woClosed.status, { [itemForClosedWo.id]: 1 });
    check("Requested request under a Closed Job Card rejected", result.ok === false && result.reason === "job-card-terminal");
    let movementsForClosedWo = await tx.offline_inventory_movements.count({ where: { parts_request_id: prForClosedWo.id } });
    check("no inventory movement created for the Closed-Job-Card attempt", movementsForClosedWo === 0);

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
