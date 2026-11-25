// Needs Verification workflow — integration tests against a REAL, DISPOSABLE
// copy of the 1,523-material database (DATABASE_URL must end in "_test").
//
//   DATABASE_URL=postgresql://.../recafco_osi_test npm run test:integration
//
// Imports a small file whose uncertain rows are held, then walks them
// through Data Entry corrections, Manager review and posting.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { register } from "node:module";
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

register("./session-stub-hooks.mjs", import.meta.url);

const { prisma } = await import("@/lib/db/prisma");
const importSvc = await import("@/lib/backend/store/opening-stock-import");
const svc = await import("@/lib/backend/store/opening-stock-verification");
const data = await import("@/lib/store/offline-inventory-data");
const matching = await import("@/lib/store/opening-stock-matching");
const actions = await import("@/app/actions/offline-inventory");

type Ctx = Parameters<typeof svc.listVerificationEntries>[0];

async function contextFor(slug: string): Promise<Ctx> {
  const profile = await prisma.profiles.findFirst({ where: { is_active: true, roles: { slug } }, include: { roles: true } });
  assert.ok(profile, `an active ${slug} profile is required in the test database`);
  const perms = await prisma.$queryRaw<{ key: string }[]>`select p.key from role_permissions rp join permissions p on p.id = rp.permission_id where rp.role_id = ${profile.role_id}::uuid`;
  return {
    userId: profile.id, authUserId: profile.id, email: null, mustResetPassword: false,
    profile: { id: profile.id, full_name: profile.full_name, employee_number: null, phone: null, job_title: null, department_id: profile.department_id, role_id: profile.role_id, is_active: true, can_view_costs: true },
    department: null, role: { id: profile.roles!.id, name: profile.roles!.name, slug: profile.roles!.slug }, permissions: perms.map((p) => p.key),
  } as unknown as Ctx;
}

type SheetRow = [string, string, string, string, string | number, string];
async function xlsx(rows: SheetRow[]): Promise<File> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Opening Stock");
  ws.addRow(["Material Name", "Category", "Part Number", "SS Rec. Code", "Opening Quantity", "Unit", "Location / Bin", "Remarks"]);
  for (const r of rows) ws.addRow(r);
  return new File([await wb.xlsx.writeBuffer()], "verification.xlsx");
}

const runNo = String(Date.now()).slice(-6);
const tag = runNo.replace(/\d/g, (d) => "ABCDEFGHIJ"[Number(d)]);
const itos = (s: string) => `ITOS ${tag} ${s}`;
const uuid = () => crypto.randomUUID();

type Mat = { key: string; name: string; unit: string };
async function untouched(unit: string, take: number): Promise<Mat[]> {
  const rows = await prisma.$queryRaw<{ name: string; unit: string }[]>`
    select m.manual_material_name as name, m.unit from offline_inventory_movements m
    where m.deleted_at is null and m.part_id is null and m.unit = ${unit}
    group by m.manual_material_name, m.unit
    having bool_and(m.movement_type = 'OPENING_STOCK') and sum(m.quantity) = 0
    order by m.manual_material_name desc limit ${take}`;
  return rows.map((r) => ({ key: data.buildBalanceKey({ part_id: null, manual_material_name: r.name, unit: r.unit }), name: r.name, unit: r.unit }));
}

async function balances() {
  const { balanceItems, archivedItems } = await data.getOfflineInventoryBalance();
  return new Map([...balanceItems, ...archivedItems].map((b) => [b.key, b.balance]));
}

let admin: Ctx, manager: Ctx, dataEntry: Ctx, storeKeeper: Ctx;
let setMat: Mat; // a Set material: the file row says PCS → Unit Mismatch
let setMat2: Mat;
let refMat: Mat & { probe: string }; // found only through a partial part reference
let batchReference: string;
const rowId = new Map<number, string>();
let before0: Map<string, number>;

async function entry(n: number, ctx: Ctx = manager) {
  const list = await svc.listVerificationEntries(ctx);
  return list.entries.find((e) => e.id === rowId.get(n))!;
}

describe("Needs Verification workflow (disposable DB)", () => {
  before(async () => {
    [admin, manager, dataEntry, storeKeeper] = await Promise.all(["super_admin", "maintenance_manager", "maintenance_data_entry", "store_keeper"].map(contextFor));
    const sets = await untouched("Set", 40);
    const probe = await importSvc.previewOpeningStockImport(admin, await xlsx(sets.map((m) => [m.name, "Mechanical", "", "", 1, "SET"] as SheetRow)));
    const ok = probe.rows.filter((r) => r.classification === "existing").map((r) => sets.find((s) => s.key === r.match!.key)!);
    [setMat, setMat2] = ok;
    assert.ok(setMat && setMat2, "need two confirmable Set materials");
    for (const m of await untouched("Nos", 200)) {
      const ref = matching.extractReferences(m.name).find((r) => r.length >= 6 && /^[A-Z0-9]+$/.test(r));
      if (!ref) continue;
      const [p] = (await importSvc.previewOpeningStockImport(admin, await xlsx([[`ZZVERIFY ${ref}Q`, "Automotive", "", "", 1, "PCS"]]))).rows;
      if (p.classification === "needs_review" && p.candidates.length === 1 && p.candidates[0].key === m.key) {
        refMat = { ...m, probe: `ZZVERIFY ${ref}Q` };
        break;
      }
    }
    assert.ok(refMat, "need a partial-reference material");
    before0 = await balances();

    const file = await xlsx([
      [setMat.name, "Mechanical", "", "", 3, "PCS"], //          row 2: Unit Mismatch
      [refMat.probe, "Automotive", "", "", 5, "PCS"], //          row 3: partial reference
      [itos("TWIN PUMP SEAL"), "Mechanical", "", "", 2, "PCS"], // row 4: same name twice
      [itos("twin pump seal"), "Mechanical", "", "", 1, "PCS"], // row 5: same name twice
      [itos("CLEAR NEW GASKET"), "Mechanical", "", "", 7, "PCS"], // row 6: clear new → posted at import
      [setMat2.name, "Mechanical", "", "", 9, "PCS"], //          row 7: Unit Mismatch (for duplicate test)
    ]);
    const p = await importSvc.previewOpeningStockImport(dataEntry, file);
    const r = await importSvc.confirmOpeningStockImport(dataEntry, file, {}, uuid(), p.fingerprint);
    assert.deepEqual([r.held, r.registeredNew], [5, 1]);
    batchReference = r.batchReference;
    const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { batch_reference: batchReference } });
    for (const rec of await prisma.opening_stock_import_rows.findMany({ where: { batch_id: batch.id } })) rowId.set(rec.row_number, rec.id);
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("1. held entries appear in Needs Verification with plain issue labels; posted rows are Completed", async () => {
    const list = await svc.listVerificationEntries(dataEntry);
    assert.ok(list.pending >= 5);
    assert.ok((await svc.countPendingVerification()) >= 5);
    const e2 = list.entries.find((e) => e.id === rowId.get(2))!;
    assert.equal(e2.status, "needs_verification");
    assert.equal(e2.issue?.label, "Unit Mismatch");
    assert.equal(e2.suggested?.key, setMat.key);
    assert.equal(e2.suggested?.unit, "Set");
    assert.equal(list.entries.find((e) => e.id === rowId.get(3))!.issue?.label, "Material Details Need Checking");
    assert.equal(list.entries.find((e) => e.id === rowId.get(4))!.issue?.label, "Same Part Reference");
    const e6 = list.entries.find((e) => e.id === rowId.get(6))!;
    assert.equal(e6.status, "completed");
    assert.match(e6.final?.itemCode ?? "", /^AMSOS\d{4,}$/);
    assert.deepEqual(list.roles, { canView: true, canEdit: true, canApprove: false });
  });

  it("2/6. Data Entry saves a draft: nothing posted, original Excel values unchanged", async () => {
    const e2 = await entry(2, dataEntry);
    await svc.saveVerificationCorrection(dataEntry, {
      rowId: e2.id, version: e2.version, values: { materialName: null, partNumber: null, category: null, unit: "SET", quantity: null, remarks: "Checked in store" }, proposedMaterialKey: setMat.key, reason: "", submit: false,
    });
    const after = await entry(2, dataEntry);
    assert.equal(after.status, "correction_in_progress");
    assert.equal(after.correction?.unit, "SET");
    assert.equal(after.correction?.proposed?.key, setMat.key);
    assert.deepEqual([after.original.unit, after.original.quantity], ["PCS", "3"]);
    assert.equal(after.history.at(-1)?.action, "draft_saved");
    const b = await balances();
    assert.equal(b.get(setMat.key), before0.get(setMat.key), "draft posts no stock");
    const rec = await prisma.opening_stock_import_rows.findUniqueOrThrow({ where: { id: e2.id } });
    assert.deepEqual([rec.source_unit, rec.source_quantity, rec.outcome], ["PCS", "3", "held"]);
  });

  it("3. Data Entry cannot approve, return, hold or post", async () => {
    const e2 = await entry(2, dataEntry);
    await assert.rejects(svc.resolveVerificationEntry(dataEntry, { rowId: e2.id, version: e2.version, decision: { action: "use_existing", materialKey: setMat.key } }), /Maintenance Manager or System Administrator/);
    await assert.rejects(svc.returnVerificationForCorrection(dataEntry, { rowId: e2.id, version: e2.version, note: "please fix" }), /Maintenance Manager or System Administrator/);
    await assert.rejects(svc.keepVerificationOnHold(dataEntry, { rowId: e2.id, version: e2.version, note: "" }), /Maintenance Manager or System Administrator/);
    await assert.rejects(importSvc.resolveHeldOpeningStockRows(dataEntry, batchReference, { 2: { action: "use_existing", materialKey: setMat.key } }), /System Administrator or Maintenance Manager/);
  });

  it("Store Keeper can view the list but not correct it", async () => {
    const list = await svc.listVerificationEntries(storeKeeper);
    assert.equal(list.roles.canEdit, false);
    assert.ok(list.entries.some((e) => e.id === rowId.get(2)));
    const e2 = await entry(2, storeKeeper);
    await assert.rejects(svc.saveVerificationCorrection(storeKeeper, { rowId: e2.id, version: e2.version, values: { materialName: null, partNumber: null, category: null, unit: null, quantity: null, remarks: "x" }, proposedMaterialKey: null, reason: "", submit: false }), /Data Entry/);
  });

  it("11. a changed quantity needs a reason to submit; then Data Entry cannot edit while it waits", async () => {
    const e2 = await entry(2, dataEntry);
    const values = { materialName: null, partNumber: null, category: null, unit: "SET", quantity: 4, remarks: "Checked in store" };
    await assert.rejects(
      svc.saveVerificationCorrection(dataEntry, { rowId: e2.id, version: e2.version, values, proposedMaterialKey: setMat.key, reason: "", submit: true }),
      (err: { fieldErrors?: Record<string, string[]> }) => /Explain why/.test(String(err.fieldErrors?.reason))
    );
    await svc.saveVerificationCorrection(dataEntry, { rowId: e2.id, version: e2.version, values, proposedMaterialKey: setMat.key, reason: "Store count: 4 sets, sold as sets", submit: true });
    const waiting = await entry(2, dataEntry);
    assert.equal(waiting.status, "waiting_for_manager");
    await assert.rejects(svc.saveVerificationCorrection(dataEntry, { rowId: waiting.id, version: waiting.version, values, proposedMaterialKey: null, reason: "x", submit: false }), /waiting for the Manager/);
  });

  it("4/5. Manager returns it; Data Entry resubmits; Manager approves Use Existing with the corrected unit and quantity", async () => {
    let e2 = await entry(2);
    await assert.rejects(svc.returnVerificationForCorrection(manager, { rowId: e2.id, version: e2.version, note: "" }), /Explain what needs correcting/);
    await svc.returnVerificationForCorrection(manager, { rowId: e2.id, version: e2.version, note: "Please confirm the count with the store." });
    e2 = await entry(2, dataEntry);
    assert.equal(e2.status, "returned");
    assert.equal(e2.reviewNote, "Please confirm the count with the store.");
    await svc.saveVerificationCorrection(dataEntry, {
      rowId: e2.id, version: e2.version, values: { materialName: null, partNumber: null, category: null, unit: "SET", quantity: 4, remarks: "Counted again: 4 sets" }, proposedMaterialKey: setMat.key, reason: "Store count confirmed: 4 sets", submit: true,
    });
    e2 = await entry(2);
    assert.equal(e2.issue?.label.startsWith("Ready"), true, "re-matched with the corrected unit: an exact match");
    const codeBefore = (await prisma.inventory_material_settings.findFirstOrThrow({ where: { manual_material_name: setMat.name, unit: setMat.unit } })).item_code;
    const posted = await svc.resolveVerificationEntry(manager, { rowId: e2.id, version: e2.version, decision: { action: "use_existing", materialKey: setMat.key } });
    assert.deepEqual([posted.outcome, posted.quantity, posted.unit, posted.itemCode], ["posted_existing", 4, "Set", codeBefore]);
    const done = await entry(2);
    assert.equal(done.status, "completed");
    assert.deepEqual(done.history.map((h) => h.action), ["draft_saved", "submitted", "returned", "submitted", "posted_existing"]);
    const last = done.history.at(-1)!.details;
    assert.deepEqual([last.submittedQuantity, last.approvedQuantity, last.quantityDifference], [3, 4, 1]);
    const rec = await prisma.opening_stock_import_rows.findUniqueOrThrow({ where: { id: e2.id } });
    assert.deepEqual([rec.source_unit, rec.source_quantity, Number(rec.quantity), rec.material_unit], ["PCS", "3", 4, "Set"], "original kept, approved value posted");
    const mv = await prisma.offline_inventory_movements.findUniqueOrThrow({ where: { id: rec.movement_id! } });
    assert.match(mv.remarks ?? "", /corrected; Excel: ".*" 3 PCS/);
    assert.equal((await balances()).get(setMat.key), (before0.get(setMat.key) ?? 0) + 4);
  });

  it("10. a unit mismatch cannot be bypassed: an incompatible material is refused even for the System Administrator", async () => {
    const e3 = await entry(3, admin);
    await svc.saveVerificationCorrection(admin, { rowId: e3.id, version: e3.version, values: { materialName: null, partNumber: null, category: null, unit: "SET", quantity: null, remarks: null }, proposedMaterialKey: null, reason: "Test: wrong unit", submit: true });
    const again = await entry(3, admin);
    await assert.rejects(svc.resolveVerificationEntry(admin, { rowId: again.id, version: again.version, decision: { action: "use_existing", materialKey: refMat.key } }), /never converted/);
    assert.equal((await balances()).get(refMat.key), before0.get(refMat.key));
    // Put the unit back (PCS) and post to the Nos material: same counting unit.
    await svc.saveVerificationCorrection(admin, { rowId: again.id, version: again.version, values: { materialName: null, partNumber: null, category: null, unit: "PCS", quantity: null, remarks: null }, proposedMaterialKey: refMat.key, reason: "", submit: true });
    const fixed = await entry(3, admin);
    assert.equal(fixed.correction?.unit ?? null, null, "unit equals the original again: no correction stored");
  });

  it("12. concurrent decisions post once; a stale version is refused", async () => {
    const e3 = await entry(3, admin);
    const results = await Promise.allSettled([
      svc.resolveVerificationEntry(admin, { rowId: e3.id, version: e3.version, decision: { action: "use_existing", materialKey: refMat.key } }),
      svc.resolveVerificationEntry(manager, { rowId: e3.id, version: e3.version, decision: { action: "use_existing", materialKey: refMat.key } }),
      svc.resolveVerificationEntry(admin, { rowId: e3.id, version: e3.version, decision: { action: "use_existing", materialKey: refMat.key } }),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1, "one decision posts");
    for (const x of results) if (x.status === "rejected") assert.match(String(x.reason?.message), /already completed|changed by someone else/);
    assert.equal((await balances()).get(refMat.key), (before0.get(refMat.key) ?? 0) + 5);
    await assert.rejects(
      svc.saveVerificationCorrection(dataEntry, { rowId: e3.id, version: e3.version, values: { materialName: "x y", partNumber: null, category: null, unit: null, quantity: null, remarks: null }, proposedMaterialKey: null, reason: "", submit: false }),
      /already been completed/
    );
    const e4 = await entry(4);
    await svc.keepVerificationOnHold(manager, { rowId: e4.id, version: e4.version, note: "Waiting for the store" });
    await assert.rejects(svc.keepVerificationOnHold(manager, { rowId: e4.id, version: e4.version, note: "again" }), /changed this material meanwhile/);
  });

  it("7/9. corrected details are matched again: an existing name is never registered twice; distinct items get unique AMSOS codes", async () => {
    // Row 7 corrected to the exact name of an existing material: Register New is refused.
    const e7 = await entry(7);
    await svc.saveVerificationCorrection(manager, { rowId: e7.id, version: e7.version, values: { materialName: setMat2.name, partNumber: null, category: null, unit: "SET", quantity: null, remarks: null }, proposedMaterialKey: null, reason: "Unit is SET", submit: true });
    const e7b = await entry(7);
    await assert.rejects(svc.resolveVerificationEntry(manager, { rowId: e7b.id, version: e7b.version, decision: { action: "register_new" } }), /already exists/);
    // The two "TWIN PUMP SEAL" lines: rename one to tell them apart, then register both.
    const e4 = await entry(4);
    await svc.saveVerificationCorrection(dataEntry, { rowId: e4.id, version: e4.version, values: { materialName: itos("TWIN PUMP SEAL LARGE"), partNumber: null, category: null, unit: null, quantity: null, remarks: null }, proposedMaterialKey: null, reason: "Two different sizes", submit: true });
    const r4 = await svc.resolveVerificationEntry(admin, { rowId: (await entry(4)).id, version: (await entry(4)).version, decision: { action: "register_new" } });
    const r5 = await svc.resolveVerificationEntry(admin, { rowId: (await entry(5)).id, version: (await entry(5)).version, decision: { action: "register_new" } });
    const codes = [r4.itemCode!, r5.itemCode!];
    assert.ok(codes.every((c) => /^AMSOS\d{4,}$/.test(c)));
    assert.equal(Number(codes[1].slice(5)) - Number(codes[0].slice(5)), 1, "sequential");
    assert.equal(await prisma.inventory_material_settings.count({ where: { item_code: { in: codes } } }), 2);
    assert.equal(r4.materialName, itos("TWIN PUMP SEAL LARGE"), "registered with the corrected name");
    const settings = await prisma.inventory_material_settings.findMany({ select: { item_code: true } });
    const upper = settings.filter((s) => s.item_code).map((s) => s.item_code!.toUpperCase());
    assert.equal(new Set(upper).size, upper.length, "no duplicate Item Codes");
  });

  it("13/14. completed rows leave the pending list but keep their history; excluded rows keep theirs", async () => {
    const e7 = await entry(7);
    await assert.rejects(svc.resolveVerificationEntry(manager, { rowId: e7.id, version: e7.version, decision: { action: "exclude", reason: "no" } }), /reason/);
    await svc.resolveVerificationEntry(manager, { rowId: e7.id, version: e7.version, decision: { action: "exclude", reason: "Duplicate of an existing Set material — counted elsewhere" } });
    const list = await svc.listVerificationEntries(manager);
    const ours = list.entries.filter((e) => [...rowId.values()].includes(e.id));
    assert.equal(ours.filter((e) => ["needs_verification", "correction_in_progress", "waiting_for_manager", "returned"].includes(e.status)).length, 0, "nothing of this batch is pending");
    const ex = ours.find((e) => e.id === rowId.get(7))!;
    assert.equal(ex.status, "excluded");
    assert.deepEqual(ex.history.map((h) => h.action), ["submitted", "excluded"]);
    assert.equal(ex.history.at(-1)?.note, "Duplicate of an existing Set material — counted elsewhere");
    assert.equal(ours.find((e) => e.id === rowId.get(2))!.history.length, 5);
  });

  it("6. the original Excel values cannot be changed, even directly in the database", async () => {
    await assert.rejects(
      prisma.opening_stock_import_rows.update({ where: { id: rowId.get(2)! }, data: { source_quantity: "99" } }),
      /original values of an opening-stock import row cannot be changed/
    );
  });

  it("8/15/16. balances are exact, identities and Item Codes kept, and the stock is issuable", async () => {
    const b = await balances();
    assert.equal(b.get(setMat.key), (before0.get(setMat.key) ?? 0) + 4);
    assert.equal(b.get(refMat.key), (before0.get(refMat.key) ?? 0) + 5);
    assert.equal(b.get(setMat2.key), before0.get(setMat2.key), "excluded row posted nothing");
    const token = randomBytes(32).toString("base64url");
    const user = await prisma.auth_users.findFirstOrThrow({ where: { profile_id: dataEntry.userId } });
    await prisma.auth_sessions.create({ data: { user_id: user.id, profile_id: dataEntry.userId, session_token_hash: createHash("sha256").update(token).digest("hex"), expires_at: new Date(Date.now() + 3600_000) } });
    (globalThis as { __TEST_SESSION_TOKEN?: string }).__TEST_SESSION_TOKEN = token;
    const fd = new FormData();
    fd.set("movement_date", new Date().toISOString().slice(0, 10));
    fd.set("part_id", "__manual__");
    fd.set("manual_material_name", setMat.name);
    fd.set("unit", setMat.unit);
    fd.set("quantity", "4");
    fd.set("counterparty", "Verification test");
    assert.deepEqual(await actions.issueOfflineMaterialAction({ ok: false } as never, fd), { ok: true });
    assert.equal((await balances()).get(setMat.key), before0.get(setMat.key) ?? 0);
    const page = await actions.browseInventoryForJobCardAction({ search: (await entry(4)).final!.itemCode!, category: "", location: "", stock: "in_stock", page: 1 });
    assert.equal(page.items.length, 1, "a resolved new material is selectable for Job Cards");
  });
});
