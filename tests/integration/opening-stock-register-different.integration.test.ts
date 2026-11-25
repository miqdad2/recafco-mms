// "Register as Different Material" — integration tests on a REAL, DISPOSABLE
// copy shaped like production after the opening-stock import: the approved
// FINAL file (275 rows) imported and 47 held rows resolved by the PREVIOUS
// application version (migrations up to 20261125), leaving 13 held; then the
// new migrations applied. Runs only when asked:
//
//   DATABASE_URL=postgresql://.../recafco_prodlike_test \
//   OPENING_STOCK_HELD_SCENARIOS=1 \
//   node --import ./tests/integration/register.mjs --test tests/integration/opening-stock-register-different.integration.test.ts
//
// It never decides whether two physical items are the same: the "Manager"
// decisions here only exercise the rules.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { register } from "node:module";
import { after, before, describe, it } from "node:test";

const enabled = process.env.OPENING_STOCK_HELD_SCENARIOS === "1";
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

describe("Register as Different Material — production-like batch, 13 held rows (disposable DB)", { skip: !enabled }, () => {
  register("./session-stub-hooks.mjs", import.meta.url);
  type Svc = typeof import("@/lib/backend/store/opening-stock-verification");
  type Ctx = Parameters<Svc["listVerificationEntries"]>[0];
  type Override = { confirmed: boolean; evidenceType: "specification" | "physical_evidence"; evidence: string };
  let prisma: typeof import("@/lib/db/prisma").prisma;
  let svc: Svc;
  let data: typeof import("@/lib/store/offline-inventory-data");
  let actions: typeof import("@/app/actions/offline-inventory");
  let admin: Ctx, manager: Ctx, dataEntry: Ctx;
  let before0: Map<string, number>;
  let codesBefore: Map<string, string | null>;
  let completedBefore: string;

  async function contextFor(slug: string): Promise<Ctx> {
    const profile = await prisma.profiles.findFirst({ where: { is_active: true, roles: { slug } }, include: { roles: true } });
    assert.ok(profile, `an active ${slug} profile is required`);
    const perms = await prisma.$queryRaw<{ key: string }[]>`select p.key from role_permissions rp join permissions p on p.id = rp.permission_id where rp.role_id = ${profile.role_id}::uuid`;
    return {
      userId: profile.id, authUserId: profile.id, email: null, mustResetPassword: false,
      profile: { id: profile.id, full_name: profile.full_name, employee_number: null, phone: null, job_title: null, department_id: profile.department_id, role_id: profile.role_id, is_active: true, can_view_costs: true },
      department: null, role: { id: profile.roles!.id, name: profile.roles!.name, slug: profile.roles!.slug }, permissions: perms.map((p) => p.key),
    } as unknown as Ctx;
  }
  const entries = async (ctx: Ctx = manager) => (await svc.listVerificationEntries(ctx)).entries;
  const row = async (n: number, ctx: Ctx = manager) => (await entries(ctx)).find((e) => e.rowNumber === n)!;
  async function balances() {
    const { balanceItems, archivedItems } = await data.getOfflineInventoryBalance();
    return new Map([...balanceItems, ...archivedItems].map((b) => [b.key, b.balance]));
  }
  // The rows resolved by the previous version, exactly as they were.
  async function completedFingerprint() {
    const rows = await prisma.$queryRaw<{ f: string }[]>`
      select md5(string_agg(concat_ws('|', row_number, outcome, material_key, material_name, material_unit, item_code, quantity, movement_id, decided_by, resolved_at, resolution_note), ',' order by row_number)) as f
      from opening_stock_import_rows where outcome <> 'held' and row_number not in (select row_number from opening_stock_import_rows r2 where r2.id in (select row_id from opening_stock_row_events))`;
    return rows[0].f;
  }
  const reason = "Compared both items in the store: different body and thread size";
  const override: Override = { confirmed: true, evidenceType: "specification", evidence: "Measured on the shelf: outer diameter 93 mm vs 76 mm; thread M16x1.5 vs 3/4-16 UNF" };
  const different = (keys: string[], over: Partial<{ confirmedDifferent: boolean; reason: string; exactMatchOverride: Override }> = {}) =>
    ({ action: "register_different" as const, confirmedDifferent: true, reason, comparedKeys: keys, ...over });

  before(async () => {
    ({ prisma } = await import("@/lib/db/prisma"));
    svc = await import("@/lib/backend/store/opening-stock-verification");
    data = await import("@/lib/store/offline-inventory-data");
    actions = await import("@/app/actions/offline-inventory");
    [admin, manager, dataEntry] = await Promise.all(["super_admin", "maintenance_manager", "maintenance_data_entry"].map(contextFor));
    before0 = await balances();
    codesBefore = new Map((await prisma.inventory_material_settings.findMany({ select: { manual_material_name: true, unit: true, item_code: true } })).map((s) => [`${s.manual_material_name}|${s.unit}`, s.item_code]));
    completedBefore = await completedFingerprint();
  });
  after(async () => {
    await prisma?.$disconnect();
  });

  it("reads the batch resolved by the previous version: 275 rows, 262 completed, 13 waiting, old decisions shown", async () => {
    const list = await svc.listVerificationEntries(manager);
    assert.equal(list.entries.length, 275);
    assert.equal(list.pending, 13);
    assert.equal(list.counts.completed + list.counts.excluded, 262);
    const oldResolved = list.entries.filter((e) => e.status !== "completed" || e.history.length === 0).filter((e) => e.status === "completed" || e.status === "excluded");
    const byOld = oldResolved.filter((e) => e.lastUpdatedBy === manager.profile!.full_name);
    assert.ok(byOld.length >= 47, "rows resolved on the import page show who decided them");
    assert.ok(oldResolved.every((e) => e.version === 0 && e.history.length === 0 && e.final !== null), "no history invented for old decisions");
    const held = list.entries.filter((e) => e.status === "needs_verification");
    const table = held.map((e) => ({
      row: e.rowNumber,
      excel: `${e.original.name} — ${e.original.quantity} ${e.original.unit}`,
      sameNumber: e.sameReference.map((c) => `${c.itemCode} (${c.unit})`).join(" + "),
      issue: e.issue?.label,
      exactMatch: e.exactMatch.map((c) => c.itemCode).join(" + "),
      exception: e.differentBlock ? "blocked: " + e.differentBlock.slice(0, 60) : e.exactMatch.length ? "exact match: exceptional approval needed" : "possible",
    }));
    console.log(JSON.stringify({ held: table }, null, 1));
    assert.deepEqual(held.map((e) => e.rowNumber).sort((a, b) => a - b), [10, 50, 53, 59, 60, 61, 62, 70, 88, 89, 104, 107, 128]);
    assert.ok(held.every((e) => e.sameReference.length > 0), "all 13 are blocked by an exact part number");
    const unitOnly = held.filter((e) => /only difference found .* is the unit/.test(e.differentBlock ?? "")).map((e) => e.rowNumber);
    assert.deepEqual(unitOnly.sort((a, b) => a - b), [10, 50, 62, 104, 128]);
    const exact = held.filter((e) => !e.differentBlock && e.exactMatch.length > 0).map((e) => e.rowNumber);
    assert.deepEqual(exact.sort((a, b) => a - b), [61, 88, 89]);
  });

  it("Data Entry can propose (no stock) but cannot approve", async () => {
    const r88 = await row(88, dataEntry);
    await svc.saveVerificationCorrection(dataEntry, { rowId: r88.id, version: r88.version, values: { materialName: null, partNumber: null, category: null, unit: null, quantity: null, remarks: null }, proposedMaterialKey: null, reason: "", submit: true, proposeDifferent: true, differentReason: "Neither primary nor secondary: a third FF5488 variant on the shelf" });
    const proposed = await row(88);
    assert.equal(proposed.status, "waiting_for_manager");
    assert.deepEqual(await balances(), before0, "a proposal posts nothing");
    await assert.rejects(svc.resolveVerificationEntry(dataEntry, { rowId: proposed.id, version: proposed.version, decision: different(proposed.sameReference.map((c) => c.key), { exactMatchOverride: override }) }), /Maintenance Manager or System Administrator/);
  });

  it("an exact match is blocked by default; the exceptional approval needs its own documented evidence", async () => {
    const r = await row(88);
    const keys = r.sameReference.map((c) => c.key);
    assert.equal(r.exactMatch.length, 2);
    await assert.rejects(svc.resolveVerificationEntry(manager, { rowId: r.id, version: r.version, decision: { action: "register_new" } }), /already has this part number/, "normal duplicate prevention");
    await assert.rejects(svc.resolveVerificationEntry(manager, { rowId: r.id, version: r.version, decision: different(keys) }), /exact match to AMSHV1127, AMSHV1128.*separate exceptional approval/);
    await assert.rejects(svc.resolveVerificationEntry(manager, { rowId: r.id, version: r.version, decision: different(keys, { exactMatchOverride: { ...override, confirmed: false } }) }), /exceptional approval/);
    await assert.rejects(svc.resolveVerificationEntry(manager, { rowId: r.id, version: r.version, decision: different(keys, { exactMatchOverride: { ...override, evidence: "It is a different filter" } }) }), /at least 30 characters/);
    await assert.rejects(svc.resolveVerificationEntry(manager, { rowId: r.id, version: r.version, decision: different(keys, { reason: override.evidence, exactMatchOverride: override }) }), /its own evidence/);
    assert.deepEqual(await balances(), before0, "nothing posted by refused decisions");
    const result = await svc.resolveVerificationEntry(manager, { rowId: r.id, version: r.version, decision: different(keys, { exactMatchOverride: override }) });
    assert.equal(result.outcome, "registered_new");
    assert.match(result.itemCode ?? "", /^AMSOS\d{4,}$/);
    assert.deepEqual([result.quantity, result.unit, result.materialName], [2, "PCS", "FUEL FILTER -FF5488"], "Excel quantity, unit and description kept");
    const done = await row(88);
    const ev = done.history.at(-1)!;
    assert.equal(ev.action, "registered_different");
    assert.deepEqual((ev.details.exactMatchOverride as { evidenceType: string; evidence: string }).evidenceType, "specification");
    const audits = await prisma.audit_logs.findMany({ where: { entity_id: done.id, action: { in: ["offline_inventory.opening_stock_registered_different", "offline_inventory.opening_stock_exact_match_override"] } } });
    assert.deepEqual(audits.map((a) => a.action).sort(), ["offline_inventory.opening_stock_exact_match_override", "offline_inventory.opening_stock_registered_different"], "separate exceptional approval record");
    assert.ok(audits.every((a) => a.actor_id === manager.userId));
    const b = await balances();
    for (const k of keys) assert.equal(b.get(k), before0.get(k), "existing materials untouched");
    await assert.rejects(svc.resolveVerificationEntry(manager, { rowId: done.id, version: r.version, decision: different(keys, { exactMatchOverride: override }) }), /already completed|changed by someone else/);
  });

  it("a genuinely distinct material (a real difference found) needs no exceptional approval", async () => {
    const r = await row(70);
    assert.equal(r.exactMatch.length, 0);
    assert.equal(r.differentBlock, null);
    const res = await svc.resolveVerificationEntry(admin, { rowId: r.id, version: r.version, decision: different(r.sameReference.map((c) => c.key)) });
    assert.equal(res.outcome, "registered_new");
    const ev = (await row(70)).history.at(-1)!;
    assert.equal(ev.action, "registered_different");
    assert.equal(ev.details.exactMatchOverride, undefined);
    assert.equal(await prisma.audit_logs.count({ where: { entity_id: r.id, action: "offline_inventory.opening_stock_exact_match_override" } }), 0);
  });

  it("concurrent exceptional approvals post once", async () => {
    const r = await row(61);
    const keys = r.sameReference.map((c) => c.key);
    const results = await Promise.allSettled([
      svc.resolveVerificationEntry(manager, { rowId: r.id, version: r.version, decision: different(keys, { exactMatchOverride: override }) }),
      svc.resolveVerificationEntry(admin, { rowId: r.id, version: r.version, decision: different(keys, { exactMatchOverride: override }) }),
      svc.resolveVerificationEntry(admin, { rowId: r.id, version: r.version, decision: different(keys, { exactMatchOverride: override }) }),
    ]);
    assert.equal(results.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal(await prisma.opening_stock_row_events.count({ where: { row_id: r.id, action: "registered_different" } }), 1);
    assert.equal(await prisma.inventory_material_settings.count({ where: { manual_material_name: "UD OIL ELEMENT-15274-99386" } }), 1);
  });

  it("a corrected row that becomes an exact match is blocked by default; Use Existing still works", async () => {
    const r10 = await row(10, admin);
    await assert.rejects(svc.resolveVerificationEntry(admin, { rowId: r10.id, version: r10.version, decision: different(r10.sameReference.map((c) => c.key)) }), /unit mismatch is not a reason/);
    await svc.saveVerificationCorrection(admin, { rowId: r10.id, version: r10.version, values: { materialName: null, partNumber: null, category: null, unit: "SET", quantity: null, remarks: null }, proposedMaterialKey: null, reason: "Store confirms it is sold as a set", submit: true });
    const fixed = await row(10, admin);
    assert.equal(fixed.issue?.code, "ready");
    assert.deepEqual(fixed.exactMatch.map((c) => c.itemCode), ["AMSLV0016"], "now an exact match");
    await assert.rejects(svc.resolveVerificationEntry(admin, { rowId: fixed.id, version: fixed.version, decision: different(fixed.sameReference.map((c) => c.key)) }), /exact match to AMSLV0016/);
    const posted = await svc.resolveVerificationEntry(admin, { rowId: fixed.id, version: fixed.version, decision: { action: "use_existing", materialKey: fixed.sameReference[0].key } });
    assert.deepEqual([posted.outcome, posted.itemCode, posted.quantity, posted.unit], ["posted_existing", "AMSLV0016", 3, "Set"]);
  });

  it("rows completed by the previous version, Item Codes and their stock are unchanged; new codes are unique; new stock issues", async () => {
    assert.equal(await completedFingerprint(), completedBefore, "old decisions untouched");
    const settings = await prisma.inventory_material_settings.findMany({ select: { manual_material_name: true, unit: true, item_code: true } });
    for (const s of settings) {
      const prev = codesBefore.get(`${s.manual_material_name}|${s.unit}`);
      if (prev !== undefined) assert.equal(s.item_code, prev, "no existing Item Code changed");
    }
    const upper = settings.filter((s) => s.item_code).map((s) => s.item_code!.toUpperCase());
    assert.equal(new Set(upper).size, upper.length, "Item Codes unique");
    const b = await balances();
    for (const [k, v] of before0) if (b.get(k) !== v) assert.ok(k === "manual:filter: oil filter (part no: 25195785) chevrolet aveo|set", `only row 10's material changed (${k})`);

    const r = await row(88);
    const token = randomBytes(32).toString("base64url");
    const user = await prisma.auth_users.findFirstOrThrow({ where: { profile_id: dataEntry.userId } });
    await prisma.auth_sessions.create({ data: { user_id: user.id, profile_id: dataEntry.userId, session_token_hash: createHash("sha256").update(token).digest("hex"), expires_at: new Date(Date.now() + 3600_000) } });
    (globalThis as { __TEST_SESSION_TOKEN?: string }).__TEST_SESSION_TOKEN = token;
    const fd = new FormData();
    fd.set("movement_date", new Date().toISOString().slice(0, 10));
    fd.set("part_id", "__manual__");
    fd.set("manual_material_name", r.final!.materialName!);
    fd.set("unit", r.final!.unit!);
    fd.set("quantity", "1");
    fd.set("counterparty", "Exception test");
    assert.deepEqual(await actions.issueOfflineMaterialAction({ ok: false } as never, fd), { ok: true });
    assert.equal((await balances()).get(data.buildBalanceKey({ part_id: null, manual_material_name: r.final!.materialName!, unit: r.final!.unit! })), 1);
  });
});
