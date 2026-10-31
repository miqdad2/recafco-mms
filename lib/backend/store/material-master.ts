import "server-only";

import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import type { Json } from "@/types/database";
import { prisma } from "@/lib/db/prisma";
import { requireUser, type CurrentUserContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { writeAuditLog } from "@/lib/audit/log";
import { canViewCosts } from "@/lib/security/permissions";
import {
  MATERIAL_EDIT_LABELS,
  changedMaterialFields,
  identityLockReason,
  materialEditVersion,
  normalizeMaterialEdit,
  unitLockReason,
  validateMaterialEdit,
  type MaterialEditFieldErrors,
  type MaterialEditValues,
  type MaterialIdentityFacts,
} from "@/lib/store/material-edit";
import { withBackendTransaction, type BackendTransaction } from "@/lib/backend/shared/transaction";
import { emitOfflineInventoryRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { MATERIAL_CATEGORIES, OTHER_CATEGORY, normalizeCategory, type BalanceItem } from "@/components/store/offline-inventory-types";
import {
  buildBalanceKey,
  getLastUnitCostsForIdentities,
  getOfflineInventoryBalance,
} from "@/lib/store/offline-inventory-data";
import {
  DEFAULT_MATERIAL_IMPORT_MAPPING,
  ITEM_CODE_MAX_LENGTH,
  MATERIAL_IMPORT_FIELD_LABELS,
  MATERIAL_IMPORT_ROW_LIMIT,
  breakdownMaterialImport,
  categoryKey,
  categoryReviewList,
  classifyMaterialImportRows,
  completeMapping,
  detectHeaderMapping,
  isBlankRawRow,
  itemCodeKey,
  looksLikeDefaultLayout,
  mappingConflict,
  materialIdentityKey,
  normalizeDescription,
  normalizeItemCode,
  summarizeMaterialImport,
  validateMapping,
  type ExistingMaterialIndex,
  type MaterialCategoryResolutions,
  type MaterialImportBreakdown,
  type MaterialImportCategoryContext,
  type MaterialImportCategoryReview,
  type MaterialImportColumnMapping,
  type MaterialImportPreviewRow,
  type MaterialImportRawRow,
  type MaterialImportSummary,
} from "@/lib/store/material-master-import";
import {
  MAX_MATERIAL_REMOVAL_BATCH,
  assessMaterialRemoval,
  type MaterialRemovalFacts,
  type MaterialRemovalOutcome,
} from "@/lib/store/material-removal-policy";

// Inventory Control — Item Code, Material Master Excel import, and Super
// Admin individual/bulk removal with archive/restore. Every entry point here
// re-checks Super Admin itself (pages and buttons are only a convenience),
// and nothing here changes how a balance, stock value or movement is
// calculated: an imported material is registered exactly like Add New
// Material's register-only save (one zero-quantity OPENING_STOCK row), and
// removal never writes a stock movement.

type Db = Prisma.TransactionClient;

export function isInventorySuperAdmin(context: CurrentUserContext): boolean {
  return context.role?.slug === "super_admin";
}

// Edit Material: Super Admin and Maintenance Data Entry only.
export function canEditMaterialMaster(context: CurrentUserContext): boolean {
  return context.role?.slug === "super_admin" || context.role?.slug === "maintenance_data_entry";
}

export async function requireInventorySuperAdmin(): Promise<CurrentUserContext> {
  const context = await requireUser();
  if (!isInventorySuperAdmin(context)) {
    throw new AppError("Only the System Administrator can do this.", { code: "FORBIDDEN" });
  }
  return context;
}

function todayDateOnly(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

// ── Material identity keys ──────────────────────────────────────────────────

type MaterialIdentity = { part_id: string | null; manual_material_name: string | null; unit: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "part:<uuid>" or "manual:<name>|<unit>" (buildBalanceKey) → identity.
function parseMaterialKey(key: string): MaterialIdentity | null {
  const k = key.trim();
  if (k.startsWith("part:")) {
    const id = k.slice("part:".length);
    return UUID_RE.test(id) ? { part_id: id, manual_material_name: null, unit: "" } : null;
  }
  if (k.startsWith("manual:")) {
    const rest = k.slice("manual:".length);
    const sep = rest.lastIndexOf("|");
    if (sep <= 0) return null;
    return { part_id: null, manual_material_name: rest.slice(0, sep), unit: rest.slice(sep + 1) };
  }
  return null;
}

function movementWhere(identity: MaterialIdentity): Prisma.offline_inventory_movementsWhereInput {
  return identity.part_id
    ? { part_id: identity.part_id, deleted_at: null }
    : {
        part_id: null,
        manual_material_name: { equals: identity.manual_material_name ?? "", mode: "insensitive" },
        unit: { equals: identity.unit, mode: "insensitive" },
        deleted_at: null,
      };
}

function settingsWhere(identity: MaterialIdentity): Prisma.inventory_material_settingsWhereInput {
  return identity.part_id
    ? { part_id: identity.part_id }
    : {
        part_id: null,
        manual_material_name: { equals: identity.manual_material_name ?? "", mode: "insensitive" },
        unit: { equals: identity.unit, mode: "insensitive" },
      };
}

// The same per-material advisory lock Issue Material takes, so a removal
// and an issue of the same material never interleave.
async function lockMaterial(tx: BackendTransaction, canonicalKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${canonicalKey}, 0))`;
}

// ── Item Code ────────────────────────────────────────────────────────────────

// The Item Code unique index is an expression index Prisma does not know
// about, so a race that slips past the explicit check surfaces as P2002 or
// as a raw error naming the index.
function isItemCodeConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return true;
  return error instanceof Error && error.message.includes("inventory_material_settings_item_code_unique");
}

export async function setMaterialItemCode(context: CurrentUserContext, key: string, rawCode: string) {
  if (!isInventorySuperAdmin(context)) throw new AppError("Only the System Administrator can change Item Codes.", { code: "FORBIDDEN" });
  const identity = parseMaterialKey(key);
  if (!identity) throw new AppError("Material not found in Inventory.", { code: "NOT_FOUND" });
  const code = normalizeItemCode(rawCode);
  if (code.length > ITEM_CODE_MAX_LENGTH) {
    throw new AppError(`Item Code can be at most ${ITEM_CODE_MAX_LENGTH} characters.`, { code: "VALIDATION_ERROR" });
  }

  const canonicalKey = buildBalanceKey(identity);
  try {
    const previous = await withBackendTransaction(context.userId, async (tx) => {
      await lockMaterial(tx, canonicalKey);
      const latest = await tx.offline_inventory_movements.findFirst({
        where: movementWhere(identity),
        orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
        select: { part_id: true, manual_material_name: true, unit: true },
      });
      if (!latest) throw new AppError("Material not found in Inventory.", { code: "NOT_FOUND" });
      if (code) {
        const taken = await tx.inventory_material_settings.findFirst({
          where: { item_code: { equals: code, mode: "insensitive" }, NOT: settingsWhere(identity) },
          select: { id: true },
        });
        if (taken) throw new AppError(`Item Code ${code} is already used by another material.`, { code: "CONFLICT" });
      }
      const existing = await tx.inventory_material_settings.findFirst({ where: settingsWhere(identity) });
      if (existing) {
        await tx.inventory_material_settings.update({
          where: { id: existing.id },
          data: { item_code: code || null, updated_at: new Date() },
        });
        return existing.item_code;
      }
      if (!code) return null;
      await tx.inventory_material_settings.create({
        data: {
          part_id: latest.part_id,
          manual_material_name: latest.part_id ? null : latest.manual_material_name,
          unit: latest.unit,
          item_code: code,
          created_by: context.userId,
        },
      });
      return null;
    });

    await writeAuditLog({
      actorId: context.userId,
      action: "offline_inventory.item_code_updated",
      entityType: "inventory_material",
      entityId: null,
      summary: `Item Code ${code ? `set to ${code}` : "cleared"} for ${canonicalKey}`,
      metadata: { materialKey: canonicalKey, previousItemCode: previous, itemCode: code || null },
    });
    await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_MATERIAL_UPDATED, null, context.userId);
  } catch (error) {
    if (isItemCodeConflict(error)) {
      throw new AppError(`Item Code ${code} is already used by another material.`, { code: "CONFLICT" });
    }
    throw error;
  }
}

// ── Material Master Excel import ─────────────────────────────────────────────

export type MaterialImportOptions = {
  sheetName: string | null;
  // null = detect from the first non-empty row.
  hasHeaderRow: boolean | null;
  // null = the header's own columns, or A/B/C/D for a headerless sheet.
  mapping: Partial<MaterialImportColumnMapping> | null;
  // The administrator accepted this mapping. Defaults to true for an explicit
  // mapping; a suggested one needs it whenever detection was unsure.
  mappingConfirmed?: boolean;
  // Decisions for categories that do not exist yet, by categoryKey().
  categoryResolutions?: MaterialCategoryResolutions;
};

export type MaterialImportColumnInfo = { column: number; letter: string; firstRowText: string };

export type MaterialImportPreview = {
  fileName: string;
  sheetNames: string[];
  sheetName: string;
  hasHeaderRow: boolean;
  headerDetected: boolean;
  mapping: MaterialImportColumnMapping;
  columns: MaterialImportColumnInfo[];
  // Columns with content that no field uses; they are ignored.
  unmappedColumns: MaterialImportColumnInfo[];
  // Why the mapping must be confirmed before import; empty when it is settled.
  needsConfirmation: string[];
  rows: MaterialImportPreviewRow[];
  summary: MaterialImportSummary;
  breakdown: MaterialImportBreakdown;
  // Category values not known yet, and existing categories to map them to.
  categoryReview: MaterialImportCategoryReview[];
  knownCategories: string[];
  categoryResolutions: MaterialCategoryResolutions;
};

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_COLUMNS = 26;

function columnLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

// The cell as the user sees it. A whole number stored with a "0000"-style
// format keeps its leading zeros (Excel shows 0001, the stored value is 1).
function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    const fmt = typeof cell.numFmt === "string" ? cell.numFmt : "";
    if (/^0+$/.test(fmt) && Number.isInteger(v) && v >= 0) return String(v).padStart(fmt.length, "0");
    return String(v);
  }
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((r) => r.text).join("");
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as ExcelJS.CellFormulaValue).result;
      return result === null || result === undefined || typeof result === "object" ? "" : String(result);
    }
    if ("text" in v) return String((v as ExcelJS.CellHyperlinkValue).text ?? "");
    if ("error" in v) return "";
  }
  return String(v);
}

async function readUploadedWorkbook(file: unknown): Promise<{ workbook: ExcelJS.Workbook; fileName: string }> {
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError("Choose an Excel file to import.", { code: "VALIDATION_ERROR" });
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new AppError("File too large. Maximum 10 MB.", { code: "VALIDATION_ERROR" });
  }
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new AppError("Use an Excel .xlsx file. Older .xls files must be saved as .xlsx first.", { code: "VALIDATION_ERROR" });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  // .xlsx is a zip archive: it always starts with "PK\x03\x04".
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    throw new AppError("This file is not a real Excel .xlsx file.", { code: "VALIDATION_ERROR" });
  }
  const workbook = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(Buffer.from(bytes) as any);
  } catch {
    throw new AppError("Could not read this Excel file.", { code: "VALIDATION_ERROR" });
  }
  return { workbook, fileName: file.name.slice(0, 255) };
}

type ParsedSheet = Pick<MaterialImportPreview, "sheetNames" | "sheetName" | "hasHeaderRow" | "headerDetected" | "mapping" | "columns" | "unmappedColumns" | "needsConfirmation"> & {
  rawRows: MaterialImportRawRow[];
};

// How many leading rows may sit above the header, such as a report title.
const HEADER_SEARCH_ROWS = 10;

function parseSheet(workbook: ExcelJS.Workbook, options: MaterialImportOptions): ParsedSheet {
  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  if (sheetNames.length === 0) throw new AppError("The file has no worksheets.", { code: "VALIDATION_ERROR" });
  const ws = options.sheetName
    ? workbook.worksheets.find((w) => w.name === options.sheetName)
    : workbook.worksheets.find((w) => w.actualRowCount > 0) ?? workbook.worksheets[0];
  if (!ws) throw new AppError("The selected sheet was not found in this file.", { code: "VALIDATION_ERROR" });

  const columnCount = Math.min(Math.max(ws.columnCount, 4), MAX_IMPORT_COLUMNS);
  const nonEmptyRows: { rowNumber: number; cells: string[] }[] = [];
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= columnCount; c++) cells.push(cellText(row.getCell(c)));
    if (cells.some((t) => t.trim())) nonEmptyRows.push({ rowNumber, cells });
  });

  const headerIndex = nonEmptyRows.slice(0, HEADER_SEARCH_ROWS).findIndex((r) => detectHeaderMapping(r.cells) !== null);
  const detected = headerIndex >= 0 ? detectHeaderMapping(nonEmptyRows[headerIndex].cells) : null;
  const hasHeaderRow = options.hasHeaderRow ?? detected !== null;
  const dataRows = hasHeaderRow ? nonEmptyRows.slice(Math.max(headerIndex, 0) + 1) : nonEmptyRows;

  const suggestion = hasHeaderRow && detected ? detected.mapping : DEFAULT_MATERIAL_IMPORT_MAPPING;
  const mapping = options.mapping ? completeMapping(options.mapping) : suggestion;
  const conflict = mappingConflict(mapping);
  if (conflict) throw new AppError(conflict, { code: "VALIDATION_ERROR" });

  const reasons: string[] = [];
  if (hasHeaderRow && detected) {
    for (const field of detected.missingRequired) reasons.push(`No ${MATERIAL_IMPORT_FIELD_LABELS[field]} column was found. Choose the correct column.`);
    for (const field of detected.ambiguous) reasons.push(`More than one column could be ${MATERIAL_IMPORT_FIELD_LABELS[field]}. Check the suggested column.`);
  } else if (hasHeaderRow) {
    reasons.push("The header row was not recognized. Check every column below.");
  } else if (!looksLikeDefaultLayout(dataRows.map((r) => r.cells))) {
    reasons.push("This sheet has no recognized header and does not look like the standard layout. Check every column below.");
  }
  const needsConfirmation = (options.mappingConfirmed ?? options.mapping !== null) ? [] : reasons;

  const text = (cells: string[], col: number | null) => (col !== null && col <= cells.length ? cells[col - 1] : "");
  const rawRows = dataRows
    .map(({ rowNumber, cells }) => ({
      rowNumber,
      serial: text(cells, mapping.serial),
      itemCode: text(cells, mapping.itemCode),
      description: text(cells, mapping.description),
      unit: text(cells, mapping.unit),
      category: text(cells, mapping.category),
      partNumber: text(cells, mapping.partNumber),
      ssRecCode: text(cells, mapping.ssRecCode),
      location: text(cells, mapping.location),
      minimumStock: text(cells, mapping.minimumStock),
      reorderQuantity: text(cells, mapping.reorderQuantity),
      notes: text(cells, mapping.notes),
    }))
    .filter((r) => !isBlankRawRow(r));
  if (rawRows.length > MATERIAL_IMPORT_ROW_LIMIT) {
    throw new AppError(`This sheet has ${rawRows.length} rows. Import at most ${MATERIAL_IMPORT_ROW_LIMIT} rows at a time.`, {
      code: "VALIDATION_ERROR",
    });
  }

  const labelRow = hasHeaderRow && headerIndex >= 0 ? nonEmptyRows[headerIndex] : nonEmptyRows[0];
  const columns: MaterialImportColumnInfo[] = [];
  for (let c = 1; c <= columnCount; c++) {
    columns.push({ column: c, letter: columnLetter(c), firstRowText: labelRow ? labelRow.cells[c - 1].slice(0, 60) : "" });
  }
  const usedColumns = new Set(Object.values(mapping));
  const unmappedColumns = columns.filter((c) => !usedColumns.has(c.column) && nonEmptyRows.some((r) => r.cells[c.column - 1].trim()));

  return { sheetNames, sheetName: ws.name, hasHeaderRow, headerDetected: detected !== null, mapping, columns, unmappedColumns, needsConfirmation, rawRows };
}

// Categories in use: the fixed list plus any custom text saved on a material.
async function loadKnownCategories(db: Db): Promise<Map<string, string>> {
  const [movements, settings] = await Promise.all([
    db.offline_inventory_movements.findMany({ where: { deleted_at: null, category: { not: null } }, distinct: ["category"], select: { category: true } }),
    db.inventory_material_settings.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true } }),
  ]);
  const known = new Map<string, string>();
  for (const category of MATERIAL_CATEGORIES) known.set(categoryKey(category), category);
  for (const { category } of [...settings, ...movements]) {
    const key = categoryKey(category ?? "");
    if (key && !known.has(key)) known.set(key, normalizeDescription(category ?? ""));
  }
  return known;
}

// Every Item Code (archived materials included) and every manual material
// identity still in the ledger or in a settings row. Read inside the import
// transaction (after its lock) for the final check.
async function loadExistingMaterialIndex(db: Db): Promise<ExistingMaterialIndex> {
  const [codes, identities, settingsIdentities] = await Promise.all([
    db.inventory_material_settings.findMany({ where: { item_code: { not: null } }, select: { item_code: true } }),
    db.offline_inventory_movements.findMany({
      where: { deleted_at: null, part_id: null, manual_material_name: { not: null } },
      distinct: ["manual_material_name", "unit"],
      select: { manual_material_name: true, unit: true },
    }),
    db.inventory_material_settings.findMany({
      where: { part_id: null, manual_material_name: { not: null } },
      select: { manual_material_name: true, unit: true },
    }),
  ]);
  return {
    itemCodeKeys: new Set(codes.map((c) => itemCodeKey(c.item_code ?? ""))),
    identityKeys: new Set(
      [...identities, ...settingsIdentities].map((m) => materialIdentityKey(m.manual_material_name ?? "", m.unit))
    ),
  };
}

// Preview: reads the file and checks every row. Never writes anything.
export async function previewMaterialMasterImport(
  context: CurrentUserContext,
  file: unknown,
  options: MaterialImportOptions
): Promise<MaterialImportPreview> {
  if (!isInventorySuperAdmin(context)) throw new AppError("Only the System Administrator can import materials.", { code: "FORBIDDEN" });
  const { workbook, fileName } = await readUploadedWorkbook(file);
  const { rawRows, ...sheet } = parseSheet(workbook, options);
  const [existing, known] = await Promise.all([loadExistingMaterialIndex(prisma), loadKnownCategories(prisma)]);
  const categoryResolutions = options.categoryResolutions ?? {};
  const categories: MaterialImportCategoryContext = { mapped: sheet.mapping.category !== null, known, resolutions: categoryResolutions };
  const rows = classifyMaterialImportRows(rawRows, existing, categories);
  return {
    fileName,
    ...sheet,
    rows,
    summary: summarizeMaterialImport(rows),
    breakdown: breakdownMaterialImport(rows),
    categoryReview: categoryReviewList(rows, categories),
    knownCategories: [...known.values()].sort((a, b) => a.localeCompare(b)),
    categoryResolutions,
  };
}

export type MaterialImportResult = {
  batchReference: string;
  imported: number;
  alreadyImported: boolean;
  // Rows the administrator confirmed that were no longer valid at import
  // time (e.g. another import added the same Item Code meanwhile).
  skippedRows: { rowNumber: number; itemCode: string; message: string }[];
  summary: MaterialImportSummary;
};

function newBatchReference(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `MATERIAL-IMPORT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${suffix}`;
}

const IMPORT_LOCK_KEY = "inventory_material_master_import";

// Confirm: re-reads the same file with the same options, re-checks every
// row against the database under a global import lock, and registers only
// rows that the administrator confirmed AND are still valid. Each material
// gets one zero-quantity OPENING_STOCK registration row (shown as "Material
// Registered", no stock) plus its settings row holding the Item Code — the
// same records Add New Material creates. A repeat submit with the same
// clientSubmissionId returns the first result.
export async function confirmMaterialMasterImport(
  context: CurrentUserContext,
  file: unknown,
  options: MaterialImportOptions,
  confirmedRowNumbers: number[],
  clientSubmissionId: string
): Promise<MaterialImportResult> {
  if (!isInventorySuperAdmin(context)) throw new AppError("Only the System Administrator can import materials.", { code: "FORBIDDEN" });
  if (!UUID_RE.test(clientSubmissionId)) throw new AppError("Import request is not valid. Preview the file again.", { code: "BAD_REQUEST" });
  const confirmed = new Set(confirmedRowNumbers.filter((n) => Number.isInteger(n) && n > 0));
  if (confirmed.size === 0) throw new AppError("No rows were confirmed for import.", { code: "VALIDATION_ERROR" });

  const { workbook, fileName } = await readUploadedWorkbook(file);
  const { rawRows, ...sheet } = parseSheet(workbook, options);
  const mappingProblem = validateMapping(sheet.mapping);
  if (mappingProblem) throw new AppError(mappingProblem, { code: "VALIDATION_ERROR" });
  if (sheet.needsConfirmation.length > 0) {
    throw new AppError("Confirm the column mapping before importing.", { code: "VALIDATION_ERROR" });
  }
  const categoryResolutions = options.categoryResolutions ?? {};

  const outcome = await withBackendTransaction(context.userId, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${IMPORT_LOCK_KEY}, 0))`;

    const previous = await tx.inventory_material_import_batches.findUnique({ where: { client_submission_id: clientSubmissionId } });
    if (previous) return { previous };

    const rows = classifyMaterialImportRows(rawRows, await loadExistingMaterialIndex(tx), {
      mapped: sheet.mapping.category !== null,
      known: await loadKnownCategories(tx),
      resolutions: categoryResolutions,
    });
    const summary = summarizeMaterialImport(rows);
    const toImport = rows.filter((r) => confirmed.has(r.rowNumber) && r.status === "valid" && r.normalizedUnit);
    const skippedRows = rows
      .filter((r) => confirmed.has(r.rowNumber) && r.status !== "valid")
      .map((r) => ({ rowNumber: r.rowNumber, itemCode: r.itemCode, message: r.message }));

    const batchReference = newBatchReference();
    const movementDate = todayDateOnly();
    if (toImport.length > 0) {
      await tx.offline_inventory_movements.createMany({
        data: toImport.map((r) => ({
          movement_type: "OPENING_STOCK",
          movement_date: movementDate,
          part_id: null,
          manual_material_name: r.description,
          manual_part_number: r.partNumber || null,
          ss_rec_code: r.ssRecCode || null,
          category: r.resolvedCategory ?? OTHER_CATEGORY,
          quantity: 0,
          unit: r.normalizedUnit as string,
          counterparty: r.location || null,
          reference_number: batchReference,
          remarks: `Registered by Material Master import (Excel row ${r.rowNumber}, Item Code ${r.itemCode})`,
          created_by: context.userId,
        })),
      });
      await tx.inventory_material_settings.createMany({
        data: toImport.map((r) => ({
          part_id: null,
          manual_material_name: r.description,
          unit: r.normalizedUnit as string,
          item_code: r.itemCode,
          // Master values, so a later movement cannot replace them on screen.
          category: r.resolvedCategory,
          part_number: r.partNumber || null,
          ss_rec_code: r.ssRecCode || null,
          location: r.location || null,
          remarks: r.notes || null,
          minimum_stock_quantity: r.minimumStock ? Number(r.minimumStock) : null,
          reorder_quantity: r.reorderQuantity ? Number(r.reorderQuantity) : null,
          created_by: context.userId,
        })),
      });
    }

    await tx.inventory_material_import_batches.create({
      data: {
        batch_reference: batchReference,
        client_submission_id: clientSubmissionId,
        file_name: fileName,
        sheet_name: sheet.sheetName,
        has_header_row: sheet.hasHeaderRow,
        column_mapping: { ...sheet.mapping, categoryResolutions } as unknown as Prisma.InputJsonValue,
        total_rows: summary.totalRows,
        imported_count: toImport.length,
        existing_count: summary.existing,
        duplicate_count: summary.duplicates,
        invalid_count: summary.invalid,
        unsupported_unit_count: summary.invalidUnits,
        created_by: context.userId,
      },
    });
    return { result: { batchReference, imported: toImport.length, alreadyImported: false, skippedRows, summary } };
  });

  if ("previous" in outcome && outcome.previous) {
    const b = outcome.previous;
    return {
      batchReference: b.batch_reference,
      imported: b.imported_count,
      alreadyImported: true,
      skippedRows: [],
      summary: {
        totalRows: b.total_rows,
        valid: b.imported_count,
        existing: b.existing_count,
        duplicates: b.duplicate_count,
        invalid: b.invalid_count,
        invalidUnits: b.unsupported_unit_count,
      },
    };
  }

  const result = outcome.result as MaterialImportResult;
  await writeAuditLog({
    actorId: context.userId,
    action: "offline_inventory.material_master_import",
    entityType: "inventory_material_import_batch",
    entityId: null,
    summary: `Imported ${result.imported} material(s) from Excel material master (batch ${result.batchReference})`,
    metadata: {
      batchReference: result.batchReference,
      fileName,
      sheetName: sheet.sheetName,
      imported: result.imported,
      totalRows: result.summary.totalRows,
      existing: result.summary.existing,
      duplicates: result.summary.duplicates,
      invalid: result.summary.invalid,
      invalidUnits: result.summary.invalidUnits,
      skippedConfirmed: result.skippedRows.length,
    },
  });
  if (result.imported > 0) {
    await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_IMPORTED, null, context.userId);
  }
  return result;
}

export type MaterialImportBatchRow = {
  id: string;
  batch_reference: string;
  file_name: string;
  sheet_name: string;
  total_rows: number;
  imported_count: number;
  existing_count: number;
  duplicate_count: number;
  invalid_count: number;
  unsupported_unit_count: number;
  created_by_name: string;
  created_at: string;
};

export async function getRecentMaterialImportBatches(limit = 10): Promise<MaterialImportBatchRow[]> {
  const batches = await prisma.inventory_material_import_batches.findMany({ orderBy: { created_at: "desc" }, take: limit });
  const names = await profileNames(batches.map((b) => b.created_by));
  return batches.map((b) => ({
    id: b.id,
    batch_reference: b.batch_reference,
    file_name: b.file_name,
    sheet_name: b.sheet_name,
    total_rows: b.total_rows,
    imported_count: b.imported_count,
    existing_count: b.existing_count,
    duplicate_count: b.duplicate_count,
    invalid_count: b.invalid_count,
    unsupported_unit_count: b.unsupported_unit_count,
    created_by_name: names.get(b.created_by) ?? "Unknown",
    created_at: b.created_at.toISOString(),
  }));
}

async function profileNames(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await prisma.profiles.findMany({ where: { id: { in: unique } }, select: { id: true, full_name: true } });
  return new Map(rows.map((r) => [r.id, r.full_name]));
}

// ── Removal: assess, delete / archive, restore ──────────────────────────────

type CollectedMaterial = {
  identity: MaterialIdentity;
  canonicalKey: string;
  displayName: string;
  unit: string;
  facts: MaterialRemovalFacts;
  registrationIds: string[];
  settings: { id: string; item_code: string | null; archived_at: Date | null } | null;
};

async function collectMaterial(db: Db, key: string): Promise<CollectedMaterial | null> {
  const parsed = parseMaterialKey(key);
  if (!parsed) return null;
  const movements = await db.offline_inventory_movements.findMany({
    where: movementWhere(parsed),
    orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
    select: {
      id: true,
      movement_type: true,
      quantity: true,
      related_work_order_id: true,
      parts_request_id: true,
      part_id: true,
      manual_material_name: true,
      unit: true,
      parts: { select: { part_name: true } },
    },
  });
  if (movements.length === 0) return null;

  const latest = movements[0];
  const identity: MaterialIdentity = { part_id: latest.part_id, manual_material_name: latest.manual_material_name, unit: latest.unit };
  const canonicalKey = buildBalanceKey(identity);
  const name = latest.parts?.part_name ?? latest.manual_material_name ?? "Unknown";

  let balance = 0;
  const registrationIds: string[] = [];
  let stockMovementCount = 0;
  let linkedMovementCount = 0;
  for (const m of movements) {
    const qty = Number(m.quantity);
    if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") balance += qty;
    else if (m.movement_type === "ISSUED") balance -= qty;
    const linked = m.related_work_order_id !== null || m.parts_request_id !== null;
    if (linked) linkedMovementCount += 1;
    if (m.movement_type === "OPENING_STOCK" && qty === 0 && !linked) registrationIds.push(m.id);
    else stockMovementCount += 1;
  }

  // References by stored material key, by catalog part, or — for rows saved
  // before keys existed — by the same material name. Matching generously
  // only ever turns a delete into an archive, never the other way round.
  const keyMatch = { equals: canonicalKey, mode: "insensitive" as const };
  const nameMatch = { equals: name, mode: "insensitive" as const };
  const [jobCardRefs, requestRefs, generalRefs, settings] = await Promise.all([
    db.workOrderRequiredPart.count({
      where: {
        OR: [
          { inventory_material_key: keyMatch },
          identity.part_id ? { part_id: identity.part_id } : { inventory_material_key: null, part_id: null, description: nameMatch },
        ],
      },
    }),
    db.parts_request_items.count({
      where: {
        OR: [
          { inventory_material_key: keyMatch },
          identity.part_id ? { part_id: identity.part_id } : { inventory_material_key: null, part_id: null, description: nameMatch },
        ],
      },
    }),
    db.general_inventory_request_items.count({
      where: {
        OR: [
          { inventory_material_key: keyMatch },
          identity.part_id
            ? { inventory_part_id: identity.part_id }
            : { inventory_material_key: null, inventory_part_id: null, material_name: nameMatch },
        ],
      },
    }),
    db.inventory_material_settings.findFirst({
      where: settingsWhere(identity),
      select: { id: true, item_code: true, archived_at: true },
    }),
  ]);

  return {
    identity,
    canonicalKey,
    displayName: name,
    unit: latest.unit,
    registrationIds,
    settings,
    facts: {
      balance: Math.round(balance * 1000) / 1000,
      stockMovementCount,
      linkedMovementCount,
      jobCardMaterialReferenceCount: jobCardRefs,
      materialsRequestReferenceCount: requestRefs,
      generalRequestReferenceCount: generalRefs,
      isArchived: settings?.archived_at != null,
    },
  };
}

// ── Edit Material ───────────────────────────────────────────────────────────

export type MaterialEditData = {
  key: string;
  values: MaterialEditValues;
  version: string;
  nameLockedReason: string | null;
  unitLockedReason: string | null;
};

const EDIT_FORBIDDEN = "You do not have permission to edit materials.";

// Current editable values, using the same "master value, else latest
// movement" rule as the Inventory Control list. No cost field is read here.
async function loadEditableMaterial(db: Db, key: string) {
  const c = await collectMaterial(db, key);
  if (!c) return null;
  const where = movementWhere(c.identity);
  const [latest, opening, settings] = await Promise.all([
    db.offline_inventory_movements.findFirst({
      where,
      orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
      select: { category: true, manual_part_number: true, ss_rec_code: true, parts: { select: { part_number: true } } },
    }),
    db.offline_inventory_movements.findFirst({
      where: { ...where, movement_type: "OPENING_STOCK", counterparty: { not: null } },
      orderBy: [{ movement_date: "desc" }, { created_at: "desc" }],
      select: { counterparty: true },
    }),
    db.inventory_material_settings.findFirst({ where: settingsWhere(c.identity) }),
  ]);
  const text = (edited: string | null | undefined, fallback: string | null | undefined) => (edited ?? fallback ?? "");
  const values: MaterialEditValues = {
    name: c.displayName,
    unit: c.unit,
    itemCode: settings?.item_code ?? "",
    category: settings?.category || (latest?.category ? normalizeCategory(latest.category) : OTHER_CATEGORY),
    partNumber: text(settings?.part_number, latest?.parts?.part_number ?? latest?.manual_part_number),
    ssRecCode: text(settings?.ss_rec_code, latest?.ss_rec_code),
    location: text(settings?.location, opening?.counterparty),
    notes: settings?.remarks ?? "",
    minimumStock: settings?.minimum_stock_quantity != null ? String(Number(settings.minimum_stock_quantity)) : "",
    reorderQuantity: settings?.reorder_quantity != null ? String(Number(settings.reorder_quantity)) : "",
  };
  const facts: MaterialIdentityFacts = {
    isCatalogPart: c.identity.part_id !== null,
    balance: c.facts.balance,
    stockMovementCount: c.facts.stockMovementCount,
    linkedMovementCount: c.facts.linkedMovementCount,
    referenceCount: c.facts.jobCardMaterialReferenceCount + c.facts.materialsRequestReferenceCount + c.facts.generalRequestReferenceCount,
    hasUnitSetup: settings?.purchase_unit != null || settings?.conversion_quantity != null,
  };
  return { collected: c, settings, values, facts };
}

export async function getMaterialForEdit(context: CurrentUserContext, key: string): Promise<MaterialEditData> {
  if (!canEditMaterialMaster(context)) throw new AppError(EDIT_FORBIDDEN, { code: "FORBIDDEN" });
  const loaded = await loadEditableMaterial(prisma, key);
  if (!loaded) throw new AppError("Material not found in Inventory.", { code: "NOT_FOUND" });
  if (loaded.collected.facts.isArchived) throw new AppError("This material is archived. Restore it before editing.", { code: "CONFLICT" });
  return {
    key: loaded.collected.canonicalKey,
    values: loaded.values,
    version: materialEditVersion(loaded.values),
    nameLockedReason: identityLockReason(loaded.facts),
    unitLockedReason: unitLockReason(loaded.facts),
  };
}

export type MaterialEditResult = { key: string; changed: string[] };

function editValidationError(fieldErrors: MaterialEditFieldErrors): AppError {
  return new AppError("Please fix the highlighted fields.", { code: "VALIDATION_ERROR", fieldErrors: fieldErrors as Record<string, string[]> });
}

// Saves one material atomically: locks it (and its new identity, and the
// import, so nothing can create that identity meanwhile), re-reads it, refuses
// a stale form, re-checks every rule, then writes master values and the audit
// record together. A name or unit change only ever rewrites the zero-quantity
// registration row of a material with no history. No stock figure is read
// from or written to the request.
export async function saveMaterialEdit(
  context: CurrentUserContext,
  input: { key: string; version: string; values: MaterialEditValues }
): Promise<MaterialEditResult> {
  if (!canEditMaterialMaster(context)) throw new AppError(EDIT_FORBIDDEN, { code: "FORBIDDEN" });
  const parsed = parseMaterialKey(input.key);
  if (!parsed) throw new AppError("Material not found in Inventory.", { code: "NOT_FOUND" });
  const next = normalizeMaterialEdit(input.values);
  const fieldErrors = validateMaterialEdit(next);
  if (Object.keys(fieldErrors).length > 0) throw editValidationError(fieldErrors);

  const oldKey = buildBalanceKey(parsed);
  const newKey = parsed.part_id ? oldKey : buildBalanceKey({ part_id: null, manual_material_name: next.name, unit: next.unit });

  try {
    return await withBackendTransaction(context.userId, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${IMPORT_LOCK_KEY}, 0))`;
      for (const key of [...new Set([oldKey, newKey])].sort()) await lockMaterial(tx, key);

      const loaded = await loadEditableMaterial(tx, input.key);
      if (!loaded) throw new AppError("Material not found in Inventory.", { code: "NOT_FOUND" });
      const { collected: c, settings, values: current, facts } = loaded;
      if (c.facts.isArchived) throw new AppError("This material is archived. Restore it before editing.", { code: "CONFLICT" });
      if (materialEditVersion(current) !== input.version) {
        throw new AppError("Someone else changed this material while you were editing. Close this form and open it again to see the latest details.", { code: "CONFLICT" });
      }

      const changed = changedMaterialFields(current, next);
      if (changed.length === 0) return { key: c.canonicalKey, changed: [] };

      const nameChanged = changed.includes("name");
      const unitChanged = changed.includes("unit");
      const lockErrors: MaterialEditFieldErrors = {};
      const nameLock = identityLockReason(facts);
      const unitLock = unitLockReason(facts);
      if (nameChanged && nameLock) lockErrors.name = [nameLock];
      if (unitChanged && unitLock) lockErrors.unit = [unitLock];
      if (Object.keys(lockErrors).length > 0) throw editValidationError(lockErrors);

      if (nameChanged || unitChanged) {
        const target = materialIdentityKey(next.name, next.unit);
        if (target !== materialIdentityKey(current.name, current.unit) && (await loadExistingMaterialIndex(tx)).identityKeys.has(target)) {
          throw editValidationError({ name: ["A material with this name and unit already exists. Materials are never merged automatically."] });
        }
      }
      if (changed.includes("itemCode") && next.itemCode) {
        const taken = await tx.inventory_material_settings.findFirst({
          where: { item_code: { equals: next.itemCode, mode: "insensitive" }, ...(settings ? { NOT: { id: settings.id } } : {}) },
          select: { id: true },
        });
        if (taken) throw editValidationError({ itemCode: [`Item Code ${next.itemCode} is already used by another material.`] });
      }

      const now = new Date();
      if ((nameChanged || unitChanged) && c.registrationIds.length > 0) {
        await tx.offline_inventory_movements.updateMany({
          where: { id: { in: c.registrationIds }, deleted_at: null },
          data: { manual_material_name: next.name, unit: next.unit, updated_at: now },
        });
      }

      const master = {
        ...(changed.includes("itemCode") ? { item_code: next.itemCode || null } : {}),
        ...(changed.includes("category") ? { category: next.category } : {}),
        ...(changed.includes("partNumber") ? { part_number: next.partNumber } : {}),
        ...(changed.includes("ssRecCode") ? { ss_rec_code: next.ssRecCode } : {}),
        ...(changed.includes("location") ? { location: next.location } : {}),
        ...(changed.includes("notes") ? { remarks: next.notes || null } : {}),
        ...(changed.includes("minimumStock") ? { minimum_stock_quantity: next.minimumStock ? Number(next.minimumStock) : null } : {}),
        ...(changed.includes("reorderQuantity") ? { reorder_quantity: next.reorderQuantity ? Number(next.reorderQuantity) : null } : {}),
        ...(nameChanged ? { manual_material_name: next.name } : {}),
        ...(unitChanged ? { unit: next.unit } : {}),
      };
      if (settings) {
        await tx.inventory_material_settings.update({ where: { id: settings.id }, data: { ...master, updated_at: now } });
      } else {
        await tx.inventory_material_settings.create({
          data: {
            part_id: c.identity.part_id,
            manual_material_name: c.identity.part_id ? null : next.name,
            unit: next.unit,
            ...master,
            created_by: context.userId,
          },
        });
      }

      // In the transaction, so a saved edit always has its audit record.
      await tx.audit_logs.create({
        data: {
          actor_id: context.userId,
          action: "offline_inventory.material_edited",
          entity_type: "inventory_material",
          summary: `Edited material ${next.name}: ${changed.map((f) => MATERIAL_EDIT_LABELS[f]).join(", ")}`,
          metadata: {
            materialKey: c.canonicalKey,
            newMaterialKey: nameChanged || unitChanged ? newKey : c.canonicalKey,
            changedByName: context.profile.full_name,
            changes: Object.fromEntries(changed.map((f) => [f, { from: current[f], to: next[f] }])),
          },
        },
      });

      return { key: nameChanged || unitChanged ? newKey : c.canonicalKey, changed: changed.map((f) => MATERIAL_EDIT_LABELS[f]) };
    });
  } catch (error) {
    if (isItemCodeConflict(error)) throw editValidationError({ itemCode: [`Item Code ${next.itemCode} is already used by another material.`] });
    if (error instanceof Error && error.message.includes("inventory_material_settings_manual_unique")) {
      throw editValidationError({ name: ["A material with this name and unit already exists. Materials are never merged automatically."] });
    }
    throw error;
  }
}

export type MaterialRemovalPreview = {
  key: string;
  display_name: string;
  item_code: string | null;
  unit: string;
  balance: number;
  // null when the viewer cannot see costs or the material has no price.
  stock_value: number | null;
  outcome: MaterialRemovalOutcome | "not_found";
  reasons: string[];
};

function normalizeKeys(keys: unknown): string[] {
  if (!Array.isArray(keys)) throw new AppError("No materials selected.", { code: "VALIDATION_ERROR" });
  const unique = [...new Set(keys.filter((k): k is string => typeof k === "string" && k.trim() !== "").map((k) => k.trim()))];
  if (unique.length === 0) throw new AppError("No materials selected.", { code: "VALIDATION_ERROR" });
  if (unique.length > MAX_MATERIAL_REMOVAL_BATCH) {
    throw new AppError(`Select at most ${MAX_MATERIAL_REMOVAL_BATCH} materials at a time.`, { code: "VALIDATION_ERROR" });
  }
  return unique;
}

// Read-only: what would happen to each selected material.
export async function previewMaterialRemoval(context: CurrentUserContext, keys: unknown): Promise<MaterialRemovalPreview[]> {
  if (!isInventorySuperAdmin(context)) throw new AppError("Only the System Administrator can delete materials.", { code: "FORBIDDEN" });
  const list = normalizeKeys(keys);
  const collected = await Promise.all(list.map((k) => collectMaterial(prisma, k)));
  const showCosts = canViewCosts(context);
  const costs = showCosts
    ? await getLastUnitCostsForIdentities(collected.filter((c): c is CollectedMaterial => c !== null).map((c) => c.identity))
    : new Map<string, number | null>();

  return list.map((key, i) => {
    const c = collected[i];
    if (!c) {
      return { key, display_name: "Material not found", item_code: null, unit: "", balance: 0, stock_value: null, outcome: "not_found", reasons: ["Already removed or not found"] };
    }
    const assessment = assessMaterialRemoval(c.facts);
    const unitCost = costs.get(c.canonicalKey) ?? null;
    return {
      key,
      display_name: c.displayName,
      item_code: c.settings?.item_code ?? null,
      unit: c.unit,
      balance: c.facts.balance,
      stock_value: showCosts && unitCost !== null ? Math.max(0, c.facts.balance) * unitCost : null,
      outcome: assessment.outcome,
      reasons: assessment.reasons,
    };
  });
}

export type MaterialRemovalResultStatus = "deleted" | "archived" | "blocked" | "changed" | "not_found" | "already_archived" | "failed";

export type MaterialRemovalResult = {
  key: string;
  display_name: string;
  status: MaterialRemovalResultStatus;
  message: string;
};

export type MaterialRemovalRequest = { key: string; expectedOutcome: MaterialRemovalOutcome };

// Executes each reviewed removal in its own transaction: lock the material,
// re-collect its facts, and act only if the outcome is still the one the
// administrator reviewed — otherwise nothing is done to it and the result
// says it changed. One failure never stops the others; every result is
// reported per material.
export async function executeMaterialRemoval(
  context: CurrentUserContext,
  requests: unknown,
  reason: string | null
): Promise<MaterialRemovalResult[]> {
  if (!isInventorySuperAdmin(context)) throw new AppError("Only the System Administrator can delete materials.", { code: "FORBIDDEN" });
  if (!Array.isArray(requests)) throw new AppError("No materials selected.", { code: "VALIDATION_ERROR" });
  const keys = normalizeKeys(requests.map((r) => (r && typeof r === "object" ? (r as { key?: unknown }).key : null)));
  const expectedByKey = new Map<string, MaterialRemovalOutcome>();
  for (const r of requests as MaterialRemovalRequest[]) {
    if (r && typeof r.key === "string" && (r.expectedOutcome === "delete" || r.expectedOutcome === "archive")) {
      expectedByKey.set(r.key.trim(), r.expectedOutcome);
    }
  }
  const archiveReason = reason?.trim().slice(0, 500) || null;

  const results: MaterialRemovalResult[] = [];
  for (const key of keys) {
    const expected = expectedByKey.get(key);
    if (!expected) {
      results.push({ key, display_name: key, status: "blocked", message: "Not confirmed for deletion or archive." });
      continue;
    }
    try {
      const parsed = parseMaterialKey(key);
      if (!parsed) {
        results.push({ key, display_name: key, status: "not_found", message: "Material not found." });
        continue;
      }
      const result = await withBackendTransaction(context.userId, async (tx): Promise<MaterialRemovalResult & { audit?: Json }> => {
        await lockMaterial(tx, buildBalanceKey(parsed));
        const c = await collectMaterial(tx, key);
        if (!c) return { key, display_name: key, status: "not_found", message: "Already removed or not found." };
        const assessment = assessMaterialRemoval(c.facts);
        const base = { key, display_name: c.displayName };
        if (assessment.outcome === "already_archived") return { ...base, status: "already_archived", message: "Already archived." };
        if (assessment.outcome === "blocked") return { ...base, status: "blocked", message: assessment.reasons.join("; ") };
        if (assessment.outcome !== expected) {
          return { ...base, status: "changed", message: "This material changed since review — nothing was done. Review it again." };
        }

        const audit = {
          materialKey: c.canonicalKey,
          materialName: c.displayName,
          unit: c.unit,
          itemCode: c.settings?.item_code ?? null,
          balance: c.facts.balance,
          reasons: assessment.reasons,
          reason: archiveReason,
        };
        if (assessment.outcome === "delete") {
          const now = new Date();
          // Registration rows are soft-deleted (deleted_at), never removed.
          await tx.offline_inventory_movements.updateMany({
            where: { id: { in: c.registrationIds }, deleted_at: null },
            data: { deleted_at: now, updated_at: now },
          });
          if (c.settings) await tx.inventory_material_settings.delete({ where: { id: c.settings.id } });
          return { ...base, status: "deleted", message: "Deleted from Inventory Control.", audit: { ...audit, registrationMovementIds: c.registrationIds } };
        }

        if (c.settings) {
          await tx.inventory_material_settings.update({
            where: { id: c.settings.id },
            data: { archived_at: new Date(), archived_by: context.userId, archive_reason: archiveReason, updated_at: new Date() },
          });
        } else {
          await tx.inventory_material_settings.create({
            data: {
              part_id: c.identity.part_id,
              manual_material_name: c.identity.part_id ? null : c.identity.manual_material_name,
              unit: c.identity.unit,
              archived_at: new Date(),
              archived_by: context.userId,
              archive_reason: archiveReason,
              created_by: context.userId,
            },
          });
        }
        return { ...base, status: "archived", message: "Archived — history kept; restore from Archived Materials.", audit };
      });

      const { audit, ...publicResult } = result;
      if (audit) {
        await writeAuditLog({
          actorId: context.userId,
          action: publicResult.status === "deleted" ? "offline_inventory.material_deleted" : "offline_inventory.material_archived",
          entityType: "inventory_material",
          entityId: null,
          summary: `${publicResult.status === "deleted" ? "Deleted" : "Archived"} material ${publicResult.display_name}`,
          metadata: audit,
        });
      }
      results.push(publicResult);
    } catch {
      results.push({ key, display_name: key, status: "failed", message: "Could not be processed — nothing was changed for this material." });
    }
  }

  if (results.some((r) => r.status === "deleted" || r.status === "archived")) {
    await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_MATERIAL_UPDATED, null, context.userId);
  }
  return results;
}

export async function restoreArchivedMaterial(context: CurrentUserContext, key: string): Promise<{ display_name: string }> {
  if (!isInventorySuperAdmin(context)) throw new AppError("Only the System Administrator can restore materials.", { code: "FORBIDDEN" });
  const parsed = parseMaterialKey(key);
  if (!parsed) throw new AppError("Material not found.", { code: "NOT_FOUND" });

  const restored = await withBackendTransaction(context.userId, async (tx) => {
    await lockMaterial(tx, buildBalanceKey(parsed));
    const c = await collectMaterial(tx, key);
    if (!c) throw new AppError("Material not found.", { code: "NOT_FOUND" });
    if (!c.settings?.archived_at) throw new AppError("This material is not archived.", { code: "CONFLICT" });
    await tx.inventory_material_settings.update({
      where: { id: c.settings.id },
      data: { archived_at: null, archived_by: null, archive_reason: null, updated_at: new Date() },
    });
    return { display_name: c.displayName, canonicalKey: c.canonicalKey, archivedAt: c.settings.archived_at.toISOString() };
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "offline_inventory.material_restored",
    entityType: "inventory_material",
    entityId: null,
    summary: `Restored archived material ${restored.display_name}`,
    metadata: { materialKey: restored.canonicalKey, archivedAt: restored.archivedAt },
  });
  await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_MATERIAL_UPDATED, null, context.userId);
  return { display_name: restored.display_name };
}

export type ArchivedMaterialRow = BalanceItem & { archived_by_name: string; archive_reason: string | null };

export async function getArchivedMaterials(): Promise<ArchivedMaterialRow[]> {
  const [{ archivedItems }, settings] = await Promise.all([
    getOfflineInventoryBalance(),
    prisma.inventory_material_settings.findMany({
      where: { archived_at: { not: null } },
      select: { part_id: true, manual_material_name: true, unit: true, archived_by: true, archive_reason: true },
    }),
  ]);
  const infoByKey = new Map(settings.map((s) => [buildBalanceKey(s), s]));
  const names = await profileNames(settings.map((s) => s.archived_by).filter((id): id is string => id !== null));
  return archivedItems.map((item) => {
    const info = infoByKey.get(item.key);
    return {
      ...item,
      archived_by_name: info?.archived_by ? names.get(info.archived_by) ?? "Unknown" : "Unknown",
      archive_reason: info?.archive_reason ?? null,
    };
  });
}
