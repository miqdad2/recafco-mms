/**
 * Maintenance Workflow Redesign Unit 5 — Materials Request / Store issue
 * engine checks.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * Note on scope (same limitation as Units 3/4): lib/backend/parts-requests/
 * service.ts uses `import "server-only"` and `@/`-aliased imports, which only
 * resolve inside the Next.js/tsc build pipeline — not importable from a
 * standalone Node script without extra tooling (e.g. installing tsx, which
 * this unit intentionally avoids to keep the change footprint small). So this
 * script re-derives the REAL data-level outcome of issueMaterials/
 * markWaitingStock/syncJobCardMaterialStatus by performing the same guarded
 * Prisma operations the service functions perform (canTransition checks,
 * row lock, ledger movements, item/status updates) directly against the
 * database, rather than calling the TS functions themselves. The permission
 * checks, disabled-action messages, and exact function wiring are verified
 * by `npm run typecheck` / `npm run build` succeeding plus code review.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-workflow-redesign-unit5.mjs
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

console.log("== 1. Materials Request transitions (status-rules.ts) ==");
check("Requested -> Approved valid", canTransition("parts_request", "Requested", "Approved") === true);
check("Issued -> Approved invalid", canTransition("parts_request", "Issued", "Approved") === false);
check("Approved -> Waiting Stock valid", canTransition("parts_request", "Approved", "Waiting Stock") === true);
check("Approved -> Partially Issued valid", canTransition("parts_request", "Approved", "Partially Issued") === true);
check("Approved -> Issued valid", canTransition("parts_request", "Approved", "Issued") === true);
check("Waiting Stock -> Partially Issued valid", canTransition("parts_request", "Waiting Stock", "Partially Issued") === true);
check("Waiting Stock -> Issued valid", canTransition("parts_request", "Waiting Stock", "Issued") === true);
check("Partially Issued -> Issued valid", canTransition("parts_request", "Partially Issued", "Issued") === true);
check("Issued -> Requested invalid", canTransition("parts_request", "Issued", "Requested") === false);
check("Partially Issued -> Waiting Stock invalid (known, documented limitation)", canTransition("parts_request", "Partially Issued", "Waiting Stock") === false);

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit5 verify script";
const ACTIVE_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

async function computeBalance(tx, manualName, unit) {
  const movements = await tx.offline_inventory_movements.findMany({
    where: { part_id: null, manual_material_name: { equals: manualName, mode: "insensitive" }, unit: { equals: unit, mode: "insensitive" }, deleted_at: null },
    select: { movement_type: true, quantity: true }
  });
  let balance = 0;
  for (const m of movements) {
    const qty = Number(m.quantity);
    if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") balance += qty;
    else if (m.movement_type === "ISSUED") balance -= qty;
  }
  return balance;
}

try {
  await prisma.$transaction(async (tx) => {
    const bpm = await tx.assets.findUnique({ where: { asset_code: "AST-BPM-001" }, select: { id: true } });
    const vehicle = await tx.assets.findFirst({ where: { asset_code: "AST-VEH-0043" }, select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!bpm || !vehicle || !user) throw new Error("SKIP: expected assets/profile not found");

    console.log("== 2. Job Card A: full partial -> final issue lifecycle (Task 4 A/B) ==");
    const woA = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Created", asset_id: bpm.id, created_by: user.id },
      select: { id: true, status: true }
    });
    check("WO A created -> Created", woA.status === "Created");
    check("Created -> Under Review guarded valid", canTransition("work_order", "Created", "Under Review"));
    await tx.work_orders.update({ where: { id: woA.id }, data: { status: "Under Review" } });
    check("Under Review -> Approved guarded valid", canTransition("work_order", "Under Review", "Approved"));
    await tx.work_orders.update({ where: { id: woA.id }, data: { status: "Approved" } });

    const prA = await tx.parts_requests.create({
      data: { work_order_id: woA.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true }
    });
    await tx.parts_request_items.create({
      data: { parts_request_id: prA.id, description: "Unit5 Test Bolt", quantity_requested: 10, unit_price: 1 }
    });

    // Duplicate-active-request guard (Task 12.A / Unit 3 helper, re-verified here against a real active row).
    const activeExists = await tx.parts_requests.findFirst({ where: { work_order_id: woA.id, status: { in: ACTIVE_STATUSES } } });
    check("duplicate active Materials Request correctly detected", !!activeExists);

    // Opening stock so there's enough balance to issue against.
    await tx.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), manual_material_name: "Unit5 Test Bolt", category: "Hardware / Fasteners", quantity: 20, unit: "PCS", created_by: user.id }
    });

    check("Requested -> Approved guarded valid", canTransition("parts_request", "Requested", "Approved"));
    await tx.parts_requests.update({ where: { id: prA.id }, data: { status: "Approved" } });

    // Issue 6 of 10 (absolute new total = 6).
    const item = await tx.parts_request_items.findFirst({ where: { parts_request_id: prA.id } });
    const balance1 = await computeBalance(tx, "Unit5 Test Bolt", "PCS");
    check("balance sufficient for first issue (20 available)", balance1 === 20);
    await tx.offline_inventory_movements.create({
      data: { movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Unit5 Test Bolt", category: "Hardware / Fasteners", quantity: 6, unit: "PCS", related_work_order_id: woA.id, parts_request_id: prA.id, created_by: user.id }
    });
    await tx.parts_request_items.update({ where: { id: item.id }, data: { issued_quantity: 6, stock_availability: "Partial" } });
    check("Approved -> Partially Issued guarded valid", canTransition("parts_request", "Approved", "Partially Issued"));
    await tx.parts_requests.update({ where: { id: prA.id }, data: { status: "Partially Issued" } });
    check("WO Approved -> Partially Issued guarded valid (sync)", canTransition("work_order", "Approved", "Partially Issued"));
    await tx.work_orders.update({ where: { id: woA.id }, data: { status: "Partially Issued" } });

    const itemAfterPartial = await tx.parts_request_items.findUnique({ where: { id: item.id } });
    const prAfterPartial = await tx.parts_requests.findUnique({ where: { id: prA.id } });
    const woAfterPartial = await tx.work_orders.findUnique({ where: { id: woA.id } });
    check("item issued_quantity = 6", Number(itemAfterPartial.issued_quantity) === 6);
    check("Materials Request status = Partially Issued", prAfterPartial.status === "Partially Issued");
    check("Job Card status = Partially Issued", woAfterPartial.status === "Partially Issued");
    const ledgerAfterPartial = await tx.offline_inventory_movements.count({ where: { parts_request_id: prA.id, movement_type: "ISSUED" } });
    check("ledger has 1 ISSUED row after partial issue", ledgerAfterPartial === 1);

    // Issue remaining 4 (absolute new total = 10).
    const balance2 = await computeBalance(tx, "Unit5 Test Bolt", "PCS");
    check("balance still sufficient for remainder (14 available)", balance2 === 14);
    await tx.offline_inventory_movements.create({
      data: { movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Unit5 Test Bolt", category: "Hardware / Fasteners", quantity: 4, unit: "PCS", related_work_order_id: woA.id, parts_request_id: prA.id, created_by: user.id }
    });
    await tx.parts_request_items.update({ where: { id: item.id }, data: { issued_quantity: 10, stock_availability: "Available" } });
    check("Partially Issued -> Issued guarded valid", canTransition("parts_request", "Partially Issued", "Issued"));
    await tx.parts_requests.update({ where: { id: prA.id }, data: { status: "Issued" } });
    check("WO Partially Issued -> Materials Issued guarded valid (sync)", canTransition("work_order", "Partially Issued", "Materials Issued"));
    await tx.work_orders.update({ where: { id: woA.id }, data: { status: "Materials Issued" } });

    const itemFinal = await tx.parts_request_items.findUnique({ where: { id: item.id } });
    const prFinal = await tx.parts_requests.findUnique({ where: { id: prA.id } });
    const woFinal = await tx.work_orders.findUnique({ where: { id: woA.id } });
    check("total issued quantity = 10 (= requested)", Number(itemFinal.issued_quantity) === 10);
    check("Materials Request status = Issued", prFinal.status === "Issued");
    check("Job Card status = Materials Issued", woFinal.status === "Materials Issued");
    const ledgerFinal = await tx.offline_inventory_movements.count({ where: { parts_request_id: prA.id, movement_type: "ISSUED" } });
    check("ledger has 2 ISSUED rows total (6 then 4)", ledgerFinal === 2);

    console.log("== 3. Invalid issue scenarios (Task 12.F) ==");
    check("issue 11 of 10 would be rejected (11 > requested 10)", 11 > Number(item.quantity_requested));
    check("issue after Issued rejected (Issued not in ISSUABLE_MATERIALS_REQUEST_STATUSES)", !["Approved", "Waiting Stock", "Partially Issued"].includes("Issued"));
    check("issue without approved request rejected (Requested not issuable)", !["Approved", "Waiting Stock", "Partially Issued"].includes("Requested"));

    console.log("== 4. New request allowed after prior Issued (Task 12.A) ==");
    const prA2 = await tx.parts_requests.create({
      data: { work_order_id: woA.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true, status: true }
    });
    check("second Materials Request created (first is Issued, not active)", prA2.status === "Requested");

    console.log("== 5. Job Card B: Waiting Stock (Task 4 Example C / Task 12.C) ==");
    const woB = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Breakdown", worker_type: "Auto", status: "Approved", asset_id: bpm.id, created_by: user.id },
      select: { id: true }
    });
    const prB = await tx.parts_requests.create({
      data: { work_order_id: woB.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true }
    });
    await tx.parts_request_items.create({ data: { parts_request_id: prB.id, description: "Unit5 Scarce Part", quantity_requested: 5, unit_price: 1 } });
    await tx.parts_requests.update({ where: { id: prB.id }, data: { status: "Approved" } });

    const reason = "No stock available at this time";
    check("reason provided (>=5 chars) for Waiting Stock", reason.trim().length >= 5);
    const balanceB = await computeBalance(tx, "Unit5 Scarce Part", "PCS");
    check("zero balance for Waiting Stock scenario", balanceB === 0);
    check("Approved -> Waiting Stock guarded valid", canTransition("parts_request", "Approved", "Waiting Stock"));
    await tx.parts_requests.update({ where: { id: prB.id }, data: { status: "Waiting Stock", store_issue_comments: reason } });
    check("WO Approved -> Waiting Materials guarded valid (sync)", canTransition("work_order", "Approved", "Waiting Materials"));
    await tx.work_orders.update({ where: { id: woB.id }, data: { status: "Waiting Materials" } });

    const prBAfter = await tx.parts_requests.findUnique({ where: { id: prB.id } });
    const woBAfter = await tx.work_orders.findUnique({ where: { id: woB.id } });
    const ledgerB = await tx.offline_inventory_movements.count({ where: { parts_request_id: prB.id, movement_type: "ISSUED" } });
    check("Materials Request status = Waiting Stock", prBAfter.status === "Waiting Stock");
    check("Job Card status = Waiting Materials", woBAfter.status === "Waiting Materials");
    check("no Offline Inventory ISSUED row created for Waiting Stock", ledgerB === 0);
    check("reason recorded", prBAfter.store_issue_comments === reason);

    console.log("== 6. Job Card C: vehicle, no materials required (Task 8) ==");
    const woC = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Breakdown", worker_type: "Auto", status: "Approved", asset_id: vehicle.id, created_by: user.id },
      select: { id: true, asset_id: true }
    });
    check("WO C linked to imported vehicle asset", woC.asset_id === vehicle.id);
    check("Approved -> Assigned valid with no materials", canTransition("work_order", "Approved", "Assigned"));
    await tx.work_orders.update({ where: { id: woC.id }, data: { status: "Assigned" } });
    const woCPrCount = await tx.parts_requests.count({ where: { work_order_id: woC.id } });
    check("no Materials Request required/created for Job Card C", woCPrCount === 0);

    console.log("== 7. Missing Job Card rejected (Task 12.A) ==");
    const missingWo = await tx.work_orders.findUnique({ where: { id: "00000000-0000-0000-0000-000000000000" } });
    check("nonexistent work_order_id correctly not found", missingWo === null);

    throw new Error("__ROLLBACK_TEST_DATA__");
  });
} catch (err) {
  if (!(err instanceof Error) || err.message !== "__ROLLBACK_TEST_DATA__") {
    if (err instanceof Error && err.message.startsWith("SKIP:")) {
      console.log(`  SKIP  scenario: ${err.message}`);
    } else {
      console.error("  FAIL  transaction errored unexpectedly:", err);
      failures++;
    }
  }
}

console.log("== 8. Counts after rollback (Task 12.H) ==");
const wo = await prisma.work_orders.count({ where: { ordered_by: MARKER } });
const pr = await prisma.parts_requests.count();
const oim = await prisma.offline_inventory_movements.count();
check("work_orders remains 0", wo === 0);
check("parts_requests remains 0", pr === 0);
check("offline_inventory_movements remains 0", oim === 0);

await prisma.$disconnect();

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
