"use server";
import "server-only";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { logSystemError } from "@/lib/errors/logging";
import { notifyWorkflowEvent } from "@/lib/backend/notifications/safe-notifications";

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
  // Vehicle fields — Vehicle Import Unit 1. All optional; existing
  // non-vehicle imports simply leave these blank.
  chassisNumber: string;
  engineNumber: string;
  registrationExpiryDate: string; // normalized "YYYY-MM-DD" when valid, otherwise the raw offending text
  insuranceExpiryDate: string; // normalized "YYYY-MM-DD" when valid, otherwise the raw offending text
  currentKilometerReading: string; // normalized numeric text when valid, otherwise the raw offending text
  assignedOperatorDriver: string;
  modelYear: string; // normalized 4-digit year text when valid, otherwise the raw offending text
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

// Normalizes a plate number for duplicate comparison: trims, collapses
// repeated whitespace, and lowercases. Used for both within-file and
// against-database duplicate checks — never used for display.
function normalizePlateNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").toLowerCase();
}

// ─── Vehicle field parsing helpers (Vehicle Import Unit 1) ──────────────────
// These never throw and never hand an unvalidated value to Prisma — every
// caller gets either a safely-parsed value or an `invalid` flag plus the raw
// text to show back to the user in a row-level error.

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // Excel day-0, compensating for its 1900 leap-year bug

function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const d = new Date(EXCEL_EPOCH_MS + serial * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Parses "YYYY-MM-DD", "DD/MM/YYYY", or "DD-MM-YYYY" into a UTC-midnight
// Date, validating the calendar date actually exists (e.g. rejects 31/02/2026).
function parseDateText(raw: string): Date | null {
  const text = raw.trim();
  if (!text) return null;

  let y: number, mo: number, d: number;
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]);
  } else {
    m = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!m) return null;
    d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]);
  }

  const date = new Date(Date.UTC(y, mo - 1, d));
  const valid =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === mo - 1 &&
    date.getUTCDate() === d;
  return valid ? date : null;
}

type DateCellResult = { date: Date | null; display: string; invalid: boolean };

// Reads a date-typed Excel cell safely: native Date objects (normal case for
// date-formatted cells), raw serial numbers (cells with no date formatting
// applied), formula results, and free-text YYYY-MM-DD / DD/MM/YYYY / DD-MM-YYYY.
// Empty cell -> not invalid, date: null. Anything unparseable -> invalid: true.
function parseDateCell(cell: ExcelJS.Cell): DateCellResult {
  let v: unknown = cell.value;
  if (v && typeof v === "object" && "result" in v) {
    v = (v as ExcelJS.CellFormulaValue).result ?? null;
  }

  if (v === null || v === undefined || v === "") {
    return { date: null, display: "", invalid: false };
  }
  if (v instanceof Date) {
    return Number.isNaN(v.getTime())
      ? { date: null, display: String(v), invalid: true }
      : { date: v, display: toIsoDateOnly(v), invalid: false };
  }
  if (typeof v === "number") {
    const d = excelSerialToDate(v);
    return d
      ? { date: d, display: toIsoDateOnly(d), invalid: false }
      : { date: null, display: String(v), invalid: true };
  }

  const text = String(v).trim();
  if (!text) return { date: null, display: "", invalid: false };
  const parsed = parseDateText(text);
  return parsed
    ? { date: parsed, display: toIsoDateOnly(parsed), invalid: false }
    : { date: null, display: text, invalid: true };
}

type YearCellResult = {
  year: number | null;
  display: string;
  invalid: boolean;
  reason?: "format" | "range";
};

// model_year is a distinct optional 4-digit integer column — never confused
// with the existing free-text `model` (model name/designation) field.
function parseModelYear(raw: string): YearCellResult {
  const text = raw.trim();
  if (!text) return { year: null, display: "", invalid: false };
  if (!/^\d{4}$/.test(text)) {
    return { year: null, display: text, invalid: true, reason: "format" };
  }
  const year = Number(text);
  const minYear = 1970;
  const maxYear = new Date().getFullYear() + 1;
  if (year < minYear || year > maxYear) {
    return { year: null, display: text, invalid: true, reason: "range" };
  }
  return { year, display: text, invalid: false };
}

type KmCellResult = { value: number | null; display: string; invalid: boolean };

// Current kilometer reading feeds a Decimal(12,2) column — reject anything
// that isn't a plain non-negative number rather than letting Prisma throw.
function parseKilometerReading(raw: string): KmCellResult {
  const text = raw.trim();
  if (!text) return { value: null, display: "", invalid: false };
  const normalized = text.replace(/,/g, "");
  const num = Number(normalized);
  if (!Number.isFinite(num) || num < 0) {
    return { value: null, display: text, invalid: true };
  }
  return { value: num, display: normalized, invalid: false };
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s/_\-.]/g, "");
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
  // ── Vehicle fields — Vehicle Import Unit 1 ──────────────────────────────
  chassisnumber:   "chassisNumber",
  chassisno:       "chassisNumber",
  chassis:         "chassisNumber",
  vin:             "chassisNumber",
  enginenumber:    "engineNumber",
  engineno:        "engineNumber",
  engine:          "engineNumber",
  registrationexpirydate:  "registrationExpiryDate",
  registrationexpiry:      "registrationExpiryDate",
  registrationexpirydt:    "registrationExpiryDate",
  istimaraexpiry:          "registrationExpiryDate",
  vehicleregistrationexpiry: "registrationExpiryDate",
  insuranceexpirydate:     "insuranceExpiryDate",
  insuranceexpiry:         "insuranceExpiryDate",
  insuranceexpirydt:       "insuranceExpiryDate",
  insurancevaliduntil:     "insuranceExpiryDate",
  currentkilometerreading: "currentKilometerReading",
  currentkm:               "currentKilometerReading",
  currentkilometers:       "currentKilometerReading",
  kmreading:               "currentKilometerReading",
  kilometerreading:        "currentKilometerReading",
  odometer:                "currentKilometerReading",
  mileage:                 "currentKilometerReading",
  assigneddriver:          "assignedOperatorDriver",
  assignedoperator:        "assignedOperatorDriver",
  assignedoperatordriver:  "assignedOperatorDriver",
  driver:                  "assignedOperatorDriver",
  operatordriver:          "assignedOperatorDriver",
  modelyear:               "modelYear",
  year:                    "modelYear",
  vehicleyear:             "modelYear",
  manufacturingyear:       "modelYear",
  mfgyear:                 "modelYear",
};

// Subcategory headers take priority over a plain "Category" / "Type" column.
// If present, the subcategory value is used as the DB `category` field.
const SUBCATEGORY_HEADER_NAMES = new Set([
  "subcategory", "subcat", "sub", "assetsubcategory", "subtype",
]);

// ── Worksheet selection — Asset Import Parse Fix Unit 1 ──────────────────────
// The prepared vehicle workbooks ship with reference/notes sheets alongside
// the actual data sheet (e.g. "Import Notes", "Classification Summary"). The
// importer must pick the real data sheet by name when possible, rather than
// always assuming index 0 is correct or failing outright when more than one
// sheet is present.
const IGNORED_SHEET_NAMES = new Set(["import notes", "classification summary", "summary", "notes"]);

function selectImportWorksheet(
  wb: ExcelJS.Workbook,
): { worksheet: ExcelJS.Worksheet | null; selectedName: string | null } {
  const byName = (name: string) =>
    wb.worksheets.find((w) => w.name.trim().toLowerCase() === name) ?? null;

  const finalImport = byName("final import");
  if (finalImport) return { worksheet: finalImport, selectedName: finalImport.name };

  const assetsSheet = byName("assets");
  if (assetsSheet) return { worksheet: assetsSheet, selectedName: assetsSheet.name };

  // No preferred name matched — use the first sheet that isn't a known
  // notes/summary sheet (handles both single-sheet workbooks and multi-sheet
  // workbooks that don't use the "Final Import" / "Assets" naming convention).
  const firstUsable = wb.worksheets.find(
    (w) => !IGNORED_SHEET_NAMES.has(w.name.trim().toLowerCase()),
  );
  if (firstUsable) return { worksheet: firstUsable, selectedName: firstUsable.name };

  // Every sheet matched an ignored name (unlikely, but fall back to the
  // literal first sheet rather than reporting no worksheet at all).
  const first = wb.worksheets[0] ?? null;
  return { worksheet: first, selectedName: first?.name ?? null };
}

const REQUIRED_HEADER_LABELS: Record<string, string> = {
  asset_code: "Asset Code",
  asset_name: "Asset Name",
  category: "Category",
};

export async function parseAssetExcelAction(
  formData: FormData,
): Promise<{ rows: ImportPreviewRow[]; error?: string }> {
  const context = await requirePermission("assets.manage");

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
  } catch (loadError) {
    // The real ExcelJS failure reason was previously swallowed entirely —
    // log it for diagnosis and surface a short, safe summary of it instead
    // of only ever showing the same generic message (Asset Import Parse Fix
    // Unit 1 Task 3).
    const reason = loadError instanceof Error ? loadError.message : "Unknown error";
    await logSystemError({
      source: "asset-import.parseAssetExcelAction",
      severity: "warning",
      message: `Workbook load failed: ${reason}`,
      userId: context.userId,
      route: "/assets/import",
      metadata: { fileName: file.name, fileSize: file.size },
    });
    return {
      rows: [],
      error: `Could not read workbook. Please save it again as .xlsx and retry. (${reason.slice(0, 200)})`,
    };
  }

  const { worksheet: ws, selectedName } = selectImportWorksheet(wb);
  if (!ws) {
    return {
      rows: [],
      error: "Could not find a valid import sheet. Expected a sheet named Final Import or a first sheet with asset headers.",
    };
  }

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
    return {
      rows: [],
      error: `Excel sheet "${selectedName}" was found, but required headers are missing: Asset Code, Asset Name, Category. (${ws.rowCount} row${ws.rowCount === 1 ? "" : "s"} found in this sheet)`,
    };
  }

  if (ws.rowCount <= headerRowNum) {
    return { rows: [], error: `The workbook contains no data rows below the header row in sheet "${selectedName}".` };
  }

  const vals = Object.values(colMap);
  const missingRequired = Object.keys(REQUIRED_HEADER_LABELS).filter((key) => !vals.includes(key as RowField));
  if (missingRequired.length > 0) {
    const missingLabels = missingRequired.map((key) => REQUIRED_HEADER_LABELS[key]).join(", ");
    return {
      rows: [],
      error: `Excel sheet "${selectedName}" was found, but required headers are missing: ${missingLabels}.`,
    };
  }

  const [existingAssetList, dbCategoryList] = await Promise.all([
    prisma.assets.findMany({ where: { deleted_at: null }, select: { asset_code: true, plate_number: true } }),
    prisma.asset_categories.findMany({ select: { name: true } }),
  ]);

  const existingCodes = new Set(existingAssetList.map((a) => a.asset_code.toLowerCase()));
  const existingPlates = new Set(
    existingAssetList
      .map((a) => (a.plate_number ? normalizePlateNumber(a.plate_number) : ""))
      .filter((p) => p.length > 0)
  );
  const dbCategoryNames = new Set(dbCategoryList.map((c) => c.name.toLowerCase()));

  const rows: ImportPreviewRow[] = [];
  const seenCodes = new Set<string>();
  const seenPlates = new Set<string>();

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (rowNum <= headerRowNum) return;
    if (rows.length >= 500) return;

    const get = (field: RowField): string => {
      for (const [colStr, f] of Object.entries(colMap)) {
        if (f === field) return cellStr(row.getCell(Number(colStr)));
      }
      return "";
    };

    const getCell = (field: RowField): ExcelJS.Cell | null => {
      for (const [colStr, f] of Object.entries(colMap)) {
        if (f === field) return row.getCell(Number(colStr));
      }
      return null;
    };

    // Subcategory column wins over plain Category/Type column when both are present
    const subCatVal = subCatColNums.length > 0
      ? cellStr(row.getCell(subCatColNums[0]))
      : "";
    const resolvedCategory = subCatVal || get("category");

    const regExpCell = getCell("registrationExpiryDate");
    const regExpParsed = regExpCell ? parseDateCell(regExpCell) : { date: null, display: "", invalid: false };
    const insExpCell = getCell("insuranceExpiryDate");
    const insExpParsed = insExpCell ? parseDateCell(insExpCell) : { date: null, display: "", invalid: false };
    const yearParsed = parseModelYear(get("modelYear"));
    const kmParsed = parseKilometerReading(get("currentKilometerReading"));

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
      chassisNumber:   get("chassisNumber"),
      engineNumber:    get("engineNumber"),
      registrationExpiryDate:  regExpParsed.display,
      insuranceExpiryDate:     insExpParsed.display,
      currentKilometerReading: kmParsed.display,
      assignedOperatorDriver:  get("assignedOperatorDriver"),
      modelYear:       yearParsed.display,
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

    // Vehicle field validation — Vehicle Import Unit 1
    if (regExpParsed.invalid)
      r.errors.push("Invalid Registration Expiry Date. Use YYYY-MM-DD or a valid Excel date.");
    if (insExpParsed.invalid)
      r.errors.push("Invalid Insurance Expiry Date. Use YYYY-MM-DD or a valid Excel date.");
    if (yearParsed.invalid) {
      r.errors.push(
        yearParsed.reason === "range"
          ? "Invalid Model Year. Year must be between 1970 and next year."
          : "Invalid Model Year. Expected a 4-digit year."
      );
    }
    if (kmParsed.invalid)
      r.errors.push("Invalid Current Kilometer Reading. Expected a number.");

    // Plate number duplicate checking (owner_number does not exist in this
    // schema/importer, so the duplicate key is plate_number alone).
    if (r.plate_number) {
      const normalizedPlate = normalizePlateNumber(r.plate_number);
      if (normalizedPlate) {
        if (seenPlates.has(normalizedPlate)) {
          r.errors.push("Duplicate Plate Number in uploaded file.");
        } else if (existingPlates.has(normalizedPlate)) {
          r.errors.push("Plate Number already exists in Assets & Equipment.");
        }
        seenPlates.add(normalizedPlate);
      }
    }

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
    prisma.assets.findMany({ where: { deleted_at: null }, select: { asset_code: true, plate_number: true } }),
    prisma.departments.findMany({ select: { id: true, name: true } }),
    prisma.asset_categories.findMany({ select: { id: true, name: true, parent_id: true } }),
  ]);

  const existingCodes = new Set(existingAssets.map((a) => a.asset_code.toLowerCase()));
  const existingPlates = new Set(
    existingAssets
      .map((a) => (a.plate_number ? normalizePlateNumber(a.plate_number) : ""))
      .filter((p) => p.length > 0)
  );
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
  const seenPlates = new Set<string>();

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

    // Vehicle field re-validation — defense in depth. The preview step
    // already filters these out of `validRows` before this action is ever
    // called, but this action is independently invokable, so every value is
    // re-parsed from scratch rather than trusted from the client payload.
    const normalizedPlate = row.plate_number ? normalizePlateNumber(row.plate_number) : "";
    if (normalizedPlate) {
      if (seenPlates.has(normalizedPlate)) {
        failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: "Duplicate Plate Number in uploaded file" });
        skipped++;
        continue;
      }
      if (existingPlates.has(normalizedPlate)) {
        failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: "Plate Number already exists in Assets & Equipment" });
        skipped++;
        continue;
      }
    }

    const regExpDate = row.registrationExpiryDate ? parseDateText(row.registrationExpiryDate) : null;
    if (row.registrationExpiryDate && !regExpDate) {
      failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: "Invalid Registration Expiry Date" });
      skipped++;
      continue;
    }
    const insExpDate = row.insuranceExpiryDate ? parseDateText(row.insuranceExpiryDate) : null;
    if (row.insuranceExpiryDate && !insExpDate) {
      failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: "Invalid Insurance Expiry Date" });
      skipped++;
      continue;
    }
    let modelYear: number | null = null;
    if (row.modelYear) {
      const parsedYear = parseModelYear(row.modelYear);
      if (parsedYear.invalid) {
        failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: "Invalid Model Year" });
        skipped++;
        continue;
      }
      modelYear = parsedYear.year;
    }
    let currentKm: number | null = null;
    if (row.currentKilometerReading) {
      const parsedKm = parseKilometerReading(row.currentKilometerReading);
      if (parsedKm.invalid) {
        failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: "Invalid Current Kilometer Reading" });
        skipped++;
        continue;
      }
      currentKm = parsedKm.value;
    }

    seenCodes.add(code.toLowerCase());
    if (normalizedPlate) seenPlates.add(normalizedPlate);

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
          model_year:    modelYear,
          serial_number: row.serial_number || null,
          plate_number:  row.plate_number || null,
          chassis_number: row.chassisNumber || null,
          engine_number:  row.engineNumber || null,
          registration_expiry_date: regExpDate,
          insurance_expiry_date:    insExpDate,
          current_kilometer_reading: currentKm,
          assigned_operator_driver:  row.assignedOperatorDriver || null,
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
      // Enterprise Error Handling Audit Unit Task 9/10: this used to push the
      // raw Prisma error message straight into the per-row failure reason
      // (could leak a raw Postgres constraint/column name) with no
      // system_error_logs trace. Full detail is now logged for IT; the user
      // sees the standard row-scoped import message instead.
      await logSystemError({
        source: "asset-import.importAssetsAction",
        severity: "warning",
        message: err instanceof Error ? err.message : "Asset row create failed",
        userId: context.userId,
        route: "/assets/import",
        entityType: "asset",
        metadata: { rowNumber: row.rowNumber, asset_code: code }
      });
      failures.push({ rowNumber: row.rowNumber, asset_code: code, reason: `Import failed on row ${row.rowNumber}. Please correct the file and try again.` });
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

  // Enterprise Real-Time Notifications Unit Task 2 item L / Task 11: one
  // summary ping per import batch, not one per row — noisy per-asset
  // notifications for a 200-row import would violate "notify the right
  // people only, not everyone for every update".
  if (imported > 0) {
    await notifyWorkflowEvent({
      eventKey: "asset.updated",
      entityType: "asset",
      entityId: null,
      actorId: context.userId,
      recipientRoles: ["super_admin", "maintenance_manager"],
      title: "Assets Imported",
      message: `${imported} asset${imported === 1 ? "" : "s"} imported from Excel${skipped ? ` (${skipped} skipped)` : ""}.`
    });
  }

  return { imported, skipped, failures };
}
