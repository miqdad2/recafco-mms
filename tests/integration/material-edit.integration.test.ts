// Edit Material against a REAL, DISPOSABLE PostgreSQL database. Refuses to run
// unless DATABASE_URL names a database ending in "_test".
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

type Ctx = Parameters<typeof svc.previewMaterialMasterImport>[0];
const RUN = `${Date.now()}`.slice(-6);
const code = (n: string) => `ME${RUN}${n}`;
const label = (n: string) => `ME ${RUN} ${n}`;

async function contextFor(slug: string): Promise<Ctx> {
  const profile = await prisma.profiles.findFirst({ where: { is_active: true, roles: { slug } }, include: { roles: true } });
  assert.ok(profile, `an active ${slug} profile is required`);
  return {
    userId: profile.id,
    profile: { id: profile.id, full_name: profile.full_name, can_view_costs: slug === "super_admin" },
    role: profile.roles ? { id: profile.roles.id, name: profile.roles.name, slug: profile.roles.slug } : null,
    permissions: [],
  } as unknown as Ctx;
}

async function importMaterials(rows: [string, string, string][]) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  rows.forEach((r, i) => ws.addRow([i + 1, ...r]));
  const file = new File([await wb.xlsx.writeBuffer()], "m.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const r = await svc.confirmMaterialMasterImport(admin, file, { sheetName: null, hasHeaderRow: false, mapping: { serial: 1, itemCode: 2, description: 3, unit: 4 } }, rows.map((_, i) => i + 1), crypto.randomUUID());
  assert.equal(r.imported, rows.length);
}

const item = async (itemCode: string) => {
  const { balanceItems, archivedItems } = await data.getOfflineInventoryBalance();
  return [...balanceItems, ...archivedItems].find((b) => b.item_code === itemCode);
};

async function edit(ctx: Ctx, itemCode: string, change: Partial<Awaited<ReturnType<typeof svc.getMaterialForEdit>>["values"]>) {
  const b = await item(itemCode);
  assert.ok(b, `material ${itemCode}`);
  const form = await svc.getMaterialForEdit(ctx, b.key);
  return svc.saveMaterialEdit(ctx, { key: form.key, version: form.version, values: { ...form.values, ...change } });
}

const fieldErrorsOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return (e as { fieldErrors?: Record<string, string[]> }).fieldErrors ?? {};
  }
  throw new Error("expected the save to be refused");
};

async function addMovement(b: { manual_material_name: string | null; unit: string }, type: string, quantity: number, extra: object = {}) {
  await prisma.offline_inventory_movements.create({
    data: { movement_type: type, movement_date: new Date(), manual_material_name: b.manual_material_name, unit: b.unit, category: "Other", quantity, created_by: admin.userId, ...extra },
  });
}

const movementSnapshot = async (b: { manual_material_name: string | null; unit: string }) =>
  JSON.stringify(
    await prisma.offline_inventory_movements.findMany({
      where: { manual_material_name: b.manual_material_name, unit: b.unit },
      orderBy: { id: "asc" },
    })
  );

let admin: Ctx;
let dataEntry: Ctx;
let technician: Ctx;
let manager: Ctx;

describe("Edit Material (disposable DB)", () => {
  before(async () => {
    admin = await contextFor("super_admin");
    dataEntry = await contextFor("maintenance_data_entry");
    technician = await contextFor("technician");
    manager = await contextFor("maintenance_manager");
    await importMaterials([
      [code("A"), label("rename me"), "Nos"],
      [code("B"), label("master data"), "Packet"],
      [code("C"), label("with stock"), "Nos"],
      [code("D"), label("requested"), "Set"],
      [code("E"), label("archived"), "Nos"],
      [code("F"), label("taken name"), "Nos"],
      [code("G"), label("unit setup"), "Box"],
      [code("H"), label("race"), "Nos"],
    ]);
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("1/2/5/16. Super Admin renames a zero-stock material; identity stays whole", async () => {
    const before = await item(code("A"));
    assert.ok(before);
    const movementCount = await prisma.offline_inventory_movements.count();
    const r = await edit(admin, code("A"), { name: label("renamed") });
    assert.notEqual(r.key, before.key);
    const after = await item(code("A"));
    assert.equal(after?.display_name, label("renamed"));
    assert.equal(after?.key, r.key);
    assert.equal(after?.balance, 0);
    assert.equal(await prisma.offline_inventory_movements.count(), movementCount, "no movement added or removed");
    const rows = await prisma.offline_inventory_movements.findMany({ where: { manual_material_name: label("renamed") } });
    assert.deepEqual(rows.map((m) => [m.movement_type, Number(m.quantity)]), [["OPENING_STOCK", 0]]);
    assert.equal(await prisma.offline_inventory_movements.count({ where: { manual_material_name: before.manual_material_name, deleted_at: null } }), 0);
  });

  it("2/6/8-13. Data Entry edits every master field; values show in the list and in search", async () => {
    const r = await edit(dataEntry, code("B"), {
      itemCode: code("B2"),
      category: "Electrical Materials",
      partNumber: "PN-77",
      ssRecCode: "SS-77",
      location: "Rack 4",
      notes: "Fits Bobcat",
      minimumStock: "2",
      reorderQuantity: "5",
    });
    assert.equal(r.changed.length, 8);
    const b = await item(code("B2"));
    assert.deepEqual(
      [b?.category, b?.part_number, b?.ss_rec_code, b?.location, b?.notes, b?.minimum_stock_quantity, b?.reorder_quantity, b?.unit],
      ["Electrical Materials", "PN-77", "SS-77", "Rack 4", "Fits Bobcat", 2, 5, "Packet"]
    );
    const found = await data.searchOfflineInventoryMaterials({ query: "PN-77", limit: 5 });
    assert.equal(found[0]?.item_code, code("B2"));
    assert.deepEqual([found[0]?.location, found[0]?.category, found[0]?.ss_rec_code], ["Rack 4", "Electrical Materials", "SS-77"]);

    await edit(dataEntry, code("B2"), { partNumber: "", location: "", notes: "", minimumStock: "" });
    const cleared = await item(code("B2"));
    assert.deepEqual([cleared?.part_number, cleared?.location, cleared?.notes, cleared?.minimum_stock_quantity], [null, null, null, null]);
    await edit(admin, code("B2"), { itemCode: code("B") });
  });

  it("3/4. other roles are refused at the backend", async () => {
    const b = await item(code("B"));
    assert.ok(b);
    const form = await svc.getMaterialForEdit(admin, b.key);
    for (const ctx of [technician, manager]) {
      await assert.rejects(svc.getMaterialForEdit(ctx, b.key), /permission/);
      await assert.rejects(svc.saveMaterialEdit(ctx, { key: form.key, version: form.version, values: { ...form.values, notes: "hack" } }), /permission/);
    }
    assert.equal((await item(code("B")))?.notes, null);
  });

  it("7. a duplicate Item Code is refused beside the field", async () => {
    const errors = await fieldErrorsOf(edit(dataEntry, code("B"), { itemCode: code("c").toLowerCase() }));
    assert.match(errors.itemCode?.[0] ?? "", /already used/);
  });

  it("identity: never merges into an existing material, even by spelling variants", async () => {
    const same = await fieldErrorsOf(edit(admin, code("A"), { name: label("taken name") }));
    assert.match(same.name?.[0] ?? "", /already exists/);
    const variant = await fieldErrorsOf(edit(admin, code("A"), { name: label("TAKEN  NAME"), unit: "nos." }));
    assert.match(variant.name?.[0] ?? "", /already exists/);
    const archivedRows = await prisma.offline_inventory_movements.count({ where: { manual_material_name: label("taken name"), deleted_at: null } });
    assert.equal(archivedRows, 1);
    assert.equal((await item(code("A")))?.display_name, label("renamed"), "failed save changed nothing");
  });

  it("14. a custom unit can be set on a clean material, exactly as typed, with no conversion", async () => {
    const r = await edit(admin, code("A"), { unit: "Set of 4" });
    const b = await item(code("A"));
    assert.equal(b?.unit, "Set of 4");
    assert.equal(b?.key, r.key);
    assert.deepEqual([b?.purchase_unit, b?.conversion_quantity], [null, null]);
    assert.equal(b?.balance, 0);
  });

  it("15/17/18/21/22/23. with stock: name and unit are refused; other edits leave stock, value and history alone", async () => {
    const b = (await item(code("C")))!;
    await addMovement(b, "RECEIVED", 12, { unit_cost: 2.5, total_cost: 30 });
    await addMovement(b, "ISSUED", 2);
    const snapshot = await movementSnapshot(b);
    const stocked = (await item(code("C")))!;
    assert.deepEqual([stocked.balance, stocked.stock_value], [10, 25]);

    const form = await svc.getMaterialForEdit(dataEntry, b.key);
    assert.ok(form.nameLockedReason);
    assert.ok(form.unitLockedReason);
    assert.match((await fieldErrorsOf(edit(dataEntry, code("C"), { unit: "PCS" }))).unit?.[0] ?? "", /locked/);
    assert.match((await fieldErrorsOf(edit(dataEntry, code("C"), { name: label("new") }))).name?.[0] ?? "", /locked/);
    await fieldErrorsOf(edit(dataEntry, code("C"), { name: label("new"), location: "Should not save" }));
    assert.equal((await item(code("C")))?.location, null, "a refused save writes nothing");

    await edit(dataEntry, code("C"), { category: "Safety Materials", partNumber: "PN-C", location: "Bin 9", minimumStock: "3" });
    const after = (await item(code("C")))!;
    assert.deepEqual([after.balance, after.stock_value, after.last_unit_cost, after.total_received, after.total_issued], [10, 25, 2.5, 12, 2]);
    assert.equal(after.category, "Safety Materials");
    assert.equal(await movementSnapshot(b), snapshot, "movement rows byte-identical");
  });

  it("24. receiving and issuing after an edit stay on the same material", async () => {
    const b = (await item(code("C")))!;
    await addMovement(b, "RECEIVED", 5);
    await addMovement(b, "ISSUED", 1);
    const after = (await item(code("C")))!;
    assert.equal(after.balance, 14);
    assert.equal(after.category, "Safety Materials", "the edited value survives a new movement");
    assert.equal(after.part_number, "PN-C");
  });

  it("20. a material on a request cannot change identity; the request is untouched", async () => {
    const b = (await item(code("D")))!;
    const request = await prisma.general_inventory_requests.create({
      data: { request_number: `ME/${RUN}`, purpose: "test", status: "Pending", requested_by_id: admin.userId, requested_by_name: "t" },
    });
    const requestLine = await prisma.general_inventory_request_items.create({
      data: { request_id: request.id, material_name: b.display_name, quantity_requested: 1, unit: b.unit, inventory_material_key: b.key },
    });
    const form = await svc.getMaterialForEdit(dataEntry, b.key);
    assert.match(form.nameLockedReason ?? "", /Job Card or Materials Request/);
    assert.ok((await fieldErrorsOf(edit(dataEntry, code("D"), { name: label("other") }))).name);
    await edit(dataEntry, code("D"), { location: "Shelf 1" });
    const line = await prisma.general_inventory_request_items.findUnique({ where: { id: requestLine.id } });
    assert.equal(line?.inventory_material_key, b.key);
    assert.equal(line?.material_name, b.display_name);
  });

  it("15. a purchase-unit setup blocks a unit change but not a rename", async () => {
    const b = (await item(code("G")))!;
    await data.upsertInventoryMaterialSettings({ partId: null, manualMaterialName: b.manual_material_name, unit: b.unit, purchaseUnit: "Carton", conversionQuantity: 6, createdBy: admin.userId });
    const form = await svc.getMaterialForEdit(admin, b.key);
    assert.equal(form.nameLockedReason, null);
    assert.ok(form.unitLockedReason);
    assert.ok((await fieldErrorsOf(edit(admin, code("G"), { unit: "Crate" }))).unit);
    await edit(admin, code("G"), { name: label("unit setup renamed") });
    const after = await item(code("G"));
    assert.deepEqual([after?.purchase_unit, after?.conversion_quantity, after?.unit], ["Carton", 6, "Box"]);
  });

  it("26. archived materials are refused and stay archived", async () => {
    const b = (await item(code("E")))!;
    await addMovement(b, "RECEIVED", 1);
    await addMovement(b, "ISSUED", 1);
    const [r] = await svc.executeMaterialRemoval(admin, [{ key: b.key, expectedOutcome: "archive" }], null);
    assert.equal(r.status, "archived");
    await assert.rejects(svc.getMaterialForEdit(admin, b.key), /archived/);
    const { archivedItems } = await data.getOfflineInventoryBalance();
    assert.ok(archivedItems.some((a) => a.key === b.key));
  });

  it("28/29. two people saving the same form: one wins, the other is told, nothing is lost", async () => {
    const b = (await item(code("H")))!;
    const one = await svc.getMaterialForEdit(admin, b.key);
    const two = await svc.getMaterialForEdit(dataEntry, b.key);
    const results = await Promise.allSettled([
      svc.saveMaterialEdit(admin, { key: one.key, version: one.version, values: { ...one.values, location: "Admin" } }),
      svc.saveMaterialEdit(dataEntry, { key: two.key, version: two.version, values: { ...two.values, location: "Entry" } }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), ["fulfilled", "rejected"]);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.match(refused.reason.message, /Someone else changed/);
    const winner = results.findIndex((r) => r.status === "fulfilled") === 0 ? "Admin" : "Entry";
    assert.equal((await item(code("H")))?.location, winner);
  });

  it("no-change save writes nothing; audit records who, what, before and after", async () => {
    const before = await prisma.audit_logs.count({ where: { action: "offline_inventory.material_edited" } });
    assert.deepEqual((await edit(admin, code("H"), {})).changed, []);
    assert.equal(await prisma.audit_logs.count({ where: { action: "offline_inventory.material_edited" } }), before);

    await edit(dataEntry, code("F"), { notes: "checked", itemCode: code("F2") });
    const log = await prisma.audit_logs.findFirst({ where: { action: "offline_inventory.material_edited" }, orderBy: { created_at: "desc" } });
    assert.equal(log?.actor_id, dataEntry.userId);
    assert.ok(log?.created_at);
    const meta = log?.metadata as { materialKey: string; changes: Record<string, { from: string; to: string }> };
    assert.deepEqual(meta.changes, { itemCode: { from: code("F"), to: code("F2") }, notes: { from: "", to: "checked" } });
    assert.match(meta.materialKey, /taken name/);
  });

  it("30. no cost value reaches Data Entry through the form or the audit record", async () => {
    const b = (await item(code("C")))!;
    const text = JSON.stringify(await svc.getMaterialForEdit(dataEntry, b.key));
    assert.doesNotMatch(text, /cost|price|value":|stock_value|2\.5/i);
    const logs = await prisma.audit_logs.findMany({ where: { action: "offline_inventory.material_edited" }, select: { metadata: true } });
    assert.doesNotMatch(JSON.stringify(logs), /unit_cost|total_cost|stock_value/);
  });

  it("25. the import still treats edited materials as existing", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Sheet1").addRow([1, code("B"), "ME something else", "Nos"]);
    const file = new File([await wb.xlsx.writeBuffer()], "m.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const p = await svc.previewMaterialMasterImport(admin, file, { sheetName: null, hasHeaderRow: null, mapping: null });
    assert.equal(p.rows[0].status, "existing_item_code");
  });
});
