/**
 * RECAFCO MMS Full E2E Workflow Test — cleanup.
 *
 * Deletes only rows reachable from work_orders.ordered_by = "E2E-MMS-Test"
 * (the marker every Job Card created by tests/e2e/*.spec.ts sets in the
 * "Order taken by" field — see tests/e2e/helpers.ts). Never touches assets,
 * users, roles, permissions, schema, or any other data. Follows the same
 * guard/marker pattern as scripts/e2e-unit10-cleanup.mjs.
 *
 * Most child rows (work_order_worker_assignments, work_order_work_sessions,
 * work_order_required_parts, work_order_attachments, approvals,
 * parts_requests + their items/attachments, etc.) cascade-delete
 * automatically via onDelete: Cascade FKs to work_orders.id — see
 * prisma/schema.prisma. Three things do NOT cascade and are deleted
 * explicitly first: notifications/audit_logs (entity_id reference, no FK),
 * and offline_inventory_movements (onDelete: SetNull, not Cascade — deleting
 * these ISSUED/RECEIVED test movements also restores the real "engine
 * filter" stock balance that Issue/Receive Material consumed during the
 * test run).
 *
 * Guard: set CONFIRM_E2E_MMS_CLEANUP=true to execute. Without it, the
 * script prints a warning and exits without deleting anything.
 *
 * Usage:
 *   CONFIRM_E2E_MMS_CLEANUP=true node --env-file=.env scripts/e2e-mms-cleanup.mjs
 */

import { PrismaClient } from "@prisma/client";

const MARKER = "E2E-MMS-Test";

if (process.env.CONFIRM_E2E_MMS_CLEANUP !== "true") {
  console.warn(
    "[e2e-mms-cleanup] Refusing to run: this permanently deletes E2E MMS test data from whichever " +
      "database DATABASE_URL currently points to, with no dry-run mode. " +
      "Set CONFIRM_E2E_MMS_CLEANUP=true to proceed.\n" +
      "  Usage: CONFIRM_E2E_MMS_CLEANUP=true node --env-file=.env scripts/e2e-mms-cleanup.mjs"
  );
  process.exit(0);
}

const prisma = new PrismaClient({ log: ["error"] });

const workOrders = await prisma.work_orders.findMany({ where: { ordered_by: MARKER }, select: { id: true, work_order_number: true } });
const woIds = workOrders.map((w) => w.id);

const partsRequests = await prisma.parts_requests.findMany({ where: { work_order_id: { in: woIds } }, select: { id: true } });
const prIds = partsRequests.map((p) => p.id);

console.log(`[e2e-mms-cleanup] Found ${woIds.length} E2E MMS Job Card(s): ${workOrders.map((w) => w.work_order_number).join(", ") || "(none)"}`);

if (woIds.length === 0) {
  console.log("[e2e-mms-cleanup] Nothing to clean up.");
  await prisma.$disconnect();
  process.exit(0);
}

const movementsDeleted = await prisma.offline_inventory_movements.deleteMany({
  where: { OR: [{ related_work_order_id: { in: woIds } }, { parts_request_id: { in: prIds } }] },
});
const notifDeleted = await prisma.notifications.deleteMany({ where: { entity_id: { in: [...woIds, ...prIds] } } });
const auditDeleted = await prisma.audit_logs.deleteMany({
  where: { OR: [{ entity_type: "work_order", entity_id: { in: woIds } }, { entity_type: "parts_request", entity_id: { in: prIds } }] },
});

// Cascades: approvals, parts_requests (+ items/attachments), work_order_worker_assignments,
// work_order_work_sessions, work_order_required_parts, work_order_attachments,
// work_order_labor, work_order_materials, work_order_status_history, work_order_technician_notes.
const woDeleted = await prisma.work_orders.deleteMany({ where: { id: { in: woIds } } });

console.log(`  offline_inventory_movements: ${movementsDeleted.count}`);
console.log(`  notifications:               ${notifDeleted.count}`);
console.log(`  audit_logs:                  ${auditDeleted.count}`);
console.log(`  work_orders (+ cascades):    ${woDeleted.count}`);

const remainingWo = await prisma.work_orders.count({ where: { ordered_by: MARKER } });
const engineFilterBalanceMovements = await prisma.offline_inventory_movements.count({ where: { manual_material_name: "engine filter" } });

console.log("\nPost-cleanup:");
console.log(`  remaining E2E MMS work_orders: ${remainingWo}`);
console.log(`  "engine filter" movements remaining (should equal the pre-test count): ${engineFilterBalanceMovements}`);

await prisma.$disconnect();
