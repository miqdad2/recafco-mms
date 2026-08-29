/**
 * Asset Register Import Mapping and New Asset Form Update (Unit 10G.34) —
 * LOCAL DEV ONLY.
 *
 * Reads exactly one named sheet from an Excel workbook ("assets equipment"),
 * ignores every other sheet, parses only "the current asset list" within it
 * (stops at the first large blank gap — see
 * lib/assets/asset-excel-mapping.ts's END_OF_LIST_ROW_GAP comment for why),
 * and REPLACES the entire local `assets` table with those rows — plus every
 * local Job Card / work-session / notification record that exists only as
 * demo/test data tied to the old assets being removed.
 *
 * Parsing/mapping logic lives in lib/assets/asset-excel-mapping.ts, shared
 * with the browser-driven Import Excel feature (app/actions/asset-import.ts)
 * so both paths produce identical results. Imported here via a relative
 * path (not the "@/..." alias, which only resolves inside the Next.js app)
 * — Node's built-in TypeScript type-stripping runs the file directly.
 *
 * Safety:
 *   - Refuses to run against anything but a localhost/127.0.0.1 DATABASE_URL.
 *   - Without --confirm-replace-assets, this is a dry run: the workbook is
 *     parsed and a full preview/summary is printed, but zero database writes
 *     happen (no cleanup, no import).
 *   - All destructive writes (cleanup + import) happen inside one Prisma
 *     $transaction — either the whole replace succeeds, or none of it does.
 *
 * Usage:
 *   node --env-file=.env scripts/replace-assets-from-excel.mjs --file "./Copy of assets.xlsx" --sheet "assets equipment"
 *   node --env-file=.env scripts/replace-assets-from-excel.mjs --file "./Copy of assets.xlsx" --sheet "assets equipment" --confirm-replace-assets
 *
 * (also runnable as: npm run assets:replace-local -- --file "..." --sheet "assets equipment" --confirm-replace-assets)
 */

import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import {
  parseAssetsSheet,
  findDuplicates,
  NEEDS_REVIEW_LEAF,
} from "../lib/assets/asset-excel-mapping.ts";

// ─── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const out = { file: null, sheet: "assets equipment", confirm: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file") out.file = argv[++i];
    else if (a === "--sheet") out.sheet = argv[++i];
    else if (a === "--confirm-replace-assets") out.confirm = true;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (!args.file) {
  console.error("Missing required --file <path to .xlsx>");
  process.exit(1);
}

// ─── Safety guard — local dev DB only ────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL ?? "";
const isLocalDb = /(^|@)(localhost|127\.0\.0\.1)(:|\/)/i.test(dbUrl);
if (!isLocalDb) {
  console.error("REFUSING TO RUN: DATABASE_URL does not look like a local database.");
  console.error(`  DATABASE_URL host check failed for: ${dbUrl.replace(/:[^:@]+@/, ":***@")}`);
  console.error("  This script only ever runs against localhost/127.0.0.1, per Unit 10G.34 scope (LOCAL ONLY).");
  process.exit(1);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== RECAFCO MMS Asset Register Replace Import (Unit 10G.34) ===");
  console.log(`File           : ${args.file}`);
  console.log(`Sheet requested: ${args.sheet}`);
  console.log(`Mode           : ${args.confirm ? "LIVE (--confirm-replace-assets set)" : "DRY RUN (no writes)"}`);
  console.log("");

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.readFile(args.file);
  } catch (err) {
    console.error(`Could not read workbook at "${args.file}": ${err.message}`);
    process.exit(1);
  }

  const allSheetNames = wb.worksheets.map((w) => w.name);
  const ws = wb.worksheets.find((w) => w.name.trim().toLowerCase() === args.sheet.trim().toLowerCase());
  const ignoredSheets = allSheetNames.filter((n) => n.trim().toLowerCase() !== args.sheet.trim().toLowerCase());

  console.log(`Sheets found in workbook: ${allSheetNames.join(", ")}`);
  console.log(`Sheet used             : ${ws ? ws.name : "(NOT FOUND)"}`);
  console.log(`Sheets ignored         : ${ignoredSheets.length ? ignoredSheets.join(", ") : "(none)"}`);
  console.log("");

  if (!ws) {
    console.error(`Sheet "${args.sheet}" was not found in this workbook. Aborting — nothing was changed.`);
    process.exit(1);
  }

  const { headerRowNum, rowsScanned, rows: parsed } = parseAssetsSheet(ws);
  if (headerRowNum === -1) {
    console.error(`Could not find a recognizable header row in sheet "${ws.name}".`);
    process.exit(1);
  }
  console.log(`Header row detected at row ${headerRowNum}.`);
  console.log(`Total rows found: ${rowsScanned}`);
  console.log("");

  const { codeDupes, plateDupes, chassisDupes } = findDuplicates(parsed);

  if (codeDupes.length > 0) {
    console.error(`BLOCKED: ${codeDupes.length} duplicate generated asset code(s) found — aborting without writing anything.`);
    for (const r of codeDupes) console.error(`  row ${r.rowNum}: ${r.assetCode}`);
    process.exit(1);
  }
  if (plateDupes.length > 0) {
    for (const d of plateDupes) console.log(`Duplicate plate number found in rows ${d.firstSeenRow} and ${d.row.rowNum}.`);
  }
  if (chassisDupes.length > 0) {
    for (const d of chassisDupes) console.log(`Duplicate chassis number found in rows ${d.firstSeenRow} and ${d.row.rowNum}.`);
  }
  console.log("");

  const byLeaf = new Map();
  for (const r of parsed) byLeaf.set(r.leaf, (byLeaf.get(r.leaf) ?? 0) + 1);
  const needsReview = parsed.filter((r) => r.categorySource === "needs_review");
  const missingPlateCount = parsed.filter((r) => !r.plateNumber).length;
  const missingChassisCount = parsed.filter((r) => !r.chassisNumber).length;

  console.log("Asset type counts:");
  for (const [type, count] of [...byLeaf.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type.padEnd(18)} ${count}`);
  }
  console.log("");
  console.log(`Missing plate count   : ${missingPlateCount}`);
  console.log(`Missing chassis count : ${missingChassisCount}`);
  console.log(`Needs Review          : ${needsReview.length}`);
  if (needsReview.length > 0) {
    for (const r of needsReview) console.log(`  row ${r.rowNum} [${r.assetCode}] make="${r.make}" — Asset Type missing or unrecognized`);
  }
  console.log("");
  console.log(`${rowsScanned} assets found.`);
  console.log("");

  if (!args.confirm) {
    console.log("DRY RUN — no database changes were made.");
    console.log("Re-run with --confirm-replace-assets to actually delete old local assets and import this sheet.");
    return;
  }

  // ── LIVE: cleanup + import, one transaction ──────────────────────────────
  const prisma = new PrismaClient();
  try {
    const before = {
      assets: await prisma.assets.count(),
      work_orders: await prisma.work_orders.count(),
    };

    const existingCategories = await prisma.asset_categories.findMany();
    const catByLowerName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c]));
    const parentIdByLowerName = new Map(
      existingCategories.filter((c) => c.parent_id === null).map((c) => [c.name.toLowerCase(), c.id])
    );

    // Resolve/create every leaf category this batch needs, BEFORE the
    // transaction (category creation is additive/non-destructive).
    const neededLeaves = new Set(parsed.map((r) => r.leaf));
    for (const leaf of neededLeaves) {
      if (catByLowerName.has(leaf.toLowerCase())) continue;
      const sample = parsed.find((r) => r.leaf === leaf);
      const parentName = leaf === NEEDS_REVIEW_LEAF ? "Other" : (sample?.parentIfNew ?? "Other");
      const parentId = parentIdByLowerName.get(parentName.toLowerCase()) ?? parentIdByLowerName.get("other");
      const created = await prisma.asset_categories.create({
        data: { name: leaf, parent_id: parentId ?? null, is_active: true },
      });
      catByLowerName.set(leaf.toLowerCase(), created);
      console.log(`Created new asset type "${leaf}" under "${parentName}".`);
    }

    console.log("");
    console.log("Running local cleanup + import inside one transaction...");

    await prisma.$transaction(async (tx) => {
      // Sever dangling FK links from inventory movements without deleting
      // the movements/parts-catalog data itself.
      await tx.inventory_movements.updateMany({
        data: { work_order_id: null, parts_request_id: null, purchase_request_id: null },
      });

      // Workflow engine runtime instances tied to work orders (definitions
      // and steps — the templates — are never touched here).
      await tx.workflowInstance.deleteMany({ where: { entity_type: "work_order" } });

      // Work-order children, deepest first.
      await tx.workOrderWorkSession.deleteMany({});
      await tx.workOrderWorkerAssignment.deleteMany({});
      await tx.workOrderRequiredPart.deleteMany({});
      await tx.work_order_status_history.deleteMany({});
      await tx.work_order_technician_notes.deleteMany({});
      await tx.work_order_materials.deleteMany({});
      await tx.work_order_labor.deleteMany({});
      await tx.work_order_attachments.deleteMany({});
      await tx.work_order_assignments.deleteMany({});
      await tx.purchaseOrder.deleteMany({}); // cascades PurchaseOrderItem
      await tx.parts_request_attachments.deleteMany({});
      await tx.parts_request_items.deleteMany({});
      await tx.approvals.deleteMany({});
      await tx.parts_requests.deleteMany({});
      await tx.purchase_requests.deleteMany({});

      // Asset children, then the assets themselves.
      await tx.service_contracts.deleteMany({});
      await tx.asset_documents.deleteMany({});

      await tx.work_orders.deleteMany({});
      await tx.assets.deleteMany({});

      // Notification / realtime demo records.
      await tx.notification_delivery_logs.deleteMany({});
      await tx.notifications.deleteMany({});
      await tx.realtime_events.deleteMany({});

      // Reset numbering sequences (work order / parts request numbering) so
      // a fresh Job Card/Materials Request restarts cleanly.
      await tx.numbering_sequences.updateMany({ data: { current_value: 0 } });

      // Import — only the parsed "current asset list" rows.
      for (const r of parsed) {
        await tx.assets.create({
          data: {
            asset_code: r.assetCode,
            asset_name: r.make || r.assetCode,
            category: r.leaf,
            location: r.location,
            brand: r.brand,
            model: r.model,
            model_year: r.modelYear,
            plate_number: r.plateNumber,
            chassis_number: r.chassisNumber,
            registration_expiry_date: r.registrationExpiryDate,
            assigned_operator_driver: r.driver,
            status: "Active",
            remarks: r.remarks,
            notes: r.notes,
          },
        });
      }
    }, { timeout: 120000 });

    const after = {
      assets: await prisma.assets.count(),
      work_orders: await prisma.work_orders.count(),
    };

    console.log("");
    console.log("=== Import completed ===");
    console.log(`Old assets deleted      : ${before.assets}`);
    console.log(`Old work orders deleted : ${before.work_orders}`);
    console.log(`Sheet used              : ${ws.name}`);
    console.log(`Sheets ignored          : ${ignoredSheets.join(", ") || "(none)"}`);
    console.log(`Total rows found        : ${rowsScanned}`);
    console.log(`Assets imported         : ${parsed.length}`);
    console.log(`Skipped rows            : 0`);
    console.log(`Needs Review            : ${needsReview.length}`);
    console.log(`Duplicate warnings      : ${plateDupes.length + chassisDupes.length}`);
    console.log(`Final assets in database: ${after.assets}`);
    console.log("Asset type counts:");
    for (const [type, count] of [...byLeaf.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type.padEnd(18)} ${count}`);
    }
    console.log("");
    console.log("Import completed successfully.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
