/**
 * Material Fulfillment Status and Inventory Reservation Clarity Fix Unit
 * 10F.3 — verification script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * Same scope limitation as scripts/verify-daily-activity-materials-modal-unit10d.mjs
 * and scripts/verify-materials-receive-status-fix.mjs: the real backend
 * functions (issueOfflineMaterialAction, syncPartsRequestStatusAfterFullIssueInTx,
 * materialsChipFor) either use `import "server-only"` or `@/`-aliased
 * imports, or live inside a "use client" page module, so they can't be
 * imported into a standalone Node script. This script instead:
 *   (a) re-derives the REAL data-level outcome of issuing/receiving by
 *       performing the same guarded Prisma operations those actions perform
 *       (balance check, movement insert, parts_request status transition),
 *       directly against the database, inside a rolled-back transaction, and
 *   (b) mirrors the pure derivation logic fixed in this unit (the corrected
 *       materialsChipFor priority order, and the new sync function's
 *       fulfillment-then-transition logic) so the exact Task 1/5 state ->
 *       label rules can be asserted directly.
 * lint/typecheck/build already confirm the real source files compile and
 * wire together correctly; this script confirms the underlying data math —
 * in particular, that a Job Card with fully-issued Required Materials but a
 * STILL-OPEN linked Materials Request (the reported bug's exact shape) now
 * reads "Materials Completed", never "Materials Pending".
 *
 * Usage:
 *   node --env-file=.env scripts/verify-material-fulfillment-status-fix-unit10f3.mjs
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

// ── Mirrors of lib/work-orders/material-fulfillment.ts's pure math (unchanged
// by this unit — confirms the fix did NOT touch this file's calculations) ──
function deriveStatus(issued_qty, remaining_qty, shortage_qty) {
  if (remaining_qty <= 1e-9) return "fulfilled";
  if (issued_qty > 1e-9) return "partial_issued";
  if (shortage_qty > 1e-9) return "shortage";
  return "ready";
}
function summarizeMaterialAvailability(fulfillment) {
  if (fulfillment.length === 0) return "none";
  const incomplete = fulfillment.filter((f) => f.remaining_qty > 1e-9);
  if (incomplete.length === 0) return "fulfilled";
  const allAvailable = incomplete.every((f) => f.available_now >= f.remaining_qty - 1e-9);
  if (allAvailable) return "issuable";
  const noneAvailable = incomplete.every((f) => f.available_now <= 1e-9);
  if (noneAvailable) return "shortage";
  return "partial";
}

// ── FIXED mirror of app/(dashboard)/maintenance/daily-activity/page.tsx's
// materialsChipFor (Task 1) — the only behavior change is the new
// "hasAnyRequiredPartsTracking && !materialsIncomplete" branch inserted
// before the openPartsRequests check. ──────────────────────────────────────
function materialsChipFor(hasAnyRequiredPartsTracking, hasAnyPartsRequests, materialsAvailability, openPartsRequests, materialsIncomplete) {
  if (!hasAnyPartsRequests && !hasAnyRequiredPartsTracking) return "No Materials";
  if (hasAnyRequiredPartsTracking && !materialsIncomplete) return "Materials Completed";
  if (materialsAvailability === "issuable") return "Ready to Issue";
  if (materialsAvailability === "partial") return "Partially Available";
  if (openPartsRequests > 0 || materialsIncomplete) return "Materials Pending";
  return "Materials Completed";
}
// The OLD (buggy) chip logic, kept only to prove the bug is real and that
// the fix changes the outcome for the exact reported shape.
function materialsChipForOldBuggyVersion(hasAnyRequiredPartsTracking, hasAnyPartsRequests, materialsAvailability, openPartsRequests, materialsIncomplete) {
  if (!hasAnyPartsRequests && !hasAnyRequiredPartsTracking) return "No Materials";
  if (materialsAvailability === "issuable") return "Ready to Issue";
  if (materialsAvailability === "partial") return "Partially Available";
  if (openPartsRequests > 0 || materialsIncomplete) return "Materials Pending";
  return "Materials Completed";
}

console.log("== 1. Pure derivation — the reported bug shape, before/after the fix ==");
{
  // Required 5 / Issued 5 / Remaining 0, but the linked Materials Request is
  // still "Requested" (openPartsRequests = 1) — exactly the reported bug.
  const buggyOld = materialsChipForOldBuggyVersion(true, true, "fulfilled", 1, false);
  check('Bug repro — OLD logic wrongly returns "Materials Pending" for this exact shape', buggyOld === "Materials Pending");
  const fixedNew = materialsChipFor(true, true, "fulfilled", 1, false);
  check('Task 1 fix — NEW logic returns "Materials Completed" for the same shape (stale open request no longer overrides)', fixedNew === "Materials Completed");
  // No required-parts tracking at all (request-only Job Card) — the fix must
  // NOT change this case; a lingering open request with nothing to measure
  // fulfillment against should still read Pending.
  const requestOnlyStillPending = materialsChipFor(false, true, "none", 1, false);
  check("Fix does not affect request-only Job Cards (no required-parts rows) — still Materials Pending while request is open", requestOnlyStillPending === "Materials Pending");
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10F3 verify script";
const ISSUABLE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

async function readBalance(tx, identity) {
  const movements = await tx.offline_inventory_movements.findMany({
    where: identity.part_id
      ? { part_id: identity.part_id, deleted_at: null }
      : { part_id: null, manual_material_name: { equals: identity.manual_material_name, mode: "insensitive" }, unit: { equals: identity.unit, mode: "insensitive" }, deleted_at: null },
    select: { movement_type: true, quantity: true },
  });
  let balance = 0;
  for (const m of movements) {
    const q = Number(m.quantity);
    if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") balance += q;
    else if (m.movement_type === "ISSUED") balance -= q;
  }
  return balance;
}
async function readIssuedToWorkOrder(tx, identity, workOrderId) {
  const movements = await tx.offline_inventory_movements.findMany({
    where: {
      ...(identity.part_id
        ? { part_id: identity.part_id }
        : { part_id: null, manual_material_name: { equals: identity.manual_material_name, mode: "insensitive" }, unit: { equals: identity.unit, mode: "insensitive" } }),
      movement_type: "ISSUED",
      related_work_order_id: workOrderId,
      deleted_at: null,
    },
    select: { quantity: true },
  });
  return movements.reduce((sum, m) => sum + Number(m.quantity), 0);
}
// Mirrors getMaterialFulfillmentForWorkOrder's exact per-row formulas (this
// unit added a comment there, Task 8, but changed no math).
async function fulfillmentFor(tx, requiredQty, identity, workOrderId) {
  const issued_qty = await readIssuedToWorkOrder(tx, identity, workOrderId);
  const remaining_qty = Math.max(requiredQty - issued_qty, 0);
  const available_now = Math.max(await readBalance(tx, identity), 0);
  const shortage_qty = Math.max(remaining_qty - available_now, 0);
  const status = deriveStatus(issued_qty, remaining_qty, shortage_qty);
  return { required_qty: requiredQty, issued_qty, remaining_qty, available_now, shortage_qty, status };
}
// Mirrors issueOfflineMaterialAction's core (balance check + ISSUED movement) — unchanged by this unit.
async function issueOffline(tx, identity, qty, workOrderId, actorId) {
  const balance = await readBalance(tx, identity);
  if (qty > balance) throw new Error("Issued quantity cannot be greater than current balance.");
  await tx.offline_inventory_movements.create({
    data: {
      movement_type: "ISSUED",
      movement_date: new Date(),
      part_id: identity.part_id ?? null,
      manual_material_name: identity.part_id ? null : identity.manual_material_name,
      unit: identity.unit,
      quantity: qty,
      counterparty: `${MARKER} — issue`,
      related_work_order_id: workOrderId,
      created_by: actorId,
    },
  });
}
// NEW — mirrors syncPartsRequestStatusAfterFullIssueInTx (lib/backend/parts-requests/service.ts) exactly.
async function syncPartsRequestStatusAfterFullIssue(tx, requiredQty, identity, workOrderId, actorId) {
  const f = await fulfillmentFor(tx, requiredQty, identity, workOrderId);
  if (f.remaining_qty > 1e-9) return { ran: false, reason: "materials-incomplete" };
  const active = await tx.parts_requests.findFirst({
    where: { work_order_id: workOrderId, status: { in: ISSUABLE_MATERIALS_REQUEST_STATUSES } },
    select: { id: true, status: true },
  });
  if (!active) return { ran: false, reason: "no-active-request" };
  if (!canTransition("parts_request", active.status, "Issued")) return { ran: false, reason: "illegal-transition" };
  await tx.parts_requests.update({ where: { id: active.id }, data: { status: "Issued", updated_by: actorId } });
  return { ran: true };
}

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    // ── Case A — stock already available, auto-created linked Materials
    // Request (exactly how upsertWorkOrderAction creates one for every new
    // Job Card with Required Parts, regardless of stock availability) ─────
    console.log("== 2. Case A: stock available at creation, auto-created linked Materials Request ==");
    const catalogPartA = await tx.parts.create({
      data: { part_code: `U10F3-A-${Date.now()}`, part_name: `${MARKER} Engine Filter`, unit_of_measure: "PCS", created_by: user.id },
      select: { id: true },
    });
    const woA = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: woA.id, part_id: catalogPartA.id, description: `${MARKER} Engine Filter`, quantity_required: 5, unit_of_measure: "PCS", created_by: user.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), part_id: catalogPartA.id, quantity: 10, unit: "PCS", created_by: user.id },
    });
    const prA = await tx.parts_requests.create({
      data: { work_order_id: woA.id, status: "Requested", requested_by: user.id, created_by: user.id, remarks: "Auto-created from the Job Card's Required Parts list at creation." },
      select: { id: true, status: true },
    });
    await tx.parts_request_items.create({ data: { parts_request_id: prA.id, description: `${MARKER} Engine Filter`, quantity_requested: 5, unit_price: 1 } });

    const identityA = { part_id: catalogPartA.id, unit: "PCS" };
    let fA = await fulfillmentFor(tx, 5, identityA, woA.id);
    let openA = await tx.parts_requests.count({ where: { work_order_id: woA.id, status: { notIn: ["Closed", "Cancelled", "Issued"] } } });
    check("Step 3/4 — required=5, available=10 -> status ready, remaining=5", fA.status === "ready" && fA.available_now === 10 && fA.remaining_qty === 5);
    let chipA = materialsChipFor(true, true, summarizeMaterialAvailability([fA]), openA, fA.remaining_qty > 0);
    check("Step 4 — chip is Ready to Issue (not Materials Pending)", chipA === "Ready to Issue");

    await issueOffline(tx, identityA, 5, woA.id, user.id);
    fA = await fulfillmentFor(tx, 5, identityA, woA.id);
    check("Step 6/7 — Offline Inventory balance becomes 5 after issuing 5 of 10", fA.available_now === 5);
    check("Step 8 — Required 5 / Issued 5 / Remaining 0", fA.required_qty === 5 && fA.issued_qty === 5 && fA.remaining_qty === 0);

    const syncResultA = await syncPartsRequestStatusAfterFullIssue(tx, 5, identityA, woA.id, user.id);
    check("Task 5 — sync ran and transitioned the linked Materials Request", syncResultA.ran === true);
    const prAAfter = await tx.parts_requests.findUnique({ where: { id: prA.id }, select: { status: true } });
    check('Task 5 — linked Materials Request status is now "Issued" (user-facing "Completed")', prAAfter.status === "Issued");

    openA = await tx.parts_requests.count({ where: { work_order_id: woA.id, status: { notIn: ["Closed", "Cancelled", "Issued"] } } });
    check("Step 9 — openPartsRequests is now 0", openA === 0);
    chipA = materialsChipFor(true, true, summarizeMaterialAvailability([fA]), openA, fA.remaining_qty > 0);
    check("Step 8/9 — chip is Materials Completed", chipA === "Materials Completed");
    check("Step 9 — Receive Materials is not offered (chip is not Materials Pending)", chipA !== "Materials Pending");

    const pendingMaterialsRequestsCountA = await tx.parts_requests.count({ where: { work_order_id: woA.id, status: { not: "Issued" } } });
    const closureReadyA = pendingMaterialsRequestsCountA === 0 && fA.remaining_qty <= 1e-9;
    check("Step 10 — closure-readiness mirror (pendingMaterialsRequestsCount===0 && !materialsIncomplete) is now true, without weakening the guard", closureReadyA);

    // ── Case B — no stock at all, must Receive before Issue ───────────────
    console.log("== 3. Case B: no stock -> Receive -> Ready to Issue -> Issue -> Materials Completed ==");
    const woB = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: woB.id, description: `${MARKER} Brake Pad`, quantity_required: 3, unit_of_measure: "PCS", created_by: user.id },
    });
    const prB = await tx.parts_requests.create({
      data: { work_order_id: woB.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true, status: true },
    });
    const prBItem = await tx.parts_request_items.create({ data: { parts_request_id: prB.id, description: `${MARKER} Brake Pad`, quantity_requested: 3, unit_price: 1 } });

    const identityB = { part_id: null, manual_material_name: `${MARKER} Brake Pad`, unit: "PCS" };
    let fB = await fulfillmentFor(tx, 3, identityB, woB.id);
    let openB = await tx.parts_requests.count({ where: { work_order_id: woB.id, status: { notIn: ["Closed", "Cancelled", "Issued"] } } });
    let chipB = materialsChipFor(true, true, summarizeMaterialAvailability([fB]), openB, fB.remaining_qty > 0);
    check("Step 2 — status Materials Pending (no stock at all)", chipB === "Materials Pending");

    // Mirrors issueMaterials()'s RECEIVED-side effect (absolute new total, not delta).
    await tx.offline_inventory_movements.create({
      data: { movement_type: "RECEIVED", movement_date: new Date(), manual_material_name: identityB.manual_material_name, unit: "PCS", quantity: 3, related_work_order_id: woB.id, parts_request_id: prB.id, created_by: user.id },
    });
    await tx.parts_request_items.update({ where: { id: prBItem.id }, data: { issued_quantity: 3, stock_availability: "Available" } });
    await tx.parts_requests.update({ where: { id: prB.id }, data: { status: "Issued" } }); // totalIssuedAfter(3) >= totalRequested(3)

    fB = await fulfillmentFor(tx, 3, identityB, woB.id);
    openB = await tx.parts_requests.count({ where: { work_order_id: woB.id, status: { notIn: ["Closed", "Cancelled", "Issued"] } } });
    chipB = materialsChipFor(true, true, summarizeMaterialAvailability([fB]), openB, fB.remaining_qty > 0);
    check("Step 5 — after receiving, status changes to Ready to Issue", chipB === "Ready to Issue");

    await issueOffline(tx, identityB, 3, woB.id, user.id);
    fB = await fulfillmentFor(tx, 3, identityB, woB.id);
    const syncResultB = await syncPartsRequestStatusAfterFullIssue(tx, 3, identityB, woB.id, user.id);
    check("Sync is a safe no-op — request was already Issued by the receive flow (no illegal/duplicate transition attempted)", syncResultB.ran === false && syncResultB.reason === "no-active-request");
    openB = await tx.parts_requests.count({ where: { work_order_id: woB.id, status: { notIn: ["Closed", "Cancelled", "Issued"] } } });
    chipB = materialsChipFor(true, true, summarizeMaterialAvailability([fB]), openB, fB.remaining_qty > 0);
    check("Step 7 — Materials Completed", chipB === "Materials Completed" && fB.remaining_qty === 0);

    // ── Case C — partial stock; the sync must NOT fire early, and must
    // still resolve correctly even when the request's own item-level
    // receive bookkeeping alone would only justify "Partially Issued" ─────
    console.log("== 4. Case C: partial stock (required 5, available 2) ==");
    const catalogPartC = await tx.parts.create({
      data: { part_code: `U10F3-C-${Date.now()}`, part_name: `${MARKER} Belt`, unit_of_measure: "PCS", created_by: user.id },
      select: { id: true },
    });
    const woC = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: woC.id, part_id: catalogPartC.id, description: `${MARKER} Belt`, quantity_required: 5, unit_of_measure: "PCS", created_by: user.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), part_id: catalogPartC.id, quantity: 2, unit: "PCS", created_by: user.id },
    });
    const prC = await tx.parts_requests.create({
      data: { work_order_id: woC.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true, status: true },
    });
    const prCItem = await tx.parts_request_items.create({ data: { parts_request_id: prC.id, description: `${MARKER} Belt`, quantity_requested: 5, unit_price: 1 } });

    const identityC = { part_id: catalogPartC.id, unit: "PCS" };
    let fC = await fulfillmentFor(tx, 5, identityC, woC.id);
    check("Step 1 — required=5, available=2", fC.available_now === 2 && fC.remaining_qty === 5);
    let openC = await tx.parts_requests.count({ where: { work_order_id: woC.id, status: { notIn: ["Closed", "Cancelled", "Issued"] } } });
    let chipC = materialsChipFor(true, true, summarizeMaterialAvailability([fC]), openC, fC.remaining_qty > 0);
    check("Step 2 — Partially Available", chipC === "Partially Available");

    const issueAvailQty = Math.min(fC.remaining_qty, fC.available_now);
    check("Issue Available default quantity = min(remaining, available) = 2", issueAvailQty === 2);
    await issueOffline(tx, identityC, issueAvailQty, woC.id, user.id);
    fC = await fulfillmentFor(tx, 5, identityC, woC.id);
    check("Step 4 — remaining now 3", fC.remaining_qty === 3);

    const syncResultC1 = await syncPartsRequestStatusAfterFullIssue(tx, 5, identityC, woC.id, user.id);
    check("Sync correctly refuses to close out the request early — 3 still remaining", syncResultC1.ran === false && syncResultC1.reason === "materials-incomplete");
    const prCMid = await tx.parts_requests.findUnique({ where: { id: prC.id }, select: { status: true } });
    check('Request is still "Requested" — not prematurely marked Issued', prCMid.status === "Requested");

    // Receive Shortage — only the 3 that actually came through the receive
    // flow are ever recorded as "received" on the item (the other 2 came
    // from pre-existing opening stock, never received against this
    // request) — this deliberately makes the item's own receive math say
    // 3-of-5, i.e. "Partially Issued", to prove the sync looks at the JOB
    // CARD's real fulfillment, not just the request's own item totals.
    await tx.offline_inventory_movements.create({
      data: { movement_type: "RECEIVED", movement_date: new Date(), part_id: catalogPartC.id, unit: "PCS", quantity: 3, related_work_order_id: woC.id, parts_request_id: prC.id, created_by: user.id },
    });
    await tx.parts_request_items.update({ where: { id: prCItem.id }, data: { issued_quantity: 3, stock_availability: "Partial" } });
    await tx.parts_requests.update({ where: { id: prC.id }, data: { status: "Partially Issued" } }); // totalIssuedAfter(3) < totalRequested(5)

    fC = await fulfillmentFor(tx, 5, identityC, woC.id);
    openC = await tx.parts_requests.count({ where: { work_order_id: woC.id, status: { notIn: ["Closed", "Cancelled", "Issued"] } } });
    chipC = materialsChipFor(true, true, summarizeMaterialAvailability([fC]), openC, fC.remaining_qty > 0);
    check("Step 5/6 — after Receive Shortage, chip is Ready to Issue (available=3, remaining=3)", chipC === "Ready to Issue" && fC.available_now === 3);

    await issueOffline(tx, identityC, 3, woC.id, user.id);
    fC = await fulfillmentFor(tx, 5, identityC, woC.id);
    check("Step 7 pre-check — Required 5 / Issued 5 / Remaining 0", fC.required_qty === 5 && fC.issued_qty === 5 && fC.remaining_qty === 0);

    const syncResultC2 = await syncPartsRequestStatusAfterFullIssue(tx, 5, identityC, woC.id, user.id);
    check("Task 5 — sync now transitions Partially Issued -> Issued directly (legal transition, no requested/issued shown to user)", syncResultC2.ran === true);
    const prCAfter = await tx.parts_requests.findUnique({ where: { id: prC.id }, select: { status: true } });
    check('Request is now "Issued" even though its own item receive total (3) never matched quantity_requested (5)', prCAfter.status === "Issued");
    openC = await tx.parts_requests.count({ where: { work_order_id: woC.id, status: { notIn: ["Closed", "Cancelled", "Issued"] } } });
    chipC = materialsChipFor(true, true, summarizeMaterialAvailability([fC]), openC, fC.remaining_qty > 0);
    check("Step 7 — Materials Completed", chipC === "Materials Completed");

    // ── Regressions ─────────────────────────────────────────────────────
    console.log("== 5. Regressions ==");
    check("Completed material never reads Materials Pending (Case A)", chipA !== "Materials Pending");
    check("Completed material never reads Materials Pending (Case B)", chipB !== "Materials Pending");
    check("Completed material never reads Materials Pending (Case C)", chipC !== "Materials Pending");

    let movementCountBeforeFailedIssue = await tx.offline_inventory_movements.count({ where: { related_work_order_id: woA.id } });
    let threw = false;
    try {
      await issueOffline(tx, identityA, 999, woA.id, user.id); // far more than the 5 remaining balance
    } catch {
      threw = true;
    }
    let movementCountAfterFailedIssue = await tx.offline_inventory_movements.count({ where: { related_work_order_id: woA.id } });
    check("Over-issue attempt rejected", threw);
    check("No duplicate/extra inventory movement created on failed issue attempt", movementCountBeforeFailedIssue === movementCountAfterFailedIssue);

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
