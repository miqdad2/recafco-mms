"use server";
import "server-only";

import ExcelJS from "exceljs";

import { prisma } from "@/lib/db/prisma";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { writeAuditLog } from "@/lib/audit/log";
import { revalidatePath } from "next/cache";
import { UNITS, normalizeCategory } from "@/components/store/offline-inventory-types";
import { requireOfflineInventoryManage } from "@/lib/store/offline-inventory-data";
import { emitOfflineInventoryRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";

export type ImportRowStatus =
  | "valid"
  | "missing_name"
  | "invalid_quantity"
  | "invalid_unit"
  | "duplicate";

export type ImportPreviewRow = {
  rowNumber: number;
  material_name: string;
  category: string;
  part_number: string;
  ss_rec_code: string;
  quantity: number;
  unit: string;
  location: string;
  remarks: string;
  status: ImportRowStatus;
  valid: boolean;
};

export type ImportResult = {
  imported: number;
  skipped: number;
  batchReference: string;
  failures: Array<{ rowNumber: number; material_name: string; reason: string }>;
};

type RowField =
  | "material_name"
  | "category"
  | "part_number"
  | "ss_rec_code"
  | "quantity"
  | "unit"
  | "location"
  | "remarks";

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) {
    return String((v as ExcelJS.CellFormulaValue).result ?? "").trim();
  }
  return String(v).trim();
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s/_\-.]/g, "");
}

const HEADER_MAP: Record<string, RowField> = {
  materialname: "material_name",
  material:     "material_name",
  name:         "material_name",
  category:     "category",
  partnumber:   "part_number",
  partno:       "part_number",
  partnum:      "part_number",
  ssreccode:    "ss_rec_code",
  ssrec:        "ss_rec_code",
  sscode:       "ss_rec_code",
  openingquantity: "quantity",
  openingqty:      "quantity",
  quantity:        "quantity",
  qty:             "quantity",
  unit:         "unit",
  locationbin:  "location",
  location:     "location",
  bin:          "location",
  remarks:      "remarks",
  comments:     "remarks",
  notes:        "remarks",
};

function duplicateKey(name: string, partNumber: string, ssRecCode: string, unit: string): string {
  return `${name.toLowerCase().trim()}|${partNumber.toLowerCase().trim()}|${ssRecCode.toLowerCase().trim()}|${unit.toLowerCase().trim()}`;
}

const ROW_LIMIT = 500;
const ALLOWED_UNITS = new Set<string>(UNITS);

export async function parseOpeningStockExcelAction(
  formData: FormData
): Promise<{ rows: ImportPreviewRow[]; error?: string }> {
  await requireOfflineInventoryManage();

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { rows: [], error: "No file provided." };
  if (file.size > 10 * 1024 * 1024) return { rows: [], error: "File too large. Maximum 10 MB." };

  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    return { rows: [], error: "Could not read file." };
  }

  const wb = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await wb.xlsx.load(Buffer.from(new Uint8Array(arrayBuffer)) as any);
  } catch {
    return { rows: [], error: "Could not parse Excel file. Ensure it is a valid .xlsx or .xls file." };
  }

  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], error: "No worksheet found in the file." };

  let headerRowNum = -1;
  const colMap: Record<number, RowField> = {};

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (headerRowNum !== -1) return;
    let matchCount = 0;
    row.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const h = normalizeHeader(String(cell.value ?? ""));
      if (HEADER_MAP[h]) {
        colMap[colNum] = HEADER_MAP[h];
        matchCount++;
      }
    });
    if (matchCount >= 2) headerRowNum = rowNum;
  });

  if (headerRowNum === -1) {
    return {
      rows: [],
      error: "Could not find a valid header row. Expected columns: Material Name, Category, Opening Quantity, Unit.",
    };
  }

  const mappedFields = new Set(Object.values(colMap));
  const requiredFields: RowField[] = ["material_name", "category", "quantity", "unit"];
  const missingRequired = requiredFields.filter((f) => !mappedFields.has(f));
  if (missingRequired.length > 0) {
    return {
      rows: [],
      error: "Missing required columns: Material Name, Category, Opening Quantity, Unit.",
    };
  }

  const existingOpeningStock = await prisma.offline_inventory_movements.findMany({
    where: { movement_type: "OPENING_STOCK", deleted_at: null },
    select: { manual_material_name: true, manual_part_number: true, ss_rec_code: true, unit: true },
  });
  const existingKeys = new Set(
    existingOpeningStock.map((m) =>
      duplicateKey(m.manual_material_name ?? "", m.manual_part_number ?? "", m.ss_rec_code ?? "", m.unit)
    )
  );

  const rows: ImportPreviewRow[] = [];
  const seenKeys = new Set<string>();

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRowNum) return;
    if (rows.length >= ROW_LIMIT) return;

    const get = (field: RowField): string => {
      for (const [colStr, f] of Object.entries(colMap)) {
        if (f === field) return cellStr(row.getCell(Number(colStr)));
      }
      return "";
    };

    const materialName = get("material_name");
    const categoryRaw  = get("category");
    const partNumber   = get("part_number");
    const ssRecCode    = get("ss_rec_code");
    const quantityRaw  = get("quantity");
    const unitRaw      = get("unit").toUpperCase();
    const location     = get("location");
    const remarks      = get("remarks");

    // Skip completely empty rows
    if (!materialName && !categoryRaw && !quantityRaw && !unitRaw) return;

    const quantity = Number(quantityRaw);
    const category = normalizeCategory(categoryRaw);
    const key = duplicateKey(materialName, partNumber, ssRecCode, unitRaw);

    let status: ImportRowStatus = "valid";
    if (!materialName) {
      status = "missing_name";
    } else if (!Number.isInteger(quantity) || quantity <= 0) {
      status = "invalid_quantity";
    } else if (!ALLOWED_UNITS.has(unitRaw)) {
      status = "invalid_unit";
    } else if (existingKeys.has(key) || seenKeys.has(key)) {
      status = "duplicate";
    }

    if (materialName) seenKeys.add(key);

    rows.push({
      rowNumber: rowNum,
      material_name: materialName,
      category,
      part_number: partNumber,
      ss_rec_code: ssRecCode,
      quantity: Number.isFinite(quantity) ? quantity : 0,
      unit: unitRaw,
      location,
      remarks,
      status,
      valid: status === "valid",
    });
  });

  return { rows };
}

function batchReference(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm   = String(d.getMonth() + 1).padStart(2, "0");
  const dd   = String(d.getDate()).padStart(2, "0");
  const hh   = String(d.getHours()).padStart(2, "0");
  const min  = String(d.getMinutes()).padStart(2, "0");
  return `OPENING-IMPORT-${yyyy}${mm}${dd}-${hh}${min}`;
}

export async function importOpeningStockAction(rows: ImportPreviewRow[]): Promise<ImportResult> {
  const context = await requireOfflineInventoryManage();

  const batchRef = batchReference();

  if (rows.length > ROW_LIMIT) {
    return {
      imported: 0,
      skipped: rows.length,
      batchReference: batchRef,
      failures: [{ rowNumber: 0, material_name: "", reason: `Too many rows. Maximum ${ROW_LIMIT} per import batch.` }],
    };
  }

  const existingOpeningStock = await prisma.offline_inventory_movements.findMany({
    where: { movement_type: "OPENING_STOCK", deleted_at: null },
    select: { manual_material_name: true, manual_part_number: true, ss_rec_code: true, unit: true },
  });
  const existingKeys = new Set(
    existingOpeningStock.map((m) =>
      duplicateKey(m.manual_material_name ?? "", m.manual_part_number ?? "", m.ss_rec_code ?? "", m.unit)
    )
  );

  let imported = 0;
  let skipped = 0;
  const failures: ImportResult["failures"] = [];
  const seenKeys = new Set<string>();
  const todayDateOnly = new Date(
    Date.UTC(new Date().getFullYear(), new Date().getMonth(), new Date().getDate())
  );

  await withBackendTransaction(context.userId, async (tx) => {
    for (const row of rows) {
      const name = row.material_name?.trim();
      const unit = row.unit?.trim().toUpperCase();

      if (!name) {
        failures.push({ rowNumber: row.rowNumber, material_name: name ?? "", reason: "Missing material name" });
        skipped++;
        continue;
      }
      if (!Number.isInteger(row.quantity) || row.quantity <= 0) {
        failures.push({ rowNumber: row.rowNumber, material_name: name, reason: "Invalid quantity" });
        skipped++;
        continue;
      }
      if (!ALLOWED_UNITS.has(unit)) {
        failures.push({ rowNumber: row.rowNumber, material_name: name, reason: "Invalid unit" });
        skipped++;
        continue;
      }

      const key = duplicateKey(name, row.part_number, row.ss_rec_code, unit);
      if (existingKeys.has(key) || seenKeys.has(key)) {
        failures.push({ rowNumber: row.rowNumber, material_name: name, reason: "Duplicate material" });
        skipped++;
        continue;
      }
      seenKeys.add(key);

      try {
        await tx.offline_inventory_movements.create({
          data: {
            movement_type:        "OPENING_STOCK",
            movement_date:        todayDateOnly,
            part_id:              null,
            manual_material_name: name,
            manual_part_number:   row.part_number || null,
            ss_rec_code:          row.ss_rec_code || null,
            category:             normalizeCategory(row.category),
            quantity:             row.quantity,
            unit,
            counterparty:         row.location || null,
            reference_number:     batchRef,
            remarks:              row.remarks || null,
            created_by:           context.userId,
          },
        });
        imported++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Database error";
        failures.push({ rowNumber: row.rowNumber, material_name: name, reason: msg });
        skipped++;
      }
    }
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "offline_inventory.opening_stock_import",
    entityType: "offline_inventory_movement",
    entityId: null,
    summary: `Imported ${imported} opening stock item(s) from Excel (${skipped} skipped, batch ${batchRef})`,
    metadata: { imported, skipped, failureCount: failures.length, rowsReceived: rows.length, batchReference: batchRef },
  });

  // Enterprise-Wide Real-Time Update Verification Task 2/7: one event per
  // batch, not per row — an import can be dozens/hundreds of rows, and every
  // watcher only needs to know "the ledger changed," not each individual line.
  if (imported > 0) {
    await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_IMPORTED, null, context.userId);
  }

  revalidatePath("/store/offline-inventory");
  revalidatePath("/store/offline-inventory/movements");

  return { imported, skipped, batchReference: batchRef, failures };
}
