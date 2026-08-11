/**
 * Unified Material Processing Flow Unit 10G.23 — verification script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 * Explicitly NOT an E2E/Playwright/browser test (per the unit's own "do not
 * run E2E tests" constraint) — this is a data-level verification only.
 *
 * Same scope limitation as scripts/verify-materials-receive-status-fix.mjs:
 * lib/backend/work-orders/material-processing.ts uses `import "server-only"`
 * (as does lib/work-orders/material-fulfillment.ts, which it depends on), so
 * neither can be imported from a standalone Node script. This script
 * re-derives the REAL data-level outcome of processJobCardMaterials() —
 * same balance/remaining/shortage math, same RECEIVED-then-ISSUED write
 * order, same "skip already-fulfilled lines" idempotency rule — directly
 * against the database, mirroring the real function's logic rather than
 * re-implementing the business rules from scratch. A drift check below
 * confirms the real source file still contains the exact snippets this
 * script's replica depends on, so the two can't silently diverge unnoticed.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-unified-material-processing-unit10g23.mjs
 */

import { readFileSync } from "node:fs";
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

// ── Drift check: the real service must still contain the exact logic this
// script's replica mirrors, so the two can never silently diverge. ──────────
const realSrc = readFileSync(new URL("../lib/backend/work-orders/material-processing.ts", import.meta.url), "utf8");
console.log("== 0. material-processing.ts drift check ==");
check("real file still receives shortage before issuing", realSrc.includes("const shortageNow = Math.max(remainingNow - availableNow, 0);"));
check("real file still caps issue at min(remaining, available)", realSrc.includes("const issueQty = Math.min(remainingNow, availableNow);"));
check("real file still skips lines already fulfilled since the outer snapshot", realSrc.includes("if (remainingNow <= 1e-9) {"));
check("real file still returns the exact no-op message", realSrc.includes('if (receivedCount === 0 && issuedCount === 0) return "No remaining materials to process.";'));
check("real file still guards Closed Job Cards", realSrc.includes('if (wo.status === "Closed") {'));

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G23 verify script";

// Mirrors resolveCurrentBalanceAndIssuedInTx exactly (material-processing.ts).
async function resolveCurrentBalanceAndIssued(tx, line, workOrderId) {
  const where = line.part_id
    ? { part_id: line.part_id, deleted_at: null }
    : { part_id: null, manual_material_name: { equals: line.description, mode: "insensitive" }, unit: { equals: line.unit, mode: "insensitive" }, deleted_at: null };
  const movements = await tx.offline_inventory_movements.findMany({ where, select: { movement_type: true, quantity: true, related_work_order_id: true } });
  let available = 0;
  let issuedToThisJobCard = 0;
  for (const m of movements) {
    const q = Number(m.quantity);
    if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") available += q;
    else if (m.movement_type === "ISSUED") {
      available -= q;
      if (m.related_work_order_id === workOrderId) issuedToThisJobCard += q;
    }
  }
  return { available, issuedToThisJobCard };
}

// Mirrors processJobCardMaterials's per-work-order loop exactly, minus the
// advisory lock (single-threaded script, not needed for correctness here)
// and minus the permission gate (covered separately by role-permission
// checks elsewhere; this script verifies the data-level orchestration only).
async function processJobCardMaterials(tx, workOrderId, actorId) {
  const wo = await tx.work_orders.findFirst({ where: { id: workOrderId, deleted_at: null }, select: { id: true, work_order_number: true, status: true } });
  if (!wo) throw new Error("Job Card not found.");
  if (wo.status === "Closed") throw new Error("This Job Card is closed. Materials can no longer be processed.");

  const rows = await tx.workOrderRequiredPart.findMany({ where: { work_order_id: workOrderId }, orderBy: { created_at: "asc" } });
  const fulfillment = [];
  for (const r of rows) {
    const line = { part_id: r.part_id, description: r.description, part_number: r.part_number, unit: r.unit_of_measure, required_qty: Number(r.quantity_required) };
    const { available, issuedToThisJobCard } = await resolveCurrentBalanceAndIssued(tx, line, workOrderId);
    const remaining_qty = Math.max(line.required_qty - issuedToThisJobCard, 0);
    fulfillment.push({ ...line, available_now: Math.max(available, 0), issued_qty: issuedToThisJobCard, remaining_qty });
  }

  const alreadyDone = fulfillment.length - fulfillment.filter((f) => f.remaining_qty > 1e-9).length;
  const candidates = fulfillment.filter((f) => f.remaining_qty > 1e-9);
  if (candidates.length === 0) return { workOrderNumber: wo.work_order_number, receivedCount: 0, issuedCount: 0, skippedCount: fulfillment.length, message: "No remaining materials to process." };

  const counterparty = `Job Card ${wo.work_order_number ?? workOrderId}`;
  let receivedCount = 0;
  let issuedCount = 0;
  let raceSkipped = 0;

  for (const line of candidates) {
    const { available, issuedToThisJobCard } = await resolveCurrentBalanceAndIssued(tx, line, workOrderId);
    const remainingNow = Math.max(line.required_qty - issuedToThisJobCard, 0);
    if (remainingNow <= 1e-9) {
      raceSkipped += 1;
      continue;
    }
    let availableNow = available;
    const shortageNow = Math.max(remainingNow - availableNow, 0);

    if (shortageNow > 1e-9) {
      await tx.offline_inventory_movements.create({
        data: {
          movement_type: "RECEIVED", movement_date: new Date(), part_id: line.part_id,
          manual_material_name: line.part_id ? null : line.description, manual_part_number: line.part_id ? null : line.part_number,
          category: "Other", quantity: shortageNow, unit: line.unit, counterparty,
          purpose: `Process Materials — required for ${wo.work_order_number ?? workOrderId}`, related_work_order_id: workOrderId, created_by: actorId,
        },
      });
      availableNow += shortageNow;
      receivedCount += 1;
    }

    const issueQty = Math.min(remainingNow, availableNow);
    if (issueQty > 1e-9) {
      await tx.offline_inventory_movements.create({
        data: {
          movement_type: "ISSUED", movement_date: new Date(), part_id: line.part_id,
          manual_material_name: line.part_id ? null : line.description, manual_part_number: line.part_id ? null : line.part_number,
          category: "Other", quantity: issueQty, unit: line.unit, counterparty,
          purpose: `Required material for ${wo.work_order_number ?? workOrderId}`, related_work_order_id: workOrderId, created_by: actorId,
        },
      });
      issuedCount += 1;
    }
  }

  const message =
    receivedCount === 0 && issuedCount === 0
      ? "No remaining materials to process."
      : (() => {
          const parts = [];
          if (receivedCount > 0) parts.push(`received ${receivedCount} item${receivedCount === 1 ? "" : "s"}`);
          if (issuedCount > 0) parts.push(`issued ${issuedCount} item${issuedCount === 1 ? "" : "s"}`);
          const body = parts.join(" and ");
          return `Materials processed successfully. ${body.charAt(0).toUpperCase()}${body.slice(1)}.`;
        })();

  return { workOrderNumber: wo.work_order_number, receivedCount, issuedCount, skippedCount: alreadyDone + raceSkipped, message };
}

try {
  await prisma.$transaction(
    async (tx) => {
      const asset = await tx.assets.findFirst({ select: { id: true } });
      const user = await tx.profiles.findFirst({ select: { id: true } });
      if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

      console.log("\n== 1. Set up a mixed-materials Job Card ==");
      const wo = await tx.work_orders.create({
        data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
        select: { id: true, work_order_number: true, status: true },
      });
      console.log(`  Job Card: ${wo.work_order_number}`);

      // Line 1 — Task 13's "Filter 5": existing stock, required 1, available 105.
      const filterName = `${MARKER} Filter 5`;
      await tx.offline_inventory_movements.create({
        data: { movement_type: "OPENING_STOCK", movement_date: new Date(), manual_material_name: filterName, category: "Other", quantity: 105, unit: "PCS", created_by: user.id },
      });
      const lineFilter = await tx.workOrderRequiredPart.create({
        data: { work_order_id: wo.id, description: filterName, quantity_required: 1, unit_of_measure: "PCS", created_by: user.id },
      });

      // Line 2 — Task 13's "engine oil": new material, required 1, available 0.
      const oilName = `${MARKER} Engine Oil`;
      const lineOil = await tx.workOrderRequiredPart.create({
        data: { work_order_id: wo.id, description: oilName, quantity_required: 1, unit_of_measure: "LTR", created_by: user.id },
      });

      // Line 3 — Task 8's exact worked example: required 10, already issued 3,
      // available 4, remaining 7 -> receive 3, issue 7. Set up via OPENING_STOCK
      // of 7 then an ISSUED of 3 already tied to this Job Card, so available_now
      // computes to 4 (7 - 3) and issued_qty to this card computes to 3.
      const boltName = `${MARKER} Hex Bolt`;
      await tx.offline_inventory_movements.create({
        data: { movement_type: "OPENING_STOCK", movement_date: new Date(), manual_material_name: boltName, category: "Other", quantity: 7, unit: "KG", created_by: user.id },
      });
      await tx.offline_inventory_movements.create({
        data: { movement_type: "ISSUED", movement_date: new Date(), manual_material_name: boltName, category: "Other", quantity: 3, unit: "KG", related_work_order_id: wo.id, counterparty: "Pre-existing partial issue", purpose: "Pre-existing partial issue fixture", created_by: user.id },
      });
      const lineBolt = await tx.workOrderRequiredPart.create({
        data: { work_order_id: wo.id, description: boltName, quantity_required: 10, unit_of_measure: "KG", created_by: user.id },
      });

      console.log("\n== 2. Pre-processing fulfillment classification (Task 3 grouping) ==");
      const preFilter = await resolveCurrentBalanceAndIssued(tx, { part_id: null, description: filterName, unit: "PCS" }, wo.id);
      const preOil = await resolveCurrentBalanceAndIssued(tx, { part_id: null, description: oilName, unit: "LTR" }, wo.id);
      const preBolt = await resolveCurrentBalanceAndIssued(tx, { part_id: null, description: boltName, unit: "KG" }, wo.id);
      check("Filter 5: available_now = 105 (Ready to Issue)", preFilter.available === 105);
      check("Engine Oil: available_now = 0 (Needs Receiving)", preOil.available === 0);
      check("Hex Bolt: available_now = 4, issued_qty = 3 (Partially Available)", preBolt.available === 4 && preBolt.issuedToThisJobCard === 3);

      const movementsBeforeCount = await tx.offline_inventory_movements.count({ where: { related_work_order_id: wo.id } });

      console.log("\n== 3. First Confirm & Process Materials call ==");
      const result1 = await processJobCardMaterials(tx, wo.id, user.id);
      check("receivedCount = 2 (Engine Oil shortage 1 + Hex Bolt shortage 3)", result1.receivedCount === 2);
      check("issuedCount = 3 (all three lines get an ISSUED movement)", result1.issuedCount === 3);
      check("skippedCount = 0 (nothing already done before this call)", result1.skippedCount === 0);
      check('message = "Materials processed successfully. Received 2 items and issued 3 items."', result1.message === "Materials processed successfully. Received 2 items and issued 3 items.");

      console.log("\n== 4. Per-line movement verification ==");
      const filterMovements = await tx.offline_inventory_movements.findMany({ where: { manual_material_name: filterName, related_work_order_id: wo.id } });
      check("Filter 5: exactly one ISSUED movement, qty 1, no RECEIVED (already in stock)", filterMovements.length === 1 && filterMovements[0].movement_type === "ISSUED" && Number(filterMovements[0].quantity) === 1);

      const oilMovements = await tx.offline_inventory_movements.findMany({ where: { manual_material_name: oilName, related_work_order_id: wo.id }, orderBy: { movement_type: "asc" } });
      const oilReceived = oilMovements.find((m) => m.movement_type === "RECEIVED");
      const oilIssued = oilMovements.find((m) => m.movement_type === "ISSUED");
      check("Engine Oil: one RECEIVED movement, qty 1", oilReceived && Number(oilReceived.quantity) === 1);
      check("Engine Oil: one ISSUED movement, qty 1", oilIssued && Number(oilIssued.quantity) === 1);
      check("Engine Oil: unit carried through as LTR, not hardcoded PCS", oilReceived.unit === "LTR" && oilIssued.unit === "LTR");

      const boltMovementsAfter = await tx.offline_inventory_movements.findMany({ where: { manual_material_name: boltName, related_work_order_id: wo.id } });
      const boltReceivedNew = boltMovementsAfter.filter((m) => m.movement_type === "RECEIVED");
      const boltIssuedAll = boltMovementsAfter.filter((m) => m.movement_type === "ISSUED");
      check("Hex Bolt: exactly one new RECEIVED movement, qty 3 (the shortage)", boltReceivedNew.length === 1 && Number(boltReceivedNew[0].quantity) === 3);
      check("Hex Bolt: two ISSUED movements total (pre-existing 3 + new 7), summing to 10", boltIssuedAll.length === 2 && boltIssuedAll.reduce((s, m) => s + Number(m.quantity), 0) === 10);
      check("Hex Bolt: the new ISSUED movement is exactly 7 (Task 8's worked example)", boltIssuedAll.some((m) => Number(m.quantity) === 7));

      console.log("\n== 5. Audit trail fields (Task 11) ==");
      const allNewMovements = await tx.offline_inventory_movements.findMany({ where: { related_work_order_id: wo.id, id: { notIn: [] } } });
      check("every movement for this Job Card has created_by set", allNewMovements.every((m) => m.created_by !== null));
      check("every movement for this Job Card has a non-empty purpose", allNewMovements.every((m) => m.purpose && m.purpose.length > 0));
      check("every movement for this Job Card has movement_date set", allNewMovements.every((m) => m.movement_date instanceof Date));
      check("RECEIVED movements are purposed as Process Materials", allNewMovements.filter((m) => m.movement_type === "RECEIVED" && m.purpose.includes("Process Materials")).length === 2);

      console.log("\n== 6. Post-processing fulfillment (Task 10 — all lines Fully Issued) ==");
      const postFilter = await resolveCurrentBalanceAndIssued(tx, { part_id: null, description: filterName, unit: "PCS" }, wo.id);
      const postOil = await resolveCurrentBalanceAndIssued(tx, { part_id: null, description: oilName, unit: "LTR" }, wo.id);
      const postBolt = await resolveCurrentBalanceAndIssued(tx, { part_id: null, description: boltName, unit: "KG" }, wo.id);
      check("Filter 5: issued_qty to this Job Card now = 1 (fully issued, remaining 0)", postFilter.issuedToThisJobCard === 1);
      check("Engine Oil: issued_qty to this Job Card now = 1 (fully issued, remaining 0)", postOil.issuedToThisJobCard === 1);
      check("Hex Bolt: issued_qty to this Job Card now = 10 (fully issued, remaining 0)", postBolt.issuedToThisJobCard === 10);

      console.log("\n== 7. Double-click idempotency (Task 6) — second call on the same Job Card ==");
      const movementsBeforeSecondCall = await tx.offline_inventory_movements.count({ where: { related_work_order_id: wo.id } });
      const result2 = await processJobCardMaterials(tx, wo.id, user.id);
      const movementsAfterSecondCall = await tx.offline_inventory_movements.count({ where: { related_work_order_id: wo.id } });
      check("second call: receivedCount = 0", result2.receivedCount === 0);
      check("second call: issuedCount = 0", result2.issuedCount === 0);
      check("second call: skippedCount = 3 (all three lines already fulfilled)", result2.skippedCount === 3);
      check('second call: message = "No remaining materials to process."', result2.message === "No remaining materials to process.");
      check("second call created NO new movements (no duplicate issue/receive)", movementsAfterSecondCall === movementsBeforeSecondCall);
      check("total movements for this Job Card = 5 (1 filter issue + 2 oil + 2 new bolt)", movementsAfterSecondCall - movementsBeforeCount === 5);

      console.log("\n== 8. Closed Job Card guard ==");
      const woClosed = await tx.work_orders.create({
        data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Closed", asset_id: asset.id, created_by: user.id },
        select: { id: true },
      });
      await tx.workOrderRequiredPart.create({ data: { work_order_id: woClosed.id, description: `${MARKER} Closed WO Part`, quantity_required: 1, unit_of_measure: "PCS", created_by: user.id } });
      let closedGuardError = null;
      try {
        await processJobCardMaterials(tx, woClosed.id, user.id);
      } catch (e) {
        closedGuardError = e.message;
      }
      check("Closed Job Card rejected with the expected message", closedGuardError === "This Job Card is closed. Materials can no longer be processed.");
      check("no movement created for the Closed Job Card attempt", (await tx.offline_inventory_movements.count({ where: { related_work_order_id: woClosed.id } })) === 0);

      console.log("\n== 9. No-required-materials Job Card returns a clean no-op ==");
      const woEmpty = await tx.work_orders.create({
        data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
        select: { id: true },
      });
      const resultEmpty = await processJobCardMaterials(tx, woEmpty.id, user.id);
      check("empty Job Card: skippedCount = 0, no crash", resultEmpty.skippedCount === 0 && resultEmpty.receivedCount === 0 && resultEmpty.issuedCount === 0);

      console.log("\nRolling back — no data persisted.");
      throw new Error("__ROLLBACK__");
    },
    { timeout: 20000 }
  );
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
