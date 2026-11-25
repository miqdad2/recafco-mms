// Opening Stock Excel import — integration tests against a REAL, DISPOSABLE
// PostgreSQL database holding the 1,523-material master data. Refuses to run
// unless DATABASE_URL names a database ending in "_test".
//
//   DATABASE_URL=postgresql://.../recafco_osi_test npm run test:integration
//
// Optional: OPENING_STOCK_FINAL_XLSX=<path to RECAFCO_MMS_Opening_Stock_FINAL.xlsx>
// adds a read-only preview of the Maintenance Team's 275-row file.
//
// The database must have every migration applied (prisma migrate deploy).
// Test materials are prefixed "ITOS" and left in place — the database is
// disposable. Existing materials only ever receive new movements.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

// Lets the real Issue Material action run as a signed-in user (see the file).
register("./session-stub-hooks.mjs", import.meta.url);

const { prisma } = await import("@/lib/db/prisma");
const svc = await import("@/lib/backend/store/opening-stock-import");
const data = await import("@/lib/store/offline-inventory-data");
const matching = await import("@/lib/store/opening-stock-matching");
const inventoryActions = await import("@/app/actions/offline-inventory");

type Ctx = Parameters<typeof svc.previewOpeningStockImport>[0];

async function contextFor(slug: string): Promise<Ctx> {
  const profile = await prisma.profiles.findFirst({ where: { is_active: true, roles: { slug } }, include: { roles: true } });
  assert.ok(profile, `an active ${slug} profile is required in the test database`);
  return {
    userId: profile.id,
    authUserId: profile.id,
    email: null,
    mustResetPassword: false,
    profile: { id: profile.id, full_name: profile.full_name, employee_number: null, phone: null, job_title: null, department_id: profile.department_id, role_id: profile.role_id, is_active: true, can_view_costs: true },
    department: null,
    role: profile.roles ? { id: profile.roles.id, name: profile.roles.name, slug: profile.roles.slug } : null,
    permissions: [],
  } as unknown as Ctx;
}

const HEADER = ["Material Name", "Category", "Part Number", "SS Rec. Code", "Opening Quantity", "Unit", "Location / Bin", "Remarks"];
type SheetRow = [string, string, string, string, string | number, string, string?, string?];

async function xlsx(name: string, rows: SheetRow[], opts: { title?: string } = {}): Promise<File> {
  const wb = new ExcelJS.Workbook();
  if (opts.title) wb.creator = opts.title; // different bytes, same rows
  const ws = wb.addWorksheet("Opening Stock");
  ws.addRow(HEADER);
  for (const r of rows) ws.addRow(r);
  const buf = await wb.xlsx.writeBuffer();
  return new File([buf], name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

const uuid = () => crypto.randomUUID();

// Unique test names AND part references per run, so the suite can be re-run
// on the same DB without its new items matching the previous run's ones.
// The tag is letters only, so it is never read as a part reference itself.
const runNo = String(Date.now()).slice(-6);
const tag = runNo.replace(/\d/g, (d) => "ABCDEFGHIJ"[Number(d)]);
const itos = (s: string) => `ITOS ${tag} ${s.replace(/ZQ-9(\d{4})/, `ZQ-${runNo}$1`)}`;

async function counts() {
  const [movements, settings, batches, rows, audits] = await Promise.all([
    prisma.offline_inventory_movements.count(),
    prisma.inventory_material_settings.count(),
    prisma.opening_stock_import_batches.count(),
    prisma.opening_stock_import_rows.count(),
    prisma.audit_logs.count({ where: { action: "offline_inventory.opening_stock_import" } }),
  ]);
  return { movements, settings, batches, rows, audits };
}

async function balances(): Promise<Map<string, { balance: number; category: string; part_number: string | null; total_issued: number }>> {
  const { balanceItems, archivedItems } = await data.getOfflineInventoryBalance();
  return new Map([...balanceItems, ...archivedItems].map((b) => [b.key, { balance: b.balance, category: b.category, part_number: b.part_number, total_issued: b.total_issued }]));
}


async function confirm(ctx: Ctx, file: File, decisions: Record<number, unknown> = {}, sub = uuid()) {
  const p = await svc.previewOpeningStockImport(ctx, file);
  return svc.confirmOpeningStockImport(ctx, file, decisions as never, sub, p.fingerprint);
}

async function batchRows(batchReference: string) {
  const batch = await prisma.opening_stock_import_batches.findUniqueOrThrow({ where: { batch_reference: batchReference } });
  const rows = await prisma.opening_stock_import_rows.findMany({ where: { batch_id: batch.id }, orderBy: { row_number: "asc" } });
  return { batch, rows, byRow: new Map(rows.map((r) => [r.row_number, r])) };
}

let admin: Ctx;
let manager: Ctx;
let dataEntry: Ctx;
let technician: Ctx;
type Mat = { key: string; name: string; unit: string };
// Real materials from the 1,523, chosen at start-up by read-only previews.
let nosMaterial: Mat;
let setMaterial: Mat;
let setMaterial2: Mat;
let autoRef: Mat & { probe: string }; // an exact part reference → confirmed automatically
let heldRef: Mat & { probe: string }; // a partial part reference → held, resolved later
let before0: Awaited<ReturnType<typeof balances>>;

// Zero-quantity registrations only (no stock yet).
async function untouchedMaterials(unit: string, take: number): Promise<Mat[]> {
  const rows = await prisma.$queryRaw<{ name: string; unit: string }[]>`
    select m.manual_material_name as name, m.unit
    from offline_inventory_movements m
    where m.deleted_at is null and m.part_id is null and m.unit = ${unit}
    group by m.manual_material_name, m.unit
    having bool_and(m.movement_type = 'OPENING_STOCK') and sum(m.quantity) = 0
    order by m.manual_material_name
    limit ${take}`;
  return rows.map((r) => ({ key: data.buildBalanceKey({ part_id: null, manual_material_name: r.name, unit: r.unit }), name: r.name, unit: r.unit }));
}

const newHose = () => itos("HYDRAULIC HOSE 12MM ZQ-91001");
const newGasket = () => itos("GASKET   SET ZQ-91002");

describe("Opening Stock import — partial import with held rows (disposable DB with the 1,523 materials)", () => {
  before(async () => {
    admin = await contextFor("super_admin");
    manager = await contextFor("maintenance_manager");
    dataEntry = await contextFor("maintenance_data_entry");
    technician = await contextFor("technician");
    assert.ok((await prisma.inventory_material_settings.count()) >= 1523, "the 1,523-material master data is required");

    const nosPool = await untouchedMaterials("Nos", 120);
    const setPool = await untouchedMaterials("Set", 60);
    const probe = await svc.previewOpeningStockImport(
      admin,
      await xlsx("probe.xlsx", [
        ...nosPool.map((m) => [` ${m.name.toLowerCase()}  `, "Automotive", "", "", 1, "PCS"] as SheetRow),
        ...setPool.map((m) => [m.name, "Mechanical", "", "", 1, "SET"] as SheetRow),
      ])
    );
    const existing = probe.rows.filter((r) => r.classification === "existing");
    const nosRow = existing.find((r) => r.match?.unit === "Nos")!;
    const setRows = existing.filter((r) => r.match?.unit === "Set");
    assert.ok(nosRow && setRows.length >= 2, "need confirmable Nos and Set materials");
    nosMaterial = { key: nosRow.match!.key, name: nosRow.match!.name, unit: "Nos" };
    setMaterial = { key: setRows[0].match!.key, name: setRows[0].match!.name, unit: "Set" };
    setMaterial2 = { key: setRows[1].match!.key, name: setRows[1].match!.name, unit: "Set" };

    // Two materials identified by a part reference: one exactly (confirmed
    // automatically), one only partly ("≈", held for an approver).
    for (const m of nosPool) {
      if (m.key === nosMaterial.key || (autoRef && heldRef)) continue;
      const ref = matching.extractReferences(m.name).find((r) => r.length >= 6 && /^[A-Z0-9]+$/.test(r));
      if (!ref) continue;
      // Separate files: in one file the two probes would share a reference and both be held.
      if (!autoRef) {
        const [exact] = (await svc.previewOpeningStockImport(admin, await xlsx("ref.xlsx", [[`ZZPROBE ${ref}`, "Automotive", "", "", 1, "PCS"]]))).rows;
        if (exact.classification === "existing" && exact.match?.key === m.key) {
          autoRef = { ...m, probe: `ZZPROBE ${ref}` };
          continue;
        }
      }
      if (!heldRef) {
        const [partial] = (await svc.previewOpeningStockImport(admin, await xlsx("ref2.xlsx", [[`ZZPROBE HELD ${ref}Q`, "Automotive", "", "", 1, "PCS"]]))).rows;
        if (partial.classification === "needs_review" && partial.candidates.length === 1 && partial.candidates[0].key === m.key) {
          heldRef = { ...m, probe: `ZZPROBE HELD ${ref}Q` };
        }
      }
    }
    assert.ok(autoRef && heldRef && autoRef.key !== heldRef.key, "need one exact and one partial reference material");
    before0 = await balances();
  });

  after(async () => {
    for (const t of ["itos_fail_rows ON opening_stock_import_rows", "itos_fail_update ON opening_stock_import_rows"]) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${t}`);
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS itos_fail_rows()");
    await prisma.$disconnect();
  });

  it("the Maintenance Team's 275-row file: every row accounted for, preview writes nothing", { skip: !process.env.OPENING_STOCK_FINAL_XLSX }, async () => {
    const path = process.env.OPENING_STOCK_FINAL_XLSX!;
    assert.ok(existsSync(path), `file not found: ${path}`);
    const bytes = readFileSync(path);
    const c0 = await counts();
    const p = await svc.previewOpeningStockImport(admin, new File([bytes], "RECAFCO_MMS_Opening_Stock_FINAL.xlsx"));
    assert.equal(p.rows.length, 275);
    assert.equal(p.summary.totalQuantity, 1440);
    const by = (a: string) => p.rows.filter((r) => r.proposedAction === a);
    assert.equal(by("post_existing").length + by("register_new").length + by("hold").length + by("none").length, 275);
    // The six approved corrections: only FHJ00700 (row 276) is confirmed; the other five are held, quantities untouched.
    const six = new Map(p.rows.filter((r) => [50, 65, 88, 89, 275, 276].includes(r.rowNumber)).map((r) => [r.rowNumber, r]));
    assert.deepEqual([...six.values()].map((r) => [r.rowNumber, r.quantity, r.proposedAction]), [
      [50, 6, "hold"], [65, 6, "hold"], [88, 2, "hold"], [89, 1, "hold"], [275, 2, "hold"], [276, 18, "post_existing"],
    ]);
    console.log(`275-row plan: existing ${by("post_existing").length}, new ${by("register_new").length}, held ${by("hold").length}, failed ${by("none").length}; sha256 ${createHash("sha256").update(bytes).digest("hex")}`);
    assert.deepEqual(await counts(), c0, "preview wrote nothing");
  });

  it("refuses a user without Inventory manage permission", async () => {
    const file = await xlsx("x.xlsx", [[itos("PERM"), "Automotive", "", "", 1, "PCS"]]);
    await assert.rejects(svc.previewOpeningStockImport(technician, file), /permission/);
    await assert.rejects(svc.confirmOpeningStockImport(technician, file, {}, uuid(), "x"), /permission/);
  });

  let mainFile: File;
  let mainSub: string;
  let mainBatch: string;

  it("imports clear existing and new rows, holds uncertain ones, fails invalid ones — every row and quantity recorded", async () => {
    mainFile = await xlsx("partial.xlsx", [
      [` ${nosMaterial.name.toLowerCase()} `, "Automotive", "", "", 6, "PCS"], // 2 existing (same name), PCS → Nos
      [setMaterial.name, "Mechanical", "", "", 2, "SET"], //                      3 existing (same name)
      [setMaterial2.name, "Mechanical", "", "", 3, "PCS"], //                     4 held: PCS vs Set
      [newHose(), "Mechanical", "", "", 10, "MTR", "Shelf B2"], //                5 new
      [newGasket(), "Automotive", "", "", 3, "PCS"], //                           6 new
      [itos("DUP ITEM ZQ-91003"), "Electrical", "", "", 1, "PCS"], //             7 held: listed twice
      [itos("dup  item ZQ-91003"), "Electrical", "", "", 2, "PCS"], //            8 held: listed twice
      [itos("COUPLER"), "Mechanical", "", "", "20 PIECES", "PCS"], //             9 failed: invalid quantity
      [autoRef.probe, "Automotive", "", "", 4, "PCS"], //                         10 existing (exact part reference)
      [heldRef.probe, "Automotive", "", "", 5, "PCS"], //                         11 held: partial reference
    ]);
    const p = await svc.previewOpeningStockImport(dataEntry, mainFile);
    assert.deepEqual(p.rows.map((r) => r.proposedAction), ["post_existing", "post_existing", "hold", "register_new", "register_new", "hold", "hold", "none", "post_existing", "hold"]);
    const c0 = await counts();
    mainSub = uuid();
    // Data Entry imports: no approval needed for the clear rows.
    const r = await svc.confirmOpeningStockImport(dataEntry, mainFile, {}, mainSub, p.fingerprint);
    mainBatch = r.batchReference;
    assert.deepEqual([r.postedExisting, r.registeredNew, r.held, r.failed, r.excluded, r.totalRows], [3, 2, 4, 1, 0, 10]);
    assert.equal(r.postedQuantity, 6 + 2 + 10 + 3 + 4);
    const c1 = await counts();
    assert.deepEqual([c1.movements - c0.movements, c1.settings - c0.settings, c1.batches - c0.batches, c1.rows - c0.rows, c1.audits - c0.audits], [5, 2, 1, 10, 1]);

    const mv = await prisma.offline_inventory_movements.findMany({ where: { reference_number: mainBatch } });
    const nosMv = mv.find((m) => m.manual_material_name === nosMaterial.name)!;
    assert.equal(nosMv.unit, "Nos", "PCS posted in the material's own unit");
    assert.ok(nosMv.remarks?.includes(`Excel row 2: "${nosMaterial.name.toLowerCase()}" 6 PCS`), "source description and quantity kept");
    assert.equal(mv.find((m) => m.manual_material_name === autoRef.name)!.unit, autoRef.unit);

    const created = await prisma.inventory_material_settings.findMany({ where: { manual_material_name: { in: [newHose(), itos("GASKET SET ZQ-91002")] } } });
    assert.equal(created.length, 2);
    for (const s of created) {
      assert.match(s.item_code ?? "", /^AMSOS\d{4,}$/);
      assert.equal(s.part_number, null, "Part Number left blank");
    }
    assert.equal(created.find((s) => s.manual_material_name === itos("GASKET SET ZQ-91002"))!.category, "Automotive");

    const after1 = await balances();
    for (const [key, add] of [[nosMaterial.key, 6], [setMaterial.key, 2], [autoRef.key, 4]] as const) assert.equal(after1.get(key)!.balance, before0.get(key)!.balance + add);
    for (const key of [setMaterial2.key, heldRef.key]) assert.equal(after1.get(key)!.balance, before0.get(key)!.balance, "held rows post nothing");
    assert.equal(after1.get(data.buildBalanceKey({ part_id: null, manual_material_name: newHose(), unit: "MTR" }))!.balance, 10);
    assert.equal(after1.get(nosMaterial.key)!.category, before0.get(nosMaterial.key)!.category, "existing category unchanged");
    const touched = new Set([nosMaterial.key, setMaterial.key, autoRef.key]);
    for (const [key, v] of before0) if (!touched.has(key)) assert.equal(after1.get(key)?.balance, v.balance, `unchanged: ${key}`);

    // Source-row audit: every row, with its approved quantity as supplied.
    const { batch, rows } = await batchRows(mainBatch);
    assert.deepEqual(rows.map((x) => [x.row_number, x.outcome, x.source_quantity]), [
      [2, "posted_existing", "6"], [3, "posted_existing", "2"], [4, "held", "3"], [5, "registered_new", "10"], [6, "registered_new", "3"],
      [7, "held", "1"], [8, "held", "2"], [9, "not_imported", "20 PIECES"], [10, "posted_existing", "4"], [11, "held", "5"],
    ]);
    assert.equal(rows[4].source_material_name, newGasket(), "source description kept verbatim");
    assert.deepEqual([batch.posted_existing_count, batch.registered_new_count, batch.held_count, batch.not_imported_count, Number(batch.posted_quantity)], [3, 2, 4, 1, 25]);
    const audit = await prisma.audit_logs.findFirstOrThrow({ where: { action: "offline_inventory.opening_stock_import", entity_id: batch.id } });
    assert.deepEqual((audit.metadata as { heldRows: number[] }).heldRows, [4, 7, 8, 11]);
    assert.equal((audit.metadata as { sourceQuantity: number }).sourceQuantity, 6 + 2 + 3 + 10 + 3 + 1 + 2 + 4 + 5);
  });

  it("refresh, retry or a re-saved copy never imports the file twice", async () => {
    const c0 = await counts();
    const again = await svc.confirmOpeningStockImport(dataEntry, mainFile, {}, mainSub, "ignored-for-a-repeat");
    assert.equal(again.alreadyProcessed, true);
    assert.equal(again.batchReference, mainBatch);
    await assert.rejects(confirm(dataEntry, mainFile), new RegExp(`already imported \\(batch ${mainBatch}\\)`));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await mainFile.arrayBuffer()) as never);
    wb.creator = "re-saved";
    wb.modified = new Date(2020, 0, 1);
    await assert.rejects(confirm(dataEntry, new File([await wb.xlsx.writeBuffer()], "partial-copy.xlsx")), /already imported/);
    assert.equal((await svc.previewOpeningStockImport(dataEntry, mainFile)).previousBatch?.batchReference, mainBatch);
    assert.deepEqual(await counts(), c0);
  });

  it("held rows are resolved later from the batch; completed rows are never re-posted", async () => {
    const view = await svc.getOpeningStockBatch(manager, mainBatch);
    assert.equal(view.canResolve, true);
    assert.deepEqual(view.rows.filter((r) => r.outcome === "held").map((r) => r.rowNumber), [4, 7, 8, 11]);
    assert.equal(view.rows.find((r) => r.rowNumber === 11)!.current?.candidates[0]?.key, heldRef.key);
    assert.equal((await svc.getOpeningStockBatch(dataEntry, mainBatch)).canResolve, false);
    await assert.rejects(svc.resolveHeldOpeningStockRows(dataEntry, mainBatch, { 11: { action: "use_existing", materialKey: heldRef.key } }), /System Administrator or Maintenance Manager/);

    // Not allowed: a unit conversion, or a decision on a row that is not held.
    await assert.rejects(svc.resolveHeldOpeningStockRows(manager, mainBatch, { 4: { action: "use_existing", materialKey: setMaterial2.key } }), /never converted/);

    const { rows: rowsBefore } = await batchRows(mainBatch);
    const movementsBefore = await prisma.offline_inventory_movements.count({ where: { reference_number: mainBatch } });
    const res = await svc.resolveHeldOpeningStockRows(manager, mainBatch, {
      11: { action: "use_existing", materialKey: heldRef.key },
      7: { action: "register_new" },
      8: { action: "exclude", reason: "Same item as row 7 — counted once" },
      2: { action: "register_new" }, // already posted: reported, left unchanged
    });
    assert.deepEqual(res.resolved.map((r) => [r.rowNumber, r.outcome]), [[7, "registered_new"], [8, "excluded"], [11, "posted_existing"]]);
    assert.deepEqual(res.alreadyResolved, [2]);
    assert.equal(res.stillHeld, 1);
    assert.equal(await prisma.offline_inventory_movements.count({ where: { reference_number: mainBatch } }), movementsBefore + 2);

    const { batch, byRow } = await batchRows(mainBatch);
    for (const n of [2, 3, 5, 6, 10]) {
      const was = rowsBefore.find((x) => x.row_number === n)!;
      assert.equal(byRow.get(n)!.movement_id, was.movement_id, `row ${n} untouched`);
    }
    assert.equal(byRow.get(11)!.decided_by, manager.userId);
    assert.ok(byRow.get(11)!.resolved_at);
    assert.match(byRow.get(7)!.item_code ?? "", /^AMSOS\d{4,}$/);
    assert.equal(byRow.get(8)!.resolution_note, "Same item as row 7 — counted once");
    assert.deepEqual([batch.posted_existing_count, batch.registered_new_count, batch.held_count, batch.not_imported_count, batch.excluded_count], [4, 3, 1, 1, 1]);
    assert.equal(Number(batch.posted_quantity), 25 + 5 + 1);
    const b = await balances();
    assert.equal(b.get(heldRef.key)!.balance, before0.get(heldRef.key)!.balance + 5);
    assert.equal(await prisma.audit_logs.count({ where: { action: "offline_inventory.opening_stock_held_resolved", entity_id: batch.id } }), 1);
  });

  it("a retried or concurrent resolution never posts a row twice", async () => {
    const c0 = await prisma.offline_inventory_movements.count({ where: { reference_number: mainBatch } });
    const retry = await svc.resolveHeldOpeningStockRows(manager, mainBatch, { 11: { action: "use_existing", materialKey: heldRef.key }, 7: { action: "register_new" } });
    assert.deepEqual([retry.resolved.length, retry.alreadyResolved], [0, [7, 11]]);

    const f = await xlsx("held-only.xlsx", [[itos("PARALLEL A ZQ-91010"), "Electrical", "", "", 3, "PCS"], [itos("parallel a ZQ-91010"), "Electrical", "", "", 4, "PCS"]]);
    const r = await confirm(admin, f);
    assert.deepEqual([r.held, r.postedExisting + r.registeredNew], [2, 0]);
    const d = { 2: { action: "register_new" } } as const;
    const results = await Promise.allSettled([
      svc.resolveHeldOpeningStockRows(manager, r.batchReference, d),
      svc.resolveHeldOpeningStockRows(admin, r.batchReference, d),
      svc.resolveHeldOpeningStockRows(manager, r.batchReference, d),
    ]);
    assert.ok(results.every((x) => x.status === "fulfilled"));
    const resolvedCounts = results.map((x) => (x.status === "fulfilled" ? x.value.resolved.length : -1)).sort();
    assert.deepEqual(resolvedCounts, [0, 0, 1], "exactly one resolution posts the row");
    assert.equal(await prisma.offline_inventory_movements.count({ where: { reference_number: r.batchReference } }), 1);
    assert.equal(await prisma.offline_inventory_movements.count({ where: { reference_number: mainBatch } }), c0);
  });

  it("concurrent imports of one file create one batch", async () => {
    const [m] = (await untouchedMaterials("Nos", 300)).filter((x) => ![nosMaterial.key, autoRef.key, heldRef.key].includes(x.key)).slice(-1);
    const file = await xlsx("concurrent.xlsx", [[m.name, "Automotive", "", "", 7, "PCS"], [itos("CONCURRENT FRESHITEM"), "Mechanical", "", "", 1, "PCS"]]);
    const p = await svc.previewOpeningStockImport(admin, file);
    const results = await Promise.allSettled([
      svc.confirmOpeningStockImport(admin, file, {}, uuid(), p.fingerprint),
      svc.confirmOpeningStockImport(dataEntry, file, {}, uuid(), p.fingerprint),
      svc.confirmOpeningStockImport(manager, file, {}, uuid(), p.fingerprint),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    for (const x of results) if (x.status === "rejected") assert.match(String(x.reason?.message), /already imported/);
    const sum = await prisma.offline_inventory_movements.aggregate({ where: { deleted_at: null, movement_type: "OPENING_STOCK", manual_material_name: m.name, unit: m.unit }, _sum: { quantity: true } });
    assert.equal(Number(sum._sum.quantity), 7);
    assert.equal(await prisma.inventory_material_settings.count({ where: { manual_material_name: itos("CONCURRENT FRESHITEM") } }), 1);
  });

  it("an already-stocked material fails that row only; the rest of the file still imports", async () => {
    const file = await xlsx("again.xlsx", [[nosMaterial.name, "Automotive", "", "", 6, "NOS"], [itos("AFTERWARDS ITEM"), "Mechanical", "", "", 2, "PCS"]]);
    const r = await confirm(admin, file);
    assert.deepEqual([r.failed, r.registeredNew], [1, 1]);
    assert.match(r.rows[0].message, /already recorded/);
    assert.equal((await balances()).get(nosMaterial.key)!.balance, before0.get(nosMaterial.key)!.balance + 6, "no second opening stock");
  });

  it("the database itself refuses a second posted opening-stock row for one material", async () => {
    const posted = await prisma.opening_stock_import_rows.findFirstOrThrow({ where: { outcome: "posted_existing", material_key: nosMaterial.key } });
    const other = await prisma.opening_stock_import_rows.findFirstOrThrow({ where: { outcome: "held" } });
    await assert.rejects(
      prisma.opening_stock_import_rows.update({ where: { id: other.id }, data: { outcome: "posted_existing", material_key: posted.material_key, quantity: 1, movement_id: posted.movement_id } }),
      /Unique constraint|unique/
    );
  });

  it("a reversed posting frees the material for a later import; an unmarked removal fails that row only", async () => {
    // Approved reversal: the movement is soft-deleted AND the import row marked reversed (one transaction).
    const { byRow } = await batchRows(mainBatch);
    const setRow = byRow.get(3)!;
    assert.equal(setRow.material_key, setMaterial.key);
    await prisma.$transaction([
      prisma.offline_inventory_movements.update({ where: { id: setRow.movement_id! }, data: { deleted_at: new Date() } }),
      prisma.opening_stock_import_rows.update({ where: { id: setRow.id }, data: { reversed_at: new Date(), reversed_by: admin.userId, reversal_note: "Test: approved reversal" } }),
    ]);
    const r1 = await confirm(admin, await xlsx("after-reversal.xlsx", [[setMaterial.name, "Mechanical", "", "", 5, "SET"]]));
    assert.deepEqual([r1.postedExisting, r1.failed], [1, 0], "the material receives its corrected opening stock");
    assert.equal((await balances()).get(setMaterial.key)!.balance, before0.get(setMaterial.key)!.balance + 5);

    // Movement removed outside the importer, row NOT marked reversed: that row fails, the rest imports, no crash.
    const autoRow = byRow.get(10)!;
    await prisma.offline_inventory_movements.update({ where: { id: autoRow.movement_id! }, data: { deleted_at: new Date() } });
    const r2 = await confirm(admin, await xlsx("unmarked.xlsx", [[autoRef.probe, "Automotive", "", "", 4, "PCS"], [itos("UNMARKED NEIGHBOUR"), "Mechanical", "", "", 1, "PCS"]]));
    assert.deepEqual([r2.failed, r2.registeredNew, r2.postedExisting], [1, 1, 0]);
    assert.match(r2.rows[0].message, /earlier opening-stock import already posted/);
    // Historical rows untouched: the reversed row keeps its movement link and quantity.
    const again = await prisma.opening_stock_import_rows.findUniqueOrThrow({ where: { id: setRow.id } });
    assert.deepEqual([again.outcome, again.movement_id, Number(again.quantity)], ["posted_existing", setRow.movement_id, 2]);
  });

  it("a database error rolls back the whole import, and a failed resolution leaves the row held", async () => {
    const [m] = (await untouchedMaterials("Nos", 300)).slice(-2, -1);
    const file = await xlsx("rollback.xlsx", [[m.name, "Automotive", "", "", 9, "PCS"], [itos("ROLLBACK FRESHITEM"), "Mechanical", "", "", 2, "PCS"], [itos("ROLLBACK HELD ZQ-91041"), "Mechanical", "", "", 1, "PCS"], [itos("rollback held ZQ-91041"), "Mechanical", "", "", 1, "PCS"]]);
    const p = await svc.previewOpeningStockImport(admin, file);
    const codesBefore = await prisma.inventory_material_settings.count({ where: { item_code: { startsWith: "AMSOS" } } });
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION itos_fail_rows() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'itos simulated failure'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER itos_fail_rows BEFORE INSERT ON opening_stock_import_rows FOR EACH ROW EXECUTE FUNCTION itos_fail_rows()`);
    const c0 = await counts();
    const b0 = await balances();
    try {
      await assert.rejects(svc.confirmOpeningStockImport(admin, file, {}, uuid(), p.fingerprint), /itos simulated failure/);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS itos_fail_rows ON opening_stock_import_rows");
    }
    assert.deepEqual(await counts(), c0, "nothing left behind");
    assert.equal((await balances()).get(m.key)?.balance, b0.get(m.key)?.balance);
    assert.equal(await prisma.inventory_material_settings.count({ where: { item_code: { startsWith: "AMSOS" } } }), codesBefore);

    const r = await svc.confirmOpeningStockImport(admin, file, {}, uuid(), p.fingerprint);
    assert.deepEqual([r.postedExisting, r.registeredNew, r.held], [1, 1, 2]);
    // Resolution fails on its last write → nothing changes, the row stays held.
    await prisma.$executeRawUnsafe(`CREATE TRIGGER itos_fail_update BEFORE UPDATE ON opening_stock_import_rows FOR EACH ROW EXECUTE FUNCTION itos_fail_rows()`);
    const mvBefore = await prisma.offline_inventory_movements.count();
    try {
      await assert.rejects(svc.resolveHeldOpeningStockRows(admin, r.batchReference, { 4: { action: "register_new" } }), /itos simulated failure/);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS itos_fail_update ON opening_stock_import_rows");
    }
    assert.equal(await prisma.offline_inventory_movements.count(), mvBefore);
    const { byRow } = await batchRows(r.batchReference);
    assert.equal(byRow.get(4)!.outcome, "held");
    assert.equal(await prisma.inventory_material_settings.count({ where: { manual_material_name: itos("ROLLBACK HELD ZQ-91041") } }), 0);
    const ok = await svc.resolveHeldOpeningStockRows(admin, r.batchReference, { 4: { action: "register_new" }, 5: { action: "exclude", reason: "Duplicate line of row 4" } });
    assert.deepEqual(ok.resolved.map((x) => x.outcome), ["registered_new", "excluded"]);
  });

  it("an import is refused when Inventory changed since the check", async () => {
    const file = await xlsx("stale.xlsx", [[itos("STALE ZQ-91050"), "Mechanical", "", "", 1, "PCS"]]);
    await assert.rejects(svc.confirmOpeningStockImport(admin, file, {}, uuid(), "0".repeat(64)), /changed since you checked it/);
  });

  it("AMSOS codes are sequential and unique: issued codes are never reused; archived and manually set codes are respected", async () => {
    const code = (n: number) => `AMSOS${String(n).padStart(4, "0")}`;
    const all = [
      ...(await prisma.opening_stock_import_rows.findMany({ where: { item_code: { startsWith: "AMSOS" } }, select: { item_code: true } })),
      ...(await prisma.inventory_material_settings.findMany({ where: { item_code: { startsWith: "AMSOS", mode: "insensitive" } }, select: { item_code: true } })),
    ];
    const highest = Math.max(...all.map((x) => Number(x.item_code!.slice(5))));
    const victim = await prisma.inventory_material_settings.findFirstOrThrow({ where: { item_code: { equals: code(highest), mode: "insensitive" } } });
    await prisma.inventory_material_settings.update({ where: { id: victim.id }, data: { item_code: null } });
    try {
      const r1 = await confirm(admin, await xlsx("codes1.xlsx", [[itos("CODECHECK ALPHA"), "Mechanical", "", "", 1, "PCS"], [itos("CODECHECK BRAVO"), "Mechanical", "", "", 1, "PCS"]]));
      assert.deepEqual(r1.rows.map((x) => x.itemCode), [code(highest + 1), code(highest + 2)], "sequential, and a released code is not reused");
    } finally {
      await prisma.inventory_material_settings.update({ where: { id: victim.id }, data: { item_code: victim.item_code } });
    }
    const other = await prisma.inventory_material_settings.findFirstOrThrow({ where: { item_code: { startsWith: "AMSHV" }, archived_at: null } });
    await prisma.inventory_material_settings.update({ where: { id: other.id }, data: { item_code: code(highest + 50).toLowerCase(), archived_at: new Date(), archived_by: admin.userId } });
    try {
      const r2 = await confirm(admin, await xlsx("codes2.xlsx", [[itos("CODECHECK CHARLIE"), "Mechanical", "", "", 1, "PCS"]]));
      assert.equal(r2.rows[0].itemCode, code(highest + 51));
    } finally {
      await prisma.inventory_material_settings.update({ where: { id: other.id }, data: { item_code: other.item_code, archived_at: null, archived_by: null } });
    }
    const dupes = await prisma.$queryRaw<{ n: bigint }[]>`select count(*) as n from (select upper(item_code) from inventory_material_settings where item_code is not null group by 1 having count(*) > 1) d`;
    assert.equal(Number(dupes[0].n), 0, "no duplicate Item Codes");
  });

  it("imported and resolved stock is issuable through the existing Issue Material workflow", async () => {
    const token = randomBytes(32).toString("base64url");
    const user = await prisma.auth_users.findFirstOrThrow({ where: { profile_id: dataEntry.userId } });
    await prisma.auth_sessions.create({
      data: { user_id: user.id, profile_id: dataEntry.userId, session_token_hash: createHash("sha256").update(token).digest("hex"), expires_at: new Date(Date.now() + 3600_000) },
    });
    (globalThis as { __TEST_SESSION_TOKEN?: string }).__TEST_SESSION_TOKEN = token;
    const issue = (name: string, unit: string, qty: number) => {
      const fd = new FormData();
      fd.set("movement_date", new Date().toISOString().slice(0, 10));
      fd.set("part_id", "__manual__");
      fd.set("manual_material_name", name);
      fd.set("unit", unit);
      fd.set("quantity", String(qty));
      fd.set("counterparty", "ITOS test workshop");
      return inventoryActions.issueOfflineMaterialAction({ ok: false } as never, fd);
    };
    const hoseKey = data.buildBalanceKey({ part_id: null, manual_material_name: newHose(), unit: "MTR" });
    assert.deepEqual(await issue(newHose(), "MTR", 4), { ok: true });
    assert.equal((await balances()).get(hoseKey)!.balance, 6);
    const tooMuch = await issue(newHose(), "MTR", 7);
    assert.equal(tooMuch?.ok, false);
    assert.match(String((tooMuch as { error?: string }).error), /Not enough stock/);
    // Stock posted by resolving a held row is issuable in the material's own unit.
    assert.deepEqual(await issue(heldRef.name, heldRef.unit, 5), { ok: true });
    assert.equal((await balances()).get(heldRef.key)!.balance, before0.get(heldRef.key)!.balance);
  });
});
