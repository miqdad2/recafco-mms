// Asset Register Import Mapping and New Asset Form Update Unit 10G.34.
//
// Shared, pure (no database access) Excel-parsing logic for the RECAFCO
// maintenance asset register format — the same "assets equipment"-style
// sheet used by both:
//   - the browser-driven Import Excel feature (app/actions/asset-import.ts)
//   - the local replace-import script (scripts/replace-assets-from-excel.mjs,
//     imported via a relative path since standalone scripts can't resolve
//     the "@/..." path alias — Node's built-in TypeScript stripping runs
//     this file's types away at load time, matching the pattern already
//     used by this repo's other verify-*.mjs scripts)
//
// No "server-only" import here on purpose — this module never touches
// Prisma or any request context, only ExcelJS cell values, so it is safe to
// load from either runtime.

import type ExcelJS from "exceljs";

// ─── Row field keys ──────────────────────────────────────────────────────────

export type RowField =
  | "srNo"
  | "assetType"
  | "make"
  | "modelRaw"
  | "fileNumber"
  | "colour"
  | "plateNumber"
  | "monthOf"
  | "daysExpired"
  | "expiresOn"
  | "chassisNumber"
  | "location"
  | "driver"
  | "remarks";

export function normalizeHeader(h: unknown): string {
  return String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Matches the exact column labels from the maintenance team's Excel sheet
// (Task 1): Sr. No. / Asset Tupe / Make / Model / File # / Colour /
// plate No. / month of / DAYS/ EXPIRED / Expires on / CHASSI NO. /
// Department / Location / Responsible Person / Driver / Remarks — plus a
// few close spelling variants ("Asset Type", "Chassis No.") so a re-typed
// header row still matches.
//
// Current Location Mapping Bug Fix Unit 10G.48A: the maintenance team's
// latest sheet uses the header "Current Location" instead of "Department /
// Location" — `normalizeHeader` already strips casing/spaces/slashes/
// hyphens/underscores/newlines, so every casing/spacing variant of a given
// phrase ("Current Location", "CURRENT LOCATION", "Current-Location",
// "Current / Location", ...) collapses to the same key here; only one entry
// per distinct phrase is needed. All of these map to the same "location"
// field the importer already writes into `assets.location` (the plain
// text column — never dropped just because it doesn't match an existing
// department relation, since this importer never touches department_id at
// all).
export const HEADER_MAP: Record<string, RowField> = {
  srno: "srNo",
  no: "srNo",
  assettupe: "assetType",
  assettype: "assetType",
  make: "make",
  makeassetname: "make",
  model: "modelRaw",
  modelyear: "modelRaw",
  file: "fileNumber",
  fileno: "fileNumber",
  colour: "colour",
  color: "colour",
  plateno: "plateNumber",
  monthof: "monthOf",
  expirymonth: "monthOf",
  daysexpired: "daysExpired",
  expireson: "expiresOn",
  chassino: "chassisNumber",
  chassisno: "chassisNumber",
  departmentlocation: "location",
  currentlocation: "location",
  presentlocation: "location",
  existinglocation: "location",
  location: "location",
  worklocation: "location",
  site: "location",
  area: "location",
  responsiblepersondriver: "driver",
  remarks: "remarks",
};

export function findHeaderRow(ws: ExcelJS.Worksheet): { rowNum: number; matchCount: number; colMap: Record<number, RowField> } {
  let best = { rowNum: -1, matchCount: 0, colMap: {} as Record<number, RowField> };
  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    const colMap: Record<number, RowField> = {};
    let matchCount = 0;
    row.eachCell({ includeEmpty: false }, (cell, colNum) => {
      const key = normalizeHeader(cell.value);
      const field = HEADER_MAP[key];
      if (field) {
        colMap[colNum] = field;
        matchCount++;
      }
    });
    if (matchCount > best.matchCount) best = { rowNum, matchCount, colMap };
  });
  return best.matchCount >= 6 ? best : { rowNum: -1, matchCount: 0, colMap: {} };
}

// ─── Cell readers ─────────────────────────────────────────────────────────────

export function cellRaw(cell: ExcelJS.Cell | null | undefined): unknown {
  let v = cell?.value;
  if (v && typeof v === "object" && "result" in v) v = (v as ExcelJS.CellFormulaValue).result;
  return v;
}

export function cellStr(cell: ExcelJS.Cell | null | undefined): string {
  const v = cellRaw(cell);
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

// Treats "-", "0", and "" as "not provided" — this sheet uses all three as
// placeholders for fields that don't apply to a given equipment type (Task
// 6/7 — never fabricate a value where the source is a placeholder).
export function blankIfPlaceholder(s: string): string {
  const t = s.trim();
  if (t === "" || t === "-" || t === "0") return "";
  return t;
}

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial)) return null;
  const d = new Date(EXCEL_EPOCH_MS + serial * 86400000);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ExpiryParseResult = { date: Date | null; invalid: boolean };

// Reads the "Expires on" cell (Task 6). Never surfaces a raw Excel serial
// number as a date — native Date cells and numeric serials both convert
// properly; "-"/blank and any pre-2000 result (the classic serial-0 -> 1899
// artifact) are treated as "no expiry" (shown as "—" in the UI), not a real
// date.
export function parseExpiryCell(cell: ExcelJS.Cell | null | undefined): ExpiryParseResult {
  const raw = cellRaw(cell);
  if (raw === null || raw === undefined) return { date: null, invalid: false };
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime()) || raw.getUTCFullYear() < 2000) return { date: null, invalid: false };
    return { date: raw, invalid: false };
  }
  if (typeof raw === "number") {
    const d = excelSerialToDate(raw);
    if (!d || d.getUTCFullYear() < 2000) return { date: null, invalid: false };
    return { date: d, invalid: false };
  }
  const text = String(raw).trim();
  if (text === "" || text === "-") return { date: null, invalid: false };

  let y: number, mo: number, d: number;
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const dmy = !iso ? text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/) : null;
  if (iso) {
    y = Number(iso[1]); mo = Number(iso[2]); d = Number(iso[3]);
  } else if (dmy) {
    d = Number(dmy[1]); mo = Number(dmy[2]); y = Number(dmy[3]);
  } else {
    return { date: null, invalid: true };
  }
  const date = new Date(Date.UTC(y, mo - 1, d));
  const valid = date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
  return valid ? { date, invalid: false } : { date: null, invalid: true };
}

// ─── Asset Type -> system category mapping (Task 5/6) ───────────────────────
// `leaf` is the exact value stored in assets.category / asset_categories.name
// — this app already treats that field as the "Asset Type" a normal user
// sees (Task 5: "Asset Type should become the main visible grouping").
export type CategoryMapping = { leaf: string; parentIfNew: string };

export const TYPE_MAP: Record<string, CategoryMapping> = {
  "cars": { leaf: "Car", parentIfNew: "Vehicles" },
  "pickup": { leaf: "Pickup", parentIfNew: "Vehicles" },
  "bus": { leaf: "Bus", parentIfNew: "Vehicles" },
  "half lory": { leaf: "Half Lorry", parentIfNew: "Vehicles" },
  "half lorry": { leaf: "Half Lorry", parentIfNew: "Vehicles" },
  "tanker": { leaf: "Tanker", parentIfNew: "Vehicles" },
  "trailer": { leaf: "Trailer", parentIfNew: "Vehicles" },
  "loader": { leaf: "Loader", parentIfNew: "Heavy Equipment" },
  "bob": { leaf: "Bobcat", parentIfNew: "Heavy Equipment" },
  "bobcat": { leaf: "Bobcat", parentIfNew: "Heavy Equipment" },
  "forklift": { leaf: "Forklift", parentIfNew: "Heavy Equipment" },
  "cranes": { leaf: "Crane", parentIfNew: "Heavy Equipment" },
  "crane": { leaf: "Crane", parentIfNew: "Heavy Equipment" },
  "manlift": { leaf: "Manlift", parentIfNew: "Heavy Equipment" },
  "generator": { leaf: "Generator", parentIfNew: "Heavy Equipment" },
  "tower light": { leaf: "Tower Light", parentIfNew: "Electrical Equipment" },
  "welding machine": { leaf: "Welding Machine", parentIfNew: "Electrical Equipment" },
  "airman compressor": { leaf: "Compressor", parentIfNew: "Production Equipment" },
};

export const NEEDS_REVIEW_LEAF = "Needs Review";

// asset_code prefix token per leaf category (Task 4 — exact list given).
export const CODE_TOKEN: Record<string, string> = {
  Car: "CAR",
  Pickup: "PICKUP",
  Bus: "BUS",
  "Half Lorry": "HLORRY",
  Tanker: "TANKER",
  Trailer: "TRAILER",
  Loader: "LOADER",
  Bobcat: "BOBCAT",
  Forklift: "FORKLIFT",
  Crane: "CRANE",
  Manlift: "MANLIFT",
  Generator: "GEN",
  "Tower Light": "TLIGHT",
  "Welding Machine": "WELD",
  Compressor: "COMP",
  [NEEDS_REVIEW_LEAF]: "REVIEW",
};

// The fixed, ordered display list of real asset types (Task 5/9) — used to
// drive the Asset Types overview and the New Asset Type dropdown, so both
// always agree on spelling/order.
export const ASSET_TYPE_DISPLAY_ORDER: string[] = [
  "Car", "Pickup", "Bus", "Half Lorry", "Tanker", "Trailer", "Loader",
  "Bobcat", "Forklift", "Crane", "Manlift", "Generator", "Tower Light",
  "Welding Machine", "Compressor",
];

function normalizeTypeKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export type CategorySource = "explicit" | "needs_review";

export type ResolvedCategory = CategoryMapping & { source: CategorySource; rawType: string };

// Task 5 — blank or unrecognized Asset Type is marked "Needs Review", never
// hidden and never silently folded into a generic "Other" bucket.
export function resolveCategory(rawType: string): ResolvedCategory {
  const trimmedType = rawType.trim();
  if (trimmedType) {
    const mapped = TYPE_MAP[normalizeTypeKey(trimmedType)];
    if (mapped) return { ...mapped, source: "explicit", rawType: trimmedType };
  }
  return { leaf: NEEDS_REVIEW_LEAF, parentIfNew: "Other", source: "needs_review", rawType: trimmedType };
}

// Brand heuristic (Task 1's "Make / Asset Name"): text before " - " if
// present, else the first token. Never invents anything not already in the
// Make text.
export function extractBrand(make: string): string | null {
  const dashIdx = make.indexOf(" - ");
  if (dashIdx > 0) return make.slice(0, dashIdx).trim();
  const firstToken = make.trim().split(/\s+/)[0];
  return firstToken || null;
}

export type ModelAndYear = { model: string | null; modelYear: number | null };

// Model column (Task 1's "Model / Year"): for vehicle rows this is actually
// the manufacturing YEAR; for generators/etc. it is a spec string (e.g.
// "320KVA") or a placeholder.
export function resolveModelAndYear(raw: string): ModelAndYear {
  const t = blankIfPlaceholder(raw);
  if (!t) return { model: null, modelYear: null };
  if (/^\d{4}$/.test(t)) {
    const year = Number(t);
    if (year >= 1970 && year <= new Date().getFullYear() + 1) return { model: null, modelYear: year };
  }
  return { model: t, modelYear: null };
}

// ─── Full-sheet parse (shared entry point) ───────────────────────────────────

export type ParsedAssetRow = {
  rowNum: number;
  srNo: string;
  assetTypeRaw: string;
  categorySource: CategorySource;
  leaf: string;
  parentIfNew: string;
  make: string;
  brand: string | null;
  model: string | null;
  modelYear: number | null;
  plateNumber: string | null;
  chassisNumber: string | null;
  location: string | null;
  driver: string | null;
  remarks: string | null;
  notes: string;
  registrationExpiryDate: Date | null;
  expiryInvalid: boolean;
  assetCode: string;
};

export type ParseSheetResult = {
  headerRowNum: number;
  rowsScanned: number;
  rows: ParsedAssetRow[];
  // Current Location Mapping Bug Fix Unit 10G.48A, Task 5: whether a column
  // in the header row matched to "location" at all (under any of the
  // HEADER_MAP synonyms above) — independent of whether the matched
  // column's cells actually had values. Lets the caller tell "this sheet
  // has no location-ish column at all" (nothing to warn about) apart from
  // "this sheet has a location column but every cell under it is blank"
  // (worth a hard warning — see parseAssetExcelForImportAction).
  hasLocationHeader: boolean;
};

// A jump of more than this many row numbers between two consecutive data
// rows, once at least one real data row has already been read, marks the end
// of "the current asset list" (Task 1 — "use only the current asset sheet/
// list", "do not import old/extra sheets unless the user explicitly confirms
// later"). This source file has exactly one such gap: a clean, fully-typed
// block of rows, then ~28 fully blank rows, then a separate handful of
// leftover/scrapped rows with no Asset Type at all and remarks like "scrap"
// — that trailing block is old/extra data, not part of the current register,
// so parsing stops at the gap rather than continuing into it. Note: with
// ExcelJS's `includeEmpty: false`, `eachRow` never invokes its callback at
// all for a row with zero cells set — it silently skips straight from the
// last real row number to the next one, so the gap has to be detected from
// the jump in `rowNum` between successive callback calls, not by counting
// blank-row callbacks (there are none to count).
const END_OF_LIST_ROW_GAP = 5;

// Parses every non-empty data row below the detected header row, stopping at
// the first long blank gap after data has started (see above). Within the
// current list, a row with no Asset Type or other identifying field is
// skipped as a stray blank line; every row that does carry data is kept and,
// if its Asset Type is blank/unrecognized, marked "Needs Review" rather than
// dropped (Task 5) — this only matters for a future file where that could
// happen inside the current block; it never triggers on this one.
export function parseAssetsSheet(ws: ExcelJS.Worksheet): ParseSheetResult {
  const header = findHeaderRow(ws);
  if (header.rowNum === -1) {
    return { headerRowNum: -1, rowsScanned: 0, rows: [], hasLocationHeader: false };
  }
  const hasLocationHeader = Object.values(header.colMap).includes("location");

  const getField = (row: ExcelJS.Row, field: RowField): ExcelJS.Cell | null => {
    for (const [colStr, f] of Object.entries(header.colMap)) {
      if (f === field) return row.getCell(Number(colStr));
    }
    return null;
  };

  const rows: ParsedAssetRow[] = [];
  let rowsScanned = 0;
  const seqByToken = new Map<string, number>();
  let lastDataRowNum = -1;
  let stopped = false;

  ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
    if (stopped || rowNum <= header.rowNum) return;

    const get = (field: RowField): string => cellStr(getField(row, field));

    const srNo = get("srNo");
    const assetTypeRaw = get("assetType");
    const make = get("make");
    const modelRaw = get("modelRaw");
    const fileNumber = blankIfPlaceholder(get("fileNumber"));
    const colour = blankIfPlaceholder(get("colour"));
    const plateNumberRaw = get("plateNumber");
    const monthOf = get("monthOf");
    const daysExpired = get("daysExpired");
    const chassisRaw = get("chassisNumber");
    const location = get("location");
    const driver = get("driver");
    const remarks = get("remarks");

    if (!srNo && !assetTypeRaw && !make && !plateNumberRaw && !chassisRaw && !location) return;

    if (lastDataRowNum !== -1 && rowNum - lastDataRowNum > END_OF_LIST_ROW_GAP) {
      stopped = true;
      return;
    }
    lastDataRowNum = rowNum;

    rowsScanned++;

    const expiry = parseExpiryCell(getField(row, "expiresOn"));
    // Task 7 — exact text, trim only, never coerced to a number.
    const plateNumber = blankIfPlaceholder(plateNumberRaw);
    const chassisNumber = blankIfPlaceholder(chassisRaw).trim();

    const category = resolveCategory(assetTypeRaw);
    const brand = extractBrand(make) || null;
    const { model, modelYear } = resolveModelAndYear(modelRaw);

    const noteParts: string[] = [];
    noteParts.push(`Excel Sr#: ${srNo || "?"}`);
    noteParts.push(`Excel Asset Type: ${category.rawType || "(blank)"}`);
    if (fileNumber) noteParts.push(`File #: ${fileNumber}`);
    if (colour) noteParts.push(`Colour: ${colour}`);
    if (expiry.date && (monthOf || daysExpired)) {
      noteParts.push(`Month: ${monthOf || "?"} | Days-to-expiry (as of sheet snapshot): ${daysExpired || "?"}`);
    }

    const token = CODE_TOKEN[category.leaf] ?? CODE_TOKEN[NEEDS_REVIEW_LEAF];
    const next = (seqByToken.get(token) ?? 0) + 1;
    seqByToken.set(token, next);

    rows.push({
      rowNum,
      srNo,
      assetTypeRaw: category.rawType,
      categorySource: category.source,
      leaf: category.leaf,
      parentIfNew: category.parentIfNew,
      make,
      brand,
      model,
      modelYear,
      plateNumber: plateNumber || null,
      chassisNumber: chassisNumber || null,
      location: location || null,
      driver: driver || null,
      remarks: remarks || null,
      notes: noteParts.join(" | "),
      registrationExpiryDate: expiry.date,
      expiryInvalid: expiry.invalid,
      assetCode: `AST-${token}-${String(next).padStart(4, "0")}`,
    });
  });

  return { headerRowNum: header.rowNum, rowsScanned, rows, hasLocationHeader };
}

// ─── Duplicate detection (Task 8) ───────────────────────────────────────────

export type DuplicateReport = {
  codeDupes: ParsedAssetRow[];
  plateDupes: { row: ParsedAssetRow; firstSeenRow: number }[];
  chassisDupes: { row: ParsedAssetRow; firstSeenRow: number }[];
};

export function findDuplicates(rows: ParsedAssetRow[]): DuplicateReport {
  const codeSeen = new Set<string>();
  const codeDupes: ParsedAssetRow[] = [];
  for (const r of rows) {
    const key = r.assetCode.toLowerCase();
    if (codeSeen.has(key)) codeDupes.push(r);
    codeSeen.add(key);
  }

  const plateSeen = new Map<string, number>();
  const plateDupes: DuplicateReport["plateDupes"] = [];
  for (const r of rows) {
    if (!r.plateNumber) continue;
    const key = r.plateNumber.trim().toLowerCase();
    const firstSeenRow = plateSeen.get(key);
    if (firstSeenRow !== undefined) plateDupes.push({ row: r, firstSeenRow });
    else plateSeen.set(key, r.rowNum);
  }

  const chassisSeen = new Map<string, number>();
  const chassisDupes: DuplicateReport["chassisDupes"] = [];
  for (const r of rows) {
    if (!r.chassisNumber) continue;
    const key = r.chassisNumber.trim().toLowerCase();
    const firstSeenRow = chassisSeen.get(key);
    if (firstSeenRow !== undefined) chassisDupes.push({ row: r, firstSeenRow });
    else chassisSeen.set(key, r.rowNum);
  }

  return { codeDupes, plateDupes, chassisDupes };
}

// ─── Notes field composition/extraction (Task 6/11 of Unit 10G.34, reused by
// Unit 10G.35's detail page) ─────────────────────────────────────────────────
// File No. and Colour have no dedicated assets columns — both the importer
// and the simple New/Edit Asset form compose them into the free-text `notes`
// column as "File #: X | Colour: Y". This best-effort reader is for DISPLAY/
// pre-fill only: it never fails, it just returns "" if the label isn't found.
export function extractNoteField(notes: string | null | undefined, label: string): string {
  if (!notes) return "";
  const m = notes.match(new RegExp(`${label}:\\s*([^|]+)`, "i"));
  return m ? m[1].trim() : "";
}
