// Job Card Required Materials — manual materials and outside services, against
// a REAL, DISPOSABLE copy of the database (DATABASE_URL must end in "_test").
// Uses the real New Job Card creation service, the real Edit Job Card server
// action and the real Process Materials service.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { register } from "node:module";
import { after, before, describe, it } from "node:test";

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
const creation = await import("@/lib/backend/work-orders/job-card-creation");
const processing = await import("@/lib/backend/work-orders/material-processing");
const { getMaterialFulfillmentForWorkOrder } = await import("@/lib/work-orders/material-fulfillment");
const { getClosureRequirementFactsFor } = await import("@/lib/work-orders/closure-requirements-data");
const inventory = await import("@/lib/store/offline-inventory-data");
const maintenance = await import("@/app/actions/maintenance");

type Ctx = Parameters<typeof creation.createJobCardFromForm>[0];
const RUN = String(Date.now()).slice(-6);

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

async function signIn(ctx: Ctx) {
  const token = randomBytes(32).toString("base64url");
  const user = await prisma.auth_users.findFirstOrThrow({ where: { profile_id: ctx.userId } });
  await prisma.auth_sessions.create({ data: { user_id: user.id, profile_id: ctx.userId, session_token_hash: createHash("sha256").update(token).digest("hex"), expires_at: new Date(Date.now() + 3600_000) } });
  (globalThis as { __TEST_SESSION_TOKEN?: string }).__TEST_SESSION_TOKEN = token;
}

type Line =
  | { kind: "inventory"; name: string; key: string; qty: string; unit: string }
  | { kind: "manual"; description: string; qty: string; unit: string; notes?: string; staleKey?: string };

let assetId = "";
let stockMaterial: { key: string; name: string; unit: string };

// The form the New Job Card wizard posts (Step 4 = req_part_*_<i>).
function wizardForm(label: string, lines: Line[], intent: "save_draft" | "submit_for_approval" = "submit_for_approval") {
  const fd = new FormData();
  fd.set("intent", intent);
  fd.set("asset_id", assetId);
  fd.set("ordered_by", `Manual Req ${RUN} ${label}`);
  fd.set("date_of_order", "2026-11-28");
  fd.set("maintenance_type", "Repair");
  fd.set("worker_type", "Mechanical");
  fd.set("priority", "Normal");
  fd.set("operator_complaint", "Engine does not start");
  fd.set("req_parts_inventory_first", "1");
  lines.forEach((l, i) => {
    fd.set(`req_part_entry_type_${i}`, l.kind);
    if (l.kind === "inventory") {
      fd.set(`req_part_description_${i}`, l.name);
      fd.set(`req_part_material_key_${i}`, l.key);
      fd.set(`req_part_quantity_${i}`, l.qty);
      fd.set(`req_part_entered_unit_${i}`, l.unit);
      fd.set(`req_part_uom_${i}`, l.unit);
    } else {
      fd.set(`req_part_description_${i}`, l.description);
      fd.set(`req_part_material_key_${i}`, l.staleKey ?? "");
      fd.set(`req_part_quantity_${i}`, l.qty);
      fd.set(`req_part_entered_unit_${i}`, l.unit);
      fd.set(`req_part_uom_${i}`, l.unit);
      fd.set(`req_part_notes_${i}`, l.notes ?? "");
    }
  });
  return fd;
}

async function create(ctx: Ctx, label: string, lines: Line[], submissionId: string = crypto.randomUUID()) {
  return creation.createJobCardFromForm(ctx, wizardForm(label, lines), { submissionId, correlationId: crypto.randomUUID(), route: "test" });
}

async function createOk(ctx: Ctx, label: string, lines: Line[]) {
  const r = await create(ctx, label, lines);
  assert.ok(r.ok, `Job Card should be created: ${!r.ok ? r.message : ""}`);
  return r.jobCard.id;
}

const rowsOf = (workOrderId: string) =>
  prisma.workOrderRequiredPart.findMany({ where: { work_order_id: workOrderId }, orderBy: [{ created_at: "asc" }, { id: "asc" }] });

async function stockSnapshot() {
  const [movements, settings, balance] = await Promise.all([
    prisma.offline_inventory_movements.count(),
    prisma.inventory_material_settings.count(),
    inventory.getOfflineInventoryBalance(),
  ]);
  return { movements, settings, materials: balance.balanceItems.length };
}

let dataEntry: Ctx, manager: Ctx, admin: Ctx;
let before0: Awaited<ReturnType<typeof stockSnapshot>>;

describe("Job Card manual materials and outside services (disposable DB)", () => {
  before(async () => {
    [dataEntry, manager, admin] = await Promise.all(["maintenance_data_entry", "maintenance_manager", "super_admin"].map(contextFor));
    const asset = await prisma.assets.findFirst({ where: { deleted_at: null }, select: { id: true } });
    assert.ok(asset, "an asset is required in the test database");
    assetId = asset.id;
    const { balanceItems } = await inventory.getOfflineInventoryBalance();
    const m = balanceItems.find((b) => b.part_id === null && b.balance > 5 && b.unit.trim()) ?? balanceItems.find((b) => b.part_id === null);
    assert.ok(m, "an Inventory material is required in the test database");
    stockMaterial = { key: m.key, name: m.display_name, unit: m.unit };
    before0 = await stockSnapshot();
  });
  after(async () => {
    await prisma.$disconnect();
  });

  it("1. an Inventory-only Job Card is saved exactly as before (linked row, Materials Request item)", async () => {
    const id = await createOk(dataEntry, "inv", [{ kind: "inventory", name: stockMaterial.name, key: stockMaterial.key, qty: "1", unit: stockMaterial.unit }]);
    const [row] = await rowsOf(id);
    assert.deepEqual([row.entry_type, row.inventory_material_key, row.unit_of_measure], ["inventory", stockMaterial.key, stockMaterial.unit]);
    const items = await prisma.parts_request_items.findMany({ where: { parts_requests: { work_order_id: id } } });
    assert.equal(items.length, 1, "the auto-created Materials Request has the Inventory line");
    assert.equal((await getMaterialFulfillmentForWorkOrder(prisma, id)).length, 1);
  });

  it("2/4/6. a manual-only Job Card saves several manual lines with their own units; no Materials Request, no stock", async () => {
    const id = await createOk(dataEntry, "manual", [
      { kind: "manual", description: "  Starter Motor   Repairing ", qty: "1", unit: "job" },
      { kind: "manual", description: "Special Hydraulic Hose", qty: "2.5", unit: "MTR", notes: "Ask stores first" },
      { kind: "manual", description: "Radiator Repair", qty: "1", unit: "SERVICE" },
    ]);
    const rows = await rowsOf(id);
    assert.deepEqual(
      rows.map((r) => [r.entry_type, r.description, Number(r.quantity_required), r.unit_of_measure, r.part_id, r.inventory_material_key, r.part_number, r.availability_status]),
      [
        ["manual", "Starter Motor Repairing", 1, "JOB", null, null, null, "not_applicable"],
        ["manual", "Special Hydraulic Hose", 2.5, "MTR", null, null, null, "not_applicable"],
        ["manual", "Radiator Repair", 1, "SERVICE", null, null, null, "not_applicable"],
      ]
    );
    assert.equal(rows[1].notes, "Ask stores first");
    assert.equal(await prisma.parts_requests.count({ where: { work_order_id: id } }), 0, "no Materials Request for manual lines");
    assert.equal((await getMaterialFulfillmentForWorkOrder(prisma, id)).length, 0, "not tracked as Inventory");
    assert.equal((await getClosureRequirementFactsFor(prisma, id)).materialsPresent, true, "listed materials count for closure");
  });

  it("3. a mixed Job Card keeps both kinds apart; the Materials Request gets the Inventory line only", async () => {
    const id = await createOk(dataEntry, "mixed", [
      { kind: "inventory", name: stockMaterial.name, key: stockMaterial.key, qty: "2", unit: stockMaterial.unit },
      { kind: "manual", description: "Engine Water Pump Repair", qty: "1", unit: "JOB" },
    ]);
    const rows = await rowsOf(id);
    assert.deepEqual(rows.map((r) => r.entry_type), ["inventory", "manual"]);
    const items = await prisma.parts_request_items.findMany({ where: { parts_requests: { work_order_id: id } }, select: { description: true } });
    assert.deepEqual(items.map((i) => i.description), [stockMaterial.name]);
    const f = await getMaterialFulfillmentForWorkOrder(prisma, id);
    assert.deepEqual(f.map((x) => x.description), [stockMaterial.name]);
  });

  it("5. description, quantity and unit are validated; an Inventory line must still be chosen from Inventory", async () => {
    const cases: Array<[Line, RegExp]> = [
      [{ kind: "manual", description: "Radiator Repair", qty: "0", unit: "JOB" }, /greater than 0/],
      [{ kind: "manual", description: "Radiator Repair", qty: "-2", unit: "JOB" }, /greater than 0/],
      [{ kind: "manual", description: "Radiator Repair", qty: "1.234", unit: "JOB" }, /greater than 0/],
      [{ kind: "manual", description: "Radiator Repair", qty: "1", unit: "" }, /Choose the unit/],
      [{ kind: "manual", description: "Radiator Repair", qty: "", unit: "JOB" }, /Enter the quantity/],
      [{ kind: "inventory", name: "Not in Inventory at all", key: "", qty: "1", unit: "PCS" }, /not in Inventory/],
    ];
    const count0 = await prisma.work_orders.count();
    for (const [l, pattern] of cases) {
      const r = await create(dataEntry, "invalid", [l]);
      assert.equal(r.ok, false);
      assert.match(!r.ok ? r.message : "", pattern);
    }
    assert.equal(await prisma.work_orders.count(), count0, "nothing saved");
  });

  it("7/16. a manual line never keeps an Inventory key, even when one is posted with it", async () => {
    const id = await createOk(dataEntry, "stale", [{ kind: "manual", description: "Outside machining work", qty: "1", unit: "JOB", staleKey: stockMaterial.key }]);
    const [row] = await rowsOf(id);
    assert.deepEqual([row.entry_type, row.inventory_material_key, row.part_id], ["manual", null, null]);
    await assert.rejects(
      prisma.workOrderRequiredPart.create({ data: { work_order_id: id, entry_type: "manual", description: "Bad", unit_of_measure: "JOB", quantity_required: 1, inventory_material_key: stockMaterial.key } }),
      /work_order_required_parts_manual_shape_check/,
      "the database refuses an Inventory key on a manual line"
    );
  });

  it("20. a repeated save of the same New Job Card creates no second Job Card or requirement", async () => {
    const submissionId = crypto.randomUUID();
    const lines: Line[] = [{ kind: "manual", description: "Welding service", qty: "1", unit: "SERVICE" }];
    const first = await create(dataEntry, "replay", lines, submissionId);
    const second = await create(dataEntry, "replay", lines, submissionId);
    assert.ok(first.ok && second.ok);
    assert.equal(second.replayed, true);
    assert.equal(second.jobCard.id, first.jobCard.id);
    assert.equal((await rowsOf(first.jobCard.id)).length, 1);
  });

  it("14/15/16. Process Materials ignores manual lines: no receive, no issue, no Inventory material", async () => {
    const id = await createOk(dataEntry, "process", [{ kind: "manual", description: `Unique Outside Repair ${RUN}`, qty: "1", unit: "JOB" }]);
    const result = await processing.processJobCardMaterials(admin, id);
    assert.deepEqual([result.receivedCount, result.issuedCount], [0, 0]);
    assert.equal(await prisma.offline_inventory_movements.count({ where: { manual_material_name: `Unique Outside Repair ${RUN}` } }), 0);
    assert.equal(await prisma.offline_inventory_movements.count({ where: { related_work_order_id: id } }), 0);
  });

  it("8/10/11. Edit Job Card: manual lines are edited, added and removed; Inventory lines are untouched; a repeat adds nothing", async () => {
    const id = await createOk(dataEntry, "edit", [
      { kind: "inventory", name: stockMaterial.name, key: stockMaterial.key, qty: "1", unit: stockMaterial.unit },
      { kind: "manual", description: "Starter Motor Repairing", qty: "1", unit: "JOB" },
      { kind: "manual", description: "Radiator Repair", qty: "1", unit: "JOB" },
    ]);
    const [inv, starter, radiator] = await rowsOf(id);
    await signIn(manager);
    const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id } });
    const editForm = (manual: Array<{ id?: string; description: string; qty: string; unit: string; notes?: string }>) => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("ordered_by", wo.ordered_by);
      fd.set("date_of_order", "2026-11-28");
      fd.set("maintenance_type", wo.maintenance_type);
      fd.set("worker_type", wo.worker_type);
      fd.set("priority", wo.priority);
      fd.set("operator_complaint", wo.operator_complaint ?? "");
      fd.set("asset_id", wo.asset_id ?? "");
      fd.set("manual_req_present", "1");
      manual.forEach((m, i) => {
        fd.set(`manual_req_id_${i}`, m.id ?? "");
        fd.set(`manual_req_description_${i}`, m.description);
        fd.set(`manual_req_quantity_${i}`, m.qty);
        fd.set(`manual_req_unit_${i}`, m.unit);
        fd.set(`manual_req_notes_${i}`, m.notes ?? "");
      });
      return fd;
    };
    const save = async (fd: FormData) => {
      try {
        return await maintenance.saveJobCardEditAction(null, fd);
      } catch (error) {
        // A successful save redirects to the Job Card (NEXT_REDIRECT).
        const digest = String((error as { digest?: string }).digest ?? "");
        if (digest.includes("NEXT_REDIRECT")) return { redirected: digest };
        throw error;
      }
    };
    const changed = [
      { id: starter.id, description: "Starter Motor Repairing (rewind)", qty: "2", unit: "SERVICE", notes: "Outside workshop" },
      { description: "Outside machining work", qty: "1", unit: "JOB" },
    ];
    const r1 = await save(editForm(changed));
    assert.match(String((r1 as { redirected?: string }).redirected), /success=work-order-saved/);
    const after1 = await rowsOf(id);
    assert.deepEqual(after1.filter((r) => r.entry_type === "inventory").map((r) => [r.id, r.inventory_material_key, Number(r.quantity_required)]), [[inv.id, inv.inventory_material_key, Number(inv.quantity_required)]], "Inventory line untouched");
    const manualAfter = after1.filter((r) => r.entry_type === "manual");
    assert.deepEqual(manualAfter.map((r) => [r.description, Number(r.quantity_required), r.unit_of_measure, r.notes]), [
      ["Starter Motor Repairing (rewind)", 2, "SERVICE", "Outside workshop"],
      ["Outside machining work", 1, "JOB", null],
    ]);
    assert.equal(manualAfter[0].id, starter.id, "edited in place");
    assert.ok(!after1.some((r) => r.id === radiator.id), "removed line is gone");
    const audit = await prisma.audit_logs.findFirstOrThrow({ where: { entity_id: id, action: "work_order.update" }, orderBy: { created_at: "desc" } });
    assert.match(audit.summary ?? "", /Manual materials \/ outside services/);
    const meta = audit.metadata as { manualRequirements: { added: unknown[]; updated: unknown[]; removed: unknown[] } };
    assert.deepEqual([meta.manualRequirements.added.length, meta.manualRequirements.updated.length, meta.manualRequirements.removed.length], [1, 1, 1]);

    // The same form posted again (double click / retry) adds no second "Outside machining work".
    await save(editForm(changed));
    assert.equal((await rowsOf(id)).filter((r) => r.description === "Outside machining work").length, 1);

    // Validation and stale ids are refused with a plain message; nothing changes.
    const bad = await save(editForm([{ description: "Radiator Repair", qty: "0", unit: "JOB" }]));
    assert.match(String((bad as { error?: string }).error), /greater than 0/);
    const stale = await save(editForm([{ id: inv.id, description: "Hijack the Inventory line", qty: "1", unit: "JOB" }]));
    assert.match(String((stale as { error?: string }).error), /changed since you opened it/);
    // A crafted post putting manual lines into the older Inventory fields is refused.
    const crafted = editForm(changed);
    crafted.set("req_parts_inventory_first", "1");
    crafted.set("req_part_entry_type_0", "manual");
    crafted.set("req_part_description_0", "Sneaky manual line");
    crafted.set("req_part_quantity_0", "1");
    crafted.set("req_part_entered_unit_0", "JOB");
    crafted.set("req_part_material_key_0", stockMaterial.key);
    const refusedCrafted = await save(crafted);
    assert.match(String((refusedCrafted as { error?: string }).error), /edited in their own list/);
    assert.equal((await rowsOf(id)).length, 3);
    assert.equal((await rowsOf(id)).filter((r) => r.entry_type === "manual" && (r.part_id || r.inventory_material_key)).length, 0);
  });

  it("18. closure: manual lines count as materials present and never read as materials pending", async () => {
    const { getClosureReadinessForWorkOrders } = await import("@/lib/work-orders/closure-readiness-data");
    const manualOnly = await createOk(dataEntry, "closure-manual", [{ kind: "manual", description: "Starter Motor Repairing", qty: "1", unit: "JOB" }]);
    const mixed = await createOk(dataEntry, "closure-mixed", [
      { kind: "inventory", name: stockMaterial.name, key: stockMaterial.key, qty: "1", unit: stockMaterial.unit },
      { kind: "manual", description: "Radiator Repair", qty: "1", unit: "JOB" },
    ]);
    const readiness = await getClosureReadinessForWorkOrders(prisma, [manualOnly, mixed]);
    const manualReasons = readiness.get(manualOnly)!.reasons;
    assert.ok(!manualReasons.includes("Required materials not fully issued"), "a manual line is never 'not issued'");
    assert.ok(!manualReasons.some((r) => /No materials added/.test(r)), "manual lines are materials on the Job Card");
    // The Inventory line still blocks until it is issued, exactly as before.
    assert.ok(readiness.get(mixed)!.reasons.includes("Required materials not fully issued"));
  });

  it("19. older requirement rows (saved before this change) stay Inventory lines and keep working", async () => {
    const id = await createOk(dataEntry, "legacy", []);
    await prisma.$executeRaw`insert into work_order_required_parts (work_order_id, description, quantity_required, unit_of_measure) values (${id}::uuid, ${stockMaterial.name}, 1, ${stockMaterial.unit})`;
    const [row] = await rowsOf(id);
    assert.equal(row.entry_type, "inventory", "the column default keeps older rows as Inventory lines");
    assert.equal((await getMaterialFulfillmentForWorkOrder(prisma, id)).length, 1);
  });

  it("14/15. stock, Inventory materials and Item Codes are unchanged by manual lines", async () => {
    const now = await stockSnapshot();
    assert.equal(now.settings, before0.settings, "no Inventory material / Item Code created");
    assert.equal(now.materials, before0.materials, "no Inventory identity created");
    // The only movements are none: Job Card creation never posts stock.
    assert.equal(now.movements, before0.movements);
  });
});
