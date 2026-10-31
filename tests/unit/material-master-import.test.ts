// Material Master Excel import rules: header detection, column mapping,
// unit spelling, Item Code formatting, in-file duplicates and existing
// matches. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MATERIAL_IMPORT_MAPPING,
  categoryReviewList,
  classifyMaterialImportRows,
  completeMapping,
  detectHeaderMapping,
  materialIdentityKey,
  importUnitProblem,
  looksLikeDefaultLayout,
  mappingConflict,
  normalizeImportUnit,
  summarizeMaterialImport,
  validateMapping,
  type ExistingMaterialIndex,
  type MaterialImportRawRow,
} from "@/lib/store/material-master-import";

const none: ExistingMaterialIndex = { itemCodeKeys: new Set(), identityKeys: new Set() };

function row(rowNumber: number, itemCode: string, description: string, unit: string): MaterialImportRawRow {
  return { rowNumber, serial: String(rowNumber), itemCode, description, unit };
}

describe("detectHeaderMapping", () => {
  it("reads an ordinary header row", () => {
    const m = detectHeaderMapping(["S. No.", "Item Code", "Material Description", "Unit"]);
    assert.deepEqual(m?.mapping, completeMapping({ serial: 1, itemCode: 2, description: 3, unit: 4 }));
  });

  it("follows headers in a different order", () => {
    const m = detectHeaderMapping(["Description", "UOM", "Code"]);
    assert.deepEqual(m?.mapping, completeMapping({ itemCode: 3, description: 1, unit: 2 }));
  });

  it("treats a Maintenance Department data row as data (headerless sheet)", () => {
    assert.equal(detectHeaderMapping(["1", "AMSHV0001", "FILTER: HYDRAULIC FILTER PART NO.: 123-8189", "Nos"]), null);
  });

  it("defaults to A Serial, B Item Code, C Description, D Unit", () => {
    assert.deepEqual(DEFAULT_MATERIAL_IMPORT_MAPPING, completeMapping({ serial: 1, itemCode: 2, description: 3, unit: 4 }));
  });

  it("rejects a mapping that reuses a column", () => {
    assert.ok(validateMapping(completeMapping({ itemCode: 2, description: 2, unit: 4 })));
    assert.equal(validateMapping(DEFAULT_MATERIAL_IMPORT_MAPPING), null);
  });
});

describe("normalizeImportUnit", () => {
  it("keeps the exact text, removing only surrounding whitespace", () => {
    assert.equal(normalizeImportUnit("Nos"), "Nos");
    assert.equal(normalizeImportUnit("  Set\u00a0"), "Set");
    assert.equal(normalizeImportUnit("nos."), "nos.");
    assert.equal(normalizeImportUnit("Set of 4"), "Set of 4");
  });
});

describe("importUnitProblem", () => {
  it("accepts standard, custom, spaced, mixed-case and non-Latin units", () => {
    for (const unit of ["PCS", "Nos", "Manual", "Litre", "GAL", "Sheet", "Packet", "Bundle", "Set of 4", "Nos/Set", "mL", "20L", "m²", "قطعة"]) {
      assert.equal(importUnitProblem(unit), null, unit);
    }
  });

  it("rejects text that is too long", () => {
    assert.equal(importUnitProblem("x".repeat(32)), null);
    assert.match(importUnitProblem("x".repeat(33)) ?? "", /too long/);
  });

  it("rejects characters that are unsafe or break the material key", () => {
    assert.ok(importUnitProblem("Nos|Set"));
    assert.ok(importUnitProblem("<b>Nos</b>"));
    assert.ok(importUnitProblem("Nos\nSet"));
    assert.ok(importUnitProblem("No\u200bs"));
    assert.ok(importUnitProblem("=SUM(A1)"));
    assert.ok(importUnitProblem("@Nos"));
  });

  it("rejects placeholders with no letter or digit", () => {
    for (const unit of ["-", "--", "?", "...", "#"]) assert.ok(importUnitProblem(unit), unit);
  });
});

describe("classifyMaterialImportRows", () => {
  it("accepts the two sample rows and keeps the exact Item Code", () => {
    const rows = classifyMaterialImportRows(
      [
        row(1, "AMSHV0001", "FILTER: HYDRAULIC FILTER PART NO.: 123-8189", "Nos"),
        row(2, " AMSHV0002 ", "FILTER: HYDRAULIC OIL FILTER WITH O-RING (PART NO: P20923-01)", "Nos"),
        row(3, "000123", "GASKET  SET", "SET"),
      ],
      none
    );
    assert.deepEqual(rows.map((r) => r.status), ["valid", "valid", "valid"]);
    assert.equal(rows[1].itemCode, "AMSHV0002");
    assert.equal(rows[2].itemCode, "000123");
    assert.equal(rows[2].description, "GASKET SET");
    assert.equal(rows[0].normalizedUnit, "Nos", "saved exactly as written");
    assert.equal(rows[2].normalizedUnit, "SET");
  });

  it("flags every occurrence of a duplicated Item Code (case-insensitive)", () => {
    const rows = classifyMaterialImportRows(
      [row(1, "AMSHV0001", "A", "Nos"), row(2, "amshv0001", "B", "Nos"), row(3, "AMSHV0003", "C", "Nos")],
      none
    );
    assert.deepEqual(rows.map((r) => r.status), ["duplicate_item_code", "duplicate_item_code", "valid"]);
  });

  it("flags the same description + unit under two codes", () => {
    const rows = classifyMaterialImportRows([row(1, "X1", "Oil Filter", "PCS"), row(2, "X2", "oil  filter", "pcs")], none);
    assert.deepEqual(rows.map((r) => r.status), ["duplicate_material", "duplicate_material"]);
  });

  it("detects Item Codes and materials already in Inventory Control", () => {
    const existing: ExistingMaterialIndex = {
      itemCodeKeys: new Set(["AMSHV0001"]),
      identityKeys: new Set([materialIdentityKey("Engine Oil", "Liter")]),
    };
    const rows = classifyMaterialImportRows([row(1, "amshv0001", "New", "Nos"), row(2, "Z9", "ENGINE OIL", "liter")], existing);
    assert.deepEqual(rows.map((r) => r.status), ["existing_item_code", "existing_material"]);
  });

  it("reports missing fields and unsupported units, never importing them", () => {
    const rows = classifyMaterialImportRows(
      [row(1, "", "A", "Nos"), row(2, "C2", "", "Nos"), row(3, "C3", "B", ""), row(4, "C4", "C", "<Nos>")],
      none
    );
    assert.deepEqual(rows.map((r) => r.status), ["missing_item_code", "missing_description", "missing_unit", "invalid_unit"]);
    const summary = summarizeMaterialImport(rows);
    assert.deepEqual(summary, { totalRows: 4, valid: 0, existing: 0, duplicates: 0, invalid: 3, invalidUnits: 1 });
  });

  it("accepts a custom unit and saves it unchanged, with its case", () => {
    const rows = classifyMaterialImportRows([row(1, "C1", "Hose", "Packet"), row(2, "C2", "Clip", " Bundle ")], none);
    assert.deepEqual(rows.map((r) => [r.status, r.normalizedUnit]), [["valid", "Packet"], ["valid", "Bundle"]]);
  });

  it("the same material under spelling variants of a unit is still a duplicate", () => {
    const rows = classifyMaterialImportRows([row(1, "C1", "Hose", "Nos"), row(2, "C2", "HOSE", "nos."), row(3, "C3", "hose", "NOS")], none);
    assert.deepEqual(rows.map((r) => r.status), ["duplicate_material", "duplicate_material", "duplicate_material"]);
  });

  it("different units stay different materials, with no conversion between them", () => {
    const rows = classifyMaterialImportRows([row(1, "C1", "Hose", "Mtr"), row(2, "C2", "Hose", "Roll")], none);
    assert.deepEqual(rows.map((r) => r.status), ["valid", "valid"]);
  });

  it("a re-import of the same file finds every row existing", () => {
    const file = [row(1, "AMSHV0001", "Filter A", "Nos"), row(2, "AMSHV0002", "Filter B", "Nos")];
    const first = classifyMaterialImportRows(file, none).filter((r) => r.status === "valid");
    const afterImport: ExistingMaterialIndex = {
      itemCodeKeys: new Set(first.map((r) => r.itemCode.toUpperCase())),
      identityKeys: new Set(first.map((r) => materialIdentityKey(r.description, r.normalizedUnit ?? ""))),
    };
    const again = classifyMaterialImportRows(file, afterImport);
    assert.deepEqual(again.map((r) => r.status), ["existing_item_code", "existing_item_code"]);
  });
});

describe("column detection and mapping", () => {
  it("recognizes every documented header", () => {
    const m = detectHeaderMapping(["Part #", "Store Location", "SKU", "Material Name", "Unit of Measure", "Group", "SS Rec. Code", "Remarks"]);
    assert.deepEqual(m?.mapping, completeMapping({ partNumber: 1, location: 2, itemCode: 3, description: 4, unit: 5, category: 6, ssRecCode: 7, notes: 8 }));
    assert.deepEqual([m?.ambiguous, m?.missingRequired], [[], []]);
  });

  it("flags two columns for one field and a missing required field", () => {
    const m = detectHeaderMapping(["Item Code", "Description", "Item Description"]);
    assert.deepEqual([m?.ambiguous, m?.missingRequired], [["description"], ["unit"]]);
    assert.equal(m?.mapping.unit, null);
  });

  it("does not read a data row as a header", () => {
    assert.equal(detectHeaderMapping(["1", "AMS1", "Filters", "HOSE", "Nos"]), null);
  });

  it("accepts the standard headerless shape only when it really fits", () => {
    assert.equal(looksLikeDefaultLayout([["1", "AMS1", "HYDRAULIC FILTER", "Nos"]]), true);
    assert.equal(looksLikeDefaultLayout([["1", "AMS1", "Filters", "HYDRAULIC FILTER", "Nos"]]), false);
    assert.equal(looksLikeDefaultLayout([["1", "AMS1", "Nos", "HYDRAULIC FILTER"]]), false);
    assert.equal(looksLikeDefaultLayout([["AMS1", "1", "HYDRAULIC FILTER", "Nos"]]), false);
  });

  it("never lets one column feed two fields", () => {
    assert.match(mappingConflict(completeMapping({ itemCode: 1, notes: 1 })) ?? "", /same column/);
    assert.equal(mappingConflict(completeMapping({ itemCode: 1, notes: 2 })), null);
  });

  it("needs every required field before import", () => {
    assert.match(validateMapping(completeMapping({ itemCode: 1, description: 2 })) ?? "", /Choose a column/);
  });
});

describe("categories in the import", () => {
  const known = new Map([["electrical materials", "Electrical Materials"], ["other", "Other"]]);
  const rowOf = (n: number, category: string) => ({ ...row(n, `C${n}`, `Item ${n}`, "Nos"), category });
  const context = (resolutions = {}) => ({ mapped: true, known, resolutions });

  it("matches by case and spacing only, never by similarity", () => {
    const rows = classifyMaterialImportRows([rowOf(1, " ELECTRICAL   materials "), rowOf(2, "Electrical Material")], none, context());
    assert.deepEqual(rows.map((r) => [r.status, r.resolvedCategory]), [["valid", "Electrical Materials"], ["unknown_category", null]]);
  });

  it("holds unknown and blank categories, and never uses Other on its own", () => {
    const rows = classifyMaterialImportRows([rowOf(1, "Hoses"), rowOf(2, "")], none, context());
    assert.deepEqual(rows.map((r) => r.status), ["unknown_category", "unknown_category"]);
    assert.ok(rows.every((r) => r.resolvedCategory === null));
  });

  it("gives every spelling of a new category the first spelling, so one category is created", () => {
    const rows = classifyMaterialImportRows([rowOf(1, "Crane Spares"), rowOf(2, "CRANE  SPARES")], none, context({ "crane spares": { action: "create" } }));
    assert.deepEqual(rows.map((r) => r.resolvedCategory), ["Crane Spares", "Crane Spares"]);
  });

  it("cannot create a blank category or map to one that does not exist", () => {
    const rows = classifyMaterialImportRows([rowOf(1, ""), rowOf(2, "Hoses")], none, context({ "": { action: "create" }, hoses: { action: "map", category: "Nope" } }));
    assert.deepEqual(rows.map((r) => r.status), ["unknown_category", "unknown_category"]);
  });

  it("lists each undecided value once, with its row count", () => {
    const c = context();
    const rows = classifyMaterialImportRows([rowOf(1, "Hoses"), rowOf(2, "HOSES"), rowOf(3, "Other")], none, c);
    assert.deepEqual(categoryReviewList(rows, c).map((r) => [r.value, r.rows]), [["Hoses", 2]]);
  });
});
