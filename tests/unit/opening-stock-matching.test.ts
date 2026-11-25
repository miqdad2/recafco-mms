// Opening Stock import matching engine: normalisation, part references,
// specifications, item types, unit compatibility, classification, decisions
// and Item Code allocation. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DecisionError,
  allocateItemCodes,
  buildMaterialIndex,
  canonicalSourceContent,
  classifyOpeningStockRows,
  detectOpeningStockHeader,
  extractReferences,
  extractSpecifications,
  identityName,
  itemType,
  itemTypesAgree,
  makesOf,
  parseOpeningQuantity,
  resolveOpeningStockDecisions,
  resolveRowOutcome,
  summarizeOpeningStock,
  unitCompatibility,
  type ExistingInventoryMaterial,
  type OpeningStockSourceRow,
} from "@/lib/store/opening-stock-matching";

function material(name: string, unit: string, extra: Partial<ExistingInventoryMaterial> = {}): ExistingInventoryMaterial {
  return {
    key: `manual:${name.toLowerCase()}|${unit.toLowerCase()}`,
    name,
    unit,
    partId: null,
    partNumber: null,
    ssRecCode: null,
    itemCode: null,
    category: "Other",
    archived: false,
    openingStockQuantity: 0,
    balance: 0,
    ...extra,
  };
}

function row(rowNumber: number, materialName: string, quantityText: string, unit: string, extra: Partial<OpeningStockSourceRow> = {}): OpeningStockSourceRow {
  return { rowNumber, materialName, category: "Automotive", partNumber: "", ssRecCode: "", quantityText, unit, location: "", remarks: "", ...extra };
}

const EXISTING = [
  material("FILTER : OIL FILTER MZ690150 (MITSUBISHI PAJERO JEEPS)", "Nos", { itemCode: "AMSHV0101" }),
  material("FILTER : FUEL FILTER FF5488 FOR SANY 30-80T MOBILE CRANE (PRIMARY)", "Nos"),
  material("FILTER : FUEL FILTER FF5488 FOR SANY 30-80T MOBILE CRANE (SECONDRY)", "Nos"),
  material("FILTER: OIL FILTER (PART NO: 25195785) CHEVROLET AVEO", "Set"),
  material("FILTER: HYDRAULIC FILTER (PART NO: 144-6691) / CAT 930K", "Nos", { itemCode: "AMSHV0037" }),
  material("FILTER: OIL FILTER 7W2326E FOR CATERPILLAR TELEHANDLER", "Nos"),
  material("FUEL SHUT OFF SOLENOID (PART NO: P0Z00448)", "Nos"),
  material("FILTER : OIL FILTER PART NO : 5411800209 / 01JRE21 (SANY)", "Nos"),
  material("FILTER : FUEL FILTER PART NO : 4616544 (BRAND HITACHI)", "Nos"),
  material("FILTER : OIL FILTER : 90915-YZZD2 (TOYOTA COASTER)", "Nos"),
  material("FILTER : AIR FILTER (FOR TOYOTA LAND CRUISER)", "Nos"),
  material("BRAKE PAD SET", "Nos", { itemCode: "AMSHV0200" }),
  material("V BELT B-52", "Set"),
  material("ENGINE OIL 15W40", "Litre"),
  material("GASKET: OIL JOINTING GASKET PAPER 0.5MM", "Mtr"),
  material("RADIATOR CAP", "Nos", { openingStockQuantity: 4, balance: 4 }),
  material("OLD HORN", "Nos", { archived: true }),
  material("WIPER BLADE", "Nos", { partNumber: "WB-100" }),
];
const index = buildMaterialIndex(EXISTING);
const keyOf = (name: string) => EXISTING.find((m) => m.name === name)!.key;

describe("template header and quantities", () => {
  it("detects the eight-column template, case- and spacing-insensitively", () => {
    const m = detectOpeningStockHeader(["Material Name", "Category", "Part Number", "SS Rec. Code", "Opening Quantity", "Unit", "Location / Bin", "Remarks"]);
    assert.deepEqual(m, { material_name: 1, category: 2, part_number: 3, ss_rec_code: 4, quantity: 5, unit: 6, location: 7, remarks: 8 });
    assert.equal(detectOpeningStockHeader(["TOYOTA KINGLONG -90915-D2", "Automotive", "", "", "6", "PCS"]), null);
  });

  it("accepts only plain whole numbers greater than zero — never guesses", () => {
    assert.equal(parseOpeningQuantity("6"), 6);
    assert.equal(parseOpeningQuantity(" 18 "), 18);
    assert.equal(parseOpeningQuantity("4.0"), 4);
    for (const bad of ["0", "-3", "1.5", "20 PIECES", "6PCS", "10MTR", "", "abc"]) assert.equal(parseOpeningQuantity(bad), null, bad);
  });
});

describe("normalisation, references, specifications and item types", () => {
  it("finds references written with spaces, hyphens and glued words", () => {
    assert.ok(extractReferences("CAT FUEL FILTER- 1R- 0749").includes("1R0749"));
    assert.ok(extractReferences("BENZ FUEL FILTER -A906 180 0209").includes("A9061800209"));
    assert.ok(extractReferences("CAT CARTRIDGE ASSY OIL FILTER-32B4020100C").includes("32B4020100C"));
    assert.ok(extractReferences("FILTER : FUEL SEPARATOR PART NO.PHJ00004 ( ASHOK-LEYLAND)").includes("PHJ00004"));
  });

  it("does not treat ratings or short numbers as part references", () => {
    assert.deepEqual(extractReferences("CONTACTOR 5.5 KW 240.V"), []);
    assert.deepEqual(extractSpecifications("CONTACTOR L.C 1D12 C 7    5.5 KW 240.V").get("KW"), new Set(["5.5"]));
    assert.deepEqual(extractSpecifications("PAPER GASKET 0.4mm").get("MM"), new Set(["0.4"]));
  });

  it("recognises item types and makes, and when types agree", () => {
    assert.equal(itemType("CAT ENGINE OIL FILTER -7W-2326"), "OIL FILTER");
    assert.equal(itemType("FUEL SHUT OFF SOLENOID"), "SOLENOID");
    assert.equal(itemType("REPAIR KIT: DIESEL LIFT PUMP"), "PUMP");
    assert.equal(itemType("CAT FILTER -144-6691"), "FILTER (type not stated)");
    assert.equal(itemType("PAJERO MZ690150"), null);
    assert.ok(itemTypesAgree("FILTER (type not stated)", "HYDRAULIC FILTER"));
    assert.ok(itemTypesAgree(null, "OIL FILTER"));
    assert.ok(!itemTypesAgree("AIR FILTER", "OIL FILTER"));
    assert.ok(!itemTypesAgree("FUEL FILTER", "SOLENOID"));
    assert.deepEqual(makesOf("CATERPILLAR TELEHANDLER"), ["CAT"]);
  });

  it("collapses inner spacing for a new identity name only", () => {
    assert.equal(identityName("ENGINE     OIL FILTER -84475542"), "ENGINE OIL FILTER -84475542");
  });

  it("PCS and Nos are the same counting unit; nothing else is converted", () => {
    assert.equal(unitCompatibility("PCS", "Nos"), "counting_equivalent");
    assert.equal(unitCompatibility("NOS", "nos."), "same");
    assert.equal(unitCompatibility("PCS", "Set"), "incompatible");
    assert.equal(unitCompatibility("PCS", "Mtr"), "incompatible");
    assert.equal(unitCompatibility("PCS", "Box"), "incompatible");
    assert.equal(unitCompatibility("LTR", "Litre"), "incompatible");
  });
});

describe("classifyOpeningStockRows", () => {
  const classify = (rows: OpeningStockSourceRow[]) => new Map(classifyOpeningStockRows(rows, index).map((r) => [r.rowNumber, r]));

  it("confirms a single same-name material and keeps its exact name and unit (PCS → Nos)", () => {
    const r = classify([row(2, "  brake   pad set ", "6", "PCS")]).get(2)!;
    assert.equal(r.classification, "existing");
    assert.equal(r.proposedAction, "post_existing");
    assert.equal(r.match?.name, "BRAKE PAD SET");
    assert.equal(r.match?.unit, "Nos");
    assert.match(r.message, /Recorded in Nos/);
  });

  it("confirms a single exact part-reference match when type, make and unit agree", () => {
    const pajero = classify([row(2, "PAJERO MZ690150", "1", "PCS")]).get(2)!;
    assert.equal(pajero.classification, "existing");
    assert.equal(pajero.match?.itemCode, "AMSHV0101");
    const cat = classify([row(2, "CAT FILTER -144-6691", "2", "PCS")]).get(2)!;
    assert.equal(cat.classification, "existing", "a filter of unstated type agrees with a hydraulic filter");
    assert.match(cat.message, /part reference 1446691/);
  });

  it("holds a reference written only partly the same (7W2326 vs 7W2326E)", () => {
    const r = classify([row(2, "CAT ENGINE OIL FILTER -7W-2326", "4", "PCS")]).get(2)!;
    assert.equal(r.classification, "needs_review");
    assert.match(r.message, /only partly the same/);
  });

  it("holds an exact reference when the kind of part or the make disagrees", () => {
    const type = classify([row(2, "BENZ AIR FILTER -5411800209", "6", "PCS")]).get(2)!;
    assert.equal(type.classification, "needs_review");
    assert.match(type.message, /different kinds of part|different makes/);
    const make = classify([row(2, "TOYOTA FUEL FILTER 4616544", "1", "PCS")]).get(2)!;
    assert.equal(make.classification, "needs_review");
    assert.match(make.message, /different makes/);
  });

  it("holds a reference match whose unit is incompatible (PCS vs Set) — never converted", () => {
    const r = classify([row(2, "AVEO CHEVROLET 25195785", "3", "PCS")]).get(2)!;
    assert.equal(r.classification, "needs_review");
    assert.match(r.message, /stocks it in Set.*never converted/);
  });

  it("several candidates (FF5488 primary and secondary) stay held", () => {
    const r = classify([row(2, "FUEL FILTER -FF5488", "2", "PCS")]).get(2)!;
    assert.equal(r.classification, "needs_review");
    assert.equal(r.candidates.length, 2);
  });

  it("weak evidence is never treated as new: digits, a one-character reference, make + type", () => {
    const m = classify([
      row(2, "TOYOTA KINGLONG -90915-D2", "6", "PCS"), // number 90915 in AMS description
      row(3, "ASHOK LEYLAND FUEL FILTER -P0Z00442", "3", "PCS"), // P0Z00448 one character apart
      row(4, "TOYOTA LAND CRUISER AIR FILTER", "1", "PCS"), // same make and type, MMS item has no part number
    ]);
    for (const n of [2, 3, 4]) {
      assert.equal(m.get(n)?.classification, "needs_review", `row ${n}`);
      assert.ok(["weak", "similar_name"].includes(m.get(n)!.candidates[0]?.strength), `row ${n} has only weak or name evidence`);
    }
    assert.equal(m.get(2)?.candidates[0]?.strength, "weak");
    assert.match(m.get(3)!.message, /differs by one character/);
  });

  it("a row with no evidence at all is New", () => {
    const r = classify([row(2, "HYDRAULIC HOSE 12MM ZQ-77881", "10", "MTR")]).get(2)!;
    assert.equal(r.classification, "new");
    assert.equal(r.proposedAction, "register_new");
  });

  it("the same material twice in the file is held, never merged", () => {
    const m = classify([row(2, "NEW ITEM ALPHA", "1", "PCS"), row(3, "new  item alpha", "2", "SET")]);
    for (const n of [2, 3]) {
      assert.equal(m.get(n)?.classification, "duplicate_in_file");
      assert.equal(m.get(n)?.proposedAction, "hold");
    }
  });

  it("two different rows sharing a part reference are both held", () => {
    const m = classify([row(2, "SANY FUEL FILTER M.60208877", "7", "PCS"), row(3, "FUEL FILTER -60208877", "1", "PCS")]);
    assert.equal(m.get(2)?.proposedAction, "hold");
    assert.equal(m.get(3)?.proposedAction, "hold");
    assert.deepEqual(m.get(3)?.relatedRows, [2]);
  });

  it("archived, part-number-conflicting and already-stocked materials", () => {
    const m = classify([row(2, "OLD HORN", "1", "PCS"), row(3, "WIPER BLADE", "2", "PCS", { partNumber: "WB-200" }), row(4, "Radiator Cap", "5", "NOS")]);
    assert.equal(m.get(2)?.classification, "needs_review");
    assert.equal(m.get(3)?.classification, "needs_review");
    assert.equal(m.get(4)?.classification, "already_imported");
  });

  it("an earlier, un-reversed import posting makes a row Already Imported (existing and new), never a crash", () => {
    const posted = [keyOf("BRAKE PAD SET"), "manual:imported before item zz-55555|pcs"];
    const idx2 = buildMaterialIndex(EXISTING, posted);
    const [brake, before, fresh] = classifyOpeningStockRows(
      [row(2, "BRAKE PAD SET", "6", "PCS"), row(3, "Imported  Before Item ZZ-55555", "2", "PCS"), row(4, "BRAND NEW THING QX-31337", "1", "PCS")],
      idx2
    );
    assert.deepEqual([brake.classification, before.classification, fresh.classification], ["already_imported", "already_imported", "new"]);
    assert.equal(brake.proposedAction, "none");
    // An approver cannot point another row at it either.
    const [held] = classifyOpeningStockRows([row(5, "FUEL FILTER -FF5488", "1", "PCS")], idx2);
    assert.throws(() => resolveRowOutcome(held, { action: "use_existing", materialKey: keyOf("BRAKE PAD SET") }, idx2, true), /earlier opening-stock import/);
  });

  it("invalid rows explain what is wrong", () => {
    const m = classify([row(2, "", "1", "PCS"), row(3, "QUICK COUPLER", "20 PIECES", "PCS"), row(4, "AIR TUBE", "10", "METERS")]);
    assert.ok([...m.values()].every((r) => r.classification === "invalid" && r.proposedAction === "none"));
    assert.match(m.get(3)!.message, /20 PIECES/);
  });

  it("every source row is accounted for, in order, with totals", () => {
    const out = classifyOpeningStockRows([row(2, "BRAKE PAD SET", "6", "PCS"), row(3, "", "1", "PCS"), row(4, "FUEL FILTER -FF5488", "1", "PCS"), row(5, "UNSEEN ITEM QQ-99881", "3", "PCS")], index);
    assert.deepEqual(out.map((r) => r.rowNumber), [2, 3, 4, 5]);
    const s = summarizeOpeningStock(out);
    assert.equal(s.existing + s.new + s.needs_review + s.duplicate_in_file + s.already_imported + s.invalid, 4);
    assert.equal(s.totalQuantity, 11);
  });
});

describe("resolveRowOutcome / resolveOpeningStockDecisions", () => {
  const rows = classifyOpeningStockRows(
    [
      row(2, "BRAKE PAD SET", "6", "PCS"),
      row(3, "FUEL FILTER -FF5488", "2", "PCS"),
      row(4, "UNSEEN ITEM QQ-99881", "3", "PCS"),
      row(5, "V BELT B-52", "3", "PCS"),
      row(6, "DUP X", "1", "PCS"),
      row(7, "dup x", "1", "PCS"),
      row(8, "BAD", "x", "PCS"),
    ],
    index
  );
  const byRow = new Map(rows.map((r) => [r.rowNumber, r]));
  const primary = keyOf("FILTER : FUEL FILTER FF5488 FOR SANY 30-80T MOBILE CRANE (PRIMARY)");

  it("defaults: clear Existing posts, clear New registers, uncertain rows are held, invalid fails", () => {
    const out = new Map(resolveOpeningStockDecisions(rows, {}, index, false).map((r) => [r.row.rowNumber, r.outcome.outcome]));
    assert.deepEqual(Object.fromEntries(out), { 2: "post_existing", 3: "hold", 4: "register_new", 5: "hold", 6: "hold", 7: "hold", 8: "not_imported" });
  });

  it("only an approver can resolve a held row", () => {
    assert.throws(() => resolveRowOutcome(byRow.get(3)!, { action: "use_existing", materialKey: primary }, index, false), /System Administrator or Maintenance Manager/);
    const ok = resolveRowOutcome(byRow.get(3)!, { action: "use_existing", materialKey: primary }, index, true);
    assert.ok(ok.outcome === "post_existing" && ok.material.unit === "Nos" && ok.approvedDecision);
    assert.throws(() => resolveRowOutcome(byRow.get(6)!, { action: "exclude", reason: "same as row 7" }, index, false), /System Administrator/);
  });

  it("incompatible units are refused even for an approver; a same-name second material is never created", () => {
    assert.throws(() => resolveRowOutcome(byRow.get(5)!, { action: "use_existing", materialKey: keyOf("V BELT B-52") }, index, true), /never converted/);
    assert.throws(() => resolveRowOutcome(byRow.get(5)!, { action: "register_new" }, index, true), /already exists/);
  });

  it("a row whose exact part number belongs to an existing material is never registered as new (no duplicate identity)", () => {
    const [aveo] = classifyOpeningStockRows([row(2, "AVEO CHEVROLET 25195785", "3", "PCS")], index); // MMS has it in Set
    assert.equal(aveo.proposedAction, "hold");
    assert.throws(() => resolveRowOutcome(aveo, { action: "register_new" }, index, true), /already has this part number/);
    assert.deepEqual(resolveRowOutcome(aveo, { action: "exclude", reason: "Unit to be corrected first" }, index, true).outcome, "exclude");
  });

  it("exclude needs a reason; invalid rows can never post", () => {
    assert.throws(() => resolveRowOutcome(byRow.get(6)!, { action: "exclude", reason: "  " }, index, true), /reason/);
    const ex = resolveRowOutcome(byRow.get(6)!, { action: "exclude", reason: "Same item as row 7" }, index, true);
    assert.deepEqual(ex, { outcome: "exclude", reason: "Same item as row 7" });
    assert.throws(() => resolveRowOutcome(byRow.get(8)!, { action: "register_new" }, index, true), /Invalid rows cannot be imported/);
  });

  it("duplicate lines: one can be registered, the other must be excluded or held", () => {
    assert.throws(
      () => resolveOpeningStockDecisions(rows, { 6: { action: "register_new" }, 7: { action: "register_new" } }, index, true),
      /already registers a material with this name/
    );
    const ok = resolveOpeningStockDecisions(rows, { 6: { action: "register_new" }, 7: { action: "exclude", reason: "Duplicate of row 6" } }, index, true);
    assert.deepEqual(ok.filter((r) => [6, 7].includes(r.row.rowNumber)).map((r) => r.outcome.outcome), ["register_new", "exclude"]);
  });

  it("a material that already has opening stock or is archived cannot be chosen", () => {
    assert.throws(() => resolveRowOutcome(byRow.get(3)!, { action: "use_existing", materialKey: keyOf("RADIATOR CAP") }, index, true), /already has opening stock/);
    assert.throws(() => resolveRowOutcome(byRow.get(3)!, { action: "use_existing", materialKey: keyOf("OLD HORN") }, index, true), /archived/);
  });

  it("one material receives opening stock from one row only", () => {
    assert.throws(
      () => resolveOpeningStockDecisions(rows, { 3: { action: "use_existing", materialKey: keyOf("BRAKE PAD SET") } }, index, true),
      /one row only/
    );
  });

  it("unknown rows are refused", () => {
    assert.throws(() => resolveOpeningStockDecisions(rows, { 99: { action: "hold" } }, index, true), DecisionError);
  });
});

describe("allocateItemCodes", () => {
  it("starts the AMSOS series at 0001 and never reuses a code", () => {
    assert.deepEqual(allocateItemCodes(["AMSHV0001", null, "AMSLV0223"], 3), ["AMSOS0001", "AMSOS0002", "AMSOS0003"]);
    assert.deepEqual(allocateItemCodes(["AMSOS0009", "amsos0012", "AMSOS0003"], 2), ["AMSOS0013", "AMSOS0014"]);
    assert.deepEqual(allocateItemCodes(["AMSOS9999"], 1), ["AMSOS10000"]);
    assert.deepEqual(allocateItemCodes([], 0), []);
  });
});

describe("canonicalSourceContent", () => {
  it("is the same for a re-saved copy differing only in case and spacing", () => {
    const a = canonicalSourceContent([row(2, "Oil  Filter", "6", "PCS")]);
    assert.equal(a, canonicalSourceContent([row(2, "OIL FILTER ", " 6", "pcs")]));
    assert.notEqual(a, canonicalSourceContent([row(2, "OIL FILTER", "7", "PCS")]));
  });
});
