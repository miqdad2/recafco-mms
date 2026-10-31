// Material Master import: custom units from Excel, against a REAL, DISPOSABLE
// PostgreSQL database. Refuses to run unless DATABASE_URL names a database
// ending in "_test".
//
//   DATABASE_URL=postgresql://.../some_test npm run test:integration
//
// Optional: LIST_XLSX=<path> also runs a real workbook through preview and
// import. It expects the file's materials not to exist yet.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

type Ctx = Parameters<typeof svc.previewMaterialMasterImport>[0];
const RUN = `${Date.now()}`.slice(-6);
const AUTO = { sheetName: null, hasHeaderRow: null, mapping: null };

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
  return new File([await wb.xlsx.writeBuffer()], "units.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const code = (n: string) => `CU${RUN}${n}`;
const name = (n: string) => `CU ${RUN} ${n}`;

describe("Custom units in the Material Master import (disposable DB)", () => {
  let admin: Ctx;
  let dataEntry: Ctx;
  let existingBefore: { id: string; unit: string; quantity: unknown; deleted_at: Date | null }[];

  before(async () => {
    admin = await contextFor("super_admin");
    dataEntry = await contextFor("maintenance_data_entry");
    existingBefore = await prisma.offline_inventory_movements.findMany({ select: { id: true, unit: true, quantity: true, deleted_at: true }, orderBy: { id: "asc" } });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("1-7. preview accepts valid units as written and reports only bad ones", async () => {
    const file = await xlsx([
      [1, code("01"), name("standard"), "PCS"],
      [2, code("02"), name("nos"), "Nos"],
      [3, code("03"), name("packet"), "Packet"],
      [4, code("04"), name("spaced"), "Set of 4"],
      [5, code("05"), name("mixed"), "mL/Bottle"],
      [6, code("06"), name("padded"), "  Bundle  "],
      [7, code("07"), name("too long"), "x".repeat(33)],
      [8, code("08"), name("empty"), ""],
      [9, code("09"), name("pipe"), "Nos|Set"],
      [10, code("10"), name("markup"), "<script>"],
      [11, code("11"), name("placeholder"), "-"],
      [12, code("12"), name("formula"), "=1+1"],
    ]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    const byRow = new Map(p.rows.map((r) => [r.rowNumber, r]));
    assert.deepEqual([1, 2, 3, 4, 5, 6].map((n) => byRow.get(n)?.normalizedUnit), ["PCS", "Nos", "Packet", "Set of 4", "mL/Bottle", "Bundle"]);
    for (const n of [1, 2, 3, 4, 5, 6]) assert.equal(byRow.get(n)?.status, "valid");
    assert.equal(byRow.get(7)?.status, "invalid_unit");
    assert.match(byRow.get(7)?.message ?? "", /too long/);
    assert.equal(byRow.get(8)?.status, "missing_unit");
    for (const n of [9, 10, 11, 12]) assert.equal(byRow.get(n)?.status, "invalid_unit");
    assert.deepEqual(p.summary, { totalRows: 12, valid: 6, existing: 0, duplicates: 0, invalid: 1, invalidUnits: 5 });
  });

  it("8/10/18. import saves the exact unit with zero stock and no conversion; reimport adds nothing", async () => {
    const file = await xlsx([
      [1, code("20"), name("imp packet"), "Packet"],
      [2, code("21"), name("imp spaced"), "Set of 4"],
      [3, code("22"), name("imp case"), "nOs"],
    ]);
    const before = await prisma.offline_inventory_movements.count();
    const r = await svc.confirmMaterialMasterImport(admin, file, AUTO, [1, 2, 3], crypto.randomUUID());
    assert.equal(r.imported, 3);
    assert.equal((await prisma.offline_inventory_movements.count()) - before, 3);

    const rows = await prisma.offline_inventory_movements.findMany({ where: { reference_number: r.batchReference } });
    assert.deepEqual(rows.map((m) => m.unit).sort(), ["Packet", "Set of 4", "nOs"]);
    for (const m of rows) {
      assert.equal(m.movement_type, "OPENING_STOCK");
      assert.equal(Number(m.quantity), 0);
      assert.equal(m.unit_cost, null);
      assert.equal(m.category, "Other");
    }
    const settings = await prisma.inventory_material_settings.findMany({ where: { item_code: { in: [code("20"), code("21"), code("22")] } } });
    assert.equal(settings.length, 3);
    for (const s of settings) {
      assert.equal(s.purchase_unit, null, "no conversion invented");
      assert.equal(s.conversion_quantity, null);
    }

    const { balanceItems } = await data.getOfflineInventoryBalance();
    const packet = balanceItems.find((b) => b.item_code === code("20"));
    assert.ok(packet);
    assert.equal(packet.unit, "Packet");
    assert.equal(packet.balance, 0);
    assert.equal(packet.stock_value, 0);

    const found = await data.searchOfflineInventoryMaterials({ query: code("21"), limit: 5 });
    assert.equal(found[0]?.unit, "Set of 4", "14. Job Card / request search returns the exact unit");

    const count = await prisma.offline_inventory_movements.count();
    const again = await svc.confirmMaterialMasterImport(admin, file, AUTO, [1, 2, 3], crypto.randomUUID());
    assert.equal(again.imported, 0);
    assert.equal(again.summary.existing, 3);
    assert.equal(await prisma.offline_inventory_movements.count(), count);
  });

  it("9. duplicates: repeated codes, and one material under spelling variants of a unit", async () => {
    const file = await xlsx([
      [1, code("30"), name("dup a"), "Packet"],
      [2, code("30"), name("dup b"), "Bundle"],
      [3, code("31"), name("same"), "Nos"],
      [4, code("32"), name("SAME"), "nos."],
      [5, code("33"), name("imp packet"), "PACKET"],
    ]);
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    assert.deepEqual(p.rows.map((r) => r.status), ["duplicate_item_code", "duplicate_item_code", "duplicate_material", "duplicate_material", "existing_material"]);
  });

  it("11. editing an imported material keeps its unit", async () => {
    const item = (await data.getOfflineInventoryBalance()).balanceItems.find((b) => b.item_code === code("21"));
    assert.ok(item);
    await svc.setMaterialItemCode(admin, item.key, code("21B"));
    const after = (await data.getOfflineInventoryBalance()).balanceItems.find((b) => b.item_code === code("21B"));
    assert.equal(after?.unit, "Set of 4");
    assert.equal(after?.key, item.key);
    await svc.setMaterialItemCode(admin, item.key, code("21"));
  });

  it("removal still works for a custom-unit material, including a unit with spaces", async () => {
    const item = (await data.getOfflineInventoryBalance()).balanceItems.find((b) => b.item_code === code("21"));
    assert.ok(item);
    const [p] = await svc.previewMaterialRemoval(admin, [item.key]);
    assert.equal(p.outcome, "delete");
    const [r] = await svc.executeMaterialRemoval(admin, [{ key: item.key, expectedOutcome: "delete" }], null);
    assert.equal(r.status, "deleted");
  });

  it("19. import stays Super Admin only", async () => {
    const file = await xlsx([[1, code("40"), name("blocked"), "Packet"]]);
    await assert.rejects(svc.previewMaterialMasterImport(dataEntry, file, AUTO), /System Administrator/);
    await assert.rejects(svc.confirmMaterialMasterImport(dataEntry, file, AUTO, [1], crypto.randomUUID()), /System Administrator/);
  });

  it("17/20. rows that existed before this suite are untouched", async () => {
    const ids = existingBefore.map((m) => m.id);
    const now = await prisma.offline_inventory_movements.findMany({ where: { id: { in: ids } }, select: { id: true, unit: true, quantity: true, deleted_at: true }, orderBy: { id: "asc" } });
    assert.deepEqual(JSON.parse(JSON.stringify(now)), JSON.parse(JSON.stringify(existingBefore)));
  });

  const list = process.env.LIST_XLSX;
  it("LIST.xlsx: previously unsupported units are accepted, duplicates still found", { skip: !list }, async () => {
    const bytes = readFileSync(list as string);
    const file = new File([bytes], "LIST.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const p = await svc.previewMaterialMasterImport(admin, file, AUTO);
    const counts = new Map<string, number>();
    for (const r of p.rows) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    console.log("[LIST.xlsx] mapping", JSON.stringify(p.mapping), "summary", JSON.stringify(p.summary), "statuses", JSON.stringify([...counts]));
    const rejected = p.rows.filter((r) => r.status !== "valid");
    for (const r of rejected.slice(0, 60)) console.log(`[LIST.xlsx] row ${r.rowNumber} ${r.itemCode} ${r.unit} ${r.status}`);
    const was = ["Manual", "Litre", "GAL", "Sheet"];
    const formerly = p.rows.filter((r) => was.includes(r.unit));
    console.log("[LIST.xlsx] formerly unsupported", formerly.length, "valid now", formerly.filter((r) => r.status === "valid").length, JSON.stringify(formerly.filter((r) => r.status !== "valid").map((r) => [r.rowNumber, r.unit, r.status])));
    assert.ok(p.summary.totalRows > 0);
    assert.equal(p.summary.invalidUnits, 0);
    assert.equal(formerly.length, 18);

    const validRows = p.rows.filter((r) => r.status === "valid").map((r) => r.rowNumber);
    const r = await svc.confirmMaterialMasterImport(admin, file, AUTO, validRows, crypto.randomUUID());
    assert.equal(r.imported, validRows.length);
    const saved = await prisma.offline_inventory_movements.groupBy({ by: ["unit"], where: { reference_number: r.batchReference }, _count: { _all: true }, _sum: { quantity: true } });
    console.log("[LIST.xlsx] saved units", JSON.stringify(saved.map((s) => [s.unit, s._count._all])));
    assert.ok(saved.every((s) => Number(s._sum.quantity) === 0), "zero stock");

    const again = await svc.previewMaterialMasterImport(admin, file, AUTO);
    assert.equal(again.summary.valid, 0, "reimport finds nothing new");
  });
});
