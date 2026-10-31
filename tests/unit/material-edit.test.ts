// Edit Material rules: normalization, validation, identity and unit locks.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  changedMaterialFields,
  identityLockReason,
  materialEditVersion,
  normalizeMaterialEdit,
  unitLockReason,
  validateMaterialEdit,
  type MaterialEditValues,
  type MaterialIdentityFacts,
} from "@/lib/store/material-edit";

const base: MaterialEditValues = {
  name: "HOSE CLIP",
  unit: "Nos",
  itemCode: "000123",
  category: "Other",
  partNumber: "",
  ssRecCode: "",
  location: "",
  notes: "",
  minimumStock: "",
  reorderQuantity: "",
};

const clean: MaterialIdentityFacts = { isCatalogPart: false, balance: 0, stockMovementCount: 0, linkedMovementCount: 0, referenceCount: 0, hasUnitSetup: false };

describe("normalizeMaterialEdit", () => {
  it("keeps Item Code and unit text exactly, trimming only the ends", () => {
    const v = normalizeMaterialEdit({ ...base, itemCode: "  000123 ", unit: " Set of 4 " });
    assert.equal(v.itemCode, "000123");
    assert.equal(v.unit, "Set of 4");
  });

  it("does not touch Part Number or SS Rec. Code when Item Code changes", () => {
    const v = normalizeMaterialEdit({ ...base, itemCode: "NEW", partNumber: "P-1", ssRecCode: "SS-1" });
    assert.deepEqual([v.partNumber, v.ssRecCode], ["P-1", "SS-1"]);
  });

  it("uses a known category's spelling and keeps a custom one", () => {
    assert.equal(normalizeMaterialEdit({ ...base, category: "electrical materials" }).category, "Electrical Materials");
    assert.equal(normalizeMaterialEdit({ ...base, category: "Crane Spares" }).category, "Crane Spares");
  });
});

describe("validateMaterialEdit", () => {
  it("accepts complete values, with optional fields empty", () => {
    assert.deepEqual(validateMaterialEdit(base), {});
  });

  it("requires name, unit and category", () => {
    const e = validateMaterialEdit({ ...base, name: "", unit: "", category: "" });
    assert.deepEqual(Object.keys(e).sort(), ["category", "name", "unit"]);
  });

  it("applies the import's unit rules, so custom units pass and bad ones do not", () => {
    assert.deepEqual(validateMaterialEdit({ ...base, unit: "Packet" }), {});
    assert.ok(validateMaterialEdit({ ...base, unit: "Nos|Set" }).unit);
    assert.ok(validateMaterialEdit({ ...base, unit: "<Nos>" }).unit);
  });

  it("checks stock settings", () => {
    assert.ok(validateMaterialEdit({ ...base, minimumStock: "-1" }).minimumStock);
    assert.ok(validateMaterialEdit({ ...base, minimumStock: "abc" }).minimumStock);
    assert.deepEqual(validateMaterialEdit({ ...base, minimumStock: "0" }), {});
    assert.ok(validateMaterialEdit({ ...base, reorderQuantity: "0" }).reorderQuantity);
    assert.deepEqual(validateMaterialEdit({ ...base, reorderQuantity: "2.5" }), {});
  });
});

describe("changedMaterialFields and version", () => {
  it("lists only what changed", () => {
    assert.deepEqual(changedMaterialFields(base, { ...base, location: "A1", notes: "x" }), ["location", "notes"]);
    assert.deepEqual(changedMaterialFields(base, base), []);
  });

  it("gives a different version for any change", () => {
    assert.notEqual(materialEditVersion(base), materialEditVersion({ ...base, notes: "x" }));
    assert.equal(materialEditVersion(base), materialEditVersion({ ...base }));
  });
});

describe("identity and unit locks", () => {
  it("a material with no history can change name and unit", () => {
    assert.equal(identityLockReason(clean), null);
    assert.equal(unitLockReason(clean), null);
  });

  it("stock, movements, links and references lock both", () => {
    for (const facts of [
      { ...clean, balance: 5 },
      { ...clean, balance: -2 },
      { ...clean, stockMovementCount: 1 },
      { ...clean, linkedMovementCount: 1 },
      { ...clean, referenceCount: 1 },
      { ...clean, isCatalogPart: true },
    ]) {
      assert.ok(identityLockReason(facts));
      assert.ok(unitLockReason(facts));
    }
  });

  it("a purchase-unit setup locks the unit but not the name", () => {
    const facts = { ...clean, hasUnitSetup: true };
    assert.equal(identityLockReason(facts), null);
    assert.match(unitLockReason(facts) ?? "", /purchase unit setup/);
  });
});
