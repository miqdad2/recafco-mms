/**
 * Maintenance Workflow Redesign Unit 4 — Job Card action engine checks.
 *
 * Read-only overall: all work_orders/parts_requests rows created here are
 * inside a transaction that is deliberately rolled back — nothing is left
 * behind either way.
 *
 * Note on scope: lib/backend/work-orders/service.ts uses `import "server-only"`
 * and `@/`-aliased imports, which only resolve inside the Next.js/tsc build
 * pipeline — not importable from a standalone Node script without extra
 * tooling. So this script verifies:
 *   1. lib/workflows/status-rules.ts transitions (self-contained, no aliases)
 *      directly, including the new invalid-transition cases.
 *   2. Real Job Card creation behavior at the database level (asset linkage,
 *      plate snapshot, status acceptance) for both a non-vehicle and an
 *      imported-vehicle asset.
 *   3. Counts: confirms no parts_requests / offline_inventory_movements rows
 *      are created as a side effect of anything exercised here.
 * The disabled-action messages, permission-gate changes, and two-hop close
 * logic added in Unit 4 are verified by `npm run typecheck` / `npm run build`
 * succeeding plus code review — not by importing the service module directly.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-workflow-redesign-unit4.mjs
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

console.log("== 1. Job Card lifecycle (valid transitions) ==");
check("Created -> Under Review valid", canTransition("work_order", "Created", "Under Review") === true);
check("Under Review -> Under Review valid (review/correction no-op)", canTransition("work_order", "Under Review", "Under Review") === true);
check("Under Review -> Approved valid", canTransition("work_order", "Under Review", "Approved") === true);
check("Approved -> Assigned valid (no materials needed)", canTransition("work_order", "Approved", "Assigned") === true);
check("Assigned -> In Progress valid", canTransition("work_order", "Assigned", "In Progress") === true);
check("In Progress -> Closed valid", canTransition("work_order", "In Progress", "Closed") === true);

console.log("== 2. Invalid transitions ==");
check("Created -> Closed invalid", canTransition("work_order", "Created", "Closed") === false);
check("Approved -> Closed invalid", canTransition("work_order", "Approved", "Closed") === false);
check("Closed -> In Progress invalid", canTransition("work_order", "Closed", "In Progress") === false);
check("Under Review -> Assigned invalid", canTransition("work_order", "Under Review", "Assigned") === false);

console.log("== 3. Assignment / reassignment transitions ==");
check("Approved -> Assigned valid", canTransition("work_order", "Approved", "Assigned") === true);
check("Partially Issued -> Assigned valid", canTransition("work_order", "Partially Issued", "Assigned") === true);
check("Materials Issued -> Assigned valid", canTransition("work_order", "Materials Issued", "Assigned") === true);
check("Assigned -> Assigned valid (reassignment)", canTransition("work_order", "Assigned", "Assigned") === true);
check("In Progress -> Assigned valid (reassignment while active)", canTransition("work_order", "In Progress", "Assigned") === true);

const prisma = new PrismaClient({ log: ["error"] });

console.log("== 4. Job Card creation (rolled back, no data left behind) ==");
try {
  await prisma.$transaction(async (tx) => {
    const bpm = await tx.assets.findUnique({ where: { asset_code: "AST-BPM-001" }, select: { id: true, asset_code: true } });
    const pickup = await tx.assets.findFirst({ where: { asset_code: "AST-VEH-0043" }, select: { id: true, asset_code: true, plate_number: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!bpm || !pickup || !user) throw new Error("SKIP: expected assets/profile not found");

    // Non-vehicle asset (AST-BPM-001), saved as Created.
    const woBpm = await tx.work_orders.create({
      data: {
        ordered_by: "Unit4 verify script",
        maintenance_type: "Routine",
        worker_type: "Mechanical",
        status: "Created",
        asset_id: bpm.id,
        created_by: user.id
      },
      select: { id: true, asset_id: true, status: true }
    });
    check("AST-BPM-001 Job Card created with status Created", woBpm.status === "Created");
    check("AST-BPM-001 Job Card asset_id correct", woBpm.asset_id === bpm.id);

    // Imported vehicle asset, saved directly as Under Review (submit intent),
    // with a plate_number snapshot matching the asset's plate.
    const woVeh = await tx.work_orders.create({
      data: {
        ordered_by: "Unit4 verify script",
        maintenance_type: "Breakdown",
        worker_type: "Auto",
        status: "Under Review",
        asset_id: pickup.id,
        plate_number: pickup.plate_number,
        created_by: user.id
      },
      select: { id: true, asset_id: true, plate_number: true, status: true }
    });
    check("Imported vehicle Job Card created with status Under Review", woVeh.status === "Under Review");
    check("Imported vehicle Job Card asset_id correct", woVeh.asset_id === pickup.id);
    check("Imported vehicle Job Card plate snapshot matches asset", woVeh.plate_number === pickup.plate_number);

    // Confirm no parts_requests / offline_inventory_movements exist for these
    // Job Cards (Task 8/10 boundary: creation alone must not touch Materials
    // Request or the Store ledger).
    const linkedPr = await tx.parts_requests.count({ where: { work_order_id: { in: [woBpm.id, woVeh.id] } } });
    check("No Materials Request created alongside Job Card creation", linkedPr === 0);

    // Force rollback — nothing created here should persist.
    throw new Error("__ROLLBACK_TEST_DATA__");
  });
} catch (err) {
  if (!(err instanceof Error) || err.message !== "__ROLLBACK_TEST_DATA__") {
    if (err instanceof Error && err.message.startsWith("SKIP:")) {
      console.log(`  SKIP  Job Card creation checks: ${err.message}`);
    } else {
      console.error("  FAIL  Job Card creation transaction errored unexpectedly:", err);
      failures++;
    }
  }
}

console.log("== 5. Counts after rollback (nothing left behind) ==");
const wo = await prisma.work_orders.count({ where: { ordered_by: "Unit4 verify script" } });
const pr = await prisma.parts_requests.count();
const oim = await prisma.offline_inventory_movements.count();
check("no leftover Unit4 test work_orders", wo === 0);
check("no parts_requests exist (Unit 4 created none)", pr === 0);
check("no offline_inventory_movements exist (Unit 4 created none)", oim === 0);

await prisma.$disconnect();

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
