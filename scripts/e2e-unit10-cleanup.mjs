/**
 * Maintenance Workflow Redesign Unit 10 — cleanup for the E2E test data
 * committed by scripts/e2e-unit10-run.mjs (Task 12). Deletes only rows
 * reachable from work_orders.ordered_by = "Unit10 E2E" — never touches
 * assets, roles, permissions, schema, or any other data.
 *
 * Guard: set CONFIRM_E2E_UNIT10_CLEANUP=true to execute. Without the env var
 * the script prints a warning and exits without deleting anything — this
 * previously ran its deleteMany calls unconditionally against whatever
 * DATABASE_URL was active, unlike the other cleanup/purge scripts in this
 * folder (Backend Reliability Fix Unit 1, Task 6).
 *
 * Usage:
 *   CONFIRM_E2E_UNIT10_CLEANUP=true node --env-file=.env scripts/e2e-unit10-cleanup.mjs
 */

import { PrismaClient } from "@prisma/client";

const MARKER = "Unit10 E2E";

if (process.env.CONFIRM_E2E_UNIT10_CLEANUP !== "true") {
  console.warn(
    "[e2e-unit10-cleanup] Refusing to run: this script permanently deletes Unit10 E2E test data " +
    "from whichever database DATABASE_URL currently points to, with no dry-run mode. " +
    "Set CONFIRM_E2E_UNIT10_CLEANUP=true to proceed.\n" +
    "  Usage: CONFIRM_E2E_UNIT10_CLEANUP=true node --env-file=.env scripts/e2e-unit10-cleanup.mjs"
  );
  process.exit(0);
}

const prisma = new PrismaClient({ log: ["error"] });

const workOrders = await prisma.work_orders.findMany({ where: { ordered_by: MARKER }, select: { id: true } });
const woIds = workOrders.map((w) => w.id);
const partsRequests = await prisma.parts_requests.findMany({ where: { work_order_id: { in: woIds } }, select: { id: true } });
const prIds = partsRequests.map((p) => p.id);

console.log(`Deleting Unit10 E2E data: ${woIds.length} work_orders, ${prIds.length} parts_requests`);

const notifDeleted = await prisma.notifications.deleteMany({ where: { entity_id: { in: [...woIds, ...prIds] } } });
const auditDeleted = await prisma.audit_logs.deleteMany({ where: { OR: [{ entity_type: "work_order", entity_id: { in: woIds } }, { entity_type: "parts_request", entity_id: { in: prIds } }] } });
// OPENING_STOCK rows are never linked to a work_order/parts_request (by
// design — see scripts/e2e-unit10-run.mjs) so they must also be matched by
// their distinctive test material name, or this delete silently misses them.
const movementsDeleted = await prisma.offline_inventory_movements.deleteMany({
  where: { OR: [{ related_work_order_id: { in: woIds } }, { parts_request_id: { in: prIds } }, { manual_material_name: { startsWith: "Unit10 Test" } }] },
});
const assignmentsDeleted = await prisma.work_order_assignments.deleteMany({ where: { work_order_id: { in: woIds } } });
const approvalsDeleted = await prisma.approvals.deleteMany({ where: { work_order_id: { in: woIds } } });
const itemsDeleted = await prisma.parts_request_items.deleteMany({ where: { parts_request_id: { in: prIds } } });
const prDeleted = await prisma.parts_requests.deleteMany({ where: { id: { in: prIds } } });
const woDeleted = await prisma.work_orders.deleteMany({ where: { id: { in: woIds } } });

console.log(`  notifications:               ${notifDeleted.count}`);
console.log(`  audit_logs:                  ${auditDeleted.count}`);
console.log(`  offline_inventory_movements: ${movementsDeleted.count}`);
console.log(`  work_order_assignments:      ${assignmentsDeleted.count}`);
console.log(`  approvals:                   ${approvalsDeleted.count}`);
console.log(`  parts_request_items:         ${itemsDeleted.count}`);
console.log(`  parts_requests:              ${prDeleted.count}`);
console.log(`  work_orders:                 ${woDeleted.count}`);

const remainingWo = await prisma.work_orders.count();
const remainingPr = await prisma.parts_requests.count();
const remainingOim = await prisma.offline_inventory_movements.count();
const assetsCount = await prisma.assets.count();
const bpmStillExists = await prisma.assets.findUnique({ where: { asset_code: "AST-BPM-001" }, select: { id: true } });

console.log("\nPost-cleanup counts:");
console.log(`  work_orders: ${remainingWo}, parts_requests: ${remainingPr}, offline_inventory_movements: ${remainingOim}`);
console.log(`  assets preserved: ${assetsCount}, AST-BPM-001 present: ${!!bpmStillExists}`);

await prisma.$disconnect();
