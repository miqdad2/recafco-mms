/**
 * Soft-delete RECAFCO demo/seed assets and any linked work orders.
 *
 * Guard: set CONFIRM_DELETE_DEMO_ASSETS=true to execute.
 * Without the env var the script runs in dry-run mode and only prints counts.
 *
 * Usage:
 *   node scripts/cleanup-demo-assets.mjs                          # dry run
 *   CONFIRM_DELETE_DEMO_ASSETS=true node scripts/cleanup-demo-assets.mjs
 */

import { PrismaClient } from "@prisma/client";

const DEMO_ASSET_CODES = [
  "AST-BPM-001",
  "AST-BUS-001",
  "AST-CAR-001",
  "AST-CMP-001",
  "AST-CRN-001",
  "AST-ELP-004",
  "AST-FRK-001",
  "AST-GEN-001",
  "AST-GEN-002",
  "AST-GRC-001",
  "AST-HCL-002",
  "AST-HVA-001",
  "AST-LFT-001",
  "AST-MCH-001",
  "AST-MCH-002",
  "AST-PMP-001",
  "AST-PUP-001",
  "AST-TLG-001",
  "AST-TRK-001",
  "AST-WLD-001",
];

const confirm = process.env.CONFIRM_DELETE_DEMO_ASSETS === "true";
const prisma = new PrismaClient();

async function main() {
  const now = new Date();

  const assets = await prisma.assets.findMany({
    where: {
      asset_code: { in: DEMO_ASSET_CODES },
      deleted_at: null,
    },
    select: { id: true, asset_code: true, asset_name: true },
  });

  if (assets.length === 0) {
    console.log("No matching demo assets found (already cleaned up or never seeded).");
    return;
  }

  const assetIds = assets.map((a) => a.id);

  const linkedWorkOrders = await prisma.work_orders.findMany({
    where: { asset_id: { in: assetIds }, deleted_at: null },
    select: { id: true, work_order_number: true, status: true },
  });

  console.log("");
  console.log("=== Demo Asset Cleanup ===");
  console.log(`Assets found   : ${assets.length}`);
  assets.forEach((a) => console.log(`  - ${a.asset_code}  ${a.asset_name}`));
  console.log(`Work orders    : ${linkedWorkOrders.length}`);
  linkedWorkOrders.forEach((w) => console.log(`  - ${w.work_order_number}  [${w.status}]`));
  console.log("");

  if (!confirm) {
    console.log("DRY RUN — no changes made.");
    console.log("Set CONFIRM_DELETE_DEMO_ASSETS=true to execute the soft-delete.");
    return;
  }

  // Soft-delete linked work orders first
  if (linkedWorkOrders.length > 0) {
    await prisma.work_orders.updateMany({
      where: { id: { in: linkedWorkOrders.map((w) => w.id) } },
      data: { deleted_at: now },
    });
    console.log(`Soft-deleted ${linkedWorkOrders.length} work order(s).`);
  }

  // Soft-delete the assets
  await prisma.assets.updateMany({
    where: { id: { in: assetIds } },
    data: { deleted_at: now },
  });
  console.log(`Soft-deleted ${assets.length} asset(s).`);
  console.log("Done.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
