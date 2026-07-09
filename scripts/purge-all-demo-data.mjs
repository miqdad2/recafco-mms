/**
 * HARD DELETE all demo/mock data from RECAFCO MMS.
 *
 * Deletes (permanently, no recovery):
 *   - All work orders and every child record
 *   - All assets and every child record
 *   - All spare parts and every child record
 *   - All notifications
 *   - Resets numbering sequences to 0
 *
 * Does NOT touch:
 *   - Users, profiles, sessions
 *   - Roles, permissions, departments
 *   - App settings
 *   - Asset categories
 *   - Workflow definitions / steps
 *   - Audit logs
 *   - System error logs
 *
 * Guard: set CONFIRM_PURGE_DEMO_DATA=true to execute.
 */

import { PrismaClient } from "@prisma/client";

const confirm = process.env.CONFIRM_PURGE_DEMO_DATA === "true";
const prisma = new PrismaClient();

async function countAll() {
  const [
    workOrders,
    assets,
    parts,
    notifications,
  ] = await Promise.all([
    prisma.work_orders.count(),
    prisma.assets.count(),
    prisma.parts.count(),
    prisma.notifications.count(),
  ]);
  return { workOrders, assets, parts, notifications };
}

async function main() {
  const before = await countAll();

  console.log("");
  console.log("=== RECAFCO Demo Data Purge ===");
  console.log(`Work orders  : ${before.workOrders}`);
  console.log(`Assets       : ${before.assets}`);
  console.log(`Spare parts  : ${before.parts}`);
  console.log(`Notifications: ${before.notifications}`);
  console.log("");

  if (before.workOrders === 0 && before.assets === 0 && before.parts === 0) {
    console.log("Nothing to purge — all tables are already empty.");
    return;
  }

  if (!confirm) {
    console.log("DRY RUN — no changes made.");
    console.log("Set CONFIRM_PURGE_DEMO_DATA=true to permanently delete all of the above.");
    return;
  }

  console.log("Purging...");

  // Use raw SQL inside a transaction so everything is atomic.
  // Delete in FK dependency order (deepest children first).
  await prisma.$transaction([
    // ── Work-order children (deepest first) ───────────────────────────────
    prisma.$executeRaw`DELETE FROM clarification_requests`,
    prisma.$executeRaw`DELETE FROM workflow_step_instances`,
    prisma.$executeRaw`DELETE FROM workflow_instances`,
    prisma.$executeRaw`DELETE FROM work_order_materials`,
    prisma.$executeRaw`DELETE FROM work_order_required_parts`,
    prisma.$executeRaw`DELETE FROM work_order_assignments`,
    prisma.$executeRaw`DELETE FROM work_order_attachments`,
    prisma.$executeRaw`DELETE FROM work_order_labor`,
    prisma.$executeRaw`DELETE FROM work_order_status_history`,
    prisma.$executeRaw`DELETE FROM work_order_technician_notes`,
    prisma.$executeRaw`DELETE FROM parts_request_items`,
    prisma.$executeRaw`DELETE FROM purchase_order_items`,
    prisma.$executeRaw`DELETE FROM purchase_request_items`,
    prisma.$executeRaw`DELETE FROM purchase_orders`,
    prisma.$executeRaw`DELETE FROM approvals`,
    prisma.$executeRaw`DELETE FROM purchase_requests`,
    prisma.$executeRaw`DELETE FROM parts_requests`,
    prisma.$executeRaw`DELETE FROM work_orders`,

    // ── Asset children ─────────────────────────────────────────────────────
    prisma.$executeRaw`DELETE FROM asset_documents`,
    prisma.$executeRaw`DELETE FROM assets`,

    // ── Parts / inventory ──────────────────────────────────────────────────
    prisma.$executeRaw`DELETE FROM inventory_movements`,
    prisma.$executeRaw`DELETE FROM parts`,

    // ── Notifications ──────────────────────────────────────────────────────
    prisma.$executeRaw`DELETE FROM notifications`,

    // ── Reset numbering sequences ──────────────────────────────────────────
    prisma.$executeRaw`UPDATE numbering_sequences SET current_value = 0`,
  ]);

  const after = await countAll();
  console.log("");
  console.log("Done.");
  console.log(`Work orders  : ${before.workOrders} → ${after.workOrders}`);
  console.log(`Assets       : ${before.assets} → ${after.assets}`);
  console.log(`Spare parts  : ${before.parts} → ${after.parts}`);
  console.log(`Notifications: ${before.notifications} → ${after.notifications}`);
  console.log("Numbering sequences reset to 0.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
