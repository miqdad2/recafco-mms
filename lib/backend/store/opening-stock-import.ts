import "server-only";

import { createHash, randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";
import type { CurrentUserContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors/app-error";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { MATERIAL_MASTER_IMPORT_LOCK_KEY, cellText } from "@/lib/backend/store/material-master";
import { emitOfflineInventoryRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";
import { OTHER_CATEGORY, normalizeCategory } from "@/components/store/offline-inventory-types";
import { buildBalanceKey, canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
import {
  CLASSIFICATION_LABELS,
  DecisionError,
  OPENING_STOCK_ROW_LIMIT,
  REQUIRED_OPENING_STOCK_FIELDS,
  allocateItemCodes,
  buildMaterialIndex,
  canonicalSourceContent,
  classifyOpeningStockRows,
  detectOpeningStockHeader,
  identityName,
  isBlankSourceRow,
  previewFingerprintSource,
  resolveOpeningStockDecisions,
  summarizeOpeningStock,
  type ClassifiedOpeningStockRow,
  type ResolvedOpeningStockRow,
  type RowOutcome,
  type ExistingInventoryMaterial,
  type OpeningStockField,
  type OpeningStockSourceRow,
  type OpeningStockSummary,
  type RowDecision,
} from "@/lib/store/opening-stock-matching";
import {
  deriveVerificationStatus,
  effectiveSourceRow,
  hasCorrection,
  type CorrectionValues,
} from "@/lib/store/opening-stock-verification-rules";

// Opening Stock Excel import — preview (read-only), import and held-row
// resolution. The rules live in lib/store/opening-stock-matching.ts; this
// module reads the workbook and the ledger, and writes.
//
// Import re-reads the uploaded file and re-classifies every row under a
// global import lock, so nothing the browser sends is trusted except
// decisions, which are re-validated here. Clear rows post, uncertain rows are
// held with their source values, and everything — movements, new material
// settings rows, batch and row records, audit — is written in one
// transaction: any failure leaves nothing behind. Held rows are resolved later
// from the stored batch, again in one transaction each time.

type Db = Prisma.TransactionClient | typeof prisma;

const IMPORT_LOCK_KEY = "offline_inventory_opening_stock_import";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const HEADER_SEARCH_ROWS = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Uncertain matches are approved by the System Administrator or the
// Maintenance Manager only (approved 2026-11-25).
export function canApproveOpeningStockDecisions(context: CurrentUserContext): boolean {
  return context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
}

function requireManage(context: CurrentUserContext) {
  if (!canManageOfflineInventory(context)) {
    throw new AppError("You do not have permission to import opening stock.", { code: "FORBIDDEN" });
  }
}

// ── Workbook ────────────────────────────────────────────────────────────────

type ParsedFile = {
  fileName: string;
  fileSha256: string;
  contentSha256: string;
  sheetName: string;
  rows: OpeningStockSourceRow[];
};

const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

async function readOpeningStockFile(file: unknown): Promise<ParsedFile> {
  if (!(file instanceof File) || file.size === 0) throw new AppError("Choose an Excel file to import.", { code: "VALIDATION_ERROR" });
  if (file.size > MAX_FILE_BYTES) throw new AppError("File too large. Maximum 10 MB.", { code: "VALIDATION_ERROR" });
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new AppError("Use an Excel .xlsx file. Older .xls files must be saved as .xlsx first.", { code: "VALIDATION_ERROR" });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    throw new AppError("This file is not a real Excel .xlsx file.", { code: "VALIDATION_ERROR" });
  }
  const workbook = new ExcelJS.Workbook();
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(Buffer.from(bytes) as any);
  } catch {
    throw new AppError(
      "Could not read this Excel file. If it was produced by another program, open it in Excel and save it again as .xlsx.",
      { code: "VALIDATION_ERROR" }
    );
  }
  // Only the first sheet is read, as before.
  const ws = workbook.worksheets[0];
  if (!ws) throw new AppError("No worksheet found in the file.", { code: "VALIDATION_ERROR" });

  const nonEmpty: { rowNumber: number; cells: string[] }[] = [];
  const width = Math.min(Math.max(ws.columnCount, 8), 26);
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c)));
    if (cells.some((t) => t.trim())) nonEmpty.push({ rowNumber, cells });
  });

  const headerAt = nonEmpty.slice(0, HEADER_SEARCH_ROWS).findIndex((r) => detectOpeningStockHeader(r.cells) !== null);
  if (headerAt < 0) {
    throw new AppError("Could not find the header row. Expected columns: Material Name, Category, Opening Quantity, Unit.", {
      code: "VALIDATION_ERROR",
    });
  }
  const mapping = detectOpeningStockHeader(nonEmpty[headerAt].cells)!;
  if (REQUIRED_OPENING_STOCK_FIELDS.some((f) => mapping[f] === undefined)) {
    throw new AppError("Missing required columns: Material Name, Category, Opening Quantity, Unit.", { code: "VALIDATION_ERROR" });
  }
  const get = (cells: string[], field: OpeningStockField) => {
    const col = mapping[field];
    return col === undefined ? "" : (cells[col - 1] ?? "").trim();
  };
  const rows = nonEmpty
    .slice(headerAt + 1)
    .map(({ rowNumber, cells }) => ({
      rowNumber,
      materialName: get(cells, "material_name"),
      category: get(cells, "category"),
      partNumber: get(cells, "part_number"),
      ssRecCode: get(cells, "ss_rec_code"),
      quantityText: get(cells, "quantity"),
      unit: get(cells, "unit"),
      location: get(cells, "location"),
      remarks: get(cells, "remarks"),
    }))
    .filter((r) => !isBlankSourceRow(r));
  if (rows.length === 0) throw new AppError("No data rows found in the file.", { code: "VALIDATION_ERROR" });
  // Never cut a file silently: an over-long file is refused as a whole.
  if (rows.length > OPENING_STOCK_ROW_LIMIT) {
    throw new AppError(`This file has ${rows.length} rows. Import at most ${OPENING_STOCK_ROW_LIMIT} rows at a time.`, {
      code: "VALIDATION_ERROR",
    });
  }
  return {
    fileName: file.name.slice(0, 255),
    fileSha256: sha256(bytes),
    contentSha256: sha256(canonicalSourceContent(rows)),
    sheetName: ws.name,
    rows,
  };
}

// ── Inventory ───────────────────────────────────────────────────────────────

type LatestMovement = { partNumber: string | null; ssRecCode: string | null; category: string | null };

type LoadedInventory = {
  materials: ExistingInventoryMaterial[];
  // The material's most recent movement values, copied onto its new Opening
  // Stock row so Inventory Control keeps showing the same part number, SS
  // Rec. Code and category afterwards.
  latest: Map<string, LatestMovement>;
  // Material keys an earlier, un-reversed import row already posted to.
  postedImportKeys: Set<string>;
};

function masterValue(edited: string | null | undefined, fromMovements: string | null): string | null {
  if (edited === null || edited === undefined) return fromMovements;
  return edited === "" ? null : edited;
}

// Every material identity in the ledger, the same way Inventory Control
// builds its list (getOfflineInventoryBalance), archived ones included.
export async function loadInventory(db: Db): Promise<LoadedInventory> {
  const [grouped, latestRows, settings, posted] = await Promise.all([
    db.offline_inventory_movements.groupBy({
      by: ["part_id", "manual_material_name", "unit", "movement_type"],
      where: { deleted_at: null },
      _sum: { quantity: true },
    }),
    db.offline_inventory_movements.findMany({
      where: { deleted_at: null },
      distinct: ["part_id", "manual_material_name", "unit"],
      orderBy: [{ part_id: "asc" }, { manual_material_name: "asc" }, { unit: "asc" }, { movement_date: "desc" }, { created_at: "desc" }],
      select: {
        part_id: true,
        manual_material_name: true,
        manual_part_number: true,
        ss_rec_code: true,
        unit: true,
        category: true,
        parts: { select: { part_name: true, part_number: true } },
      },
    }),
    db.inventory_material_settings.findMany({
      select: { part_id: true, manual_material_name: true, unit: true, item_code: true, archived_at: true, category: true, part_number: true, ss_rec_code: true },
    }),
    db.opening_stock_import_rows.findMany({
      where: { outcome: { in: ["posted_existing", "registered_new"] }, reversed_at: null, material_key: { not: null } },
      select: { material_key: true },
    }),
  ]);
  const postedImportKeys = new Set(posted.map((p) => p.material_key!));
  const settingsByKey = new Map(settings.map((s) => [buildBalanceKey(s), s]));
  const opening = new Map<string, number>();
  const balance = new Map<string, number>();
  for (const g of grouped) {
    const key = buildBalanceKey(g);
    const qty = Number(g._sum.quantity ?? 0);
    if (g.movement_type === "OPENING_STOCK") opening.set(key, (opening.get(key) ?? 0) + qty);
    const delta = g.movement_type === "ISSUED" ? -qty : g.movement_type === "RECEIVED" || g.movement_type === "OPENING_STOCK" ? qty : 0;
    balance.set(key, (balance.get(key) ?? 0) + delta);
  }
  const materials: ExistingInventoryMaterial[] = [];
  const latest = new Map<string, LatestMovement>();
  const seen = new Set<string>();
  for (const m of latestRows) {
    const key = buildBalanceKey(m);
    if (seen.has(key)) continue; // identities that differ only by case merge, as in Inventory Control
    seen.add(key);
    const s = settingsByKey.get(key);
    const rawPartNumber = m.parts?.part_number ?? m.manual_part_number ?? null;
    latest.set(key, { partNumber: m.manual_part_number, ssRecCode: m.ss_rec_code, category: m.category });
    materials.push({
      key,
      name: m.parts?.part_name ?? m.manual_material_name ?? "",
      unit: m.unit,
      partId: m.part_id,
      partNumber: masterValue(s?.part_number, rawPartNumber),
      ssRecCode: masterValue(s?.ss_rec_code, m.ss_rec_code),
      itemCode: s?.item_code ?? null,
      category: s?.category || (m.category ? normalizeCategory(m.category) : OTHER_CATEGORY),
      archived: Boolean(s?.archived_at),
      openingStockQuantity: opening.get(key) ?? 0,
      balance: balance.get(key) ?? 0,
      postedByImport: postedImportKeys.has(key),
    });
  }
  return { materials, latest, postedImportKeys };
}

async function previousBatchFor(db: Db, parsed: Pick<ParsedFile, "fileSha256" | "contentSha256">) {
  return db.opening_stock_import_batches.findFirst({
    where: { OR: [{ file_sha256: parsed.fileSha256 }, { content_sha256: parsed.contentSha256 }] },
    select: { batch_reference: true, created_at: true, file_name: true },
  });
}

// ── Preview ─────────────────────────────────────────────────────────────────

export type OpeningStockPreviewRow = ClassifiedOpeningStockRow & { label: string };

export type OpeningStockPreview = {
  fileName: string;
  sheetName: string;
  fileSha256: string;
  // What the reviewer saw; confirm refuses to run on anything else.
  fingerprint: string;
  rows: OpeningStockPreviewRow[];
  summary: OpeningStockSummary;
  canApprove: boolean;
  // Set when this file (or the same rows) was already imported.
  previousBatch: { batchReference: string; fileName: string; importedAt: string } | null;
};

export function withLabels(rows: ClassifiedOpeningStockRow[]): OpeningStockPreviewRow[] {
  return rows.map((r) => ({ ...r, label: CLASSIFICATION_LABELS[r.classification] }));
}

// Reads the file and checks every row against Inventory. Never writes.
export async function previewOpeningStockImport(context: CurrentUserContext, file: unknown): Promise<OpeningStockPreview> {
  requireManage(context);
  const parsed = await readOpeningStockFile(file);
  const [inventory, previous] = await Promise.all([loadInventory(prisma), previousBatchFor(prisma, parsed)]);
  const rows = classifyOpeningStockRows(parsed.rows, buildMaterialIndex(inventory.materials, inventory.postedImportKeys));
  return {
    fileName: parsed.fileName,
    sheetName: parsed.sheetName,
    fileSha256: parsed.fileSha256,
    fingerprint: sha256(previewFingerprintSource(rows)),
    rows: withLabels(rows),
    summary: summarizeOpeningStock(rows),
    canApprove: canApproveOpeningStockDecisions(context),
    previousBatch: previous
      ? { batchReference: previous.batch_reference, fileName: previous.file_name, importedAt: previous.created_at.toISOString() }
      : null,
  };
}

// ── Posting (shared by the import and by held-row resolution) ──────────────

// Result names shown to staff: Imported Existing / Registered New / Held for
// Review / Failed (cannot post stock), plus Excluded for a held row an
// approver closed without stock.
export type OpeningStockRowOutcome = "posted_existing" | "registered_new" | "held" | "not_imported" | "excluded";

type Posting = {
  outcome: "posted_existing" | "registered_new";
  movementId: string;
  materialKey: string;
  materialName: string;
  materialUnit: string;
  itemCode: string | null;
  quantity: number;
};

type PostPlan = { row: ClassifiedOpeningStockRow; outcome: RowOutcome };

function newMaterialKey(row: ClassifiedOpeningStockRow): string {
  return buildBalanceKey({ part_id: null, manual_material_name: identityName(row.materialName), unit: row.normalizedUnit ?? "" });
}

// Writes the stock movements (and settings rows for new materials) for every
// plan that posts, inside the caller's transaction. Takes the same
// per-material locks as Issue Material, re-reads Inventory under them, and
// refuses — rolling back everything — if a target received opening stock or
// a new name appeared meanwhile.
async function writePostings(
  tx: Prisma.TransactionClient,
  context: CurrentUserContext,
  plans: PostPlan[],
  batchReference: string,
  note: string,
  // Per row: the original Excel values, when the posted values were corrected.
  originals: Map<number, string> = new Map()
): Promise<Map<number, Posting>> {
  const posting = plans.filter((p) => p.outcome.outcome === "post_existing" || p.outcome.outcome === "register_new");
  const result = new Map<number, Posting>();
  if (posting.length === 0) return result;

  const lockKeys = new Set<string>();
  for (const { row, outcome } of posting) lockKeys.add(outcome.outcome === "post_existing" ? outcome.material.key : newMaterialKey(row));
  for (const key of [...lockKeys].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
  const inventory = await loadInventory(tx);
  const now = new Map(inventory.materials.map((m) => [m.key, m]));
  for (const { row, outcome } of posting) {
    if (outcome.outcome === "post_existing" && ((now.get(outcome.material.key)?.openingStockQuantity ?? 0) > 0 || inventory.postedImportKeys.has(outcome.material.key))) {
      throw new AppError(`Row ${row.rowNumber}: opening stock was recorded for ${outcome.material.name} meanwhile. Nothing was saved — check again.`, { code: "CONFLICT" });
    }
    if (outcome.outcome === "register_new" && (now.has(newMaterialKey(row)) || inventory.postedImportKeys.has(newMaterialKey(row)))) {
      throw new AppError(`Row ${row.rowNumber}: this material was added to Inventory meanwhile. Nothing was saved — check again.`, { code: "CONFLICT" });
    }
  }

  // Every Item Code in use (archived materials included) AND every code an
  // opening-stock import has ever issued, so a code is never reused.
  const [usedCodes, issuedCodes] = await Promise.all([
    tx.inventory_material_settings.findMany({ where: { item_code: { not: null } }, select: { item_code: true } }),
    tx.opening_stock_import_rows.findMany({ where: { item_code: { not: null } }, select: { item_code: true } }),
  ]);
  const codes = allocateItemCodes(
    [...usedCodes, ...issuedCodes].map((c) => c.item_code),
    posting.filter((p) => p.outcome.outcome === "register_new").length
  );

  const movementDate = todayDateOnly();
  const movements: Prisma.offline_inventory_movementsCreateManyInput[] = [];
  const settings: Prisma.inventory_material_settingsCreateManyInput[] = [];
  let codeIndex = 0;
  for (const { row, outcome } of posting) {
    const movementId = randomUUID();
    const original = originals.get(row.rowNumber);
    const remarks = `${note} ${batchReference}, Excel row ${row.rowNumber}: "${row.materialName}" ${row.quantityText} ${row.unit}${original ? ` (corrected; Excel: ${original})` : ""}${row.remarks ? ` — ${row.remarks}` : ""}`;
    if (outcome.outcome === "post_existing") {
      const m = outcome.material;
      const last = inventory.latest.get(m.key);
      movements.push({
        id: movementId,
        movement_type: "OPENING_STOCK",
        movement_date: movementDate,
        part_id: m.partId,
        manual_material_name: m.partId ? null : m.name,
        // Unchanged display values: the material's own latest ones.
        manual_part_number: m.partId ? null : last?.partNumber ?? null,
        ss_rec_code: last?.ssRecCode ?? null,
        category: last?.category ?? m.category,
        quantity: row.quantity!,
        // Always the material's own unit — never converted.
        unit: m.unit,
        counterparty: row.location || null,
        reference_number: batchReference,
        remarks,
        created_by: context.userId,
      });
      result.set(row.rowNumber, { outcome: "posted_existing", movementId, materialKey: m.key, materialName: m.name, materialUnit: m.unit, itemCode: m.itemCode, quantity: row.quantity! });
    } else {
      const name = identityName(row.materialName);
      const unit = row.normalizedUnit!;
      const itemCode = codes[codeIndex++];
      movements.push({
        id: movementId,
        movement_type: "OPENING_STOCK",
        movement_date: movementDate,
        part_id: null,
        manual_material_name: name,
        manual_part_number: row.partNumber || null,
        ss_rec_code: row.ssRecCode || null,
        category: row.normalizedCategory,
        quantity: row.quantity!,
        unit,
        counterparty: row.location || null,
        reference_number: batchReference,
        remarks,
        created_by: context.userId,
      });
      settings.push({
        part_id: null,
        manual_material_name: name,
        unit,
        item_code: itemCode,
        category: row.normalizedCategory,
        // Blank unless the Maintenance Team supplied one.
        part_number: row.partNumber || null,
        ss_rec_code: row.ssRecCode || null,
        location: row.location || null,
        created_by: context.userId,
      });
      result.set(row.rowNumber, { outcome: "registered_new", movementId, materialKey: newMaterialKey(row), materialName: name, materialUnit: unit, itemCode, quantity: row.quantity! });
    }
  }
  await tx.offline_inventory_movements.createMany({ data: movements });
  if (settings.length > 0) await tx.inventory_material_settings.createMany({ data: settings });
  return result;
}

function outcomeName(o: RowOutcome): OpeningStockRowOutcome {
  return o.outcome === "post_existing" ? "posted_existing" : o.outcome === "register_new" ? "registered_new" : o.outcome === "hold" ? "held" : o.outcome === "exclude" ? "excluded" : "not_imported";
}

function rowMessage(outcome: OpeningStockRowOutcome, row: ClassifiedOpeningStockRow, approved: boolean, note?: string): string {
  const by = approved ? " (approved decision)" : "";
  if (outcome === "posted_existing") return `Opening stock added to the existing material${by}.`;
  if (outcome === "registered_new") return `Registered as a new material${by}.`;
  if (outcome === "excluded") return `Not imported by decision: ${note ?? ""}`;
  return row.message;
}

// Recomputes a batch's counts from its row records (the only source of truth).
async function refreshBatchCounts(tx: Prisma.TransactionClient, batchId: string) {
  const grouped = await tx.opening_stock_import_rows.groupBy({ by: ["outcome"], where: { batch_id: batchId }, _count: { _all: true }, _sum: { quantity: true } });
  const count = (o: string) => grouped.find((g) => g.outcome === o)?._count._all ?? 0;
  const posted = grouped.filter((g) => g.outcome === "posted_existing" || g.outcome === "registered_new").reduce((s, g) => s + Number(g._sum.quantity ?? 0), 0);
  return tx.opening_stock_import_batches.update({
    where: { id: batchId },
    data: {
      posted_existing_count: count("posted_existing"),
      registered_new_count: count("registered_new"),
      held_count: count("held"),
      not_imported_count: count("not_imported"),
      excluded_count: count("excluded"),
      posted_quantity: posted,
      updated_at: new Date(),
    },
  });
}

// ── Confirm (import) ────────────────────────────────────────────────────────

export type OpeningStockRowResult = {
  rowNumber: number;
  sourceName: string;
  sourceQuantity: string;
  sourceUnit: string;
  outcome: OpeningStockRowOutcome;
  materialName: string | null;
  unit: string | null;
  quantity: number | null;
  itemCode: string | null;
  message: string;
  // Register as Different Material: the existing Item Codes it differs from.
  differentFrom?: string[];
};

export type OpeningStockImportResult = {
  batchReference: string;
  alreadyProcessed: boolean;
  totalRows: number;
  postedExisting: number;
  registeredNew: number;
  held: number;
  failed: number;
  excluded: number;
  postedQuantity: number;
  rows: OpeningStockRowResult[];
};

function todayDateOnly(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function newBatchReference(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const suffix = randomUUID().slice(0, 4).toUpperCase();
  return `OPENING-IMPORT-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${suffix}`;
}

async function resultForBatch(db: Db, batchId: string, alreadyProcessed: boolean): Promise<OpeningStockImportResult> {
  const [b, rows] = await Promise.all([
    db.opening_stock_import_batches.findUniqueOrThrow({ where: { id: batchId } }),
    db.opening_stock_import_rows.findMany({ where: { batch_id: batchId }, orderBy: { row_number: "asc" } }),
  ]);
  return {
    batchReference: b.batch_reference,
    alreadyProcessed,
    totalRows: b.total_rows,
    postedExisting: b.posted_existing_count,
    registeredNew: b.registered_new_count,
    held: b.held_count,
    failed: b.not_imported_count,
    excluded: b.excluded_count,
    postedQuantity: Number(b.posted_quantity),
    rows: rows.map((r) => ({
      rowNumber: r.row_number,
      sourceName: r.source_material_name,
      sourceQuantity: r.source_quantity,
      sourceUnit: r.source_unit,
      outcome: r.outcome as OpeningStockRowOutcome,
      materialName: r.material_name,
      unit: r.material_unit,
      quantity: r.quantity !== null ? Number(r.quantity) : null,
      itemCode: r.item_code,
      message: r.message,
    })),
  };
}

export async function takeImportLocks(tx: Prisma.TransactionClient) {
  // One opening-stock write at a time, and never at the same time as a
  // Material Master import (both register materials and Item Codes).
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${IMPORT_LOCK_KEY}, 0))`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${MATERIAL_MASTER_IMPORT_LOCK_KEY}, 0))`;
}

// Imports a file: clear Existing rows post to their material, clear New rows
// are registered with an AMSOS Item Code, and every uncertain row is held
// (no stock) for an approver to resolve later from the same batch. Every
// source row is recorded. One transaction: any failure leaves nothing.
export async function confirmOpeningStockImport(
  context: CurrentUserContext,
  file: unknown,
  decisions: Record<number, RowDecision>,
  clientSubmissionId: string,
  expectedFingerprint: string
): Promise<OpeningStockImportResult> {
  requireManage(context);
  if (!UUID_RE.test(clientSubmissionId)) throw new AppError("Import request is not valid. Check the file again.", { code: "BAD_REQUEST" });
  const parsed = await readOpeningStockFile(file);
  const canApprove = canApproveOpeningStockDecisions(context);

  const outcome = await withBackendTransaction(context.userId, async (tx) => {
    await takeImportLocks(tx);

    const repeat = await tx.opening_stock_import_batches.findUnique({ where: { client_submission_id: clientSubmissionId }, select: { id: true } });
    if (repeat) return { repeatId: repeat.id };

    const previous = await previousBatchFor(tx, parsed);
    if (previous) {
      throw new AppError(
        `This file was already imported (batch ${previous.batch_reference}). It cannot be imported again — resolve its held rows from that batch instead.`,
        { code: "CONFLICT" }
      );
    }

    const inventory = await loadInventory(tx);
    const index = buildMaterialIndex(inventory.materials, inventory.postedImportKeys);
    const rows = classifyOpeningStockRows(parsed.rows, index);
    if (sha256(previewFingerprintSource(rows)) !== expectedFingerprint) {
      throw new AppError("Inventory or the file has changed since you checked it. Check the file again before importing.", { code: "CONFLICT" });
    }
    let resolved;
    try {
      resolved = resolveOpeningStockDecisions(rows, decisions, index, canApprove);
    } catch (error) {
      if (error instanceof DecisionError) throw new AppError(error.message, { code: "VALIDATION_ERROR" });
      throw error;
    }

    const batchId = randomUUID();
    const batchReference = newBatchReference();
    const postings = await writePostings(tx, context, resolved, batchReference, "Opening stock import");

    const records: Prisma.opening_stock_import_rowsCreateManyInput[] = resolved.map(({ row, outcome: o }) => {
      const p = postings.get(row.rowNumber);
      const name = outcomeName(o);
      const approved = (o.outcome === "post_existing" || o.outcome === "register_new") && o.approvedDecision;
      return {
        batch_id: batchId,
        row_number: row.rowNumber,
        source_material_name: row.materialName,
        source_category: row.category,
        source_part_number: row.partNumber,
        source_ss_rec_code: row.ssRecCode,
        source_quantity: row.quantityText,
        source_unit: row.unit,
        source_location: row.location,
        source_remarks: row.remarks,
        classification: row.classification,
        outcome: name,
        message: rowMessage(name, row, approved, o.outcome === "exclude" ? o.reason : undefined),
        decided_by: approved || o.outcome === "exclude" ? context.userId : null,
        resolved_at: o.outcome === "exclude" ? new Date() : null,
        resolution_note: o.outcome === "exclude" ? o.reason : null,
        candidate_keys: row.candidates.map((c) => c.key) as unknown as Prisma.InputJsonValue,
        material_key: p?.materialKey ?? null,
        material_name: p?.materialName ?? null,
        material_unit: p?.materialUnit ?? null,
        item_code: p?.itemCode ?? null,
        quantity: p?.quantity ?? null,
        movement_id: p?.movementId ?? null,
      };
    });
    const count = (n: OpeningStockRowOutcome) => records.filter((r) => r.outcome === n).length;
    await tx.opening_stock_import_batches.create({
      data: {
        id: batchId,
        batch_reference: batchReference,
        client_submission_id: clientSubmissionId,
        file_name: parsed.fileName,
        file_sha256: parsed.fileSha256,
        content_sha256: parsed.contentSha256,
        sheet_name: parsed.sheetName,
        total_rows: rows.length,
        posted_existing_count: count("posted_existing"),
        registered_new_count: count("registered_new"),
        held_count: count("held"),
        not_imported_count: count("not_imported"),
        excluded_count: count("excluded"),
        posted_quantity: [...postings.values()].reduce((s, p) => s + p.quantity, 0),
        created_by: context.userId,
      },
    });
    await tx.opening_stock_import_rows.createMany({ data: records });
    // In the transaction, so a committed import always has its audit record.
    await tx.audit_logs.create({
      data: {
        actor_id: context.userId,
        action: "offline_inventory.opening_stock_import",
        entity_type: "opening_stock_import_batch",
        entity_id: batchId,
        summary: `Opening stock import ${batchReference}: ${count("posted_existing")} existing, ${count("registered_new")} new, ${count("held")} held, ${count("not_imported")} failed (${rows.length} rows)`,
        metadata: {
          batchReference,
          fileName: parsed.fileName,
          fileSha256: parsed.fileSha256,
          totalRows: rows.length,
          postedExisting: count("posted_existing"),
          registeredNew: count("registered_new"),
          held: count("held"),
          failed: count("not_imported"),
          excluded: count("excluded"),
          postedQuantity: [...postings.values()].reduce((s, p) => s + p.quantity, 0),
          sourceQuantity: rows.reduce((s, r) => s + (r.quantity ?? 0), 0),
          heldRows: records.filter((r) => r.outcome === "held").map((r) => r.row_number),
          approvedDecisions: records.filter((r) => r.decided_by).map((r) => r.row_number),
          newItemCodes: [...postings.values()].filter((p) => p.outcome === "registered_new").map((p) => p.itemCode),
        } as Prisma.InputJsonValue,
      },
    });
    return { batchId };
  });

  if ("repeatId" in outcome) return resultForBatch(prisma, outcome.repeatId!, true);
  const result = await resultForBatch(prisma, outcome.batchId!, false);
  if (result.postedExisting + result.registeredNew > 0) {
    await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_IMPORTED, null, context.userId);
  }
  return result;
}

// ── Batches and held rows ───────────────────────────────────────────────────

export type OpeningStockBatchRow = OpeningStockRowResult & {
  classification: string;
  // Held rows only: what the engine finds now, against today's Inventory.
  current: OpeningStockPreviewRow | null;
};

export type OpeningStockBatchView = {
  batchReference: string;
  fileName: string;
  createdAt: string;
  createdByName: string;
  totalRows: number;
  postedExisting: number;
  registeredNew: number;
  held: number;
  failed: number;
  excluded: number;
  postedQuantity: number;
  canResolve: boolean;
  rows: OpeningStockBatchRow[];
};

type SourceRecord = { row_number: number; source_material_name: string; source_category: string; source_part_number: string; source_ss_rec_code: string; source_quantity: string; source_unit: string; source_location: string; source_remarks: string };
type CorrectedRecord = SourceRecord & {
  corrected_material_name?: string | null;
  corrected_part_number?: string | null;
  corrected_category?: string | null;
  corrected_unit?: string | null;
  corrected_quantity?: Prisma.Decimal | number | null;
  correction_remarks?: string | null;
};

export function correctionOf(r: CorrectedRecord): CorrectionValues {
  return {
    materialName: r.corrected_material_name ?? null,
    partNumber: r.corrected_part_number ?? null,
    category: r.corrected_category ?? null,
    unit: r.corrected_unit ?? null,
    quantity: r.corrected_quantity !== null && r.corrected_quantity !== undefined ? Number(r.corrected_quantity) : null,
    remarks: r.correction_remarks ?? null,
  };
}

// The row as matching and posting see it: the original Excel values with
// any verified corrections laid over them (the originals are never changed).
export function effectiveRowOf(r: CorrectedRecord): OpeningStockSourceRow {
  return effectiveSourceRow(sourceRowOf(r), correctionOf(r));
}

export function sourceRowOf(r: SourceRecord): OpeningStockSourceRow {
  return {
    rowNumber: r.row_number,
    materialName: r.source_material_name,
    category: r.source_category,
    partNumber: r.source_part_number,
    ssRecCode: r.source_ss_rec_code,
    quantityText: r.source_quantity,
    unit: r.source_unit,
    location: r.source_location,
    remarks: r.source_remarks,
  };
}

// The whole batch, with each held row re-checked against today's Inventory
// (the stored source row is classified again together with the rest of the
// batch, so shared references inside the file still show).
export async function getOpeningStockBatch(context: CurrentUserContext, batchReference: string): Promise<OpeningStockBatchView> {
  requireManage(context);
  const batch = await prisma.opening_stock_import_batches.findUnique({ where: { batch_reference: batchReference } });
  if (!batch) throw new AppError("Import batch not found.", { code: "NOT_FOUND" });
  const [records, inventory, creator] = await Promise.all([
    prisma.opening_stock_import_rows.findMany({ where: { batch_id: batch.id }, orderBy: { row_number: "asc" } }),
    loadInventory(prisma),
    prisma.profiles.findUnique({ where: { id: batch.created_by }, select: { full_name: true } }),
  ]);
  const classified = new Map(withLabels(classifyOpeningStockRows(records.map(effectiveRowOf), buildMaterialIndex(inventory.materials, inventory.postedImportKeys))).map((r) => [r.rowNumber, r]));
  const summary = await resultForBatch(prisma, batch.id, false);
  return {
    batchReference: batch.batch_reference,
    fileName: batch.file_name,
    createdAt: batch.created_at.toISOString(),
    createdByName: creator?.full_name ?? "Unknown",
    totalRows: summary.totalRows,
    postedExisting: summary.postedExisting,
    registeredNew: summary.registeredNew,
    held: summary.held,
    failed: summary.failed,
    excluded: summary.excluded,
    postedQuantity: summary.postedQuantity,
    canResolve: canApproveOpeningStockDecisions(context),
    rows: summary.rows.map((r, i) => ({
      ...r,
      classification: records[i].classification,
      current: r.outcome === "held" ? classified.get(r.rowNumber) ?? null : null,
    })),
  };
}

export type OpeningStockResolveResult = {
  batchReference: string;
  resolved: OpeningStockRowResult[];
  // Rows that were no longer held (e.g. a retry or another approver): left
  // exactly as they were.
  alreadyResolved: number[];
  stillHeld: number;
};

// Resolves held rows of a batch: Use existing / Register as new / Exclude
// (with a reason) / keep holding. Approvers only. One transaction under the
// import lock with the batch's rows locked, so a retry or a second approver
// never posts a row twice: a row that is no longer held is reported, not
// changed. The source values come from the batch record — the file is not
// needed again.
export async function resolveHeldOpeningStockRows(
  context: CurrentUserContext,
  batchReference: string,
  decisions: Record<number, RowDecision>,
  // Needs Verification: the row version each decision was made against; a
  // row changed since then is refused rather than posted on stale details.
  options: { expectedVersions?: Record<number, number>; note?: string } = {}
): Promise<OpeningStockResolveResult> {
  requireManage(context);
  if (!canApproveOpeningStockDecisions(context)) {
    throw new AppError("Only the System Administrator or Maintenance Manager can resolve held rows.", { code: "FORBIDDEN" });
  }
  const decided = Object.entries(decisions).filter(([, d]) => d.action !== "hold");
  if (decided.length === 0) throw new AppError("Choose a decision for at least one held row.", { code: "VALIDATION_ERROR" });

  const outcome = await withBackendTransaction(context.userId, async (tx) => {
    await takeImportLocks(tx);
    const batch = await tx.opening_stock_import_batches.findUnique({ where: { batch_reference: batchReference } });
    if (!batch) throw new AppError("Import batch not found.", { code: "NOT_FOUND" });
    await tx.$queryRaw`SELECT id FROM opening_stock_import_rows WHERE batch_id = ${batch.id}::uuid FOR UPDATE`;
    const records = await tx.opening_stock_import_rows.findMany({ where: { batch_id: batch.id }, orderBy: { row_number: "asc" } });
    const byRow = new Map(records.map((r) => [r.row_number, r]));

    const alreadyResolved: number[] = [];
    const pending: Record<number, RowDecision> = {};
    for (const [n, d] of decided) {
      const rec = byRow.get(Number(n));
      if (!rec) throw new AppError(`Row ${n} is not in batch ${batchReference}.`, { code: "VALIDATION_ERROR" });
      if (rec.outcome !== "held") alreadyResolved.push(rec.row_number);
      else {
        const expected = options.expectedVersions?.[rec.row_number];
        if (expected !== undefined && expected !== rec.row_version) {
          throw new AppError(`Row ${rec.row_number} was changed by someone else. Reload and check it again.`, { code: "CONFLICT" });
        }
        pending[rec.row_number] = d;
      }
    }

    const inventory = await loadInventory(tx);
    const index = buildMaterialIndex(inventory.materials, inventory.postedImportKeys);
    const classified = classifyOpeningStockRows(records.map(effectiveRowOf), index);
    const targets = classified.filter((r) => pending[r.rowNumber]);
    let resolved: ResolvedOpeningStockRow[];
    try {
      resolved = resolveOpeningStockDecisions(targets, pending, index, true);
    } catch (error) {
      if (error instanceof DecisionError) throw new AppError(error.message, { code: "VALIDATION_ERROR" });
      throw error;
    }

    const originals = new Map<number, string>();
    for (const { row } of resolved) {
      const rec = byRow.get(row.rowNumber)!;
      if (hasCorrection(correctionOf(rec))) originals.set(row.rowNumber, `"${rec.source_material_name}" ${rec.source_quantity} ${rec.source_unit}`);
    }
    const postings = await writePostings(tx, context, resolved, batch.batch_reference, "Opening stock import (held row resolved)", originals);
    const now = new Date();
    const results: OpeningStockRowResult[] = [];
    for (const { row, outcome: o } of resolved) {
      const rec = byRow.get(row.rowNumber)!;
      const p = postings.get(row.rowNumber);
      const name = outcomeName(o);
      if (name === "held") continue;
      const exception = o.outcome === "register_new" ? o.exception : undefined;
      const differentCodes = exception ? exception.differentFrom.map((m) => m.itemCode ?? m.name).join(", ") : "";
      const message = exception
        ? `Registered as a different material from ${differentCodes} (exception approved).`
        : rowMessage(name, row, true, o.outcome === "exclude" ? o.reason : undefined);
      await tx.opening_stock_import_rows.update({
        where: { id: rec.id },
        data: {
          outcome: name,
          message,
          decided_by: context.userId,
          resolved_at: now,
          resolution_note: o.outcome === "exclude" ? o.reason : exception ? `Different from ${differentCodes}: ${exception.reason}` : null,
          candidate_keys: row.candidates.map((c) => c.key) as unknown as Prisma.InputJsonValue,
          material_key: p?.materialKey ?? null,
          material_name: p?.materialName ?? null,
          material_unit: p?.materialUnit ?? null,
          item_code: p?.itemCode ?? null,
          quantity: p?.quantity ?? null,
          movement_id: p?.movementId ?? null,
          updated_at: now,
          row_version: { increment: 1 },
        },
      });
      // Verification history: the decision, and the approved versus the
      // submitted quantity.
      const submittedQty = Number(rec.source_quantity);
      await tx.opening_stock_row_events.create({
        data: {
          row_id: rec.id,
          batch_id: batch.id,
          action: name === "excluded" ? "excluded" : exception ? "registered_different" : name === "registered_new" ? "registered_new" : "posted_existing",
          from_status: deriveVerificationStatus(rec.outcome, rec.verification_status),
          to_status: deriveVerificationStatus(name, rec.verification_status),
          actor_id: context.userId,
          note: o.outcome === "exclude" ? o.reason : exception ? exception.reason : options.note ?? null,
          details: {
            materialName: p?.materialName ?? null,
            itemCode: p?.itemCode ?? null,
            unit: p?.materialUnit ?? null,
            submittedQuantity: Number.isFinite(submittedQty) ? submittedQty : rec.source_quantity,
            approvedQuantity: p?.quantity ?? null,
            quantityDifference: p && Number.isFinite(submittedQty) ? p.quantity - submittedQty : null,
            corrected: hasCorrection(correctionOf(rec)),
            ...(exception
              ? {
                  exception: "register_as_different_material",
                  confirmedDifferent: true,
                  differentFrom: exception.differentFrom,
                  proposedByDataEntry: rec.different_material_proposed,
                  ...(exception.exactMatchOverride ? { exactMatchOverride: exception.exactMatchOverride } : {}),
                }
              : {}),
          } as Prisma.InputJsonValue,
        },
      });
      if (exception) {
        await tx.audit_logs.create({
          data: {
            actor_id: context.userId,
            action: "offline_inventory.opening_stock_registered_different",
            entity_type: "opening_stock_import_row",
            entity_id: rec.id,
            summary: `Opening stock row ${row.rowNumber}: registered as ${p?.itemCode ?? "a new material"}, a material different from ${differentCodes} (same part number) — exception approved`,
            metadata: {
              batchReference: batch.batch_reference,
              rowNumber: row.rowNumber,
              newItemCode: p?.itemCode ?? null,
              newMaterialName: p?.materialName ?? null,
              existingMaterials: exception.differentFrom,
              confirmedDifferent: true,
              reason: exception.reason,
              submittedName: rec.source_material_name,
              submittedQuantity: rec.source_quantity,
              submittedUnit: rec.source_unit,
              exactMatchOverride: exception.exactMatchOverride ?? null,
            } as Prisma.InputJsonValue,
          },
        });
        // The exact-match override is a separate exceptional approval with
        // its own audit record.
        if (exception.exactMatchOverride) {
          const o = exception.exactMatchOverride;
          await tx.audit_logs.create({
            data: {
              actor_id: context.userId,
              action: "offline_inventory.opening_stock_exact_match_override",
              entity_type: "opening_stock_import_row",
              entity_id: rec.id,
              summary: `Opening stock row ${row.rowNumber}: exceptional approval — registered although it exactly matches ${o.exactMatchTo.map((m) => m.itemCode ?? m.name).join(", ")} (${o.evidenceType === "specification" ? "distinguishing specification" : "physical evidence"} documented)`,
              metadata: {
                batchReference: batch.batch_reference,
                rowNumber: row.rowNumber,
                newItemCode: p?.itemCode ?? null,
                exactMatchTo: o.exactMatchTo,
                evidenceType: o.evidenceType,
                evidence: o.evidence,
                reason: exception.reason,
              } as Prisma.InputJsonValue,
            },
          });
        }
      }
      results.push({
        rowNumber: row.rowNumber,
        sourceName: rec.source_material_name,
        sourceQuantity: rec.source_quantity,
        sourceUnit: rec.source_unit,
        outcome: name,
        materialName: p?.materialName ?? null,
        unit: p?.materialUnit ?? null,
        quantity: p?.quantity ?? null,
        itemCode: p?.itemCode ?? null,
        message,
        ...(exception ? { differentFrom: exception.differentFrom.map((m) => m.itemCode ?? m.name) } : {}),
      });
    }
    const updated = await refreshBatchCounts(tx, batch.id);
    if (results.length > 0) {
      await tx.audit_logs.create({
        data: {
          actor_id: context.userId,
          action: "offline_inventory.opening_stock_held_resolved",
          entity_type: "opening_stock_import_batch",
          entity_id: batch.id,
          summary: `Opening stock import ${batch.batch_reference}: ${results.length} held row(s) resolved (${updated.held_count} still held)`,
          metadata: {
            batchReference: batch.batch_reference,
            rows: results.map((r) => ({ row: r.rowNumber, outcome: r.outcome, itemCode: r.itemCode, quantity: r.quantity, material: r.materialName })),
            alreadyResolved,
            stillHeld: updated.held_count,
          } as Prisma.InputJsonValue,
        },
      });
    }
    return { results, alreadyResolved, stillHeld: updated.held_count, posted: postings.size };
  });

  if (outcome.posted > 0) await emitOfflineInventoryRealtimeEvent(REALTIME_EVENTS.OFFLINE_INVENTORY_IMPORTED, null, context.userId);
  return { batchReference, resolved: outcome.results, alreadyResolved: outcome.alreadyResolved, stillHeld: outcome.stillHeld };
}

export type OpeningStockBatchSummary = {
  batchReference: string;
  fileName: string;
  totalRows: number;
  postedExisting: number;
  registeredNew: number;
  held: number;
  failed: number;
  excluded: number;
  postedQuantity: number;
  createdByName: string;
  createdAt: string;
};

export async function getRecentOpeningStockImports(limit = 10): Promise<OpeningStockBatchSummary[]> {
  const batches = await prisma.opening_stock_import_batches.findMany({ orderBy: { created_at: "desc" }, take: limit });
  const names = new Map(
    (await prisma.profiles.findMany({ where: { id: { in: [...new Set(batches.map((b) => b.created_by))] } }, select: { id: true, full_name: true } })).map(
      (p) => [p.id, p.full_name]
    )
  );
  return batches.map((b) => ({
    batchReference: b.batch_reference,
    fileName: b.file_name,
    totalRows: b.total_rows,
    postedExisting: b.posted_existing_count,
    registeredNew: b.registered_new_count,
    held: b.held_count,
    failed: b.not_imported_count,
    excluded: b.excluded_count,
    postedQuantity: Number(b.posted_quantity),
    createdByName: names.get(b.created_by) ?? "Unknown",
    createdAt: b.created_at.toISOString(),
  }));
}
