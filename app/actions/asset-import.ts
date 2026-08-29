"use server";
import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { logSystemError } from "@/lib/errors/logging";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";
import {
  parseAssetsSheet,
  findDuplicates,
  NEEDS_REVIEW_LEAF,
  type ParsedAssetRow,
} from "@/lib/assets/asset-excel-mapping";

// Asset Register Import Mapping and New Asset Form Update Unit 10G.34.
//
// Replaces the previous generic "Asset Code / Category / Brand / Condition /
// Criticality" importer with one tailored to the maintenance team's actual
// Excel format (Asset Type / Make / Model / Plate No. / Chassis No. /
// Department-Location / Responsible Person-Driver / Remarks — see
// lib/assets/asset-excel-mapping.ts, shared with the local replace-import
// script so both paths agree). Messages are written for a normal
// maintenance user, not a technical one (Task 2): "171 assets found",
// "Duplicate plate number found in rows 12 and 45.", "Import completed
// successfully." — no mention of column mapping, categories, or codes.

const IGNORED_SHEET_NAMES = new Set(["cranes"]);

function selectSheet(wb: ExcelJS.Workbook, requestedName?: string): { ws: ExcelJS.Worksheet | null; ignored: string[] } {
  const allNames = wb.worksheets.map((w) => w.name);
  const wanted = (requestedName ?? "assets equipment").trim().toLowerCase();
  const exact = wb.worksheets.find((w) => w.name.trim().toLowerCase() === wanted);
  if (exact) return { ws: exact, ignored: allNames.filter((n) => n !== exact.name) };

  const fallback = wb.worksheets.find((w) => !IGNORED_SHEET_NAMES.has(w.name.trim().toLowerCase()));
  const chosen = fallback ?? wb.worksheets[0] ?? null;
  return { ws: chosen, ignored: allNames.filter((n) => n !== chosen?.name) };
}

export type AssetImportPreviewRow = ParsedAssetRow & {
  isDuplicatePlate: boolean;
  isDuplicateChassis: boolean;
};

export type AssetImportPreview = {
  sheetUsed: string | null;
  sheetsIgnored: string[];
  totalRowsFound: number;
  rows: AssetImportPreviewRow[];
  needsReviewCount: number;
  duplicateMessages: string[];
  error?: string;
};

const EMPTY_PREVIEW: Omit<AssetImportPreview, "error"> = {
  sheetUsed: null,
  sheetsIgnored: [],
  totalRowsFound: 0,
  rows: [],
  needsReviewCount: 0,
  duplicateMessages: [],
};

export async function parseAssetExcelForImportAction(formData: FormData): Promise<AssetImportPreview> {
  await requirePermission("assets.manage");

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { ...EMPTY_PREVIEW, error: "Please choose an Excel file to upload." };
  if (file.size > 10 * 1024 * 1024) return { ...EMPTY_PREVIEW, error: "File is too large. Maximum size is 10 MB." };

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    return { ...EMPTY_PREVIEW, error: "Could not read the file. Please try again." };
  }

  const wb = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(new Uint8Array(arrayBuffer)) as any);
  } catch {
    return { ...EMPTY_PREVIEW, error: "This file could not be opened. Please re-save it as .xlsx and try again." };
  }

  const { ws, ignored } = selectSheet(wb);
  if (!ws) {
    return { ...EMPTY_PREVIEW, error: "No sheet was found in this file." };
  }

  const { headerRowNum, rowsScanned, rows } = parseAssetsSheet(ws);
  if (headerRowNum === -1) {
    return {
      ...EMPTY_PREVIEW,
      sheetUsed: ws.name,
      sheetsIgnored: ignored,
      error: `The expected columns (Asset Type, Make, Plate No., Chassis No., ...) were not found in "${ws.name}".`,
    };
  }
  if (rows.length === 0) {
    return { ...EMPTY_PREVIEW, sheetUsed: ws.name, sheetsIgnored: ignored, error: "No assets were found in this file." };
  }

  const { plateDupes, chassisDupes } = findDuplicates(rows);
  const dupPlateRowNums = new Set(plateDupes.map((d) => d.row.rowNum));
  const dupChassisRowNums = new Set(chassisDupes.map((d) => d.row.rowNum));

  const duplicateMessages = [
    ...plateDupes.map((d) => `Duplicate plate number found in rows ${d.firstSeenRow} and ${d.row.rowNum}.`),
    ...chassisDupes.map((d) => `Duplicate chassis number found in rows ${d.firstSeenRow} and ${d.row.rowNum}.`),
  ];

  const previewRows: AssetImportPreviewRow[] = rows.map((r) => ({
    ...r,
    isDuplicatePlate: dupPlateRowNums.has(r.rowNum),
    isDuplicateChassis: dupChassisRowNums.has(r.rowNum),
  }));

  return {
    sheetUsed: ws.name,
    sheetsIgnored: ignored,
    totalRowsFound: rowsScanned,
    rows: previewRows,
    needsReviewCount: rows.filter((r) => r.categorySource === "needs_review").length,
    duplicateMessages,
  };
}

export type AssetImportResult = {
  totalRowsFound: number;
  imported: number;
  skipped: number;
  needsReview: number;
  duplicateWarnings: number;
  replaced: boolean;
  oldAssetsRemoved: number;
};

// Task 3 — "Replace Asset Register": clears the current asset list (and the
// local demo Job Cards/sessions/notifications that reference it) before
// importing. Only ever reachable through this explicit, separately-named
// action — never triggered by the plain "Import" button — and the UI form
// requires its own typed confirmation before calling it (Task 3's "do not
// accidentally delete assets on normal upload click").
export async function replaceAssetRegisterAction(rows: AssetImportPreviewRow[]): Promise<AssetImportResult> {
  const context = await requirePermission("assets.manage");

  // Unit 10H.2 production-readiness review: this transaction below does not
  // just replace assets — it wipes ALL work orders, purchase requests,
  // parts requests, purchase orders, service contracts, notifications, and
  // realtime events system-wide (not scoped to the assets being replaced).
  // `assets.manage` alone (held by maintenance_data_entry) is far too broad
  // a gate for that; only Super Admin may run it.
  if (context.role?.slug !== "super_admin") {
    throw new Error("Only a Super Admin can replace the asset register. Use \"Add these assets\" instead, or ask a Super Admin to run this.");
  }

  const existingCategories = await prisma.asset_categories.findMany();
  const catByLowerName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c]));
  const parentIdByLowerName = new Map(
    existingCategories.filter((c) => c.parent_id === null).map((c) => [c.name.toLowerCase(), c.id])
  );

  const neededLeaves = new Set(rows.map((r) => r.leaf));
  for (const leaf of neededLeaves) {
    if (catByLowerName.has(leaf.toLowerCase())) continue;
    const sample = rows.find((r) => r.leaf === leaf);
    const parentName = leaf === NEEDS_REVIEW_LEAF ? "Other" : (sample?.parentIfNew ?? "Other");
    const parentId = parentIdByLowerName.get(parentName.toLowerCase()) ?? parentIdByLowerName.get("other");
    const created = await prisma.asset_categories.create({
      data: { name: leaf, parent_id: parentId ?? null, is_active: true },
    });
    catByLowerName.set(leaf.toLowerCase(), created);
  }

  const before = await prisma.assets.count();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.inventory_movements.updateMany({
        data: { work_order_id: null, parts_request_id: null, purchase_request_id: null },
      });
      await tx.workflowInstance.deleteMany({ where: { entity_type: "work_order" } });
      await tx.workOrderWorkSession.deleteMany({});
      await tx.workOrderWorkerAssignment.deleteMany({});
      await tx.workOrderRequiredPart.deleteMany({});
      await tx.work_order_status_history.deleteMany({});
      await tx.work_order_technician_notes.deleteMany({});
      await tx.work_order_materials.deleteMany({});
      await tx.work_order_labor.deleteMany({});
      await tx.work_order_attachments.deleteMany({});
      await tx.work_order_assignments.deleteMany({});
      await tx.purchaseOrder.deleteMany({});
      await tx.parts_request_attachments.deleteMany({});
      await tx.parts_request_items.deleteMany({});
      await tx.approvals.deleteMany({});
      await tx.parts_requests.deleteMany({});
      await tx.purchase_requests.deleteMany({});
      await tx.service_contracts.deleteMany({});
      await tx.asset_documents.deleteMany({});
      await tx.work_orders.deleteMany({});
      await tx.assets.deleteMany({});
      await tx.notification_delivery_logs.deleteMany({});
      await tx.notifications.deleteMany({});
      await tx.realtime_events.deleteMany({});
      await tx.numbering_sequences.updateMany({ data: { current_value: 0 } });

      for (const r of rows) {
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
            created_by: context.userId,
            updated_by: context.userId,
          },
        });
      }
    }, { timeout: 120000 });
  } catch (err) {
    await logSystemError({
      source: "asset-import.replaceAssetRegisterAction",
      severity: "error",
      message: err instanceof Error ? err.message : "Replace import failed",
      userId: context.userId,
      route: "/assets/import",
      entityType: "asset",
      metadata: { rowCount: rows.length },
    });
    throw new Error("The asset list could not be replaced. No changes were made.");
  }

  const { plateDupes, chassisDupes } = findDuplicates(rows);
  const needsReview = rows.filter((r) => r.categorySource === "needs_review").length;

  await writeAuditLog({
    actorId: context.userId,
    action: "asset.replace_import",
    entityType: "asset",
    entityId: null,
    summary: `Replaced asset register from Excel: ${before} removed, ${rows.length} imported`,
    metadata: { before, imported: rows.length, needsReview },
  });

  if (rows.length > 0) {
    await notifyWorkflowEvent({
      eventKey: "asset.updated",
      entityType: "asset",
      entityId: null,
      actorId: context.userId,
      recipientRoles: ["super_admin", "maintenance_manager"],
      title: "Asset Register Replaced",
      message: `Asset list replaced from Excel: ${rows.length} asset${rows.length === 1 ? "" : "s"} imported.`,
    });
  }

  return {
    totalRowsFound: rows.length,
    imported: rows.length,
    skipped: 0,
    needsReview,
    duplicateWarnings: plateDupes.length + chassisDupes.length,
    replaced: true,
    oldAssetsRemoved: before,
  };
}

// Plain "Add to current list" import — never deletes anything, matches
// existing asset codes/plate numbers to skip duplicates instead. This is
// the button that runs on a normal upload click (Task 3 — "do not
// accidentally delete assets on normal upload click").
export async function addAssetsFromExcelAction(rows: AssetImportPreviewRow[]): Promise<AssetImportResult> {
  const context = await requirePermission("assets.manage");

  const [existingCodes, existingPlates, existingChassis, existingCategories] = await Promise.all([
    prisma.assets.findMany({ where: { deleted_at: null }, select: { asset_code: true } }),
    prisma.assets.findMany({ where: { deleted_at: null, plate_number: { not: null } }, select: { plate_number: true } }),
    prisma.assets.findMany({ where: { deleted_at: null, chassis_number: { not: null } }, select: { chassis_number: true } }),
    prisma.asset_categories.findMany(),
  ]);
  const codeSet = new Set(existingCodes.map((a) => a.asset_code.toLowerCase()));
  const plateSet = new Set(existingPlates.map((a) => (a.plate_number ?? "").trim().toLowerCase()).filter(Boolean));
  const chassisSet = new Set(existingChassis.map((a) => (a.chassis_number ?? "").trim().toLowerCase()).filter(Boolean));
  const catByLowerName = new Map(existingCategories.map((c) => [c.name.toLowerCase(), c]));
  const parentIdByLowerName = new Map(
    existingCategories.filter((c) => c.parent_id === null).map((c) => [c.name.toLowerCase(), c.id])
  );

  let imported = 0;
  let skipped = 0;

  for (const r of rows) {
    if (codeSet.has(r.assetCode.toLowerCase())) { skipped++; continue; }
    if (r.plateNumber && plateSet.has(r.plateNumber.trim().toLowerCase())) { skipped++; continue; }
    if (r.chassisNumber && chassisSet.has(r.chassisNumber.trim().toLowerCase())) { skipped++; continue; }

    if (!catByLowerName.has(r.leaf.toLowerCase())) {
      const parentName = r.leaf === NEEDS_REVIEW_LEAF ? "Other" : r.parentIfNew;
      const parentId = parentIdByLowerName.get(parentName.toLowerCase()) ?? parentIdByLowerName.get("other");
      try {
        const created = await prisma.asset_categories.create({
          data: { name: r.leaf, parent_id: parentId ?? null, is_active: true },
        });
        catByLowerName.set(r.leaf.toLowerCase(), created);
      } catch {
        // Unique constraint race — another request created it first; ignore.
      }
    }

    try {
      await prisma.assets.create({
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
          created_by: context.userId,
          updated_by: context.userId,
        },
      });
      codeSet.add(r.assetCode.toLowerCase());
      if (r.plateNumber) plateSet.add(r.plateNumber.trim().toLowerCase());
      if (r.chassisNumber) chassisSet.add(r.chassisNumber.trim().toLowerCase());
      imported++;
    } catch (err) {
      await logSystemError({
        source: "asset-import.addAssetsFromExcelAction",
        severity: "warning",
        message: err instanceof Error ? err.message : "Asset row create failed",
        userId: context.userId,
        route: "/assets/import",
        entityType: "asset",
        metadata: { rowNumber: r.rowNum, asset_code: r.assetCode },
      });
      skipped++;
    }
  }

  const { plateDupes, chassisDupes } = findDuplicates(rows);
  const needsReview = rows.filter((r) => r.categorySource === "needs_review").length;

  await writeAuditLog({
    actorId: context.userId,
    action: "asset.import",
    entityType: "asset",
    entityId: null,
    summary: `Imported ${imported} asset(s) from Excel (${skipped} skipped)`,
    metadata: { imported, skipped, needsReview },
  });

  if (imported > 0) {
    await notifyWorkflowEvent({
      eventKey: "asset.updated",
      entityType: "asset",
      entityId: null,
      actorId: context.userId,
      recipientRoles: ["super_admin", "maintenance_manager"],
      title: "Assets Imported",
      message: `${imported} asset${imported === 1 ? "" : "s"} imported from Excel${skipped ? ` (${skipped} skipped)` : ""}.`,
    });
  }

  return {
    totalRowsFound: rows.length,
    imported,
    skipped,
    needsReview,
    duplicateWarnings: plateDupes.length + chassisDupes.length,
    replaced: false,
    oldAssetsRemoved: 0,
  };
}
