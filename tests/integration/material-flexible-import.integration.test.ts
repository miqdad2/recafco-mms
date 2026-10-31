// Flexible Excel import (dynamic columns, optional fields, categories) against
// a REAL, DISPOSABLE PostgreSQL database. Refuses to run unless DATABASE_URL
// names a database ending in "_test".
//
//   DATABASE_URL=postgresql://.../some_test npm run test:integration
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import ExcelJS from "exceljs";

const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
if (!dbName.endsWith("_test")) {
  throw new Error(`Refusing to run: DATABASE_URL must point at a disposable *_test database (got "${dbName || "unset"}").`);
}

const { prisma } = await import("@/lib/db/prisma");
const svc = await import("@/lib/backend/store/material-master");
const data = await import("@/lib/store/offline-inventory-data");
const { completeMapping } = await import("@/lib/store/material-master-import");

type Ctx = Parameters<typeof svc.previewMaterialMasterImport>[0];
const RUN = `${Date.now()}`.slice(-6);
const AUTO = { sheetName: null, hasHeaderRow: null, mapping: null };
const code = (n: string) => `FX${RUN}${n}`;
const name = (n: string) => `FX ${RUN} ${n}`;

async function contextFor(slug: string): Promise<Ctx> {
  const profile = await prisma.profiles.findFirst({ where: { is_active: true, roles: { slug } }, include: { roles: true } });
  assert.ok(profile, `an active ${slug} profile is required`);
  return {
    userId: profile.id,
    profile: { id: profile.id, full_name: profile.full_name, can_view_costs: true },
    role: profile.roles ? { id: profile.roles.id, name: profile.roles.name, slug: profile.roles.slug } : null,
    permissions: [],
  } as unknown as Ctx;
}

async function xlsx(rows: (string | number)[][]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const r of rows) ws.addRow(r);
  return new File([await wb.xlsx.writeBuffer()], "x.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const validRows = (p: { rows: { status: string; rowNumber: number }[] }) => p.rows.filter((r) => r.status === "valid").map((r) => r.rowNumber);
const item = async (itemCode: string) => (await data.getOfflineInventoryBalance()).balanceItems.find((b) => b.item_code === itemCode);

let admin: Ctx;
let dataEntry: Ctx;
let existingBefore: string;

describe("Flexible Excel import (disposable DB)", () => {
  before(async () => {
    admin = await contextFor("super_admin");
    dataEntry = await contextFor("maintenance_data_entry");
    existingBefore = JSON.stringify(await prisma.offline_inventory_movements.findMany({ orderBy: { id: "asc" } }));
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("1. four-column layout with headers needs no confirmation", async () => {
    const p = await svc.previewMaterialMasterImport(admin, await xlsx([["sl no ", "item code ", "material ", "unit "], [1, code("A1"), name("four"), "Nos"]]), AUTO);
    assert.deepEqual(p.mapping, completeMapping({ serial: 1, itemCode: 2, description: 3, unit: 4 }));
    assert.deepEqual(p.needsConfirmation, []);
    assert.equal(p.summary.valid, 1);
  });

  it("2/15/22. the new five-column layout: Category read, existing one matched by case and spacing", async () => {
    const file = await xlsx([
      ["Serial Number", "Item Code", "Category", "Material Description", "Unit"],
      [1, code("B1"), "  electrical   MATERIALS ", name("five a"), "Nos"],
      [2, code("B2"), "Safety Materials", name("five b"), "Set"],
    ]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    assert.deepEqual(p.mapping, completeMapping({ serial: 1, itemCode: 2, category: 3, description: 4, unit: 5 }));
    assert.deepEqual(p.categoryReview, []);
    assert.equal(p.rows[0].resolvedCategory, "Electrical Materials");
    const r = await svc.confirmMaterialMasterImport(admin, file, AUTO, validRows(p), crypto.randomUUID());
    assert.equal(r.imported, 2);
    const b = await item(code("B1"));
    assert.deepEqual([b?.category, b?.balance, b?.stock_value, b?.unit], ["Electrical Materials", 0, 0, "Nos"]);
    const rows = await prisma.offline_inventory_movements.findMany({ where: { reference_number: r.batchReference } });
    assert.ok(rows.every((m) => m.movement_type === "OPENING_STOCK" && Number(m.quantity) === 0 && m.unit_cost === null));
  });

  it("3/6/7. any column order; extra columns reported and ignored; optional columns may be absent", async () => {
    const p = await svc.previewMaterialMasterImport(
      admin,
      await xlsx([["Remarks Internal", "UOM", "Warehouse Owner", "SKU", "Item Description"], ["skip", "Nos", "Ali", code("C1"), name("order")]]),
      AUTO
    );
    assert.deepEqual(p.mapping, completeMapping({ unit: 2, itemCode: 4, description: 5 }));
    assert.deepEqual(p.unmappedColumns.map((c) => c.letter), ["A", "C"]);
    assert.equal(p.rows[0].status, "valid");
    assert.equal(p.rows[0].categoryState, null, "no Category column: nothing to review");
  });

  it("a title above the header is skipped", async () => {
    const p = await svc.previewMaterialMasterImport(admin, await xlsx([["RECAFCO MATERIAL LIST 2026"], ["Item Code", "Material", "Unit"], [code("C2"), name("title"), "Nos"]]), AUTO);
    assert.equal(p.hasHeaderRow, true);
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0].itemCode, code("C2"));
  });

  it("4. headerless: standard shape is suggested; any other shape needs a person, even if forced through", async () => {
    const standard = await svc.previewMaterialMasterImport(admin, await xlsx([[1, code("D1"), name("plain"), "Nos"]]), AUTO);
    assert.deepEqual(standard.needsConfirmation, []);

    const fiveColumns = await xlsx([[1, code("D2"), "Filters", name("no header"), "Nos"]]);
    const p = await svc.previewMaterialMasterImport(admin, fiveColumns, AUTO);
    assert.equal(p.needsConfirmation.length, 1);
    await assert.rejects(svc.confirmMaterialMasterImport(admin, fiveColumns, AUTO, [1], crypto.randomUUID()), /Confirm the column mapping/);

    const mapping = completeMapping({ serial: 1, itemCode: 2, category: 3, description: 4, unit: 5 });
    const fixed = await svc.previewMaterialMasterImport(admin, fiveColumns, { sheetName: null, hasHeaderRow: false, mapping, categoryResolutions: { filters: { action: "create" } } });
    assert.deepEqual(fixed.needsConfirmation, []);
    assert.equal(fixed.rows[0].status, "valid");
    assert.equal(fixed.rows[0].resolvedCategory, "Filters");
  });

  it("8. a required column missing from the headers is never guessed", async () => {
    const file = await xlsx([["Item Code", "Description", "Qty on hand"], [code("E1"), name("no unit col"), 5]]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    assert.equal(p.mapping.unit, null, "the old fallback to column D is gone");
    assert.match(p.needsConfirmation[0], /No Unit column/);
    assert.equal(p.rows[0].status, "missing_unit");
    await assert.rejects(svc.confirmMaterialMasterImport(admin, file, AUTO, [1], crypto.randomUUID()), /Choose a column/);
  });

  it("9/10. ambiguous detection needs confirmation; a manual correction settles it", async () => {
    const file = await xlsx([["Item Code", "Description", "Item Description", "Unit"], [code("F1"), "short", name("real text"), "Nos"]]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    assert.match(p.needsConfirmation[0], /Material Description/);
    await assert.rejects(svc.confirmMaterialMasterImport(admin, file, AUTO, [1], crypto.randomUUID()), /Confirm the column mapping/);
    const fixed = await svc.previewMaterialMasterImport(admin, file, { ...AUTO, mapping: { ...p.mapping, description: 3 } });
    assert.deepEqual(fixed.needsConfirmation, []);
    assert.equal(fixed.rows[0].description, name("real text"));
  });

  it("11. one source column cannot feed two fields, optional ones included", async () => {
    const file = await xlsx([["Item Code", "Material", "Unit", "Category"], [code("G1"), name("twice"), "Nos", "Other"]]);
    const mapping = completeMapping({ itemCode: 1, description: 2, unit: 3, category: 2 });
    await assert.rejects(svc.previewMaterialMasterImport(admin, file, { ...AUTO, mapping }), /cannot use the same column/);
    await assert.rejects(svc.confirmMaterialMasterImport(admin, file, { ...AUTO, mapping }, [1], crypto.randomUUID()), /cannot use the same column/);
  });

  it("12/13/17/18/19. row problems are counted separately and nothing bad is imported", async () => {
    const file = await xlsx([
      ["Item Code", "Material", "Unit", "Minimum Stock", "Reorder Quantity"],
      [code("B1"), name("existing code"), "Nos", "", ""],
      [code("H1"), name("dup a"), "Nos", "", ""],
      [code("H1"), name("dup b"), "Nos", "", ""],
      ["", name("no code"), "Nos", "", ""],
      [code("H2"), "", "Nos", "", ""],
      [code("H3"), name("no unit"), "", "", ""],
      [code("H4"), name("bad unit"), "<x>", "", ""],
      [code("H5"), name("bad min"), "Nos", "lots", ""],
      [code("H6"), name("neg min"), "Nos", -1, ""],
      [code("H7"), name("bad reorder"), "Nos", "", 0],
      [code("H8"), name("good"), "Nos", 2, 5],
    ]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    assert.deepEqual(p.summary, { totalRows: 11, valid: 1, existing: 1, duplicates: 2, invalid: 6, invalidUnits: 1 });
    assert.deepEqual(p.breakdown, { missingCodes: 1, missingDescriptions: 1, missingUnits: 1, invalidValues: 3, unknownCategories: 0, rowsRequiringReview: 9 });
    const r = await svc.confirmMaterialMasterImport(admin, file, AUTO, p.rows.map((row) => row.rowNumber), crypto.randomUUID());
    assert.equal(r.imported, 1);
    assert.equal(r.skippedRows.length, 10);
    const b = await item(code("H8"));
    assert.deepEqual([b?.minimum_stock_quantity, b?.reorder_quantity], [2, 5]);
  });

  it("14. an unknown category is held for a decision, never turned into Other", async () => {
    const CRANE = `Crane Spares ${RUN}`;
    const CRANE_LOUD = `CRANE  SPARES ${RUN}`;
    const HOSES = `Hoses ${RUN}`;
    const settingsBefore = await prisma.inventory_material_settings.count();
    const file = await xlsx([
      ["Item Code", "Category", "Material", "Unit"],
      [code("J1"), CRANE, name("cat a"), "Nos"],
      [code("J2"), CRANE_LOUD, name("cat b"), "Nos"],
      [code("J3"), HOSES, name("cat c"), "Nos"],
      [code("J4"), "", name("cat d"), "Nos"],
      [code("J5"), "Other", name("cat e"), "Nos"],
    ]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    assert.equal(p.breakdown.unknownCategories, 4);
    assert.deepEqual(p.categoryReview.map((c) => [c.value, c.rows]), [["", 1], [CRANE, 2], [HOSES, 1]]);
    assert.equal(p.rows.filter((r) => r.status === "valid").length, 1);

    const held = await svc.confirmMaterialMasterImport(admin, file, AUTO, p.rows.map((r) => r.rowNumber), crypto.randomUUID());
    assert.equal(held.imported, 1, "only the row with a known category");
    assert.equal(await prisma.inventory_material_settings.count(), settingsBefore + 1);

    const options = {
      ...AUTO,
      categoryResolutions: {
        [CRANE.toLowerCase()]: { action: "create" as const },
        [HOSES.toLowerCase()]: { action: "map" as const, category: "Mechanical Materials" },
        "": { action: "map" as const, category: "Other" },
      },
    };
    const decided = await svc.previewMaterialMasterImport(admin, file, options);
    assert.deepEqual(decided.rows.map((r) => [r.status, r.resolvedCategory]).slice(0, 4), [["valid", CRANE], ["valid", CRANE], ["valid", "Mechanical Materials"], ["valid", "Other"]]);
    assert.equal(decided.breakdown.unknownCategories, 0);
    const r = await svc.confirmMaterialMasterImport(admin, file, options, validRows(decided), crypto.randomUUID());
    assert.equal(r.imported, 4);
    assert.equal((await item(code("J2")))?.category, CRANE, "spelling variants became one category");

    const next = await svc.previewMaterialMasterImport(admin, await xlsx([["Item Code", "Category", "Material", "Unit"], [code("J6"), CRANE.toLowerCase(), name("cat f"), "Nos"]]), AUTO);
    assert.equal(next.rows[0].resolvedCategory, CRANE, "a created category is an existing one from now on");
  });

  it("14. a decision cannot point at a category that does not exist", async () => {
    const file = await xlsx([["Item Code", "Category", "Material", "Unit"], [code("K1"), "Nowhere", name("bad map"), "Nos"]]);
    const p = await svc.previewMaterialMasterImport(admin, file, { ...AUTO, categoryResolutions: { nowhere: { action: "map", category: "Made Up" } } });
    assert.equal(p.rows[0].status, "unknown_category");
  });

  it("16/26/27. every optional field is saved, custom unit kept, and survives editing and a later receipt", async () => {
    const file = await xlsx([
      ["Part No", "Bin", "Item Code", "Material Name", "Unit of Measure", "Group", "SS Rec. Code", "Min Stock", "Reorder Qty", "Notes"],
      [`PN-${RUN}`, "Rack 3", code("L1"), name("full"), "Set of 4", "Safety Materials", "SS-9", 2.5, 10, "Keep dry"],
    ]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    assert.deepEqual(p.needsConfirmation, []);
    assert.deepEqual(p.unmappedColumns, []);
    await svc.confirmMaterialMasterImport(admin, file, AUTO, validRows(p), crypto.randomUUID());
    const b = (await item(code("L1")))!;
    assert.deepEqual(
      [b.part_number, b.location, b.unit, b.category, b.ss_rec_code, b.minimum_stock_quantity, b.reorder_quantity, b.notes],
      [`PN-${RUN}`, "Rack 3", "Set of 4", "Safety Materials", "SS-9", 2.5, 10, "Keep dry"]
    );

    const found = await data.searchOfflineInventoryMaterials({ query: `PN-${RUN}`, limit: 5 });
    assert.equal(found[0]?.item_code, code("L1"));

    const form = await svc.getMaterialForEdit(dataEntry, b.key);
    assert.deepEqual([form.values.partNumber, form.values.location, form.values.notes, form.values.minimumStock], [`PN-${RUN}`, "Rack 3", "Keep dry", "2.5"]);
    await svc.saveMaterialEdit(dataEntry, { key: form.key, version: form.version, values: { ...form.values, location: "Rack 4" } });

    await prisma.offline_inventory_movements.create({
      data: { movement_type: "RECEIVED", movement_date: new Date(), manual_material_name: b.manual_material_name, unit: b.unit, category: "Other", quantity: 6, created_by: admin.userId },
    });
    const after = (await item(code("L1")))!;
    assert.deepEqual([after.balance, after.category, after.part_number, after.location], [6, "Safety Materials", `PN-${RUN}`, "Rack 4"]);
  });

  it("20. retry and reimport create nothing new", async () => {
    const file = await xlsx([["Item Code", "Material", "Unit"], [code("M1"), name("retry"), "Nos"]]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    const id = crypto.randomUUID();
    assert.equal((await svc.confirmMaterialMasterImport(admin, file, AUTO, validRows(p), id)).imported, 1);
    assert.equal((await svc.confirmMaterialMasterImport(admin, file, AUTO, validRows(p), id)).alreadyImported, true);
    assert.equal((await svc.confirmMaterialMasterImport(admin, file, AUTO, [2], crypto.randomUUID())).imported, 0);
    assert.equal(await prisma.inventory_material_settings.count({ where: { item_code: code("M1") } }), 1);
  });

  it("21. concurrent imports of one file register each material once", async () => {
    const file = await xlsx([["Item Code", "Category", "Material", "Unit"], [code("N1"), "Other", name("conc 1"), "Nos"], [code("N2"), "Other", name("conc 2"), "Nos"]]);
    const [a, b] = await Promise.all([
      svc.confirmMaterialMasterImport(admin, file, AUTO, [2, 3], crypto.randomUUID()),
      svc.confirmMaterialMasterImport(admin, file, AUTO, [2, 3], crypto.randomUUID()),
    ]);
    assert.equal(a.imported + b.imported, 2);
  });

  it("28/29. only Super Admin can preview or import", async () => {
    const file = await xlsx([["Item Code", "Material", "Unit"], [code("P1"), name("nope"), "Nos"]]);
    await assert.rejects(svc.previewMaterialMasterImport(dataEntry, file, AUTO), /System Administrator/);
    await assert.rejects(svc.confirmMaterialMasterImport(dataEntry, file, AUTO, [2], crypto.randomUUID()), /System Administrator/);
    assert.equal(await prisma.inventory_material_settings.count({ where: { item_code: code("P1") } }), 0);
  });

  it("30. the largest workbook (5,000 rows, all optional columns) is previewed and imported in time", async () => {
    const rows: (string | number)[][] = [["Item Code", "Category", "Material", "Unit", "Part No", "Bin", "Notes", "Min Stock"]];
    for (let i = 1; i <= 5000; i++) rows.push([code(`Z${i}`), "Other", name(`bulk ${i}`), i % 2 ? "Nos" : "Packet", `P${i}`, `B${i % 40}`, "n", 1]);
    const file = await xlsx(rows);
    let t = Date.now();
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    const previewMs = Date.now() - t;
    assert.equal(p.summary.valid, 5000);
    t = Date.now();
    const r = await svc.confirmMaterialMasterImport(admin, file, AUTO, validRows(p), crypto.randomUUID());
    console.log(`[perf] preview ${previewMs} ms, import ${Date.now() - t} ms`);
    assert.equal(r.imported, 5000);
    assert.ok(Date.now() - t < 15000, "inside the 15 second transaction limit");
  });

  it("22/23. every movement that existed before this suite is untouched", async () => {
    const before = JSON.parse(existingBefore) as { id: string }[];
    const now = await prisma.offline_inventory_movements.findMany({ where: { id: { in: before.map((m) => m.id) } }, orderBy: { id: "asc" } });
    assert.equal(JSON.stringify(now), existingBefore);
  });
});
