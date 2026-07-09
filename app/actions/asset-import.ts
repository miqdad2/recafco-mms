"use server";
import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";

export type CategoryStatus = "matched" | "new";

export type ImportPreviewRow = {
  rowNumber: number;
  asset_code: string;
  asset_name: string;
  category: string;
  location: string;
  department_name: string;
  brand: string;
  model: string;
  serial_number: string;
  plate_number: string;
  status: string;
  condition: string;
  criticality: string;
  remarks: string;
  valid: boolean;
  errors: string[];
  category_status?: CategoryStatus; // "matched" = known DB category; "new" = will be created on import
};

export type ImportResult = {
  imported: number;
  skipped: number;
  failures: Array<{ rowNumber: number; asset_code: string; reason: string }>;
};

type RowField = keyof Omit<ImportPreviewRow, "rowNumber" | "valid" | "errors">;

const CONDITION_NORMALIZE: Record<string, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Fair",
  poor: "Poor",
  "out of service": "Out of Service",
  "outofservice": "Out of Service",
  "out-of-service": "Out of Service",
  oos: "Out of Service",
};

const CRITICALITY_NORMALIZE: Record<string, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  med: "Medium",
  low: "Low",
};

function normalizeCondition(raw: string): string {
  const key = raw.toLowerCase().trim();
  return CONDITION_NORMALIZE[key] ?? "";
}

function normalizeCriticality(raw: string): string {
  const key = raw.toLowerCase().trim();
  return CRITICALITY_NORMALIZE[key] ?? "";
}

function cellStr(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object" && "result" in v) {
    return String((v as ExcelJS.CellFormulaValue).result ?? "").trim();
  }
  return String(v).trim();
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s/_\-]/g, "");
}

const HEADER_MAP: Record<string, RowField> = {
  assetcode:       "asset_code",
  code:            "asset_code",
  assetno:         "asset_code",
  assetname:       "asset_name",
  name:            "asset_name",
  description:     "asset_name",
  category:        "category",
  type:            "category",
  assettype:       "category",
  location:        "location",
  site:            "location",
  department:      "department_name",
  departmentarea:  "department_name",
  area:            "department_name",
  manufacturer:    "brand",
  brand:           "brand",
  make:            "brand",
  model:           "model",
  serialnumber:    "serial_number",
  serialno:        "serial_number",
  sn:              "serial_number",
  platenumber:     "plate_number",
  plateno:         "plate_number",
  registration:    "plate_number",
  status:          "status",
  condition:       "condition",
  physicalcondition: "condition",
  assetcondition:  "condition",
  criticality:     "criticality",
  criticalitylevel:"criticality",
  priority:        "criticality",
  riskpriority:    "criticality",
  remarks:         "remarks",
  additionalremarks: "remarks",
  comments:        "remarks",
  internalcomments: "remarks",
};

// Subcategory headers take priority over a plain "Category" / "Type" column.
// If present, the subcategory value is used as the DB `category` field.
const SUBCATEGORY_HEADER_NAMES = new Set([
  "subcategory", "subcat", "sub", "assetsubcategory", "subtype",
]);

export async function parseAssetExcelAction(
  formData: FormData,
): Promise<{ rows: ImportPreviewRow[]; error?: string }> {
  await requirePermission("assets.manage");

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
    return { rows: [], error: "Could not parse Excel file. Ensure it is a valid .xlsx file." };
  }

  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], error: "No worksheet found in the file." };

  let headerRowNum = -1;
  const colMap: Record<number, RowField> = {};
  const subCatColNums: number[] = [];

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (headerRowNum !== -1) return;
    let matchCount = 0;
    row.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const h = normalizeHeader(String(cell.value ?? ""));
      if (HEADER_MAP[h]) {
        colMap[colNum] = HEADER_MAP[h];
        matchCount++;
      } else if (SUBCATEGORY_HEADER_NAMES.has(h)) {
        subCatColNums.push(colNum);
        matchCount++;
      }
    });
    if (matchCount >= 2) headerRowNum = rowNum;
  });

  if (headerRowNum === -1) {
    return { rows: [], error: "Could not find a valid header row. Expected columns: Asset Code, Asset Name, Category." };
  }

  const vals = Object.values(colMap);
  if (!vals.includes("asset_code") || !vals.includes("asset_name") || !vals.includes("category")) {
    return { rows: [], error: "Missing required columns: Asset Code, Asset Name, Category." };
  }

  const [existingAssetList, dbCategoryList] = await Promise.all([
    prisma.assets.findMany({ where: { deleted_at: null }, select: { asset_code: true } }),
    prisma.asset_categories.findMany({ select: { name: true } }),
  ]);

  const existingCodes = new Set(existingAssetList.map((a) => a.asset_code.toLowerCase()));
  const dbCategoryNames = new Set(dbCategoryList.map((c) => c.name.toLowerCase()));

  const rows: ImportPreviewRow[] = [];
  const seenCodes = new Set<string>();

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRowNum) return;
    if (rows.length >= 500) return;

    const get = (field: RowField): string => {
      for (const [colStr, f] of Object.entries(colMap)) {
        if (f === field) return cellStr(row.getCell(Number(colStr)));
      }
      return "";
    };

    // Subcategory column wins over plain Category/Type column when both are present
    const subCatVal = subCatColNums.length > 0
      ? cellStr(row.getCell(subCatColNums[0]))
      : "";
    const resolvedCategory = subCatVal || get("category");

    const r: ImportPreviewRow = {
      rowNumber:       rowNum,
      asset_code:      get("asset_code"),
      asset_name:      get("asset_name"),
      category:        resolvedCategory,
      location:        get("location"),
      department_name: get("department_name"),
      brand:           get("brand"),
      model:           get("model"),
      serial_number:   get("serial_number"),
      plate_number:    get("plate_number"),
      status:          get("status") || "Active",
      condition:       get("condition"),
      criticality:     get("criticality"),
      remarks:         get("remarks"),
      valid:           true,
      errors:          [],
    };

    // Skip completely empty rows
    if (!r.asset_code && !r.asset_name && !r.category) return;

    if (!r.asset_code)  r.errors.push("Missing asset code");
    if (!r.asset_name)  r.errors.push("Missing asset name");
    if (!r.category)    r.errors.push("Missing category");
    if (r.asset_code && existingCodes.has(r.asset_code.toLowerCase()))
      r.errors.push("Asset code already exists in database");
    if (r.asset_code && seenCodes.has(r.asset_code.toLowerCase()))
      r.errors.push("Duplicate code in this file");
    if (r.asset_code) seenCodes.add(r.asset_code.toLowerCase());
    if (r.errors.length > 0) r.valid = false;

    r.category_status = r.category && dbCategoryNames.has(r.category.toLowerCase()) ? "matched" : "new";

    rows.push(r);
  });

  return { rows };
}

const IMPORT_ROW_LIMIT = 500;

export async function importAssetsAction(rows: ImportPreviewRow[]): Promise<ImportResult> {
  const context = await requirePermission("assets.manage");

  // Server-side row cap — prevents clients from bypassing the preview limit.
  if (rows.length > IMPORT_ROW_LIMIT) {
    return {
      imported: 0,
      skipped: rows.length,
      failures: [{ rowNumber: 0, asset_code: "", reason: `Too many rows. Maximum ${IMPORT_ROW_LIMIT} per import batch.` }]
    };
  }

  const [existingAssets, allDepartments, allCategories] = await Promise.all([
    prisma.assets.findMany({ where: { deleted_at: null }, select: { asset_code: true } }),
    prisma.departments.findMany({ select: { id: true, name: true } }),
    prisma.asset_categories.findMany({ select: { id: true, name: true, parent_id: true } }),
  ]);

  const existingCodes = new Set(existingAssets.map((a) => a.asset_code.toLowerCase()));
  // Case-insensitive department name → id map (built once, used for every row)
  const deptByName = new Map(allDepartments.map((d) => [d.name.toLowerCase(), d.id]));
  // Known categories by lower-case name → id
  const catByName = new Map(allCategories.map((c) => [c.name.toLowerCase(), c.id]));
  // "Other" main category id — fallback parent for auto-created subcategories
  const otherMainCat = allCategories.find(
    (c) => c.parent_id === null && c.name.toLowerCase() === "other"
  );
  // Track auto-created category names within this import batch
  const createdCatNames = new Map<string, string>(); // lower-case name → id

  let imported = 0;
  let skipped = 0;
  const failures: ImportResult["failures"] = [];
  const seenCodes = new Set<string>();

  for (const row of rows) {
    const code = row.asset_code?.trim();
    const name = row.asset_name?.trim();
    const cat  = row.category?.trim();

    if (!code || !name || !cat) {
      failures.push({ rowNumber: row.rowNumber, asset_code: code ?? "", reason: "Missing required field" });
      skipped++;
      continue;
    }
    if (existingCodes.has(code.toLowerCase())) {
      failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: "Asset code already exists" });
      skipped++;
      continue;
    }
    if (seenCodes.has(code.toLowerCase())) {
      failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: "Duplicate in import batch" });
      skipped++;
      continue;
    }
    seenCodes.add(code.toLowerCase());

    const department_id = row.department_name
      ? (deptByName.get(row.department_name.toLowerCase()) ?? null)
      : null;

    const normalizedCondition   = row.condition   ? normalizeCondition(row.condition)   : null;
    const normalizedCriticality = row.criticality ? normalizeCriticality(row.criticality) : null;

    // Auto-create unknown categories under the "Other" main category
    const catKey = cat.toLowerCase();
    if (!catByName.has(catKey) && !createdCatNames.has(catKey) && otherMainCat) {
      try {
        const newCat = await prisma.asset_categories.create({
          data: { name: cat, parent_id: otherMainCat.id, is_active: true },
          select: { id: true },
        });
        createdCatNames.set(catKey, newCat.id);
        catByName.set(catKey, newCat.id);
      } catch {
        // Unique constraint race — another process inserted it; ignore and continue
      }
    }

    try {
      await prisma.assets.create({
        data: {
          asset_code:    code,
          asset_name:    name,
          category:      cat,
          location:      row.location || null,
          brand:         row.brand || null,
          model:         row.model || null,
          serial_number: row.serial_number || null,
          plate_number:  row.plate_number || null,
          status:        row.status || "Active",
          condition:     normalizedCondition || null,
          criticality:   normalizedCriticality || null,
          remarks:       row.remarks || null,
          department_id,
          created_by:    context.userId,
          updated_by:    context.userId,
        },
      });
      existingCodes.add(code.toLowerCase());
      imported++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Database error";
      failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: msg });
      skipped++;
    }
  }

  const createdCategories = createdCatNames.size;
  await writeAuditLog({
    actorId: context.userId,
    action: "asset.import",
    entityType: "asset",
    entityId: null,
    summary: `Imported ${imported} asset(s) from Excel (${skipped} skipped, ${failures.length} failed, ${createdCategories} new categor${createdCategories === 1 ? "y" : "ies"} created)`,
    metadata: { imported, skipped, failureCount: failures.length, rowsReceived: rows.length, createdCategories }
  });

  return { imported, skipped, failures };
}
