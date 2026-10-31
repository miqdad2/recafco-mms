// Material Master Excel import — pure, dependency-free rules (no
// "server-only", no database), shared by the server import service and its
// unit tests. Reading the workbook and every database check live in
// lib/backend/store/material-master.ts.
//
// Files differ between departments, so no column position is assumed: each
// field is found from the header row, or chosen by the administrator. This is
// a material master import only: no quantity or cost is ever read from the
// file. Optional fields are master information, never stock.

import { normalizeMaterialKey } from "@/lib/materials/normalize-material";

export const MATERIAL_IMPORT_ROW_LIMIT = 5000;
export const ITEM_CODE_MAX_LENGTH = 64;
export const MATERIAL_DESCRIPTION_MAX_LENGTH = 300;
export const UNIT_MAX_LENGTH = 32;
export const MATERIAL_TEXT_MAX_LENGTH = 120;
export const MATERIAL_NOTES_MAX_LENGTH = 1000;
const QUANTITY_MAX = 999_999_999;

// 1-based worksheet column numbers (A = 1); null = not in this file. serial
// is display-only.
export type MaterialImportColumnMapping = {
  serial: number | null;
  itemCode: number | null;
  description: number | null;
  unit: number | null;
  category: number | null;
  partNumber: number | null;
  ssRecCode: number | null;
  location: number | null;
  minimumStock: number | null;
  reorderQuantity: number | null;
  notes: number | null;
};

export type MaterialImportField = keyof MaterialImportColumnMapping;

export const MATERIAL_IMPORT_FIELD_LABELS: Record<MaterialImportField, string> = {
  serial: "Serial Number",
  itemCode: "Item Code",
  description: "Material Description",
  unit: "Unit",
  category: "Category",
  partNumber: "Part Number",
  ssRecCode: "SS Rec. Code",
  location: "Location / Bin",
  minimumStock: "Minimum Stock Level",
  reorderQuantity: "Reorder Quantity",
  notes: "Notes",
};

export const REQUIRED_IMPORT_FIELDS: readonly MaterialImportField[] = ["itemCode", "description", "unit"];
export const OPTIONAL_IMPORT_FIELDS: readonly MaterialImportField[] = ["category", "partNumber", "ssRecCode", "location", "minimumStock", "reorderQuantity", "notes"];

const EMPTY_MAPPING: MaterialImportColumnMapping = {
  serial: null,
  itemCode: null,
  description: null,
  unit: null,
  category: null,
  partNumber: null,
  ssRecCode: null,
  location: null,
  minimumStock: null,
  reorderQuantity: null,
  notes: null,
};

// The older Maintenance Department layout, offered for a headerless sheet:
// A Serial, B Item Code, C Description, D Unit.
export const DEFAULT_MATERIAL_IMPORT_MAPPING: MaterialImportColumnMapping = {
  ...EMPTY_MAPPING,
  serial: 1,
  itemCode: 2,
  description: 3,
  unit: 4,
};

export function completeMapping(partial: Partial<MaterialImportColumnMapping>): MaterialImportColumnMapping {
  return { ...EMPTY_MAPPING, ...partial };
}

// A unit is a label: any value from the file is accepted and saved exactly as
// written, apart from surrounding whitespace. It is never converted, changed
// in case or treated as another unit (Set stays Set, and is never PCS).
export function normalizeImportUnit(raw: string): string {
  return raw.trim();
}

// Why a unit cannot be saved, or null when it can. "|" separates name and unit
// in the material key (buildBalanceKey), so it would break the material's
// identity. Control and invisible characters, markup and a leading formula
// character are refused; a unit also needs at least one letter or digit, so
// placeholders such as "-" or "?" are reported instead of saved.
export function importUnitProblem(unit: string): string | null {
  if (unit.length > UNIT_MAX_LENGTH) return `Unit is too long (max ${UNIT_MAX_LENGTH} characters)`;
  if (/[\p{Cc}\p{Cf}]/u.test(unit)) return "Unit contains a control or invisible character";
  if (/[|<>]/.test(unit)) return 'Unit cannot contain "|", "<" or ">"';
  if (/^[=+\-@]/.test(unit)) return "Unit cannot start with =, +, - or @";
  if (!/[\p{L}\p{N}]/u.test(unit)) return "Unit must contain a letter or number";
  return null;
}

// Item Codes are kept exactly as written (leading zeros, case, inner
// characters); only surrounding whitespace is removed. Uniqueness is
// compared case-insensitively, matching the database index.
export function normalizeItemCode(raw: string): string {
  return raw.trim();
}

export function itemCodeKey(code: string): string {
  return code.trim().toUpperCase();
}

// Collapses runs of whitespace inside a description (Excel cells often hold
// line breaks or double spaces); the text itself is otherwise unchanged.
export function normalizeDescription(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s/_\-.#:()]/g, "");
}

const FIELD_HEADERS: Record<MaterialImportField, Set<string>> = {
  itemCode: new Set(["itemcode", "code", "itemno", "itemnumber", "materialcode", "stockcode", "sku"]),
  description: new Set(["materialdescription", "description", "itemdescription", "material", "materialname", "itemname", "name", "desc"]),
  unit: new Set(["unit", "uom", "unitofmeasure", "units"]),
  serial: new Set(["sno", "slno", "srno", "serial", "serialno", "serialnumber", "no", "sn"]),
  category: new Set(["category", "materialcategory", "group"]),
  partNumber: new Set(["partnumber", "partno", "part"]),
  ssRecCode: new Set(["ssreccode", "ssrec", "sscode"]),
  location: new Set(["location", "storelocation", "bin", "locationbin"]),
  minimumStock: new Set(["minimumstock", "minimumstocklevel", "minstock", "minimumstockquantity"]),
  reorderQuantity: new Set(["reorderquantity", "reorderqty"]),
  notes: new Set(["notes", "remarks", "comments"]),
};

export type HeaderDetection = {
  mapping: MaterialImportColumnMapping;
  // Fields more than one column could be; the first is only a suggestion.
  ambiguous: MaterialImportField[];
  missingRequired: MaterialImportField[];
};

// A row is a header when it names at least two fields, one of them required.
// Returns what it describes, or null for a data row.
export function detectHeaderMapping(cells: string[]): HeaderDetection | null {
  const candidates = new Map<MaterialImportField, number[]>();
  cells.forEach((cell, index) => {
    const h = normalizeHeader(cell);
    if (!h) return;
    for (const field of Object.keys(FIELD_HEADERS) as MaterialImportField[]) {
      if (FIELD_HEADERS[field].has(h)) candidates.set(field, [...(candidates.get(field) ?? []), index + 1]);
    }
  });
  const named = [...candidates.keys()].filter((f) => f !== "serial");
  if (named.length < 2 || !named.some((f) => REQUIRED_IMPORT_FIELDS.includes(f))) return null;
  const mapping = completeMapping({});
  for (const [field, columns] of candidates) mapping[field] = columns[0];
  return {
    mapping,
    ambiguous: [...candidates].filter(([, columns]) => columns.length > 1).map(([field]) => field),
    missingRequired: REQUIRED_IMPORT_FIELDS.filter((f) => !candidates.has(f)),
  };
}

// Whether a headerless sheet really looks like A Serial, B Item Code,
// C Description, D Unit. Deliberately cautious: anything else needs a person.
export function looksLikeDefaultLayout(rows: string[][]): boolean {
  const sample = rows.slice(0, 50);
  if (sample.length === 0) return false;
  let description = 0;
  let unit = 0;
  for (const cells of sample) {
    if (cells.slice(4).some((c) => c.trim())) return false;
    if (cells[0].trim() && !/^\d+$/.test(cells[0].trim())) return false;
    description += cells[2].trim().length;
    unit += cells[3].trim().length;
  }
  return description >= unit;
}

// One source column can feed one field only.
export function mappingConflict(mapping: MaterialImportColumnMapping): string | null {
  const used = new Map<number, MaterialImportField>();
  for (const field of Object.keys(mapping) as MaterialImportField[]) {
    const column = mapping[field];
    if (column === null) continue;
    if (!Number.isInteger(column) || column < 1 || column > 50) return `${MATERIAL_IMPORT_FIELD_LABELS[field]} column is not valid.`;
    const other = used.get(column);
    if (other) return `${MATERIAL_IMPORT_FIELD_LABELS[other]} and ${MATERIAL_IMPORT_FIELD_LABELS[field]} cannot use the same column.`;
    used.set(column, field);
  }
  return null;
}

// Ready to import: every required field chosen and no column used twice.
export function validateMapping(mapping: MaterialImportColumnMapping): string | null {
  if (REQUIRED_IMPORT_FIELDS.some((f) => mapping[f] === null)) {
    return "Choose a column for Item Code, Material Description and Unit.";
  }
  return mappingConflict(mapping);
}

export type MaterialImportRawRow = {
  rowNumber: number;
  serial: string;
  itemCode: string;
  description: string;
  unit: string;
  category?: string;
  partNumber?: string;
  ssRecCode?: string;
  location?: string;
  minimumStock?: string;
  reorderQuantity?: string;
  notes?: string;
};

export type MaterialImportRowStatus =
  | "valid"
  | "existing_item_code"
  | "existing_material"
  | "duplicate_item_code"
  | "duplicate_material"
  | "missing_item_code"
  | "missing_description"
  | "missing_unit"
  | "invalid_unit"
  | "invalid_value"
  | "too_long"
  | "unknown_category";

export type MaterialImportPreviewRow = MaterialImportRawRow & {
  // The unit as it will be saved (only when it can be saved).
  normalizedUnit: string | null;
  // The category as it will be saved; null while it needs a decision, or when
  // the file has no Category column (the safe default then applies).
  resolvedCategory: string | null;
  categoryState: "existing" | "new" | "mapped" | "review" | null;
  status: MaterialImportRowStatus;
  message: string;
};

export type MaterialImportSummary = {
  totalRows: number;
  valid: number;
  existing: number;
  duplicates: number;
  invalid: number;
  invalidUnits: number;
};

// What already exists in Inventory Control, for the "existing match" check.
// itemCodeKeys: every Item Code on any material (archived included), via
// itemCodeKey(). identityKeys: every manual material identity as
// `${normalizeMaterialKey(name)}|${normalizeMaterialKey(unit)}` (archived
// included — an archived material is restored, never re-created).
export type ExistingMaterialIndex = {
  itemCodeKeys: Set<string>;
  identityKeys: Set<string>;
};

// Comparison only, never stored. The saved unit keeps its exact text, but
// "Nos" and "nos." still count as the same material here, so saving units
// exactly cannot let a duplicate through.
export function materialIdentityKey(name: string, unit: string): string {
  return `${normalizeMaterialKey(name)}|${normalizeMaterialKey(unit).replace(/\.$/, "").trim()}`;
}

const STATUS_MESSAGES: Record<MaterialImportRowStatus, string> = {
  valid: "Ready to import",
  existing_item_code: "Item Code already exists in Inventory Control — not imported",
  existing_material: "A material with this description and unit already exists — not imported",
  duplicate_item_code: "Item Code appears more than once in this file — fix the file",
  duplicate_material: "Same description and unit appear more than once in this file — fix the file",
  missing_item_code: "Item Code is missing",
  missing_description: "Material description is missing",
  missing_unit: "Unit is missing",
  invalid_unit: "Unit is not valid",
  invalid_value: "A value in this row is not valid",
  unknown_category: "Category needs a decision before this row can be imported",
  too_long: `Item Code (max ${ITEM_CODE_MAX_LENGTH}) or description (max ${MATERIAL_DESCRIPTION_MAX_LENGTH}) is too long`,
};

export function isBlankRawRow(row: Pick<MaterialImportRawRow, "itemCode" | "description" | "unit">): boolean {
  return !row.itemCode.trim() && !row.description.trim() && !row.unit.trim();
}

// Categories have no table: they are the fixed list plus any custom text
// already in use. Comparison ignores case and spacing only, so "FILTERS " is
// "Filters", but "Filter" is never treated as "Filters".
export function categoryKey(raw: string): string {
  return normalizeMaterialKey(raw);
}

export type MaterialCategoryResolution = { action: "create" } | { action: "map"; category: string };
export type MaterialCategoryResolutions = Record<string, MaterialCategoryResolution>;

export type MaterialImportCategoryContext = {
  // Whether this file has a Category column at all.
  mapped: boolean;
  // categoryKey() → saved spelling of every category in use.
  known: Map<string, string>;
  // The administrator's decision per unknown value, by categoryKey().
  resolutions: MaterialCategoryResolutions;
};

export type MaterialImportCategoryReview = {
  key: string;
  // As written in the file; "" = rows with a blank category.
  value: string;
  rows: number;
  resolution: MaterialCategoryResolution | null;
};

function resolveCategory(
  raw: string,
  context: MaterialImportCategoryContext,
  firstSpelling: Map<string, string>
): Pick<MaterialImportPreviewRow, "resolvedCategory" | "categoryState"> {
  if (!context.mapped) return { resolvedCategory: null, categoryState: null };
  const text = normalizeDescription(raw);
  const key = categoryKey(text);
  const known = context.known.get(key);
  if (known) return { resolvedCategory: known, categoryState: "existing" };
  const decision = context.resolutions[key];
  // Every spelling of a new category takes the first one in the file.
  if (decision?.action === "create" && text) return { resolvedCategory: firstSpelling.get(key) ?? text, categoryState: "new" };
  if (decision?.action === "map") {
    const target = context.known.get(categoryKey(decision.category));
    if (target) return { resolvedCategory: target, categoryState: "mapped" };
  }
  return { resolvedCategory: null, categoryState: "review" };
}

function optionalValueProblem(raw: MaterialImportRawRow): string | null {
  const text = (value?: string) => normalizeDescription(value ?? "");
  if ([raw.category, raw.partNumber, raw.ssRecCode, raw.location].some((v) => text(v).length > MATERIAL_TEXT_MAX_LENGTH)) {
    return `A text value is too long (max ${MATERIAL_TEXT_MAX_LENGTH} characters)`;
  }
  if (text(raw.notes).length > MATERIAL_NOTES_MAX_LENGTH) return `Notes are too long (max ${MATERIAL_NOTES_MAX_LENGTH} characters)`;
  const minimum = (raw.minimumStock ?? "").trim();
  if (minimum && !(Number(minimum) >= 0 && Number(minimum) <= QUANTITY_MAX)) return "Minimum Stock Level must be a number, 0 or greater";
  const reorder = (raw.reorderQuantity ?? "").trim();
  if (reorder && !(Number(reorder) > 0 && Number(reorder) <= QUANTITY_MAX)) return "Reorder Quantity must be a number greater than 0";
  return null;
}

const NO_CATEGORY_COLUMN: MaterialImportCategoryContext = { mapped: false, known: new Map(), resolutions: {} };

// Classifies every row. Problems in the row itself win over duplicate and
// existing checks. Every occurrence of a duplicated Item Code (or of a
// duplicated description + unit) is flagged, not just the later ones — the
// file is ambiguous about which one is right, so none is imported. A category
// nobody has decided on keeps an otherwise good row out; it is never quietly
// replaced with Other.
export function classifyMaterialImportRows(
  rows: MaterialImportRawRow[],
  existing: ExistingMaterialIndex,
  categories: MaterialImportCategoryContext = NO_CATEGORY_COLUMN
): MaterialImportPreviewRow[] {
  const codeCounts = new Map<string, number>();
  const identityCounts = new Map<string, number>();
  const firstCategorySpelling = new Map<string, string>();
  for (const raw of rows) {
    const text = normalizeDescription(raw.category ?? "");
    if (text && !firstCategorySpelling.has(categoryKey(text))) firstCategorySpelling.set(categoryKey(text), text);
  }
  const prepared = rows.map((raw) => {
    const itemCode = normalizeItemCode(raw.itemCode);
    const description = normalizeDescription(raw.description);
    const unitText = raw.unit.trim();
    const unitProblem = unitText ? importUnitProblem(unitText) : null;
    const normalizedUnit = unitText && !unitProblem ? normalizeImportUnit(unitText) : null;
    if (itemCode) codeCounts.set(itemCodeKey(itemCode), (codeCounts.get(itemCodeKey(itemCode)) ?? 0) + 1);
    if (description && normalizedUnit) {
      const key = materialIdentityKey(description, normalizedUnit);
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
    }
    return { raw, itemCode, description, unitText, unitProblem, normalizedUnit };
  });

  return prepared.map(({ raw, itemCode, description, unitText, unitProblem, normalizedUnit }) => {
    const category = resolveCategory(raw.category ?? "", categories, firstCategorySpelling);
    const valueProblem = optionalValueProblem(raw);
    let status: MaterialImportRowStatus;
    if (!itemCode) status = "missing_item_code";
    else if (!description) status = "missing_description";
    else if (!unitText) status = "missing_unit";
    else if (itemCode.length > ITEM_CODE_MAX_LENGTH || description.length > MATERIAL_DESCRIPTION_MAX_LENGTH) status = "too_long";
    else if (unitProblem || !normalizedUnit) status = "invalid_unit";
    else if (valueProblem) status = "invalid_value";
    else if ((codeCounts.get(itemCodeKey(itemCode)) ?? 0) > 1) status = "duplicate_item_code";
    else if ((identityCounts.get(materialIdentityKey(description, normalizedUnit)) ?? 0) > 1) status = "duplicate_material";
    else if (existing.itemCodeKeys.has(itemCodeKey(itemCode))) status = "existing_item_code";
    else if (existing.identityKeys.has(materialIdentityKey(description, normalizedUnit))) status = "existing_material";
    else if (category.categoryState === "review") status = "unknown_category";
    else status = "valid";

    const clean = (value?: string) => normalizeDescription(value ?? "");
    return {
      rowNumber: raw.rowNumber,
      serial: raw.serial.trim(),
      itemCode,
      description,
      unit: unitText,
      category: clean(raw.category),
      partNumber: clean(raw.partNumber),
      ssRecCode: clean(raw.ssRecCode),
      location: clean(raw.location),
      minimumStock: (raw.minimumStock ?? "").trim(),
      reorderQuantity: (raw.reorderQuantity ?? "").trim(),
      notes: (raw.notes ?? "").trim(),
      normalizedUnit,
      ...category,
      status,
      message: status === "invalid_unit" ? unitProblem ?? STATUS_MESSAGES.invalid_unit : status === "invalid_value" ? valueProblem ?? STATUS_MESSAGES.invalid_value : STATUS_MESSAGES[status],
    };
  });
}

// Each category value in the file that is not known yet, with the decision
// taken so far; the first spelling in the file names it.
export function categoryReviewList(rows: MaterialImportPreviewRow[], context: MaterialImportCategoryContext): MaterialImportCategoryReview[] {
  const review = new Map<string, MaterialImportCategoryReview>();
  if (!context.mapped) return [];
  for (const row of rows) {
    const value = row.category ?? "";
    const key = categoryKey(value);
    if (context.known.has(key)) continue;
    const entry = review.get(key);
    if (entry) entry.rows += 1;
    else review.set(key, { key, value, rows: 1, resolution: context.resolutions[key] ?? null });
  }
  return [...review.values()].sort((a, b) => a.value.localeCompare(b.value));
}

// Unknown categories count as invalid in the totals, since those rows are not
// imported; MaterialImportBreakdown says why each row was held back.
export function summarizeMaterialImport(rows: MaterialImportPreviewRow[]): MaterialImportSummary {
  const summary: MaterialImportSummary = { totalRows: rows.length, valid: 0, existing: 0, duplicates: 0, invalid: 0, invalidUnits: 0 };
  for (const row of rows) {
    if (row.status === "valid") summary.valid += 1;
    else if (row.status === "existing_item_code" || row.status === "existing_material") summary.existing += 1;
    else if (row.status === "duplicate_item_code" || row.status === "duplicate_material") summary.duplicates += 1;
    else if (row.status === "invalid_unit") summary.invalidUnits += 1;
    else summary.invalid += 1;
  }
  return summary;
}

export type MaterialImportBreakdown = {
  missingCodes: number;
  missingDescriptions: number;
  missingUnits: number;
  invalidValues: number;
  unknownCategories: number;
  rowsRequiringReview: number;
};

export function breakdownMaterialImport(rows: MaterialImportPreviewRow[]): MaterialImportBreakdown {
  const count = (...statuses: MaterialImportRowStatus[]) => rows.filter((r) => statuses.includes(r.status)).length;
  return {
    missingCodes: count("missing_item_code"),
    missingDescriptions: count("missing_description"),
    missingUnits: count("missing_unit"),
    invalidValues: count("invalid_value", "too_long"),
    unknownCategories: count("unknown_category"),
    rowsRequiringReview: rows.length - count("valid", "existing_item_code", "existing_material"),
  };
}
