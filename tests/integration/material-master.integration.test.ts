// Inventory Control Item Code / Material Master import / Super Admin
// delete-archive-restore — integration tests against a REAL, DISPOSABLE
// PostgreSQL database. Refuses to run unless DATABASE_URL names a database
// ending in "_test", so it can never touch the dev or production database.
//
//   DATABASE_URL=postgresql://.../recafco_mm_item_code_test npm run test:integration
//
// The database must have every migration applied (prisma migrate deploy).
// Test materials are prefixed "ITST"/"IT " and left in place — the
// database is disposable. Existing materials are only read, never removed,
// except one zero-balance material that is archived and then restored.
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

async function contextFor(slug: string): Promise<Ctx> {
  const profile = await prisma.profiles.findFirst({
    where: { is_active: true, roles: { slug } },
    include: { roles: true },
  });
  assert.ok(profile, `an active ${slug} profile is required in the test database`);
  return {
    userId: profile.id,
    authUserId: profile.id,
    email: null,
    mustResetPassword: false,
    profile: {
      id: profile.id,
      full_name: profile.full_name,
      employee_number: null,
      phone: null,
      job_title: null,
      department_id: profile.department_id,
      role_id: profile.role_id,
      is_active: true,
      can_view_costs: true,
    },
    department: null,
    role: profile.roles ? { id: profile.roles.id, name: profile.roles.name, slug: profile.roles.slug } : null,
    permissions: [],
  } as unknown as Ctx;
}

async function xlsxFile(name: string, rows: (string | number | { v: number; fmt: string })[][], sheetName = "Sheet1"): Promise<File> {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Notes").addRow(["not this sheet"]);
  const ws = wb.addWorksheet(sheetName);
  for (const r of rows) {
    const row = ws.addRow(r.map((c) => (typeof c === "object" ? c.v : c)));
    r.forEach((c, i) => {
      if (typeof c === "object") row.getCell(i + 1).numFmt = c.fmt;
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new File([buf], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const uuid = () => crypto.randomUUID();

async function counts() {
  const [movements, settings, liveMovements] = await Promise.all([
    prisma.offline_inventory_movements.count(),
    prisma.inventory_material_settings.count(),
    prisma.offline_inventory_movements.count({ where: { deleted_at: null } }),
  ]);
  return { movements, settings, liveMovements };
}

let admin: Ctx;
let dataEntry: Ctx;
type Snap = Map<string, { balance: number; stock_value: number; stock_status: string; total_received: number; total_issued: number }>;
let before0: Snap;

async function snapshot(): Promise<Snap> {
  const { balanceItems } = await data.getOfflineInventoryBalance();
  return new Map(
    balanceItems.map((b) => [b.key, { balance: b.balance, stock_value: b.stock_value, stock_status: b.stock_status, total_received: b.total_received, total_issued: b.total_issued }])
  );
}

const HEADERLESS_ROWS = [
  [1, "ITST0001", "IT FILTER: HYDRAULIC FILTER PART NO.: 123-8189", "Nos"],
  [2, "ITST0002", "IT FILTER: HYDRAULIC OIL FILTER WITH O-RING (PART NO: P20923-01)", "Nos"],
  [3, "ITST0003", "IT GASKET", "SET"],
  [4, "ITST0004", "IT DUP CODE A", "Nos"],
  [5, "itst0004", "IT DUP CODE B", "Nos"],
  [6, "ITST0006", "IT BAD UNIT", "<Nos>"],
  [7, "", "IT NO CODE", "Nos"],
  [8, { v: 42, fmt: "000000" }, "IT NUMERIC CODE", "PCS"],
  [9, "ITST0009", "Filter 5", "PCS"],
  [10, "ITST0010", "IT DELETE ME 1", "PCS"],
  [11, "ITST0011", "IT DELETE ME 2", "PCS"],
  [12, "ITST0012", "IT CHANGES", "PCS"],
  [13, "ITST0013", "IT DOUBLE DELETE", "PCS"],
];

describe("Material Master import, Item Code and Super Admin removal (disposable DB)", () => {
  before(async () => {
    admin = await contextFor("super_admin");
    dataEntry = await contextFor("maintenance_data_entry");
    before0 = await snapshot();
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("11/12. headerless preview reads A–D, flags problems, writes nothing", async () => {
    const c0 = await counts();
    const file = await xlsxFile("master.xlsx", HEADERLESS_ROWS, "Maintenance");
    const p = await svc.previewMaterialMasterImport(admin, file, { sheetName: "Maintenance", hasHeaderRow: null, mapping: null });
    assert.equal(p.hasHeaderRow, false);
    assert.deepEqual(p.mapping, completeMapping({ serial: 1, itemCode: 2, description: 3, unit: 4 }));
    assert.deepEqual(p.sheetNames, ["Notes", "Maintenance"]);
    const byRow = new Map(p.rows.map((r) => [r.rowNumber, r]));
    assert.equal(byRow.get(1)?.status, "valid");
    assert.equal(byRow.get(1)?.normalizedUnit, "Nos");
    assert.equal(byRow.get(4)?.status, "duplicate_item_code");
    assert.equal(byRow.get(5)?.status, "duplicate_item_code");
    assert.equal(byRow.get(6)?.status, "invalid_unit");
    assert.equal(byRow.get(7)?.status, "missing_item_code");
    assert.equal(byRow.get(8)?.itemCode, "000042", "18. leading zeros kept from a 000000-formatted cell");
    assert.equal(byRow.get(9)?.status, "existing_material", "15. existing material detected");
    assert.deepEqual(p.summary, { totalRows: 13, valid: 8, existing: 1, duplicates: 2, invalid: 1, invalidUnits: 1 });
    assert.deepEqual(await counts(), c0, "preview wrote nothing");
  });

  it("13. header-based sheet with a different column order", async () => {
    const file = await xlsxFile("hdr.xlsx", [
      ["Unit", "Material Description", "Item Code"],
      ["Nos", "IT HEADER ITEM", "ITSTH001"],
    ]);
    const p = await svc.previewMaterialMasterImport(admin, file, { sheetName: "Sheet1", hasHeaderRow: null, mapping: null });
    assert.equal(p.hasHeaderRow, true);
    assert.deepEqual(p.mapping, completeMapping({ itemCode: 3, description: 2, unit: 1 }));
    assert.equal(p.rows.length, 1);
    assert.equal(p.rows[0].status, "valid");
  });

  it("33. a non-Super-Admin cannot preview or import", async () => {
    const file = await xlsxFile("master.xlsx", HEADERLESS_ROWS);
    await assert.rejects(svc.previewMaterialMasterImport(dataEntry, file, { sheetName: null, hasHeaderRow: null, mapping: null }), /System Administrator/);
    await assert.rejects(
      svc.confirmMaterialMasterImport(dataEntry, file, { sheetName: null, hasHeaderRow: null, mapping: null }, [1], uuid()),
      /System Administrator/
    );
  });

  it("11/19/20/22. confirm imports only valid confirmed rows with zero stock; 16. repeats are idempotent", async () => {
    const file = await xlsxFile("master.xlsx", HEADERLESS_ROWS, "Maintenance");
    const opts = { sheetName: "Maintenance", hasHeaderRow: false, mapping: { serial: 1, itemCode: 2, description: 3, unit: 4 } };
    const p = await svc.previewMaterialMasterImport(admin, file, opts);
    // Confirm the valid rows plus an invalid one (row 6) — the server must ignore it.
    const confirmedRows = [...p.rows.filter((r) => r.status === "valid").map((r) => r.rowNumber), 6];
    const sub = uuid();
    const c0 = await counts();
    const r = await svc.confirmMaterialMasterImport(admin, file, opts, confirmedRows, sub);
    assert.equal(r.imported, 8);
    assert.equal(r.alreadyImported, false);
    assert.deepEqual(r.skippedRows.map((s) => s.rowNumber), [6]);
    const c1 = await counts();
    assert.equal(c1.movements - c0.movements, 8);
    assert.equal(c1.settings - c0.settings, 8);

    const movements = await prisma.offline_inventory_movements.findMany({ where: { reference_number: r.batchReference } });
    assert.equal(movements.length, 8);
    for (const m of movements) {
      assert.equal(m.movement_type, "OPENING_STOCK");
      assert.equal(Number(m.quantity), 0, "19. zero stock");
      assert.equal(m.unit_cost, null);
      assert.equal(m.related_work_order_id, null);
    }
    assert.equal(
      await prisma.offline_inventory_movements.count({ where: { reference_number: r.batchReference, NOT: { movement_type: "OPENING_STOCK" } } }),
      0,
      "20. no receiving / issuing movement"
    );
    const codes = await prisma.inventory_material_settings.findMany({ where: { item_code: { startsWith: "ITST" } }, select: { item_code: true } });
    assert.ok(codes.some((c) => c.item_code === "ITST0001"));
    assert.ok((await prisma.inventory_material_settings.count({ where: { item_code: "000042" } })) === 1, "18. 000042 stored exactly");

    const batch = await prisma.inventory_material_import_batches.findUnique({ where: { client_submission_id: sub } });
    assert.equal(batch?.imported_count, 8);
    assert.equal(batch?.created_by, admin.userId);

    const { balanceItems } = await data.getOfflineInventoryBalance();
    const imported = balanceItems.find((b) => b.item_code === "ITST0001");
    assert.ok(imported, "22. imported material appears in the Inventory Control list");
    assert.equal(imported.balance, 0);
    assert.equal(imported.unit, "Nos");
    assert.equal(imported.category, "Other");
    assert.equal(imported.stock_status, "out_of_stock");

    // Same submission again (double click / resubmit): first result, nothing new.
    const again = await svc.confirmMaterialMasterImport(admin, file, opts, confirmedRows, sub);
    assert.equal(again.alreadyImported, true);
    assert.equal(again.imported, 8);
    // Same file, new submission: every row is now an existing match.
    const reimport = await svc.confirmMaterialMasterImport(admin, file, opts, confirmedRows, uuid());
    assert.equal(reimport.imported, 0);
    assert.deepEqual(await counts(), { ...c1, movements: c1.movements, settings: c1.settings });
  });

  it("21. two concurrent imports of the same new rows import them once", async () => {
    const file = await xlsxFile("conc.xlsx", [
      ["Item Code", "Description", "Unit"],
      ["ITSTC001", "IT CONCURRENT 1", "PCS"],
      ["ITSTC002", "IT CONCURRENT 2", "SET"],
    ]);
    const opts = { sheetName: "Sheet1", hasHeaderRow: true, mapping: { serial: null, itemCode: 1, description: 2, unit: 3 } };
    const [a, b] = await Promise.all([
      svc.confirmMaterialMasterImport(admin, file, opts, [2, 3], uuid()),
      svc.confirmMaterialMasterImport(admin, file, opts, [2, 3], uuid()),
    ]);
    assert.equal(a.imported + b.imported, 2);
    assert.equal(await prisma.inventory_material_settings.count({ where: { item_code: { in: ["ITSTC001", "ITSTC002"] } } }), 2);
  });

  it("search finds a material by Item Code", async () => {
    const found = await data.searchOfflineInventoryMaterials({ query: "itst0003", limit: 10 });
    assert.equal(found.length, 1);
    assert.equal(found[0].item_code, "ITST0003");
    assert.equal(found[0].display_name, "IT GASKET");
  });

  it("Item Code edit: set, conflict refused, clear", async () => {
    const { balanceItems } = await data.getOfflineInventoryBalance();
    const headerItem = balanceItems.find((b) => b.item_code === "ITST0003")!;
    await assert.rejects(svc.setMaterialItemCode(admin, headerItem.key, "itst0001"), /already used/);
    await assert.rejects(svc.setMaterialItemCode(dataEntry, headerItem.key, "X"), /System Administrator/);
    await svc.setMaterialItemCode(admin, headerItem.key, "ITST0003-B");
    assert.equal((await prisma.inventory_material_settings.count({ where: { item_code: "ITST0003-B" } })), 1);
    await svc.setMaterialItemCode(admin, headerItem.key, "ITST0003");
  });

  it("23/24/25/26/31/32. bulk removal: delete unused, archive history, block stock — per-item, partial success", async () => {
    // Needs one active zero-balance material with history: bring an archived one back if none is active.
    const seeded = await data.getOfflineInventoryBalance();
    if (!seeded.balanceItems.some((b) => b.balance === 0 && b.total_received > 0 && !b.item_code) && seeded.archivedItems[0]) {
      await svc.restoreArchivedMaterial(admin, seeded.archivedItems[0].key);
    }
    const { balanceItems } = await data.getOfflineInventoryBalance();
    const del1 = balanceItems.find((b) => b.item_code === "ITST0010")!;
    const del2 = balanceItems.find((b) => b.item_code === "ITST0011")!;
    const withStock = balanceItems.find((b) => b.balance > 0 && !b.item_code?.startsWith("ITST"))!;
    const historyZero = balanceItems.find((b) => b.balance === 0 && b.total_received > 0 && !b.item_code)!;
    assert.ok(withStock && historyZero, "test database needs one stocked and one zero-balance material with history");

    const preview = await svc.previewMaterialRemoval(admin, [del1.key, del2.key, withStock.key, historyZero.key]);
    const outcome = new Map(preview.map((p) => [p.key, p.outcome]));
    assert.equal(outcome.get(del1.key), "delete");
    assert.equal(outcome.get(del2.key), "delete");
    assert.equal(outcome.get(withStock.key), "blocked", "25. stock-bearing material blocked");
    assert.equal(outcome.get(historyZero.key), "archive", "26/27. history → archive only");
    assert.equal(preview.find((p) => p.key === withStock.key)?.balance, withStock.balance);

    const c0 = await counts();
    const results = await svc.executeMaterialRemoval(
      admin,
      [
        { key: del1.key, expectedOutcome: "delete" },
        { key: del2.key, expectedOutcome: "delete" },
        // A tampered request asking to delete the stocked material is still refused.
        { key: withStock.key, expectedOutcome: "delete" },
        { key: historyZero.key, expectedOutcome: "archive" },
      ],
      "integration test"
    );
    const status = new Map(results.map((r) => [r.key, r.status]));
    assert.equal(status.get(del1.key), "deleted");
    assert.equal(status.get(del2.key), "deleted");
    assert.equal(status.get(withStock.key), "blocked");
    assert.equal(status.get(historyZero.key), "archived");

    const c1 = await counts();
    assert.equal(c1.movements, c0.movements, "nothing hard-deleted, no movement written");
    assert.equal(c0.liveMovements - c1.liveMovements, 2, "only the two registration rows soft-deleted");

    const after1 = await data.getOfflineInventoryBalance();
    assert.ok(!after1.balanceItems.some((b) => b.key === del1.key || b.key === historyZero.key));
    assert.ok(after1.archivedItems.some((b) => b.key === historyZero.key));
    assert.equal(after1.balanceItems.find((b) => b.key === withStock.key)?.balance, withStock.balance, "30. stock untouched");

    const audits = await prisma.audit_logs.count({ where: { action: { in: ["offline_inventory.material_deleted", "offline_inventory.material_archived"] }, actor_id: admin.userId } });
    assert.ok(audits >= 3);

    // 28. archived material is excluded from new selections.
    const name = historyZero.display_name;
    const search = await data.searchOfflineInventoryMaterials({ query: name, limit: 25 });
    assert.ok(!search.some((s) => s.key === historyZero.key), "archived material not offered for selection");

    // 29. restore brings it back with identity and history intact.
    const historyBefore = await prisma.offline_inventory_movements.count({ where: { manual_material_name: { equals: historyZero.manual_material_name ?? "", mode: "insensitive" }, unit: historyZero.unit, deleted_at: null } });
    await assert.rejects(svc.restoreArchivedMaterial(dataEntry, historyZero.key), /System Administrator/);
    await svc.restoreArchivedMaterial(admin, historyZero.key);
    const after2 = await data.getOfflineInventoryBalance();
    const restored = after2.balanceItems.find((b) => b.key === historyZero.key);
    assert.ok(restored);
    assert.equal(restored.total_received, historyZero.total_received);
    assert.equal(restored.total_issued, historyZero.total_issued);
    const historyAfter = await prisma.offline_inventory_movements.count({ where: { manual_material_name: { equals: historyZero.manual_material_name ?? "", mode: "insensitive" }, unit: historyZero.unit, deleted_at: null } });
    assert.equal(historyAfter, historyBefore);
    await assert.rejects(svc.restoreArchivedMaterial(admin, historyZero.key), /not archived/);
  });

  it("archived material that receives stock is never hidden", async () => {
    const { balanceItems } = await data.getOfflineInventoryBalance();
    const target = balanceItems.find((b) => b.item_code === "ITST0002")!;
    // Give it history first (receive + issue = 0), so it archives.
    const base = { movement_date: new Date(), part_id: null, manual_material_name: target.manual_material_name, unit: target.unit, category: "Other", created_by: admin.userId };
    await prisma.offline_inventory_movements.create({ data: { ...base, movement_type: "RECEIVED", quantity: 2 } });
    await prisma.offline_inventory_movements.create({ data: { ...base, movement_type: "ISSUED", quantity: 2 } });
    const [r] = await svc.executeMaterialRemoval(admin, [{ key: target.key, expectedOutcome: "archive" }], null);
    assert.equal(r.status, "archived");
    await prisma.offline_inventory_movements.create({ data: { ...base, movement_type: "RECEIVED", quantity: 3 } });
    const after = await data.getOfflineInventoryBalance();
    const visible = after.balanceItems.find((b) => b.key === target.key);
    assert.ok(visible, "archived material with stock stays in Inventory Control");
    assert.equal(visible.balance, 3);
    assert.equal(visible.unit_issue, data.ARCHIVED_WITH_STOCK_ISSUE);
  });

  it("changed since review → nothing done", async () => {
    const { balanceItems } = await data.getOfflineInventoryBalance();
    const target = balanceItems.find((b) => b.item_code === "ITST0012")!;
    const [p] = await svc.previewMaterialRemoval(admin, [target.key]);
    assert.equal(p.outcome, "delete");
    const base = { movement_date: new Date(), part_id: null, manual_material_name: target.manual_material_name, unit: target.unit, category: "Other", created_by: admin.userId };
    await prisma.offline_inventory_movements.create({ data: { ...base, movement_type: "RECEIVED", quantity: 1 } });
    await prisma.offline_inventory_movements.create({ data: { ...base, movement_type: "ISSUED", quantity: 1 } });
    const [r] = await svc.executeMaterialRemoval(admin, [{ key: target.key, expectedOutcome: "delete" }], null);
    assert.equal(r.status, "changed");
    assert.ok((await data.getOfflineInventoryBalance()).balanceItems.some((b) => b.key === target.key));
  });

  it("34. double click / concurrent delete of one material: one deleted, the other reports it", async () => {
    const { balanceItems } = await data.getOfflineInventoryBalance();
    const target = balanceItems.find((b) => b.item_code === "ITST0013")!;
    const req = [{ key: target.key, expectedOutcome: "delete" as const }];
    const [a, b] = await Promise.all([svc.executeMaterialRemoval(admin, req, null), svc.executeMaterialRemoval(admin, req, null)]);
    const statuses = [a[0].status, b[0].status].sort();
    assert.deepEqual(statuses, ["deleted", "not_found"]);
  });

  it("33. a non-Super-Admin cannot preview or execute removal; batch size is bounded", async () => {
    const { balanceItems } = await data.getOfflineInventoryBalance();
    await assert.rejects(svc.previewMaterialRemoval(dataEntry, [balanceItems[0].key]), /System Administrator/);
    await assert.rejects(svc.executeMaterialRemoval(dataEntry, [{ key: balanceItems[0].key, expectedOutcome: "delete" }], null), /System Administrator/);
    const tooMany = Array.from({ length: 101 }, (_, i) => `manual:x${i}|pcs`);
    await assert.rejects(svc.previewMaterialRemoval(admin, tooMany), /at most 100/);
  });

  it("1/2/3/8. every pre-existing material keeps its balance, stock value and status", async () => {
    const now = await snapshot();
    for (const [key, was] of before0) {
      const is = now.get(key);
      assert.ok(is, `pre-existing material ${key} still listed`);
      assert.deepEqual(is, was, `pre-existing material ${key} unchanged`);
    }
  });
});
