// Needs Verification rules: corrections overlay, validation, status, plain
// issue labels and roles. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMaterialIndex,
  classifyOpeningStockRows,
  registerDifferentBlock,
  resolveOpeningStockDecisions,
  exactMatchMaterials,
  resolveRowOutcome,
  sameReferenceMaterials,
  type ExistingInventoryMaterial,
  type OpeningStockSourceRow,
} from "@/lib/store/opening-stock-matching";
import {
  NO_CORRECTION,
  deriveVerificationStatus,
  effectiveSourceRow,
  hasCorrection,
  normalizeCorrection,
  validateCorrection,
  verificationIssue,
  verificationRolesFor,
} from "@/lib/store/opening-stock-verification-rules";

const source: OpeningStockSourceRow = {
  rowNumber: 50, materialName: "ASHOK LEYLAND FUEL FILTER SEPARATAR- PHJ00004", category: "Automotive", partNumber: "",
  ssRecCode: "", quantityText: "6", unit: "PCS", location: "", remarks: "",
};

function material(name: string, unit: string, extra: Partial<ExistingInventoryMaterial> = {}): ExistingInventoryMaterial {
  return { key: `manual:${name.toLowerCase()}|${unit.toLowerCase()}`, name, unit, partId: null, partNumber: null, ssRecCode: null, itemCode: null, category: "Other", archived: false, openingStockQuantity: 0, balance: 0, ...extra };
}

describe("corrections", () => {
  it("lays corrections over the original without changing it", () => {
    const eff = effectiveSourceRow(source, { ...NO_CORRECTION, unit: "SET", quantity: 4 });
    assert.deepEqual([eff.unit, eff.quantityText, eff.materialName], ["SET", "4", source.materialName]);
    assert.deepEqual([source.unit, source.quantityText], ["PCS", "6"], "original untouched");
  });

  it("keeps only real changes", () => {
    const n = normalizeCorrection(source, { materialName: ` ${source.materialName.toLowerCase()} `, partNumber: "PHJ00004", category: "Automotive", unit: "pcs", quantity: 6, remarks: "  " });
    assert.deepEqual(n, { ...NO_CORRECTION, partNumber: "PHJ00004" });
    assert.equal(hasCorrection(n), true);
    assert.equal(hasCorrection(normalizeCorrection(source, { ...NO_CORRECTION, remarks: "checked" })), false, "a remark alone is not a correction");
  });

  it("validates fields and requires a reason to submit a change", () => {
    assert.deepEqual(validateCorrection({ ...NO_CORRECTION, quantity: 6 }, "", true, source), {}, "no change → no reason needed");
    const e = validateCorrection({ ...NO_CORRECTION, materialName: "x", unit: "-", quantity: 1.5 }, "", true, source);
    assert.ok(e.materialName && e.unit && e.quantity);
    assert.match(validateCorrection({ ...NO_CORRECTION, quantity: 8 }, "", true, source).reason ?? "", /Explain why/);
    assert.equal(validateCorrection({ ...NO_CORRECTION, quantity: 8 }, "", false, source).reason, undefined, "a draft may wait for its reason");
    assert.deepEqual(validateCorrection({ ...NO_CORRECTION, quantity: 8 }, "Counted again on the shelf", true, source), {});
  });
});

describe("status", () => {
  it("derives the staff status from the row outcome and verification step", () => {
    assert.equal(deriveVerificationStatus("held", null), "needs_verification");
    assert.equal(deriveVerificationStatus("held", "on_hold"), "needs_verification");
    assert.equal(deriveVerificationStatus("held", "draft"), "correction_in_progress");
    assert.equal(deriveVerificationStatus("held", "submitted"), "waiting_for_manager");
    assert.equal(deriveVerificationStatus("held", "returned"), "returned");
    assert.equal(deriveVerificationStatus("posted_existing", "submitted"), "completed");
    assert.equal(deriveVerificationStatus("registered_new", null), "completed");
    assert.equal(deriveVerificationStatus("excluded", "returned"), "excluded");
    assert.equal(deriveVerificationStatus("not_imported", null), "excluded");
  });
});

describe("plain-language issues", () => {
  const index = buildMaterialIndex([
    material("FILTER : FUEL SEPARATOR PART NO.PHJ00004 ( ASHOK-LEYLAND BUS)", "Set", { itemCode: "AMSHV1021" }),
    material("FILTER : FUEL FILTER FF5488 FOR SANY (PRIMARY)", "Nos"),
    material("FILTER : FUEL FILTER FF5488 FOR SANY (SECONDRY)", "Nos"),
    material("FILTER: OIL FILTER 7W2326E FOR CATERPILLAR", "Nos"),
  ]);
  const one = (s: OpeningStockSourceRow, others: OpeningStockSourceRow[] = []) => classifyOpeningStockRows([s, ...others], index)[0];
  const row = (n: number, name: string, unit = "PCS"): OpeningStockSourceRow => ({ ...source, rowNumber: n, materialName: name, unit });

  it("labels each kind of problem with what to do", () => {
    const unit = verificationIssue(one(source));
    assert.equal(unit.label, "Unit Mismatch");
    assert.match(unit.explanation, /Excel says PCS, but MMS has AMSHV1021 in Set/);
    assert.equal(verificationIssue(one(row(2, "FUEL FILTER -FF5488"))).label, "Multiple Matching Materials");
    assert.equal(verificationIssue(one(row(2, "CAT OIL FILTER -7W-2326"))).label, "Material Details Need Checking");
    assert.equal(verificationIssue(one(row(2, "FUEL FILTER -60208877"), [row(3, "SANY FILTER M.60208877")])).label, "Same Part Reference");
  });

  it("a corrected unit turns a Unit Mismatch into a ready match", () => {
    const fixed = one(effectiveSourceRow(source, { ...NO_CORRECTION, unit: "SET" }));
    assert.equal(fixed.classification, "existing");
    assert.match(verificationIssue(fixed).label, /^Ready/);
  });
});

describe("roles (existing role slugs)", () => {
  it("Data Entry edits; Manager and System Administrator also decide; Store Keeper views", () => {
    assert.deepEqual(verificationRolesFor("maintenance_data_entry", ["parts.view"]), { canView: true, canEdit: true, canApprove: false });
    assert.deepEqual(verificationRolesFor("maintenance_manager", ["parts.view"]), { canView: true, canEdit: true, canApprove: true });
    assert.deepEqual(verificationRolesFor("super_admin", []), { canView: true, canEdit: true, canApprove: true });
    assert.deepEqual(verificationRolesFor("store_keeper", ["parts.view", "store.issue"]), { canView: true, canEdit: false, canApprove: false });
    assert.deepEqual(verificationRolesFor("technician", []), { canView: false, canEdit: false, canApprove: false });
  });
});

describe("Register as Different Material (exception)", () => {
  const primary = material("FILTER : FUEL FILTER FF5488 FOR SANY (PRIMARY)", "Nos", { itemCode: "AMSHV1127" });
  const secondary = material("FILTER : FUEL FILTER FF5488 FOR SANY (SECONDRY)", "Nos", { itemCode: "AMSHV1128" });
  const jcbFuel = material("FILTER : FUEL FILTER (PART NO: 320-07416) FOR JCB GENERATOR", "Nos", { itemCode: "AMSHV1355" });
  const ashok = material("FILTER : FUEL SEPARATOR PART NO.PHJ00004 ( ASHOK-LEYLAND BUS)", "Set", { itemCode: "AMSHV1021" });
  const index = buildMaterialIndex([primary, secondary, jcbFuel, ashok]);
  const row = (name: string, unit = "PCS"): OpeningStockSourceRow => ({ ...source, rowNumber: 7, materialName: name, unit });
  const classify = (name: string, unit = "PCS") => classifyOpeningStockRows([row(name, unit)], index)[0];
  const different = (keys: string[], over: Partial<{ confirmedDifferent: boolean; reason: string; exactMatchOverride: { confirmed: boolean; evidenceType: "specification" | "physical_evidence"; evidence: string } }> = {}) =>
    ({ action: "register_different" as const, confirmedDifferent: true, reason: "Checked both items: different filter body and thread", comparedKeys: keys, ...over });
  const override = { confirmed: true, evidenceType: "specification" as const, evidence: "Measured: outer diameter 93 mm vs 76 mm, thread M16x1.5 vs 3/4-16 UNF" };

  it("normal duplicate protection stays: Register New is still refused for an exact part number", () => {
    assert.throws(() => resolveRowOutcome(classify("FUEL FILTER -FF5488"), { action: "register_new" }, index, true), /already has this part number.*Register as Different Material/);
  });

  it("an approver can register a genuinely different material after comparing with every same-number material", () => {
    const r = classify("FUEL FILTER -FF5488");
    assert.deepEqual(sameReferenceMaterials(r).map((c) => c.itemCode).sort(), ["AMSHV1127", "AMSHV1128"]);
    assert.equal(registerDifferentBlock(r, index), null);
    const o = resolveRowOutcome(r, different([primary.key, secondary.key], { exactMatchOverride: override }), index, true);
    assert.equal(o.outcome, "register_new");
    assert.deepEqual(o.outcome === "register_new" && o.exception?.exactMatchOverride?.exactMatchTo.map((m) => m.itemCode), ["AMSHV1127", "AMSHV1128"]);
    assert.deepEqual(o.outcome === "register_new" && o.exception?.differentFrom.map((m) => m.itemCode), ["AMSHV1127", "AMSHV1128"]);
    assert.equal(o.outcome === "register_new" && o.approvedDecision, true);
    // The type-conflict case (oil filter row vs a fuel filter with the same number): a real difference, no override needed.
    const jcb = classify("JCB OIL FILTER -320/07416");
    assert.deepEqual(exactMatchMaterials(jcb), []);
    const j = resolveRowOutcome(jcb, different([jcbFuel.key]), index, true);
    assert.equal(j.outcome === "register_new" && j.exception?.exactMatchOverride, undefined);
  });

  it("requires an approver, the confirmation, an explanation and the full comparison", () => {
    const r = classify("FUEL FILTER -FF5488");
    assert.throws(() => resolveRowOutcome(r, different([primary.key, secondary.key]), index, false), /Only the System Administrator or Maintenance Manager/);
    assert.throws(() => resolveRowOutcome(r, different([primary.key, secondary.key], { confirmedDifferent: false }), index, true), /physically different/);
    assert.throws(() => resolveRowOutcome(r, different([primary.key, secondary.key], { reason: "  different " }), index, true), /at least 15 characters/);
    assert.throws(() => resolveRowOutcome(r, different([primary.key]), index, true), /Compare the row with AMSHV1128/);
  });

  it("is refused for a unit mismatch alone, without a part number match, and for the same description", () => {
    const unitOnly = classify(source.materialName);
    assert.match(registerDifferentBlock(unitOnly, index) ?? "", /only difference found from AMSHV1021 is the unit/);
    assert.throws(() => resolveRowOutcome(unitOnly, different([ashok.key]), index, true), /unit mismatch is not a reason/);
    assert.match(registerDifferentBlock(classify("HYDRAULIC HOSE 1/2 INCH"), index) ?? "", /use Register New/);
    const sameText = classify("FILTER : FUEL FILTER FF5488 FOR SANY (PRIMARY)", "Nos");
    assert.ok(registerDifferentBlock(sameText, index), "the exact same description is never registered again");
    assert.throws(() => resolveRowOutcome(sameText, different([primary.key, secondary.key]), index, true));
  });

  it("an exact match (same number, unit, type, make, equipment; only spelling differs) is blocked by default", () => {
    const r = classify("FUEL FILTER -FF5488");
    assert.deepEqual(exactMatchMaterials(r).map((c) => c.itemCode).sort(), ["AMSHV1127", "AMSHV1128"]);
    for (const spelled of ["Fuel Filtr FF5488 - Sany", "fuel  filter ff5488 for sany"]) {
      assert.equal(exactMatchMaterials(classify(spelled, "Nos")).length, 2, `"${spelled}": spelling and punctuation are not differences`);
    }
    // A part number split by a space or hyphen is still the same part number.
    for (const spaced of ["Fuel-Filter  FF 5488 (Sany)", "fuel filter, ff-5488 sany"]) {
      const r2 = classify(spaced, "Nos");
      assert.throws(() => resolveRowOutcome(r2, { action: "register_new" }, index, true), /part number FF5488, written in this row with a space or punctuation/);
      assert.match(registerDifferentBlock(r2, index) ?? "", /Correct the row's part number to FF5488/);
    }
    const keys = [primary.key, secondary.key];
    assert.throws(() => resolveRowOutcome(r, different(keys), index, true), /exact match to AMSHV1127, AMSHV1128.*separate exceptional approval/);
    assert.throws(() => resolveRowOutcome(r, different(keys, { exactMatchOverride: { ...override, confirmed: false } }), index, true), /exceptional approval/);
    assert.throws(() => resolveRowOutcome(r, different(keys, { exactMatchOverride: { ...override, evidence: "different size" } }), index, true), /at least 30 characters/);
    assert.throws(() => resolveRowOutcome(r, different(keys, { reason: override.evidence, exactMatchOverride: override }), index, true), /its own evidence/);
    assert.throws(() => resolveRowOutcome(r, different(keys, { exactMatchOverride: override }), index, false), /Only the System Administrator or Maintenance Manager/);
    assert.equal(resolveRowOutcome(r, different(keys, { exactMatchOverride: { ...override, evidenceType: "physical_evidence" } }), index, true).outcome, "register_new");
  });

  it("two rows registering the same new name in one decision are refused", () => {
    const rows = classifyOpeningStockRows([row("FUEL FILTER -FF5488"), { ...row("FUEL FILTER -FF5488"), rowNumber: 8 }], index);
    const d = different([primary.key, secondary.key], { exactMatchOverride: override });
    assert.throws(() => resolveOpeningStockDecisions(rows, { 7: d, 8: d }, index, true), /already registers a material with this name/);
  });
});
