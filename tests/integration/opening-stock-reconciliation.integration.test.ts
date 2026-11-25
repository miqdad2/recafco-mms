// Opening Stock — full reconciliation of the Maintenance Team's approved
// 275-row file against a REAL, DISPOSABLE copy of the 1,523-material
// database. Runs only when asked, on a fresh copy where the file has not been
// imported yet:
//
//   DATABASE_URL=postgresql://.../recafco_osi_test \
//   OPENING_STOCK_RECONCILE=1 \
//   OPENING_STOCK_FINAL_XLSX=<path to RECAFCO_MMS_Opening_Stock_FINAL.xlsx> \
//   node --import ./tests/integration/register.mjs --test tests/integration/opening-stock-reconciliation.integration.test.ts
//
// It imports the file as Maintenance Data Entry and checks every source row,
// quantity, Item Code, movement and balance, then issues imported stock
// through the real Issue Material action and finds it in the real Job Card
// material picker. Held rows are left held.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { register } from "node:module";
import { after, before, describe, it } from "node:test";

import ExcelJS from "exceljs";

const enabled = process.env.OPENING_STOCK_RECONCILE === "1" && Boolean(process.env.OPENING_STOCK_FINAL_XLSX);
const dbName = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").pathname.replace(/^\//, "");
  } catch {
    return "";
  }
})();
if (enabled && !dbName.endsWith("_test")) {
  throw new Error(`Refusing to run: DATABASE_URL must point at a disposable *_test database (got "${dbName || "unset"}").`);
}

register("./session-stub-hooks.mjs", import.meta.url);

// Expected results agreed for RECAFCO_MMS_Opening_Stock_FINAL.xlsx.
const EXPECTED = { existing: [21, 100], new: [194, 1116], held: [60, 224], failed: [0, 0], total: [275, 1440] } as const;
const EXPECTED_EXISTING: Record<number, string> = {
  9: "AMSHV0054", 19: "AMSHV0039", 21: "AMSHV0038", 22: "AMSHV0037", 23: "AMSHV0113", 24: "AMSHV0040", 27: "AMSHV0043",
  34: "AMSHV0189", 38: "AMSHV0005", 39: "AMSHV0118", 43: "AMSHV0190", 51: "AMSHV1023", 56: "AMSHV1324", 57: "AMSHV0045",
  58: "AMSHV0044", 67: "AMSHV1357", 105: "AMSHV0018", 127: "AMSHV1164", 129: "AMSHV1163", 130: "AMSHV1166", 276: "AMSHV0004",
};
const EXPECTED_HELD = [
  2, 3, 4, 7, 10, 12, 14, 15, 16, 25, 29, 30, 31, 32, 33, 35, 36, 42, 45, 46, 47, 50, 53, 54, 59, 60, 61, 62, 63, 64, 65, 66, 70, 76, 79, 80,
  84, 86, 88, 89, 90, 93, 96, 98, 100, 102, 103, 104, 107, 112, 122, 124, 128, 140, 141, 158, 162, 163, 179, 275,
];
// The six approved corrections: row → quantity, and what happens to it.
const SIX: [number, number, string][] = [[88, 2, "held"], [89, 1, "held"], [65, 6, "held"], [275, 2, "held"], [50, 6, "held"], [276, 18, "posted_existing"]];

describe("Opening Stock — FINAL 275-row reconciliation (disposable DB)", { skip: !enabled }, () => {
  let prisma: (typeof import("@/lib/db/prisma"))["prisma"];
  let svc: typeof import("@/lib/backend/store/opening-stock-import");
  let data: typeof import("@/lib/store/offline-inventory-data");
  let actions: typeof import("@/app/actions/offline-inventory");
  type Ctx = Parameters<typeof import("@/lib/backend/store/opening-stock-import")["previewOpeningStockImport"]>[0];
  let dataEntry: Ctx;
  let bytes: Buffer;
  let source: { row: number; name: string; qty: string; unit: string }[];
  let codesBefore: Map<string, string | null>;
  let balancesBefore: Map<string, number>;
  let settingsBefore: number;
  let batchReference: string;

  before(async () => {
    ({ prisma } = await import("@/lib/db/prisma"));
    svc = await import("@/lib/backend/store/opening-stock-import");
    data = await import("@/lib/store/offline-inventory-data");
    actions = await import("@/app/actions/offline-inventory");
    const profile = await prisma.profiles.findFirstOrThrow({ where: { is_active: true, roles: { slug: "maintenance_data_entry" } }, include: { roles: true } });
    dataEntry = {
      userId: profile.id, authUserId: profile.id, email: null, mustResetPassword: false,
      profile: { id: profile.id, full_name: profile.full_name, employee_number: null, phone: null, job_title: null, department_id: profile.department_id, role_id: profile.role_id, is_active: true, can_view_costs: true },
      department: null, role: { id: profile.roles!.id, name: profile.roles!.name, slug: profile.roles!.slug }, permissions: [],
    } as unknown as Ctx;

    bytes = readFileSync(process.env.OPENING_STOCK_FINAL_XLSX!);
    // Read the file independently of the importer, for the source audit check.
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes as never);
    source = [];
    wb.worksheets[0].eachRow((r, n) => {
      if (n > 1) source.push({ row: n, name: String(r.getCell(1).value ?? "").trim(), qty: String(r.getCell(5).value ?? "").trim(), unit: String(r.getCell(6).value ?? "").trim() });
    });

    const fileSha = createHash("sha256").update(bytes).digest("hex");
    assert.equal(await prisma.opening_stock_import_batches.count({ where: { file_sha256: fileSha } }), 0, "use a fresh copy: FINAL is already imported in this database");
    const settings = await prisma.inventory_material_settings.findMany({ select: { part_id: true, manual_material_name: true, unit: true, item_code: true } });
    codesBefore = new Map(settings.map((s) => [data.buildBalanceKey(s), s.item_code]));
    settingsBefore = settings.length;
    const { balanceItems, archivedItems } = await data.getOfflineInventoryBalance();
    balancesBefore = new Map([...balanceItems, ...archivedItems].map((b) => [b.key, b.balance]));
  });

  after(async () => {
    await prisma?.$disconnect();
  });

  it("imports FINAL: 21 existing (100), 194 new (1,116), 60 held (224), 0 failed — 275 rows, 1,440", async () => {
    assert.equal(source.length, 275);
    assert.equal(source.reduce((s, r) => s + Number(r.qty), 0), 1440);
    const file = new File([new Uint8Array(bytes)], "RECAFCO_MMS_Opening_Stock_FINAL.xlsx");
    const p = await svc.previewOpeningStockImport(dataEntry, file);
    const r = await svc.confirmOpeningStockImport(dataEntry, file, {}, crypto.randomUUID(), p.fingerprint);
    batchReference = r.batchReference;
    const sum = (o: string) => r.rows.filter((x) => x.outcome === o).reduce((s, x) => s + Number(x.sourceQuantity), 0);
    assert.deepEqual([r.postedExisting, sum("posted_existing")], [...EXPECTED.existing]);
    assert.deepEqual([r.registeredNew, sum("registered_new")], [...EXPECTED.new]);
    assert.deepEqual([r.held, sum("held")], [...EXPECTED.held]);
    assert.deepEqual([r.failed + r.excluded, sum("not_imported") + sum("excluded")], [...EXPECTED.failed]);
    assert.deepEqual([r.totalRows, r.rows.reduce((s, x) => s + Number(x.sourceQuantity), 0)], [...EXPECTED.total]);
    assert.equal(r.postedQuantity, 1216);
    assert.deepEqual(r.rows.filter((x) => x.outcome === "held").map((x) => x.rowNumber), EXPECTED_HELD);
  });

  it("every source row is recorded exactly once, with its exact description, quantity and unit", async () => {
    const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { batch_reference: batchReference } });
    const recs = await prisma.opening_stock_import_rows.findMany({ where: { batch_id: batch.id }, orderBy: { row_number: "asc" } });
    assert.equal(recs.length, 275);
    assert.deepEqual(recs.map((x) => x.row_number), source.map((s) => s.row), "rows 2–276, each once");
    for (const [i, s] of source.entries()) {
      assert.equal(recs[i].source_material_name, s.name, `row ${s.row} description`);
      assert.equal(recs[i].source_quantity, s.qty, `row ${s.row} quantity`);
      assert.equal(recs[i].source_unit, s.unit, `row ${s.row} unit`);
    }
    assert.equal(recs.find((x) => x.row_number === 37)!.source_material_name, "ENGINE     OIL FILTER -84475542", "inner spacing kept verbatim");
    assert.deepEqual(
      [batch.total_rows, batch.posted_existing_count, batch.registered_new_count, batch.held_count, batch.not_imported_count, batch.excluded_count, Number(batch.posted_quantity)],
      [275, 21, 194, 60, 0, 0, 1216]
    );
    const audit = await prisma.audit_logs.findFirstOrThrow({ where: { action: "offline_inventory.opening_stock_import", entity_id: batch.id } });
    const meta = audit.metadata as { sourceQuantity: number; postedQuantity: number; heldRows: number[] };
    assert.deepEqual([meta.sourceQuantity, meta.postedQuantity, meta.heldRows], [1440, 1216, EXPECTED_HELD]);
  });

  it("the six approved corrections keep their quantities", async () => {
    const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { batch_reference: batchReference } });
    for (const [row, qty, outcome] of SIX) {
      const rec = await prisma.opening_stock_import_rows.findUniqueOrThrow({ where: { batch_id_row_number: { batch_id: batch.id, row_number: row } } });
      assert.equal(Number(rec.source_quantity), qty, `row ${row} quantity`);
      assert.equal(rec.outcome, outcome, `row ${row} outcome`);
    }
    const r276 = await prisma.opening_stock_import_rows.findUniqueOrThrow({ where: { batch_id_row_number: { batch_id: batch.id, row_number: 276 } } });
    assert.deepEqual([r276.item_code, Number(r276.quantity), r276.material_unit], ["AMSHV0004", 18, "Nos"]);
  });

  it("existing materials keep their identity and AMSHV/AMSLV codes; movements post to that exact identity", async () => {
    const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { batch_reference: batchReference } });
    const recs = await prisma.opening_stock_import_rows.findMany({ where: { batch_id: batch.id, outcome: "posted_existing" } });
    assert.deepEqual(Object.fromEntries(recs.map((x) => [x.row_number, x.item_code])), EXPECTED_EXISTING);
    for (const rec of recs) {
      assert.ok(codesBefore.has(rec.material_key!), `row ${rec.row_number}: a pre-existing identity`);
      assert.equal(codesBefore.get(rec.material_key!), rec.item_code, `row ${rec.row_number}: Item Code unchanged`);
      const mv = await prisma.offline_inventory_movements.findUniqueOrThrow({ where: { id: rec.movement_id! } });
      assert.equal(data.buildBalanceKey(mv), rec.material_key, `row ${rec.row_number}: movement on the existing identity`);
      assert.equal(mv.manual_material_name, rec.material_name);
      assert.equal(mv.unit, rec.material_unit);
      assert.equal(Number(mv.quantity), Number(rec.source_quantity));
      assert.equal(mv.movement_type, "OPENING_STOCK");
    }
    // No Item Code of any pre-existing material changed.
    const after = await prisma.inventory_material_settings.findMany({ select: { part_id: true, manual_material_name: true, unit: true, item_code: true } });
    const afterMap = new Map(after.map((s) => [data.buildBalanceKey(s), s.item_code]));
    for (const [key, code] of codesBefore) assert.equal(afterMap.get(key), code, `Item Code of ${key}`);
    assert.equal(after.length, settingsBefore + 194, "settings rows only for the 194 new materials");
  });

  it("new materials get unique, sequential AMSOS codes and appear in Inventory Control with their quantity", async () => {
    const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { batch_reference: batchReference } });
    const recs = await prisma.opening_stock_import_rows.findMany({ where: { batch_id: batch.id, outcome: "registered_new" }, orderBy: { row_number: "asc" } });
    const codes = recs.map((x) => x.item_code!);
    assert.equal(new Set(codes.map((c) => c.toUpperCase())).size, 194);
    const nums = codes.map((c) => Number(c.slice(5))).sort((a, b) => a - b);
    assert.ok(codes.every((c) => /^AMSOS\d{4}$/.test(c)));
    assert.equal(nums[nums.length - 1] - nums[0], 193, "contiguous series");
    for (const c of codes) assert.ok(![...codesBefore.values()].includes(c), `${c} was not used before`);
    const { balanceItems } = await data.getOfflineInventoryBalance();
    const byKey = new Map(balanceItems.map((b) => [b.key, b]));
    for (const rec of recs) {
      const item = byKey.get(rec.material_key!);
      assert.ok(item, `row ${rec.row_number} is listed in Inventory Control`);
      assert.equal(item.balance, Number(rec.source_quantity));
      assert.equal(item.item_code, rec.item_code);
      assert.equal(item.part_number, null);
    }
  });

  it("held rows post nothing, and no other material changes; no duplicate stock", async () => {
    const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { batch_reference: batchReference } });
    const recs = await prisma.opening_stock_import_rows.findMany({ where: { batch_id: batch.id } });
    // A held row's candidate may be a material another row of this batch
    // posted to (e.g. row 65's candidate AMSHV1357 is row 67's material);
    // every other candidate must be untouched.
    const postedByBatch = new Set(recs.filter((x) => x.movement_id).map((x) => x.material_key));
    const current = await balancesNow();
    for (const h of recs.filter((x) => x.outcome === "held")) {
      assert.equal(h.movement_id, null);
      assert.equal(h.material_key, null);
      for (const k of h.candidate_keys as string[]) {
        if (!postedByBatch.has(k)) assert.equal(current.get(k), balancesBefore.get(k), `held row ${h.row_number}: candidate ${k} not stocked`);
      }
    }
    const mv = await prisma.offline_inventory_movements.findMany({ where: { reference_number: batchReference } });
    assert.equal(mv.length, 215);
    assert.equal(mv.reduce((s, m) => s + Number(m.quantity), 0), 1216);
    const posted = recs.filter((x) => x.movement_id);
    assert.equal(new Set(posted.map((x) => x.material_key)).size, 215, "each material posted once");
    const now = await balancesNow();
    const postedKeys = new Set(posted.map((x) => x.material_key));
    for (const [key, b] of balancesBefore) if (!postedKeys.has(key)) assert.equal(now.get(key), b, `unchanged: ${key}`);
    const total = (m: Map<string, number>) => [...m.values()].reduce((s, v) => s + v, 0);
    assert.equal(total(now) - total(balancesBefore), 1216, "inventory grew by exactly the posted quantity");
    // Re-import of the same file is refused.
    const p = await svc.previewOpeningStockImport(dataEntry, new File([new Uint8Array(bytes)], "copy.xlsx"));
    assert.equal(p.previousBatch?.batchReference, batchReference);
  });

  it("imported stock appears in the Job Card material picker and issues through Issue Material", async () => {
    const token = randomBytes(32).toString("base64url");
    const user = await prisma.auth_users.findFirstOrThrow({ where: { profile_id: dataEntry.userId } });
    await prisma.auth_sessions.create({
      data: { user_id: user.id, profile_id: dataEntry.userId, session_token_hash: createHash("sha256").update(token).digest("hex"), expires_at: new Date(Date.now() + 3600_000) },
    });
    (globalThis as { __TEST_SESSION_TOKEN?: string }).__TEST_SESSION_TOKEN = token;
    const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { batch_reference: batchReference } });
    const newRec = await prisma.opening_stock_import_rows.findFirstOrThrow({ where: { batch_id: batch.id, outcome: "registered_new" }, orderBy: { row_number: "asc" } });
    const exRec = await prisma.opening_stock_import_rows.findFirstOrThrow({ where: { batch_id: batch.id, row_number: 276 } });

    const page = await actions.browseInventoryForJobCardAction({ search: newRec.item_code!, category: "", location: "", stock: "in_stock", page: 1 });
    const found = page.items.find((i) => i.key === newRec.material_key);
    assert.ok(found, "new material listed in the Job Card picker");
    assert.equal(found.balance, Number(newRec.source_quantity));
    const page2 = await actions.browseInventoryForJobCardAction({ search: "AMSHV0004", category: "", location: "", stock: "in_stock", page: 1 });
    assert.equal(page2.items.find((i) => i.key === exRec.material_key)?.balance, 18);

    const issue = (name: string, unit: string, qty: number) => {
      const fd = new FormData();
      fd.set("movement_date", new Date().toISOString().slice(0, 10));
      fd.set("part_id", "__manual__");
      fd.set("manual_material_name", name);
      fd.set("unit", unit);
      fd.set("quantity", String(qty));
      fd.set("counterparty", "Reconciliation test");
      return actions.issueOfflineMaterialAction({ ok: false } as never, fd);
    };
    assert.deepEqual(await issue(newRec.material_name!, newRec.material_unit!, 1), { ok: true });
    assert.deepEqual(await issue(exRec.material_name!, exRec.material_unit!, 18), { ok: true });
    const over = await issue(exRec.material_name!, exRec.material_unit!, 1);
    assert.equal(over?.ok, false, "no stock left after issuing all 18");
    const now = await balancesNow();
    assert.equal(now.get(newRec.material_key!), Number(newRec.source_quantity) - 1);
    assert.equal(now.get(exRec.material_key!), (balancesBefore.get(exRec.material_key!) ?? 0));
  });

  async function balancesNow() {
    const { balanceItems, archivedItems } = await data.getOfflineInventoryBalance();
    return new Map([...balanceItems, ...archivedItems].map((b) => [b.key, b.balance]));
  }
});
