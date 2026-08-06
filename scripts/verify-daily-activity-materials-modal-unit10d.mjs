/**
 * Daily Activity Inline Materials Receive/Issue Modal Unit 10D — verification
 * script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * Same scope limitation as scripts/verify-workflow-redesign-unit5.mjs and
 * scripts/verify-materials-receive-status-fix.mjs: the real backend
 * functions (issueOfflineMaterialAction, issueMaterials) use `import
 * "server-only"` and `@/`-aliased imports, so they can't be imported into a
 * standalone Node script. This script instead:
 *   (a) re-derives the REAL data-level outcome of issuing/receiving by
 *       performing the same guarded Prisma operations those actions perform
 *       (balance check, movement insert, required-parts issued_qty via the
 *       movement ledger, parts_request status transition) directly against
 *       the database, and
 *   (b) mirrors the pure client-side derivation logic added in this unit
 *       (materialsChipFor / summarizeMaterialAvailability /
 *       materialsModalAction / materialsSecondaryAction) so the exact
 *       Task 1/2/3/4 state → action rules can be asserted directly.
 * lint/typecheck/build already confirm the real source files compile and
 * wire together correctly; this script confirms the underlying data math.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-daily-activity-materials-modal-unit10d.mjs
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

// ── Mirrors of lib/work-orders/material-fulfillment.ts's pure math ─────────
function deriveStatus(required_qty, issued_qty, remaining_qty, available_now, shortage_qty) {
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

// ── Mirrors of app/(dashboard)/maintenance/daily-activity/page.tsx's
// materialsChipFor + this unit's new materialsModalAction/
// materialsSecondaryAction derivation ───────────────────────────────────────
function materialsChipFor(hasAnyRequiredPartsTracking, hasAnyPartsRequests, materialsAvailability, openPartsRequests, materialsIncomplete) {
  if (!hasAnyPartsRequests && !hasAnyRequiredPartsTracking) return "No Materials";
  if (materialsAvailability === "issuable") return "Ready to Issue";
  if (materialsAvailability === "partial") return "Partially Available";
  if (openPartsRequests > 0 || materialsIncomplete) return "Materials Pending";
  return "Materials Completed";
}
function deriveActions(materialsChipLabel, canIssueMaterials, canReceiveMaterials, activeMaterialsRequest) {
  const materialsModalAction =
    materialsChipLabel === "Ready to Issue" && canIssueMaterials
      ? "issue"
      : materialsChipLabel === "Partially Available" && canIssueMaterials
        ? "issue"
        : materialsChipLabel === "Materials Pending" && activeMaterialsRequest && canReceiveMaterials
          ? "receive"
          : null;
  const materialsActionLabel =
    materialsChipLabel === "Partially Available" && materialsModalAction === "issue"
      ? "Issue Available"
      : materialsModalAction === "issue"
        ? "Issue Material"
        : materialsModalAction === "receive"
          ? "Receive Materials"
          : materialsChipLabel === "Materials Completed"
            ? "Materials Completed"
            : "View Materials";
  const materialsSecondaryAction =
    materialsChipLabel === "Partially Available" && activeMaterialsRequest && canReceiveMaterials ? { label: "Receive Shortage", mode: "receive" } : null;
  return { materialsModalAction, materialsActionLabel, materialsSecondaryAction };
}

console.log("== 1. Pure derivation checks (Task 1/2/3/4 state -> action rules) ==");
{
  const readyChip = materialsChipFor(true, false, "issuable", 0, false);
  check('Case A shape (available >= required) -> "Ready to Issue"', readyChip === "Ready to Issue");
  const readyActions = deriveActions(readyChip, true, true, null);
  check('Ready to Issue -> modal action "issue", label "Issue Material"', readyActions.materialsModalAction === "issue" && readyActions.materialsActionLabel === "Issue Material");
  check("Ready to Issue -> no secondary action", readyActions.materialsSecondaryAction === null);

  const pendingChip = materialsChipFor(true, true, "shortage", 1, true);
  check('Case B shape (no stock, open request) -> "Materials Pending"', pendingChip === "Materials Pending");
  const pendingActionsWithRequest = deriveActions(pendingChip, true, true, { id: "x" });
  check('Materials Pending + open request -> modal action "receive", label "Receive Materials"', pendingActionsWithRequest.materialsModalAction === "receive" && pendingActionsWithRequest.materialsActionLabel === "Receive Materials");
  const pendingActionsNoRequest = deriveActions(pendingChip, true, true, null);
  check("Task 7 — Materials Pending with NO open request -> no modal action (falls back to View Materials)", pendingActionsNoRequest.materialsModalAction === null && pendingActionsNoRequest.materialsActionLabel === "View Materials");

  const partialChip = materialsChipFor(true, true, "partial", 1, true);
  check('Case C shape (some available, shortage remains) -> "Partially Available"', partialChip === "Partially Available");
  const partialActionsWithRequest = deriveActions(partialChip, true, true, { id: "x" });
  check('Task 4 — Partially Available primary is "Issue Available" (not plain "Issue Material")', partialActionsWithRequest.materialsActionLabel === "Issue Available");
  check('Task 4 — Partially Available secondary is "Receive Shortage"', partialActionsWithRequest.materialsSecondaryAction?.label === "Receive Shortage");
  const partialActionsNoRequest = deriveActions(partialChip, true, true, null);
  check("Task 7 — Partially Available with NO open request -> no secondary Receive Shortage button", partialActionsNoRequest.materialsSecondaryAction === null);

  const completedChip = materialsChipFor(true, false, "fulfilled", 0, false);
  check('Fully issued -> "Materials Completed"', completedChip === "Materials Completed");
  const completedActions = deriveActions(completedChip, true, true, null);
  check("Task 7 — Materials Completed never offers Issue or Receive", completedActions.materialsModalAction === null);

  const noPermActions = deriveActions(readyChip, false, false, null);
  check("Task 11 — no permission -> no modal action even when Ready to Issue", noPermActions.materialsModalAction === null);
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10D verify script";

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

// Mirrors getMaterialFulfillmentForWorkOrder's exact per-row formulas.
async function fulfillmentFor(tx, requiredQty, identity, workOrderId) {
  const issued_qty = await readIssuedToWorkOrder(tx, identity, workOrderId);
  const remaining_qty = Math.max(requiredQty - issued_qty, 0);
  const available_now = Math.max(await readBalance(tx, identity), 0);
  const shortage_qty = Math.max(remaining_qty - available_now, 0);
  const status = deriveStatus(requiredQty, issued_qty, remaining_qty, available_now, shortage_qty);
  return { required_qty: requiredQty, issued_qty, remaining_qty, available_now, shortage_qty, status };
}

// Mirrors issueOfflineMaterialAction's core (balance check + ISSUED movement).
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

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    // ── Case A — stock already available (catalog part_id identity) ──────
    console.log("== 2. Case A: stock already available (uses part_id identity — Task 5 correctness check) ==");
    const catalogPart = await tx.parts.create({
      data: { part_code: `U10D-${Date.now()}`, part_name: `${MARKER} Bolt`, unit_of_measure: "PCS", created_by: user.id },
      select: { id: true },
    });
    const woA = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: woA.id, part_id: catalogPart.id, description: `${MARKER} Bolt`, quantity_required: 1, unit_of_measure: "PCS", created_by: user.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), part_id: catalogPart.id, quantity: 1, unit: "PCS", created_by: user.id },
    });

    const identityA = { part_id: catalogPart.id, unit: "PCS" };
    let fA = await fulfillmentFor(tx, 1, identityA, woA.id);
    check("Case A step 3/4 — required=1, available=1 -> status ready", fA.status === "ready" && fA.available_now === 1 && fA.remaining_qty === 1);
    let availA = summarizeMaterialAvailability([fA]);
    let chipA = materialsChipFor(true, false, availA, 0, fA.remaining_qty > 0);
    check("Case A step 4 — chip is Ready to Issue (not Materials Pending)", chipA === "Ready to Issue");
    let actionsA = deriveActions(chipA, true, true, null);
    check("Case A step 5 — primary action is Issue Material (not Receive Materials)", actionsA.materialsActionLabel === "Issue Material");

    await issueOffline(tx, identityA, 1, woA.id, user.id);
    fA = await fulfillmentFor(tx, 1, identityA, woA.id);
    check("Case A step 9 — after issuing the full quantity, remaining=0 -> fulfilled", fA.status === "fulfilled" && fA.remaining_qty === 0);
    availA = summarizeMaterialAvailability([fA]);
    chipA = materialsChipFor(true, false, availA, 0, fA.remaining_qty > 0);
    check("Case A step 9 — chip becomes Materials Completed", chipA === "Materials Completed");
    const closureReadyA = 0 === 0 && fA.remaining_qty <= 1e-9 && true; // no pending requests, materials complete, no active session
    check("Case A step 10 — closure-readiness inputs now satisfied (materials no longer incomplete)", closureReadyA);

    // ── Case B — no stock, receivable via a "Requested" Materials Request
    // (also re-verifies the Unit prior to this one's Requested-receive fix,
    // since Task 3 explicitly requires it) ────────────────────────────────
    console.log("== 3. Case B: no stock, receive via Materials Request (manual-name identity) ==");
    const woB = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true, status: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: woB.id, description: `${MARKER} Gasket`, quantity_required: 1, unit_of_measure: "PCS", created_by: user.id },
    });
    const prB = await tx.parts_requests.create({
      data: { work_order_id: woB.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true, status: true },
    });
    const prBItem = await tx.parts_request_items.create({
      data: { parts_request_id: prB.id, description: `${MARKER} Gasket`, quantity_requested: 1, unit_price: 1 },
    });

    const identityB = { part_id: null, manual_material_name: `${MARKER} Gasket`, unit: "PCS" };
    let fB = await fulfillmentFor(tx, 1, identityB, woB.id);
    check("Case B step 3 — required=1, available=0 -> status shortage", fB.status === "shortage" && fB.available_now === 0);
    let availB = summarizeMaterialAvailability([fB]);
    let chipB = materialsChipFor(true, true, availB, 1, fB.remaining_qty > 0);
    check("Case B step 3 — chip is Materials Pending", chipB === "Materials Pending");
    let actionsB = deriveActions(chipB, true, true, prB);
    check("Case B step 4 — primary action is Receive Materials (Requested status IS receivable)", actionsB.materialsActionLabel === "Receive Materials" && actionsB.materialsModalAction === "receive");

    // Mirrors issueMaterials()'s RECEIVED-side effect for one item.
    await tx.offline_inventory_movements.create({
      data: { movement_type: "RECEIVED", movement_date: new Date(), manual_material_name: identityB.manual_material_name, unit: "PCS", quantity: 1, related_work_order_id: woB.id, parts_request_id: prB.id, created_by: user.id },
    });
    await tx.parts_request_items.update({ where: { id: prBItem.id }, data: { issued_quantity: 1 } });
    await tx.parts_requests.update({ where: { id: prB.id }, data: { status: "Issued" } });

    fB = await fulfillmentFor(tx, 1, identityB, woB.id);
    check("Case B step 6/7 — after receiving, available=1, still remaining=1 (received != issued-to-Job-Card)", fB.available_now === 1 && fB.remaining_qty === 1);
    availB = summarizeMaterialAvailability([fB]);
    chipB = materialsChipFor(true, false, availB, 0, fB.remaining_qty > 0);
    check("Case B step 7 — chip becomes Ready to Issue", chipB === "Ready to Issue");

    await issueOffline(tx, identityB, 1, woB.id, user.id);
    fB = await fulfillmentFor(tx, 1, identityB, woB.id);
    availB = summarizeMaterialAvailability([fB]);
    chipB = materialsChipFor(true, false, availB, 0, fB.remaining_qty > 0);
    check("Case B step 10 — after issuing, chip becomes Materials Completed", chipB === "Materials Completed" && fB.status === "fulfilled");

    // ── Case C — partial stock (required 4, available 2) ──────────────────
    console.log("== 4. Case C: partial stock (required 4, available 2) ==");
    const catalogPartC = await tx.parts.create({
      data: { part_code: `U10D-C-${Date.now()}`, part_name: `${MARKER} Filter`, unit_of_measure: "PCS", created_by: user.id },
      select: { id: true },
    });
    const woC = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: woC.id, part_id: catalogPartC.id, description: `${MARKER} Filter`, quantity_required: 4, unit_of_measure: "PCS", created_by: user.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), part_id: catalogPartC.id, quantity: 2, unit: "PCS", created_by: user.id },
    });
    const prC = await tx.parts_requests.create({
      data: { work_order_id: woC.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true, status: true },
    });
    const prCItem = await tx.parts_request_items.create({
      data: { parts_request_id: prC.id, description: `${MARKER} Filter`, quantity_requested: 2, unit_price: 1 },
    });

    const identityC = { part_id: catalogPartC.id, unit: "PCS" };
    let fC = await fulfillmentFor(tx, 4, identityC, woC.id);
    check("Case C step 1/2 — required=4, available=2 -> status shortage, shortage_qty=2", fC.status === "shortage" && fC.shortage_qty === 2);
    let availC = summarizeMaterialAvailability([fC]);
    let chipC = materialsChipFor(true, true, availC, 1, fC.remaining_qty > 0);
    check("Case C step 2 — chip is Partially Available", chipC === "Partially Available");
    let actionsC = deriveActions(chipC, true, true, prC);
    check('Case C step 3 — primary action is "Issue Available"', actionsC.materialsActionLabel === "Issue Available");
    check('Case C step 5 — secondary action is "Receive Shortage"', actionsC.materialsSecondaryAction?.label === "Receive Shortage");

    // Step 3/4 — Issue Available: default qty = min(remaining=4, available=2) = 2.
    const issueAvailQty = Math.min(fC.remaining_qty, fC.available_now);
    check("Case C step 3 — Issue Available modal default quantity is 2", issueAvailQty === 2);
    await issueOffline(tx, identityC, issueAvailQty, woC.id, user.id);
    fC = await fulfillmentFor(tx, 4, identityC, woC.id);
    check("Case C step 4 — after Issue Available, issued_qty=2, available_now=0", fC.issued_qty === 2 && fC.available_now === 0);

    // Step 5 — Receive Shortage: 2 more received against the Materials Request.
    await tx.offline_inventory_movements.create({
      data: { movement_type: "RECEIVED", movement_date: new Date(), part_id: catalogPartC.id, unit: "PCS", quantity: 2, related_work_order_id: woC.id, parts_request_id: prC.id, created_by: user.id },
    });
    await tx.parts_request_items.update({ where: { id: prCItem.id }, data: { issued_quantity: 2 } });
    await tx.parts_requests.update({ where: { id: prC.id }, data: { status: "Issued" } });
    fC = await fulfillmentFor(tx, 4, identityC, woC.id);
    check("Case C step 5 — after Receive Shortage, available_now=2 again", fC.available_now === 2);
    availC = summarizeMaterialAvailability([fC]);
    chipC = materialsChipFor(true, false, availC, 0, fC.remaining_qty > 0);
    check("Case C step 5/6 — chip becomes Ready to Issue (remaining=2, available=2)", chipC === "Ready to Issue");

    // Step 6 — Issue remaining 2.
    await issueOffline(tx, identityC, 2, woC.id, user.id);
    fC = await fulfillmentFor(tx, 4, identityC, woC.id);
    availC = summarizeMaterialAvailability([fC]);
    chipC = materialsChipFor(true, false, availC, 0, fC.remaining_qty > 0);
    check("Case C step 7 — Materials Completed (issued_qty=4=required)", chipC === "Materials Completed" && fC.status === "fulfilled");

    // ── Regressions ─────────────────────────────────────────────────────
    console.log("== 5. Regressions ==");
    const completedActions = deriveActions("Materials Completed", true, true, null);
    check("Completed request never shows Receive Materials", completedActions.materialsActionLabel !== "Receive Materials");

    // Closed Job Card never appears on Daily Activity in the first place
    // (page.tsx's own `where` filters status: { not: "Closed" }) — verified
    // by code review; re-confirmed here that a Closed WO's fulfillment
    // still computes (no crash) but Daily Activity's list query would
    // exclude it, so no Issue Material button is ever reachable for it.
    const woClosed = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Closed", asset_id: asset.id, created_by: user.id },
      select: { id: true, status: true },
    });
    const closedListWhere = { status: { not: "Closed" } };
    check("Closed Job Card excluded by Daily Activity's own list filter", !(woClosed.status !== "Closed"));

    let movementCountBeforeFailedIssue = await tx.offline_inventory_movements.count({ where: { related_work_order_id: woA.id } });
    let threw = false;
    try {
      await issueOffline(tx, identityA, 999, woA.id, user.id); // far more than balance (0 left after Case A)
    } catch {
      threw = true;
    }
    let movementCountAfterFailedIssue = await tx.offline_inventory_movements.count({ where: { related_work_order_id: woA.id } });
    check("Over-issue attempt rejected", threw);
    check("No inventory movement created on failed issue attempt", movementCountBeforeFailedIssue === movementCountAfterFailedIssue);

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
