// Opening Stock Excel import — pure matching and decision rules (no
// "server-only", no database), shared by the server import service
// (lib/backend/store/opening-stock-import.ts) and its unit tests.
//
// Inventory Control has no material table: a material is a ledger identity
// (buildBalanceKey: "part:<id>" or "manual:<name>|<unit>"). Opening stock for
// an existing material must therefore be posted with that material's EXACT
// stored name and unit, or the stock lands on a different identity that the
// Issue workflow never sees.
//
// Safety rules enforced here:
//   - A row is "Existing Material" only when exactly one material has the
//     same name (case and spacing aside), its unit is compatible, and no
//     other material is a possible match. Everything less certain is
//     "Needs Review" and is held until an approver decides.
//   - Not finding a match never proves a row is new: rows with no candidate
//     are proposed as new, but any approver can link them to an existing
//     material instead.
//   - Units are never converted. PCS and Nos are the same counting unit, and
//     are only treated so once the material itself is confirmed; any other
//     difference (PCS vs Set, Mtr, …) blocks "Use existing".

import { normalizeMaterialKey } from "@/lib/materials/normalize-material";
import { UNITS, normalizeCategory } from "@/components/store/offline-inventory-types";

export const OPENING_STOCK_ROW_LIMIT = 500;
export const OPENING_STOCK_NAME_MAX_LENGTH = 300;
export const OPENING_STOCK_TEXT_MAX_LENGTH = 120;
export const OPENING_STOCK_QUANTITY_MAX = 999_999_999;
// Approved 2026-11-25: new materials registered by this import get Item Codes
// in their own series, AMSOS0001, AMSOS0002, … (never reused).
export const OPENING_STOCK_ITEM_CODE_PREFIX = "AMSOS";
export const OPENING_STOCK_ITEM_CODE_WIDTH = 4;
// A candidate list longer than this is cut for display; the row stays held.
const MAX_CANDIDATES = 6;

// ── Template header ──────────────────────────────────────────────────────────

export type OpeningStockField =
  | "material_name"
  | "category"
  | "part_number"
  | "ss_rec_code"
  | "quantity"
  | "unit"
  | "location"
  | "remarks";

// Same header names the importer has always accepted.
const HEADER_MAP: Record<string, OpeningStockField> = {
  materialname: "material_name",
  material: "material_name",
  name: "material_name",
  category: "category",
  partnumber: "part_number",
  partno: "part_number",
  partnum: "part_number",
  ssreccode: "ss_rec_code",
  ssrec: "ss_rec_code",
  sscode: "ss_rec_code",
  openingquantity: "quantity",
  openingqty: "quantity",
  quantity: "quantity",
  qty: "quantity",
  unit: "unit",
  locationbin: "location",
  location: "location",
  bin: "location",
  remarks: "remarks",
  comments: "remarks",
  notes: "remarks",
};

export const REQUIRED_OPENING_STOCK_FIELDS: readonly OpeningStockField[] = ["material_name", "category", "quantity", "unit"];

function normalizeHeader(h: string): string {
  return h.toLowerCase().replace(/[\s/_\-.]/g, "");
}

// 1-based column per field, or null when the row is not a header (fewer than
// two recognised columns). A field named twice keeps its first column.
export function detectOpeningStockHeader(cells: string[]): Partial<Record<OpeningStockField, number>> | null {
  const mapping: Partial<Record<OpeningStockField, number>> = {};
  let matches = 0;
  cells.forEach((cell, index) => {
    const field = HEADER_MAP[normalizeHeader(cell)];
    if (!field) return;
    matches += 1;
    if (mapping[field] === undefined) mapping[field] = index + 1;
  });
  return matches >= 2 ? mapping : null;
}

// ── Source rows ──────────────────────────────────────────────────────────────

export type OpeningStockSourceRow = {
  rowNumber: number;
  // Exactly as in the file (surrounding whitespace removed only).
  materialName: string;
  category: string;
  partNumber: string;
  ssRecCode: string;
  quantityText: string;
  unit: string;
  location: string;
  remarks: string;
};

export function isBlankSourceRow(r: Pick<OpeningStockSourceRow, "materialName" | "category" | "quantityText" | "unit">): boolean {
  return !r.materialName.trim() && !r.category.trim() && !r.quantityText.trim() && !r.unit.trim();
}

// A positive whole number, written as a plain number. "20 PIECES" or "6PCS"
// is refused rather than guessed.
export function parseOpeningQuantity(text: string): number | null {
  const t = text.trim();
  if (!/^\d+(\.0+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 && n <= OPENING_STOCK_QUANTITY_MAX ? n : null;
}

// ── Normalisation ────────────────────────────────────────────────────────────

// Case and spacing only — the key a confirmed match must share.
export function nameKey(name: string | null | undefined): string {
  return normalizeMaterialKey(name);
}

// The identity name saved for a NEW material: inner whitespace collapsed (the
// verbatim source text is kept in the import record).
export function identityName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

function compact(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// The Inventory identity key of a NEW manual material (buildBalanceKey form).
export function manualMaterialKey(name: string, unit: string): string {
  return `manual:${identityName(name).toLowerCase().trim()}|${unit.toLowerCase().trim()}`;
}

export function unitKey(unit: string | null | undefined): string {
  return normalizeMaterialKey(unit).replace(/\.$/, "").trim();
}

const COUNTING_UNITS = new Set(["pcs", "nos"]);

export type UnitCompatibility = "same" | "counting_equivalent" | "incompatible";

export function unitCompatibility(sourceUnit: string, materialUnit: string): UnitCompatibility {
  const a = unitKey(sourceUnit);
  const b = unitKey(materialUnit);
  if (a && a === b) return "same";
  if (COUNTING_UNITS.has(a) && COUNTING_UNITS.has(b)) return "counting_equivalent";
  return "incompatible";
}

const SPEC_UNITS: Record<string, string> = {
  V: "V", VAC: "V", VDC: "V", VOLT: "V", VOLTS: "V", KV: "KV",
  KW: "KW", KVA: "KVA", W: "W", HP: "HP",
  A: "A", AMP: "A", AMPS: "A", MA: "MA",
  MM: "MM", CM: "CM", INCH: "INCH",
  BAR: "BAR", PSI: "PSI", HZ: "HZ", DEG: "DEG", DEGREE: "DEG",
};
const SPEC_RE = new RegExp(`^(\\d+(?:[.\\-/]\\d+)*)(${Object.keys(SPEC_UNITS).sort((a, b) => b.length - a.length).join("|")})$`);

function tokens(text: string): string[] {
  return text
    .toUpperCase()
    // "4 KW" / "240 V" → "4KW" / "240V", so a rating reads as one spec.
    .replace(new RegExp(`(\\d)\\s+(${Object.keys(SPEC_UNITS).join("|")})\\b`, "g"), "$1$2")
    // "240.V" → "240V"
    .replace(/(\d)\.(?=[A-Z])/g, "$1")
    .replace(/[(),:;[\]{}"'`=]/g, " ")
    .split(/\s+/)
    .flatMap(splitGluedWords)
    .map((t) => t.replace(/^[-./\\]+|[-./\\]+$/g, ""))
    .filter(Boolean);
}

// "FILTER-32B4020100C" → FILTER, 32B4020100C; "NO.PHJ00004" → NO, PHJ00004.
// A word is split off only when it has no digits, so "1R-0716" and
// "T15-1109111" stay one reference.
function splitGluedWords(token: string): string[] {
  const parts = token.split(/(?<=[A-Z]{2})[-.](?=[A-Z0-9])|(?<=[A-Z0-9])-(?=[A-Z]{3,}(?:$|-))/);
  if (parts.length === 1) return parts;
  const out: string[] = [];
  let pending = "";
  for (const p of parts) {
    if (/^[A-Z]+$/.test(p) && p.length >= 2) {
      if (pending) out.push(pending);
      pending = "";
      out.push(p);
    } else {
      pending = pending ? `${pending}-${p}` : p;
    }
  }
  if (pending) out.push(pending);
  return out;
}

function specOf(token: string): { dimension: string; value: string } | null {
  const m = token.match(SPEC_RE);
  return m ? { dimension: SPEC_UNITS[m[2]], value: m[1].replace(/^0+(?=\d)/, "") } : null;
}

// Ratings such as 240V, 5.5KW or 0.4MM, by dimension.
export function extractSpecifications(text: string): Map<string, Set<string>> {
  const specs = new Map<string, Set<string>>();
  for (const t of tokens(text)) {
    const s = specOf(t);
    if (!s) continue;
    if (!specs.has(s.dimension)) specs.set(s.dimension, new Set());
    specs.get(s.dimension)!.add(s.value);
  }
  return specs;
}

function isReference(compacted: string): boolean {
  return compacted.length >= 5 && (compacted.match(/\d/g)?.length ?? 0) >= 3;
}

// Part references written inside a description: tokens that contain digits
// and are not ratings, with neighbouring digit tokens also joined ("1R- 0749"
// → 1R0749, "A906 180 0209" → A9061800209). Compared without separators.
export function extractReferences(text: string): string[] {
  const refs = new Set<string>();
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1) {
      const joined = compact(run.join(""));
      if (isReference(joined)) refs.add(joined);
    }
    run = [];
  };
  for (const t of tokens(text)) {
    if (/\d/.test(t) && !specOf(t)) {
      run.push(t);
      const c = compact(t);
      if (isReference(c)) refs.add(c);
    } else {
      flush();
    }
  }
  flush();
  return [...refs];
}

const STOP_WORDS = new Set(["FOR", "AND", "WITH", "THE", "PART", "NO", "NOS", "NUMBER", "OF", "TO", "IN", "SIZE", "TYPE", "NEW", "PCS"]);
// Words that only say what kind of item it is. A similar-name match needs at
// least one other shared word (a make, model or purpose).
const GENERIC_WORDS = new Set([
  "FILTER", "FILTERS", "ELEMENT", "OIL", "FUEL", "AIR", "WATER", "ASSY", "ASSEMBLY", "SET", "KIT", "CARTRIDGE",
  "SEPARATOR", "ENGINE", "HYDRAULIC", "HYD", "MAIN", "SMALL", "BIG", "LARGE", "SPARE", "BELT", "PIPE", "HOSE",
  "SWITCH", "CONTACTOR", "RELAY", "BEARING", "GASKET", "SEAL", "VALVE", "PUMP", "MOTOR", "CABLE", "WIRE",
]);

// Plain words (no digits) that carry meaning, for the similar-name check.
function significantWords(text: string): Set<string> {
  const words = new Set<string>();
  for (const t of tokens(text)) {
    const c = compact(t);
    if (c.length >= 3 && !/\d/.test(c) && !STOP_WORDS.has(c)) words.add(c);
  }
  return words;
}


// ── Item type and make / model ──────────────────────────────────────────────
// Used only to decide whether two descriptions can be the same part: a part
// number match between an OIL FILTER and a FUEL PUMP, or a TOYOTA and a CAT
// part, is never taken as confirmed.

const PART_TYPES: [string, RegExp][] = [
  ["PUMP", /\bPUMP/], ["RESERVOIR / TANK", /RESERVOIR|\bTANK/], ["SOLENOID", /SOLENOID/], ["REPAIR KIT", /REPAIR\s*KIT|\bKIT\b/],
  ["HOUSING", /HOUSING/], ["CAP / COVER", /\bCAP\b|COVER/], ["SENSOR", /SENSOR/], ["MOTOR", /\bMOTOR\b|BLOWER/],
];
const FILTER_TYPES: [string, RegExp][] = [
  ["FUEL WATER SEPARATOR", /WATER\s*SEP|FUEL\s*WATER|SEPARAT|SEPRAT|SEPAR/],
  ["FUEL FILTER", /FUEL|DIESEL|FULE|FULTER/],
  ["OIL FILTER", /\bOIL\b|LUBE/],
  ["AIR FILTER", /\bAIR\b|HAVA/],
  ["HYDRAULIC FILTER", /HYDRAULIC|\bHYD\b/],
  ["COOLANT FILTER", /COOLANT/],
  ["BREATHER", /BREATHER/],
];
const OTHER_TYPES: [string, RegExp][] = [
  ["CONTACTOR", /CONTACTOR/], ["RELAY", /RELAY/], ["CIRCUIT BREAKER", /\bMCB\b|\bMCCB\b|BREAKER/], ["SWITCH", /SWITCH/],
  ["BEARING", /BEARING/], ["BELT", /\bBELT/], ["CLUTCH", /CLUTCH/], ["BRAKE", /BRAKE/], ["GASKET", /GASKET/],
  ["HOSE / PIPE", /HOSE|PIPE|TUBE/], ["COUPLING", /COUPL|ADAPTER|ELBOW|\bTEE\b|SOCKET|FLANGE|NIPPLE|UNION/],
  ["FUSE", /FUSE|FUZE/], ["LAMP / LIGHT", /LAMP|LIGHT|BULB/], ["TIMER", /TIMER|DELAY/], ["SEAL", /\bSEAL|O-?RING/],
];
const IS_FILTER = /FILTER|FULTER|ELEMENT|ELMENT|CARTRIDGE|CATRIDGE|SEPARAT|SEPRAT|STRAINER/;
export const GENERIC_FILTER = "FILTER (type not stated)";

export function itemType(name: string): string | null {
  const u = name.toUpperCase();
  const filter = IS_FILTER.test(u) && !/HOUSING|PUMP|RESERVOIR/.test(u);
  if (!filter) for (const [label, re] of PART_TYPES) if (re.test(u)) return label;
  if (filter) {
    for (const [label, re] of FILTER_TYPES) if (re.test(u)) return label;
    return GENERIC_FILTER;
  }
  for (const [label, re] of OTHER_TYPES) if (re.test(u)) return label;
  return null;
}

// Two types agree when equal, when either is unknown, or when one is a
// filter of unstated type and the other a specific filter.
export function itemTypesAgree(a: string | null, b: string | null): boolean {
  if (!a || !b || a === b) return true;
  const isFilter = (t: string) => t === GENERIC_FILTER || FILTER_TYPES.some(([label]) => label === t);
  return (a === GENERIC_FILTER && isFilter(b)) || (b === GENERIC_FILTER && isFilter(a));
}

const MAKES = [
  "TOYOTA", "LAND CRUISER", "COASTER", "HIACE", "SUZUKI", "VITARA", "MITSUBISHI", "PAJERO", "PICKUP", "CANTER", "CHERY", "CHEVROLET",
  "AVEO", "JEEP", "COMPASS", "NISSAN", "UD", "HINO", "ISUZU", "HYUNDAI", "KIA", "FORD", "TRANSIT", "BENZ", "MERCEDES", "ACTROS", "CAT",
  "CATERPILLAR", "BOBCAT", "JCB", "SANY", "ASHOK", "LEYLAND", "VOLVO", "SCANIA", "MAN", "KOMATSU", "HITACHI", "DOOSAN", "HELI", "TCM",
  "KOHLER", "PERKINS", "CUMMINS", "DEUTZ", "KINGLONG", "KING LONG", "DODGE", "GMC", "SCHNEIDER", "TELEMECANIQUE", "ABB", "SIEMENS",
  "LEGRAND", "OMRON", "FINDER",
];
// CAT and CATERPILLAR, BENZ and MERCEDES, … are the same make.
const MAKE_ALIASES: Record<string, string> = { CATERPILLAR: "CAT", MERCEDES: "BENZ", "KING LONG": "KINGLONG" };

export function makesOf(name: string): string[] {
  const u = ` ${name.toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  return [...new Set(MAKES.filter((k) => u.includes(` ${k} `)).map((k) => MAKE_ALIASES[k] ?? k))];
}

function makesConflict(a: string[], b: string[]): boolean {
  return a.length > 0 && b.length > 0 && !a.some((x) => b.includes(x));
}

function wholeNumbers(text: string): string[] {
  return compact(text).match(/\d+/g) ?? [];
}

function oneEditApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// ── Existing materials ───────────────────────────────────────────────────────

export type ExistingInventoryMaterial = {
  key: string;
  // Exactly as stored — reused for a confirmed match.
  name: string;
  unit: string;
  partId: string | null;
  partNumber: string | null;
  ssRecCode: string | null;
  itemCode: string | null;
  category: string;
  archived: boolean;
  // Sum of the material's Opening Stock quantities (registration rows are 0).
  openingStockQuantity: number;
  balance: number;
  // An earlier opening-stock import row (not reversed) already posted to it.
  postedByImport?: boolean;
};

type IndexedMaterial = {
  material: ExistingInventoryMaterial;
  nameKey: string;
  compactName: string;
  refs: string[];
  words: Set<string>;
  specs: Map<string, Set<string>>;
  type: string | null;
  makes: string[];
  numbers: Set<string>;
};

export type MaterialIndex = {
  byKey: Map<string, IndexedMaterial>;
  byNameKey: Map<string, IndexedMaterial[]>;
  byCompactName: Map<string, IndexedMaterial[]>;
  byRef: Map<string, IndexedMaterial[]>;
  byWord: Map<string, IndexedMaterial[]>;
  byNumber: Map<string, IndexedMaterial[]>;
  byMake: Map<string, IndexedMaterial[]>;
  refList: string[];
  // unitKey → stored spelling, for "is this a unit Inventory already uses".
  units: Map<string, string>;
  // Material keys an earlier, un-reversed import row posted to — including
  // keys whose movements were later removed outside the importer.
  postedImportKeys: Set<string>;
};

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildMaterialIndex(materials: ExistingInventoryMaterial[], postedImportKeys: Iterable<string> = []): MaterialIndex {
  const index: MaterialIndex = {
    byKey: new Map(),
    byNameKey: new Map(),
    byCompactName: new Map(),
    byRef: new Map(),
    byWord: new Map(),
    byNumber: new Map(),
    byMake: new Map(),
    refList: [],
    units: new Map(),
    postedImportKeys: new Set(postedImportKeys),
  };
  for (const input of materials) {
    const material = index.postedImportKeys.has(input.key) && !input.postedByImport ? { ...input, postedByImport: true } : input;
    const refs = new Set(extractReferences(material.name));
    for (const extra of [material.partNumber, material.ssRecCode]) {
      if (extra) for (const r of [compact(extra), ...extractReferences(extra)]) if (isReference(r)) refs.add(r);
    }
    const m: IndexedMaterial = {
      material,
      nameKey: nameKey(material.name),
      compactName: compact(material.name),
      refs: [...refs],
      words: significantWords(material.name),
      specs: extractSpecifications(material.name),
      type: itemType(material.name),
      makes: makesOf(material.name),
      numbers: new Set(wholeNumbers(material.name).filter((n) => n.length >= 5)),
    };
    index.byKey.set(material.key, m);
    push(index.byNameKey, m.nameKey, m);
    push(index.byCompactName, m.compactName, m);
    for (const r of m.refs) push(index.byRef, r, m);
    for (const w of m.words) push(index.byWord, w, m);
    for (const n of m.numbers) push(index.byNumber, n, m);
    for (const k of m.makes) push(index.byMake, k, m);
    const uk = unitKey(material.unit);
    if (uk && !index.units.has(uk)) index.units.set(uk, material.unit);
  }
  index.refList = [...index.byRef.keys()];
  return index;
}

// ── Classification ──────────────────────────────────────────────────────────

export type OpeningStockClassification =
  | "existing"
  | "new"
  | "needs_review"
  | "duplicate_in_file"
  | "already_imported"
  | "invalid";

export const CLASSIFICATION_LABELS: Record<OpeningStockClassification, string> = {
  existing: "Existing Material",
  new: "New Material",
  needs_review: "Needs Review",
  duplicate_in_file: "Duplicate in File",
  already_imported: "Already Imported",
  invalid: "Invalid",
};

export type CandidateMatch = {
  key: string;
  name: string;
  unit: string;
  itemCode: string | null;
  reasons: string[];
  // weak: no shared part number, only partial evidence (digits, a reference
  // one character apart, the same make and item type, the same ratings).
  strength: "same_name" | "reference" | "similar_name" | "weak";
  // The row and this material share an exact part reference (not one
  // written inside the other).
  exactReference: boolean;
  unitCompatibility: UnitCompatibility;
  specConflict: boolean;
  typeConflict: boolean;
  makeConflict: boolean;
  archived: boolean;
  openingStockQuantity: number;
  postedByImport: boolean;
};

export type ProposedAction = "post_existing" | "register_new" | "hold" | "none";

export type ClassifiedOpeningStockRow = OpeningStockSourceRow & {
  classification: OpeningStockClassification;
  message: string;
  quantity: number | null;
  // Unit as it will be saved for a NEW material (template spelling), or null
  // when the unit is not valid.
  normalizedUnit: string | null;
  normalizedCategory: string;
  // The single confirmed material (Existing Material / Already Imported).
  match: CandidateMatch | null;
  candidates: CandidateMatch[];
  // Other rows in the same file sharing a name or a part reference.
  relatedRows: number[];
  proposedAction: ProposedAction;
};

const ALLOWED_UNITS = new Map<string, string>(UNITS.map((u) => [unitKey(u), u]));

// The unit to save: a template unit in its template spelling, or a unit
// already used in Inventory in its stored spelling. Anything else is invalid.
export function resolveSourceUnit(unit: string, index: MaterialIndex): string | null {
  const k = unitKey(unit);
  if (!k || /[|<>]/.test(unit)) return null;
  return ALLOWED_UNITS.get(k) ?? index.units.get(k) ?? null;
}

function specsConflict(a: Map<string, Set<string>>, b: Map<string, Set<string>>): boolean {
  for (const [dimension, values] of a) {
    const other = b.get(dimension);
    if (!other) continue;
    if (![...values].some((v) => other.has(v))) return true;
  }
  return false;
}

function sharedSpecDimensions(a: Map<string, Set<string>>, b: Map<string, Set<string>>): string[] {
  const shared: string[] = [];
  for (const [dimension, values] of a) {
    const other = b.get(dimension);
    if (other && [...values].some((v) => other.has(v))) shared.push(dimension);
  }
  return shared;
}

function invalidReason(row: OpeningStockSourceRow, unit: string | null): string | null {
  if (!row.materialName.trim()) return "Material name is missing";
  if (identityName(row.materialName).length > OPENING_STOCK_NAME_MAX_LENGTH) {
    return `Material name is too long (max ${OPENING_STOCK_NAME_MAX_LENGTH} characters)`;
  }
  if ([row.category, row.partNumber, row.ssRecCode, row.location].some((v) => v.trim().length > OPENING_STOCK_TEXT_MAX_LENGTH)) {
    return `A text value is too long (max ${OPENING_STOCK_TEXT_MAX_LENGTH} characters)`;
  }
  if (identityName(row.materialName).includes("|")) return 'Material name cannot contain "|"';
  if (parseOpeningQuantity(row.quantityText) === null) {
    return row.quantityText.trim()
      ? `Opening Quantity "${row.quantityText.trim()}" is not a whole number greater than 0`
      : "Opening Quantity is missing";
  }
  if (!row.unit.trim()) return "Unit is missing";
  if (!unit) return `Unit "${row.unit.trim()}" is not a recognised unit`;
  return null;
}

type RowFacts = { specs: Map<string, Set<string>>; type: string | null; makes: string[] };

function factsOf(row: OpeningStockSourceRow): RowFacts {
  return { specs: extractSpecifications(row.materialName), type: itemType(row.materialName), makes: makesOf(row.materialName) };
}

function candidateFrom(m: IndexedMaterial, row: OpeningStockSourceRow, facts: RowFacts, strength: CandidateMatch["strength"], reason: string): CandidateMatch {
  return {
    key: m.material.key,
    name: m.material.name,
    unit: m.material.unit,
    itemCode: m.material.itemCode,
    reasons: [reason],
    strength,
    exactReference: false,
    unitCompatibility: unitCompatibility(row.unit, m.material.unit),
    specConflict: specsConflict(facts.specs, m.specs),
    typeConflict: !itemTypesAgree(facts.type, m.type),
    makeConflict: makesConflict(facts.makes, m.makes),
    archived: m.material.archived,
    openingStockQuantity: m.material.openingStockQuantity,
    postedByImport: Boolean(m.material.postedByImport),
  };
}

const STRENGTH_ORDER: Record<CandidateMatch["strength"], number> = { same_name: 0, reference: 1, similar_name: 2, weak: 3 };

// Every material that could be the same physical item as this row, strongest
// evidence first. Weak evidence is only looked for when nothing stronger is
// found, so a row with no part-number match is never assumed to be new.
export function findCandidates(row: OpeningStockSourceRow, index: MaterialIndex): CandidateMatch[] {
  const found = new Map<string, CandidateMatch>();
  const facts = factsOf(row);
  const add = (m: IndexedMaterial, strength: CandidateMatch["strength"], reason: string, exact = false) => {
    const existing = found.get(m.material.key);
    if (!existing) {
      const c = candidateFrom(m, row, facts, strength, reason);
      c.exactReference = exact;
      found.set(m.material.key, c);
      return;
    }
    if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
    if (exact) existing.exactReference = true;
    if (STRENGTH_ORDER[strength] < STRENGTH_ORDER[existing.strength]) existing.strength = strength;
  };

  for (const m of index.byNameKey.get(nameKey(row.materialName)) ?? []) add(m, "same_name", "Same name");
  for (const m of index.byCompactName.get(compact(row.materialName)) ?? []) add(m, "reference", "Same name apart from punctuation");

  const rowRefs = extractReferences(`${row.materialName} ${row.partNumber} ${row.ssRecCode}`);
  for (const ref of rowRefs) {
    for (const m of index.byRef.get(ref) ?? []) add(m, "reference", `Reference ${ref}`, ref.length >= 6);
    // One reference written inside the other (7W2326 / 7W2326E, M60208878 /
    // 60208878). Only for longer references, so short numbers do not match
    // everything. Never counted as an exact match.
    if (ref.length >= 6) {
      for (const other of index.refList) {
        if (other === ref || other.length < 6) continue;
        if (other.includes(ref) || ref.includes(other)) {
          for (const m of index.byRef.get(other) ?? []) add(m, "reference", `Reference ${ref} ≈ ${other}`);
        }
      }
    }
  }

  // Similar name: every meaningful word of the row (at least two, one of
  // them not generic) appears in the material's description — unless both
  // carry part references and none is shared, or their ratings differ.
  const words = significantWords(row.materialName);
  const specific = [...words].filter((w) => !GENERIC_WORDS.has(w));
  if (words.size >= 2 && specific.length > 0) {
    const [rarest] = specific.sort((a, b) => (index.byWord.get(a)?.length ?? 0) - (index.byWord.get(b)?.length ?? 0));
    const rowRefSet = new Set(rowRefs);
    for (const m of index.byWord.get(rarest) ?? []) {
      if (![...words].every((w) => m.words.has(w))) continue;
      if (rowRefSet.size > 0 && m.refs.length > 0 && !m.refs.some((r) => rowRefSet.has(r)) && !found.has(m.material.key)) continue;
      if (specsConflict(facts.specs, m.specs)) continue;
      add(m, "similar_name", "Similar name");
    }
  }

  // Weak evidence, only when nothing stronger was found.
  if (found.size === 0) {
    for (const n of new Set(wholeNumbers(row.materialName).filter((x) => x.length >= 5))) {
      for (const m of index.byNumber.get(n) ?? []) add(m, "weak", `Number ${n} also appears in the MMS description`);
    }
    for (const ref of rowRefs) {
      if (ref.length < 6) continue;
      for (const other of index.refList) {
        if (other.length >= 6 && oneEditApart(ref, other)) {
          for (const m of index.byRef.get(other) ?? []) add(m, "weak", `Reference ${ref} differs by one character from ${other}`);
        }
      }
    }
    if (facts.type && facts.makes.length) {
      for (const make of facts.makes) {
        for (const m of index.byMake.get(make) ?? []) {
          if (m.type !== facts.type) continue;
          if (rowRefs.length > 0 && m.refs.length > 0 && !m.refs.some((r) => rowRefs.includes(r))) continue; // different part numbers
          add(m, "weak", `Same make (${make}) and item type (${facts.type})${m.refs.length ? "" : "; MMS item has no part number"}`);
        }
      }
    }
    if (facts.type && ["CONTACTOR", "RELAY", "CIRCUIT BREAKER", "TIMER"].includes(facts.type)) {
      for (const m of index.byKey.values()) {
        if (m.type !== facts.type || specsConflict(facts.specs, m.specs)) continue;
        const shared = sharedSpecDimensions(facts.specs, m.specs);
        if (shared.length >= 2) add(m, "weak", `Same ${facts.type.toLowerCase()} ratings (${shared.join(", ")})`);
      }
    }
  }

  // A part reference is the stronger signal: once one matches, materials that
  // only look similar by name are left out of the choice.
  const list = [...found.values()];
  const hasStrong = list.some((c) => c.strength === "same_name" || c.strength === "reference");
  return (hasStrong ? list.filter((c) => c.strength === "same_name" || c.strength === "reference") : list).sort(
    (a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] || b.reasons.length - a.reasons.length || a.name.localeCompare(b.name)
  );
}

function formatQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/\.?0+$/, "");
}

// Why a single candidate cannot be taken as confirmed, or null when it can.
function confirmationProblem(c: CandidateMatch, row: OpeningStockSourceRow, partNumberConflict: boolean): string | null {
  if (c.unitCompatibility === "incompatible") return `MMS stocks it in ${c.unit}, the file says ${row.unit.trim()} — units are never converted`;
  if (c.archived) return "the material is archived";
  if (c.specConflict) return "the ratings in the descriptions differ";
  if (c.typeConflict) return "the descriptions name different kinds of part";
  if (c.makeConflict) return "the descriptions name different makes";
  if (partNumberConflict) return "the Part Number differs";
  if (c.strength === "same_name") return null;
  if (c.strength === "reference" && c.exactReference) return null;
  if (c.strength === "reference") return "the part reference is only partly the same";
  return "there is no shared part number";
}

export function classifyOpeningStockRows(rows: OpeningStockSourceRow[], index: MaterialIndex): ClassifiedOpeningStockRow[] {
  const prepared = rows.map((row) => {
    const unit = resolveSourceUnit(row.unit, index);
    return {
      row,
      unit,
      invalid: invalidReason(row, unit),
      nameKey: nameKey(row.materialName),
      refs: extractReferences(`${row.materialName} ${row.partNumber} ${row.ssRecCode}`),
    };
  });

  const rowsByName = new Map<string, number[]>();
  const rowsByRef = new Map<string, number[]>();
  for (const p of prepared) {
    if (p.invalid) continue;
    push(rowsByName, p.nameKey, p.row.rowNumber);
    for (const r of p.refs) push(rowsByRef, r, p.row.rowNumber);
  }
  // Same containment rule as for existing materials (M60208878 / 60208878).
  const fileRefs = [...rowsByRef.keys()];
  const relatedRefs = (ref: string) =>
    ref.length < 6 ? [ref] : fileRefs.filter((o) => o === ref || (o.length >= 6 && (o.includes(ref) || ref.includes(o))));

  return prepared.map(({ row, unit, invalid, nameKey: key, refs }) => {
    const base = {
      ...row,
      quantity: parseOpeningQuantity(row.quantityText),
      normalizedUnit: unit,
      normalizedCategory: normalizeCategory(row.category),
      match: null,
      candidates: [] as CandidateMatch[],
      relatedRows: [] as number[],
    };
    if (invalid) {
      return { ...base, classification: "invalid", message: invalid, proposedAction: "none" } satisfies ClassifiedOpeningStockRow;
    }

    const all = findCandidates(row, index);
    const candidates = all.slice(0, MAX_CANDIDATES);

    // The same material listed twice: both rows are held — quantities are
    // never added together automatically.
    const sameName = (rowsByName.get(key) ?? []).filter((n) => n !== row.rowNumber);
    if (sameName.length > 0) {
      return {
        ...base,
        candidates,
        relatedRows: sameName,
        classification: "duplicate_in_file",
        message: `This material is listed more than once in the file (also row ${sameName.join(", ")}). Held — quantities are never added together automatically.`,
        proposedAction: "hold",
      } satisfies ClassifiedOpeningStockRow;
    }

    const sharedRef = [...new Set(refs.flatMap((r) => relatedRefs(r).flatMap((x) => rowsByRef.get(x) ?? [])))]
      .filter((n) => n !== row.rowNumber)
      .sort((a, b) => a - b);
    const withCandidates = { ...base, candidates, relatedRows: sharedRef };

    const single = all.length === 1 ? all[0] : null;
    const storedPartNumber = single ? index.byKey.get(single.key)?.material.partNumber ?? "" : "";
    const partNumberConflict = Boolean(row.partNumber.trim() && storedPartNumber && nameKey(row.partNumber) !== nameKey(storedPartNumber));
    const problem = single ? confirmationProblem(single, row, partNumberConflict) : null;

    // Confirmed: exactly one candidate, by the same name or an exact part
    // reference, with agreeing type, make, ratings and a compatible unit, and
    // no other row of the file sharing its reference.
    if (single && !problem && sharedRef.length === 0) {
      const match = single;
      if (match.openingStockQuantity > 0 || match.postedByImport) {
        return {
          ...withCandidates,
          match,
          classification: "already_imported",
          message: match.openingStockQuantity > 0
            ? `Opening stock is already recorded for ${match.name} (${formatQty(match.openingStockQuantity)} ${match.unit}). Not imported again.`
            : `An earlier opening-stock import already posted ${match.name}. Not imported again.`,
          proposedAction: "none",
        } satisfies ClassifiedOpeningStockRow;
      }
      const how = match.strength === "same_name" ? "same name" : `part reference ${match.reasons.find((r) => r.startsWith("Reference "))?.slice(10) ?? ""}`.trim();
      const unitNote =
        match.unitCompatibility === "counting_equivalent"
          ? ` Recorded in ${match.unit}, the material's own unit (${row.unit.trim()} and ${match.unit} are the same counting unit).`
          : "";
      return {
        ...withCandidates,
        match,
        classification: "existing",
        message: `Matches existing material ${match.name}${match.itemCode ? ` (${match.itemCode})` : ""} by ${how}. The opening quantity is added to it.${unitNote}`,
        proposedAction: "post_existing",
      } satisfies ClassifiedOpeningStockRow;
    }

    if (all.length === 0 && sharedRef.length === 0 && unit && index.postedImportKeys.has(manualMaterialKey(row.materialName, unit))) {
      return {
        ...withCandidates,
        classification: "already_imported",
        message: "An earlier opening-stock import already registered this material. Not imported again.",
        proposedAction: "none",
      } satisfies ClassifiedOpeningStockRow;
    }

    if (all.length === 0 && sharedRef.length === 0) {
      return {
        ...withCandidates,
        classification: "new",
        message: "No existing material shares its name, part reference, numbers, make and type, or ratings. It is registered as a new material with a new Item Code.",
        proposedAction: "register_new",
      } satisfies ClassifiedOpeningStockRow;
    }

    const reasons: string[] = [];
    if (all.length > 1) reasons.push(`${all.length} possible materials found`);
    else if (single) reasons.push(`Possible match ${single.itemCode ?? single.name} (${single.reasons.join(", ")})${problem ? `, but ${problem}` : ""}`);
    if (sharedRef.length > 0) reasons.push(`Shares a part reference with row ${sharedRef.join(", ")} in this file — rows are never merged automatically`);
    return {
      ...withCandidates,
      classification: "needs_review",
      message: `${reasons.join(". ")}. Held for review; no stock is recorded.`,
      proposedAction: "hold",
    } satisfies ClassifiedOpeningStockRow;
  });
}

// ── Decisions ────────────────────────────────────────────────────────────────

export type RowDecision =
  | { action: "use_existing"; materialKey: string }
  | { action: "register_new" }
  // Exception (approvers only): register a NEW material although an existing
  // material has the same exact part number, because the approver confirmed
  // the two are physically different. `comparedKeys` must name every such
  // existing material — the approver has compared the row with each one.
  | {
      action: "register_different";
      confirmedDifferent: boolean;
      reason: string;
      comparedKeys: string[];
      // Required only when the row is an EXACT match to an existing material
      // (see exactMatchMaterials): a separate exceptional approval with the
      // documented distinguishing specification or physical evidence.
      exactMatchOverride?: ExactMatchOverride;
    }
  | { action: "hold" }
  // Close a held row without stock (e.g. a duplicate line), with a reason.
  | { action: "exclude"; reason: string };

export type RowOutcome =
  | { outcome: "post_existing"; material: ExistingInventoryMaterial; approvedDecision: boolean; unitCompatibility: UnitCompatibility }
  | { outcome: "register_new"; approvedDecision: boolean; exception?: RegisterDifferentException }
  | { outcome: "hold"; approvedDecision: boolean }
  | { outcome: "exclude"; reason: string }
  | { outcome: "not_imported" };

export class DecisionError extends Error {
  readonly rowNumber: number;
  constructor(rowNumber: number, message: string) {
    super(`Row ${rowNumber}: ${message}`);
    this.name = "DecisionError";
    this.rowNumber = rowNumber;
  }
}

export const EXCLUDE_REASON_MIN = 5;

// ── Register as Different Material (exception) ──────────────────────────────

export const DIFFERENT_REASON_MIN = 15;

export type DifferentFromMaterial = { key: string; name: string; unit: string; itemCode: string | null };

// Existing materials whose part reference appears in the row only split by a
// space or punctuation ("FF 5488", "ff-5488" for FF5488) — which the matcher
// does not read as the same reference. Spacing and punctuation are never
// evidence of a different material, so a new material is not registered
// until the row's part number is written properly and compared again.
// Checked only when a decision registers a material; the classification of a
// row (and so the import itself) is unchanged.
export function spacedReferenceMaterials(row: ClassifiedOpeningStockRow, index: MaterialIndex): { ref: string; material: ExistingInventoryMaterial }[] {
  const text = `${row.materialName} ${row.partNumber} ${row.ssRecCode}`.toUpperCase();
  const parts = text.split(/[^A-Z0-9]+/).filter(Boolean);
  const known = new Set(extractReferences(text));
  const exactKeys = new Set(row.candidates.filter((c) => c.exactReference).map((c) => c.key));
  const out = new Map<string, { ref: string; material: ExistingInventoryMaterial }>();
  for (let i = 0; i < parts.length; i++) {
    for (const len of [2, 3]) {
      if (i + len > parts.length) continue;
      const joined = parts.slice(i, i + len).join("");
      if (joined.length < 6 || !isReference(joined) || known.has(joined)) continue;
      for (const m of index.byRef.get(joined) ?? []) {
        if (!exactKeys.has(m.material.key) && !m.material.archived) out.set(m.material.key, { ref: joined, material: m.material });
      }
    }
  }
  return [...out.values()];
}

function spacedReferenceMessage(found: { ref: string; material: ExistingInventoryMaterial }[]): string {
  const f = found[0];
  return `${f.material.itemCode ?? f.material.name} has part number ${f.ref}, written in this row with a space or punctuation — that is not a difference. Correct the row's part number to ${f.ref} (Edit Details) so it is compared with ${f.material.itemCode ?? "that material"}, then decide.`;
}

export const EXACT_MATCH_EVIDENCE_MIN = 30;

export type ExactMatchEvidenceType = "specification" | "physical_evidence";

export type ExactMatchOverride = { confirmed: boolean; evidenceType: ExactMatchEvidenceType; evidence: string };

export type RegisterDifferentException = {
  reason: string;
  differentFrom: DifferentFromMaterial[];
  // Present when the row was an exact match and the approver gave the
  // separate exceptional approval.
  exactMatchOverride?: { evidenceType: ExactMatchEvidenceType; evidence: string; exactMatchTo: DifferentFromMaterial[] };
};

// Existing materials this row matches EXACTLY: the same complete part
// reference, the same unit (PCS = Nos counts as the same), and no detected
// difference in item type, make / equipment or specification. Spelling and
// punctuation of the description are deliberately not compared — they are
// never evidence that two materials differ. Register as Different Material
// is blocked for these unless a separate exceptional approval documents the
// distinguishing specification or physical evidence.
export function exactMatchMaterials(row: ClassifiedOpeningStockRow): CandidateMatch[] {
  return sameReferenceMaterials(row).filter((c) => c.unitCompatibility !== "incompatible" && !c.typeConflict && !c.makeConflict && !c.specConflict);
}

// The existing materials that carry this row's exact part number — the only
// thing the exception can set aside.
export function sameReferenceMaterials(row: ClassifiedOpeningStockRow): CandidateMatch[] {
  return row.candidates.filter((c) => c.exactReference);
}

// Why "Register as Different Material" is NOT possible for this row (null when
// it is possible). Independent of who asks and of the explanation; those are
// checked in resolveRowOutcome. Never decides that two materials are the
// same or different — it only refuses cases the exception is not for:
//  - no existing material has the exact part number (use Register New);
//  - the only difference found is the unit (correct the unit instead);
//  - the same material is already in Inventory or already registered.
export function registerDifferentBlock(row: ClassifiedOpeningStockRow, index: MaterialIndex): string | null {
  if (row.classification === "invalid" || row.classification === "already_imported") {
    return `${CLASSIFICATION_LABELS[row.classification]} rows cannot be imported.`;
  }
  if (!row.normalizedUnit || row.quantity === null) return "The row's unit or quantity is not valid. Correct it first.";
  const spaced = spacedReferenceMaterials(row, index);
  if (spaced.length > 0) return spacedReferenceMessage(spaced);
  const sameRef = sameReferenceMaterials(row);
  if (sameRef.length === 0) return "No existing material has this exact part number, so no exception is needed — use Register New.";
  const unitOnly = sameRef.find((c) => c.unitCompatibility === "incompatible" && !c.typeConflict && !c.makeConflict && !c.specConflict);
  if (unitOnly) {
    return `The only difference found from ${unitOnly.itemCode ?? unitOnly.name} is the unit (${row.unit.trim()} vs ${unitOnly.unit}). A unit mismatch is not a reason to create a second material — correct the unit (or the material's unit with Edit Material), then Use Existing.`;
  }
  const sameName = [
    ...(index.byNameKey.get(nameKey(row.materialName)) ?? []),
    ...(index.byCompactName.get(compact(row.materialName)) ?? []),
  ][0];
  if (sameName) {
    return `${sameName.material.itemCode ?? sameName.material.name} already has this exact description. The same material is never registered twice — use it or correct the description.`;
  }
  const sameNameCandidate = row.candidates.find((c) => c.strength === "same_name");
  if (sameNameCandidate) return `${sameNameCandidate.itemCode ?? sameNameCandidate.name} has the same name. Use it or correct the description.`;
  if (index.postedImportKeys.has(manualMaterialKey(row.materialName, row.normalizedUnit))) {
    return "An earlier opening-stock import already registered this material.";
  }
  return null;
}

// What happens to one row, given a decision (or none: the proposed action).
// Throws DecisionError for any decision that is not allowed, so a bad
// decision is refused instead of being silently ignored.
export function resolveRowOutcome(
  row: ClassifiedOpeningStockRow,
  decision: RowDecision | undefined,
  index: MaterialIndex,
  canApproveUncertain: boolean
): RowOutcome {
  // Invalid and already-imported rows can never post stock.
  const blocked = row.classification === "invalid" || row.classification === "already_imported";
  if (blocked) {
    if (decision && decision.action !== "hold") {
      throw new DecisionError(row.rowNumber, `${CLASSIFICATION_LABELS[row.classification]} rows cannot be imported.`);
    }
    return { outcome: "not_imported" };
  }

  if (!decision) {
    if (row.classification === "existing" && row.match) {
      const material = index.byKey.get(row.match.key)?.material;
      if (!material) throw new DecisionError(row.rowNumber, "The matched material is no longer in Inventory. Preview the file again.");
      return { outcome: "post_existing", material, approvedDecision: false, unitCompatibility: row.match.unitCompatibility };
    }
    if (row.classification === "new") return { outcome: "register_new", approvedDecision: false };
    return { outcome: "hold", approvedDecision: false };
  }

  if (decision.action === "hold") return { outcome: "hold", approvedDecision: false };

  if (decision.action === "register_different") {
    if (!canApproveUncertain) {
      throw new DecisionError(row.rowNumber, "Only the System Administrator or Maintenance Manager can register a material as different.");
    }
    const blocked = registerDifferentBlock(row, index);
    if (blocked) throw new DecisionError(row.rowNumber, blocked);
    if (decision.confirmedDifferent !== true) {
      throw new DecisionError(row.rowNumber, "Confirm that the submitted material is physically different from the existing material.");
    }
    const reason = decision.reason.trim();
    if (reason.length < DIFFERENT_REASON_MIN) {
      throw new DecisionError(row.rowNumber, `Explain how the materials differ (at least ${DIFFERENT_REASON_MIN} characters).`);
    }
    const sameRef = sameReferenceMaterials(row);
    const compared = new Set(decision.comparedKeys);
    const notCompared = sameRef.filter((c) => !compared.has(c.key));
    if (notCompared.length > 0) {
      throw new DecisionError(
        row.rowNumber,
        `Compare the row with ${notCompared.map((c) => c.itemCode ?? c.name).join(", ")} first — the existing materials changed since the comparison was shown.`
      );
    }
    const asRef = (c: CandidateMatch): DifferentFromMaterial => ({ key: c.key, name: c.name, unit: c.unit, itemCode: c.itemCode });
    const exact = exactMatchMaterials(row);
    let exactMatchOverride: RegisterDifferentException["exactMatchOverride"];
    if (exact.length > 0) {
      const codes = exact.map((c) => c.itemCode ?? c.name).join(", ");
      const o = decision.exactMatchOverride;
      if (!o || o.confirmed !== true) {
        throw new DecisionError(
          row.rowNumber,
          `This row is an exact match to ${codes}: same part number, unit, item type, make and equipment — only the spelling or punctuation differs, which is not evidence of a different material. Register as Different Material is blocked unless a separate exceptional approval documents the distinguishing specification or physical evidence.`
        );
      }
      if (o.evidenceType !== "specification" && o.evidenceType !== "physical_evidence") {
        throw new DecisionError(row.rowNumber, "Choose whether the evidence is a distinguishing specification or physical evidence.");
      }
      const evidence = o.evidence.trim();
      if (evidence.length < EXACT_MATCH_EVIDENCE_MIN) {
        throw new DecisionError(row.rowNumber, `Document the distinguishing specification or physical evidence (at least ${EXACT_MATCH_EVIDENCE_MIN} characters).`);
      }
      if (compact(evidence) === compact(reason)) {
        throw new DecisionError(row.rowNumber, "The exceptional approval needs its own evidence — not a repeat of the explanation.");
      }
      exactMatchOverride = { evidenceType: o.evidenceType, evidence: evidence.slice(0, 1000), exactMatchTo: exact.map(asRef) };
    }
    return {
      outcome: "register_new",
      approvedDecision: true,
      exception: { reason: reason.slice(0, 1000), differentFrom: sameRef.map(asRef), ...(exactMatchOverride ? { exactMatchOverride } : {}) },
    };
  }

  const isProposed =
    (decision.action === "register_new" && row.classification === "new") ||
    (decision.action === "use_existing" && row.classification === "existing" && row.match?.key === decision.materialKey);
  if (!isProposed && !canApproveUncertain) {
    throw new DecisionError(row.rowNumber, "Only the System Administrator or Maintenance Manager can approve this decision.");
  }

  if (decision.action === "exclude") {
    const reason = decision.reason.trim();
    if (reason.length < EXCLUDE_REASON_MIN) throw new DecisionError(row.rowNumber, "Give a reason for not importing this row.");
    return { outcome: "exclude", reason: reason.slice(0, 500) };
  }

  if (decision.action === "register_new") {
    // A material that already carries this exact part reference is the same
    // part: registering it again would create a duplicate identity (even when
    // its unit differs — that is corrected, not worked around).
    const sameRef = row.candidates.find((c) => c.exactReference);
    if (sameRef) {
      throw new DecisionError(
        row.rowNumber,
        `${sameRef.name}${sameRef.itemCode ? ` (${sameRef.itemCode})` : ""} already has this part number. Use that material (once its unit agrees) or do not import the row — a duplicate material is not created. If the Manager confirms the two are physically different, use Register as Different Material.`
      );
    }
    const spaced = spacedReferenceMaterials(row, index);
    if (spaced.length > 0) throw new DecisionError(row.rowNumber, spacedReferenceMessage(spaced));
    if (row.normalizedUnit && index.postedImportKeys.has(manualMaterialKey(row.materialName, row.normalizedUnit))) {
      throw new DecisionError(row.rowNumber, "An earlier opening-stock import already registered this material.");
    }
    const sameName = index.byNameKey.get(nameKey(row.materialName)) ?? [];
    if (sameName.length > 0) {
      throw new DecisionError(
        row.rowNumber,
        `A material named "${sameName[0].material.name}" (${sameName[0].material.unit}) already exists. Use it or keep the row on hold — a second material with the same name is not created.`
      );
    }
    return { outcome: "register_new", approvedDecision: !isProposed };
  }

  const target = index.byKey.get(decision.materialKey)?.material;
  if (!target) throw new DecisionError(row.rowNumber, "The chosen material was not found in Inventory.");
  if (target.archived) throw new DecisionError(row.rowNumber, `${target.name} is archived. Restore it first or keep the row on hold.`);
  const compatibility = unitCompatibility(row.unit, target.unit);
  if (compatibility === "incompatible") {
    throw new DecisionError(
      row.rowNumber,
      `${target.name} is stocked in ${target.unit}; this row is in ${row.unit.trim()}. Units are never converted — keep the row on hold until the unit is corrected.`
    );
  }
  if (target.postedByImport || index.postedImportKeys.has(target.key)) {
    throw new DecisionError(row.rowNumber, `An earlier opening-stock import already posted ${target.name}.`);
  }
  if (target.openingStockQuantity > 0) {
    throw new DecisionError(row.rowNumber, `${target.name} already has opening stock (${formatQty(target.openingStockQuantity)} ${target.unit}).`);
  }
  return { outcome: "post_existing", material: target, approvedDecision: !isProposed, unitCompatibility: compatibility };
}

export type ResolvedOpeningStockRow = { row: ClassifiedOpeningStockRow; outcome: RowOutcome };

// Every row's outcome, plus the rule that one material receives opening stock
// from one row only.
export function resolveOpeningStockDecisions(
  rows: ClassifiedOpeningStockRow[],
  decisions: Record<number, RowDecision>,
  index: MaterialIndex,
  canApproveUncertain: boolean
): ResolvedOpeningStockRow[] {
  const known = new Set(rows.map((r) => r.rowNumber));
  for (const n of Object.keys(decisions)) {
    if (!known.has(Number(n))) throw new DecisionError(Number(n), "This row is not in the file.");
  }
  const resolved = rows.map((row) => ({ row, outcome: resolveRowOutcome(row, decisions[row.rowNumber], index, canApproveUncertain) }));
  const targets = new Map<string, number>();
  const newNames = new Map<string, number>();
  for (const { row, outcome } of resolved) {
    if (outcome.outcome === "post_existing") {
      const other = targets.get(outcome.material.key);
      if (other !== undefined) {
        throw new DecisionError(row.rowNumber, `Row ${other} already adds opening stock to ${outcome.material.name}. One material can receive opening stock from one row only.`);
      }
      targets.set(outcome.material.key, row.rowNumber);
    }
    if (outcome.outcome === "register_new") {
      const k = nameKey(identityName(row.materialName));
      const other = newNames.get(k);
      if (other !== undefined) throw new DecisionError(row.rowNumber, `Row ${other} already registers a material with this name.`);
      newNames.set(k, row.rowNumber);
    }
  }
  return resolved;
}

// ── Item Codes ───────────────────────────────────────────────────────────────

// The next `count` free codes in the AMSOS series, after the highest one in
// use (archived materials included), so a code is never reused.
export function allocateItemCodes(existingCodes: Iterable<string | null>, count: number): string[] {
  const prefix = OPENING_STOCK_ITEM_CODE_PREFIX;
  const re = new RegExp(`^${prefix}(\\d+)$`, "i");
  const used = new Set<string>();
  let max = 0;
  for (const code of existingCodes) {
    if (!code) continue;
    used.add(code.trim().toUpperCase());
    const m = code.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  const codes: string[] = [];
  let n = max;
  while (codes.length < count) {
    n += 1;
    const code = `${prefix}${String(n).padStart(OPENING_STOCK_ITEM_CODE_WIDTH, "0")}`;
    if (!used.has(code)) codes.push(code);
  }
  return codes;
}

// ── Summary ─────────────────────────────────────────────────────────────────

export type OpeningStockSummary = Record<OpeningStockClassification, number> & { totalRows: number; totalQuantity: number };

export function summarizeOpeningStock(rows: ClassifiedOpeningStockRow[]): OpeningStockSummary {
  const summary: OpeningStockSummary = {
    totalRows: rows.length,
    totalQuantity: 0,
    existing: 0,
    new: 0,
    needs_review: 0,
    duplicate_in_file: 0,
    already_imported: 0,
    invalid: 0,
  };
  for (const r of rows) {
    summary[r.classification] += 1;
    if (r.quantity !== null) summary.totalQuantity += r.quantity;
  }
  return summary;
}

// Canonical text of the file's rows, for the "same content already imported"
// check: a re-saved copy of the same sheet has different bytes but the same
// content.
export function canonicalSourceContent(rows: OpeningStockSourceRow[]): string {
  return JSON.stringify(
    rows.map((r) => [
      r.rowNumber,
      identityName(r.materialName).toUpperCase(),
      r.category.trim().toUpperCase(),
      r.partNumber.trim().toUpperCase(),
      r.ssRecCode.trim().toUpperCase(),
      r.quantityText.trim(),
      unitKey(r.unit),
      r.location.trim().toUpperCase(),
      r.remarks.trim(),
    ])
  );
}

// What the reviewer saw, per row: compared again at import time, so an
// import never goes ahead on a picture that has changed since the preview.
export function previewFingerprintSource(rows: ClassifiedOpeningStockRow[]): string {
  return JSON.stringify(rows.map((r) => [r.rowNumber, r.classification, r.match?.key ?? "", r.candidates.map((c) => c.key)]));
}
