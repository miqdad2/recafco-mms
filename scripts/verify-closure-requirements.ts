/**
 * No Workers / No Materials Required before closure — integration checks
 * that call the real backend services in-process (what the Server Actions
 * call).
 *
 * DESTRUCTIVE: creates workers, Job Cards, assignments, work periods,
 * Materials Requests, confirmations and closure decisions. Run it ONLY
 * against a throw-away copy of the database with migration
 * 20261028000000_job_card_requirement_confirmations applied:
 *
 *   createdb + pg_restore a dump of the dev DB into recafco_requirements_test
 *   DATABASE_URL=<test db url> npx prisma migrate deploy
 *   DATABASE_URL=<test db url> node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --experimental-transform-types --import ./scripts/integration-register.mjs \
 *     scripts/verify-closure-requirements.ts
 *
 * Refuses to run unless the database name contains "test".
 */

import type { CurrentUserContext } from "@/lib/auth/context";
import type { PermissionKey, RoleSlug } from "@/types/database";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!/test/i.test(dbName)) {
  console.error(`Refusing to run against "${dbName}": the database name must contain "test".`);
  process.exit(2);
}

const { prisma } = await import("@/lib/db/prisma");
const requirements = await import("@/lib/backend/work-orders/closure-requirements");
const service = await import("@/lib/backend/work-orders/service");
const sessions = await import("@/lib/backend/work-orders/work-sessions");
const roster = await import("@/lib/backend/work-orders/worker-roster");
const partsRequests = await import("@/lib/backend/parts-requests/service");
const { getClosureReadinessForWorkOrders } = await import("@/lib/work-orders/closure-readiness-data");
const { getWorkOrderLaborSummariesBulk } = await import("@/lib/work-orders/work-session-totals");
const { getMaterialFulfillmentForWorkOrders } = await import("@/lib/work-orders/material-fulfillment");

// ── Harness ──────────────────────────────────────────────────────────────────

const results: Array<{ id: string; pass: boolean }> = [];
async function check(id: string, name: string, fn: () => Promise<string | void>) {
  try {
    const detail = await fn();
    results.push({ id, pass: true });
    console.log(`PASS  ${id.padEnd(4)} ${name}${detail ? `  — ${detail}` : ""}`);
  } catch (error) {
    results.push({ id, pass: false });
    console.log(`FAIL  ${id.padEnd(4)} ${name}  — ${error instanceof Error ? error.message : String(error)}`);
  }
}
function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
async function rejects(promise: Promise<unknown>, pattern: RegExp, label = "call"): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    assert(pattern.test(msg), `${label} failed with unexpected message: ${msg}`);
    return msg;
  }
  throw new Error(`${label} should have been refused`);
}

async function contextFor(roleSlug: string): Promise<CurrentUserContext> {
  const p = await prisma.profiles.findFirst({
    where: { is_active: true, roles: { slug: roleSlug } },
    include: { roles: true, departments: true },
    orderBy: { created_at: "asc" },
  });
  if (!p || !p.roles) throw new Error(`No active ${roleSlug} user in the test database.`);
  const perms = await prisma.role_permissions.findMany({ where: { role_id: p.role_id! }, include: { permissions: true } });
  const set = new Set<string>(perms.map((rp) => rp.permissions.key));
  if (p.can_view_costs) set.add("costs.view");
  if (roleSlug !== "super_admin") {
    const overrides = await prisma.user_permission_overrides.findMany({ where: { profile_id: p.id } });
    for (const o of overrides) if (o.override_type === "allow") set.add(o.permission_key);
    for (const o of overrides) if (o.override_type === "deny") set.delete(o.permission_key);
  }
  return {
    userId: p.id,
    authUserId: p.id,
    email: null,
    mustResetPassword: false,
    profile: { id: p.id, full_name: p.full_name, employee_number: p.employee_number, phone: p.phone, job_title: p.job_title, department_id: p.department_id, role_id: p.role_id, is_active: p.is_active, can_view_costs: p.can_view_costs },
    department: p.departments ? { id: p.departments.id, name: p.departments.name, code: p.departments.code } : null,
    role: { id: p.roles.id, name: p.roles.name, slug: p.roles.slug as RoleSlug },
    permissions: [...set] as PermissionKey[],
  };
}

const dataEntry = await contextFor("maintenance_data_entry");
const manager = await contextFor("maintenance_manager");
const technician = await contextFor("technician");
const storeKeeper = await contextFor("store_keeper");

// ── Snapshot of every existing Job Card's time and material figures ─────────

const existingIds = (await prisma.work_orders.findMany({ where: { deleted_at: null }, select: { id: true } })).map((w) => w.id);
async function figures(ids: string[]) {
  const [labor, materials] = await Promise.all([getWorkOrderLaborSummariesBulk(prisma, ids), getMaterialFulfillmentForWorkOrders(prisma, ids)]);
  return JSON.stringify(
    ids.map((id) => {
      const l = labor.get(id);
      return [id, l?.total_minutes ?? 0, l?.total_amount ?? 0, (materials.get(id) ?? []).map((m) => [m.required_qty, m.issued_qty, m.available_now])];
    })
  );
}
const figuresBefore = await figures(existingIds);
const existingReadiness = await getClosureReadinessForWorkOrders(prisma, existingIds);

// ── Fixtures ─────────────────────────────────────────────────────────────────

const tag = `CR-${Date.now().toString(36)}`;
const assetId = (await prisma.assets.findFirstOrThrow({ where: { deleted_at: null }, select: { id: true } })).id;

async function makeWorker(name: string) {
  return prisma.workerProfile.create({ data: { name: `${tag} ${name}`, worker_type: "Technician", hourly_rate: "1.000" }, select: { id: true } });
}
async function makeJobCard(label: string) {
  return prisma.work_orders.create({
    data: {
      ordered_by: `${tag} ${label}`,
      maintenance_type: "Repair",
      worker_type: "Mechanical",
      priority: "Normal",
      status: "Materials Issued",
      asset_id: assetId,
      created_by: dataEntry.userId,
      operator_complaint: `${tag} ${label}`,
    },
    select: { id: true, work_order_number: true },
  });
}
/** Assign through the real roster save, then Start + Finish the timer. */
async function finishedWorker(workOrderId: string, name: string) {
  const w = await makeWorker(name);
  await roster.assignInternalTeamRoster(manager, { workOrderId, technicianIds: [w.id], helperIds: [], estimatedHoursByWorkerId: {} });
  const a = await prisma.workOrderWorkerAssignment.findFirstOrThrow({ where: { work_order_id: workOrderId, worker_id: w.id }, select: { id: true } });
  await sessions.startWorkSession(dataEntry, { workOrderId, workerAssignmentId: a.id });
  await sessions.finishWorkSession(dataEntry, { workOrderId, workerAssignmentId: a.id });
  return a.id;
}
async function materialUsedLine(workOrderId: string) {
  await prisma.work_order_materials.create({ data: { work_order_id: workOrderId, material_name: `${tag} oil`, quantity: 1, unit_price: 0 } });
}
const confirm = (ctx: CurrentUserContext, workOrderId: string, requirement: "workers" | "materials", reason?: string) =>
  requirements.confirmRequirementNotRequired(ctx, { workOrderId, requirement, reason });
const requestClosure = (workOrderId: string) => service.requestJobCardClosure(dataEntry, workOrderId, "");
const statusOf = async (id: string) => (await prisma.work_orders.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
const confirmations = (id: string) => prisma.jobCardRequirementConfirmation.findMany({ where: { work_order_id: id }, orderBy: { confirmed_at: "asc" } });

// ── 1–4, 10, 11: present / missing ───────────────────────────────────────────

await check("R1", "no workers and no materials: closure refused with both reasons", async () => {
  const jc = await makeJobCard("R1");
  const msg = await rejects(requestClosure(jc.id), /No workers assigned.*No materials added/, "closure");
  assert((await statusOf(jc.id)) === "Materials Issued", "status changed");
  return msg.slice(0, 90);
});

await check("R2", "workers only (finished): closure refused — no materials", async () => {
  const jc = await makeJobCard("R2");
  await finishedWorker(jc.id, "R2");
  const msg = await rejects(requestClosure(jc.id), /No materials added/, "closure");
  assert(!/No workers/.test(msg), "workers reported missing");
  return msg.slice(0, 90);
});

await check("R3", "materials only: closure refused — no workers", async () => {
  const jc = await makeJobCard("R3");
  await materialUsedLine(jc.id);
  const msg = await rejects(requestClosure(jc.id), /No workers assigned/, "closure");
  assert(!/No materials/.test(msg), "materials reported missing");
  return msg.slice(0, 90);
});

await check("R4", "both present: closure allowed, Manager approves", async () => {
  const jc = await makeJobCard("R4");
  await finishedWorker(jc.id, "R4");
  await materialUsedLine(jc.id);
  await requestClosure(jc.id);
  assert((await statusOf(jc.id)) === "Closure Requested", "not requested");
  await service.approveJobCardClosure(manager, jc.id, "ok");
  assert((await statusOf(jc.id)) === "Closed", "not closed");
  return "Closure Requested → Closed";
});

// ── 5–7: confirmations ───────────────────────────────────────────────────────

await check("R5", "No Workers Required: reason required, who/when recorded, repeat is idempotent", async () => {
  const jc = await makeJobCard("R5");
  await materialUsedLine(jc.id);
  await rejects(confirm(dataEntry, jc.id, "workers", " "), /reason/i, "empty reason");
  const first = await confirm(dataEntry, jc.id, "workers", "Inspection only, done by vendor");
  const again = await confirm(dataEntry, jc.id, "workers", "Another reason");
  const rows = await confirmations(jc.id);
  assert(!first.alreadyConfirmed && again.alreadyConfirmed, "idempotency");
  assert(rows.length === 1 && rows[0].confirmed_by === dataEntry.userId && rows[0].reason === "Inspection only, done by vendor" && rows[0].confirmed_at, "row");
  const audit = await prisma.audit_logs.count({ where: { entity_id: jc.id, action: "work_order.workers_not_required" } });
  assert(audit === 1, `audit rows ${audit}`);
  await requestClosure(jc.id);
  assert((await statusOf(jc.id)) === "Closure Requested", "not requested");
  return "1 row, 1 audit entry, closure allowed";
});

await check("R6", "No Materials Required (no reason needed) with finished workers: closure allowed", async () => {
  const jc = await makeJobCard("R6");
  await finishedWorker(jc.id, "R6");
  await confirm(dataEntry, jc.id, "materials");
  const [row] = await confirmations(jc.id);
  assert(row.requirement === "materials" && row.reason === null && row.confirmed_by === dataEntry.userId, "row");
  await requestClosure(jc.id);
  assert((await statusOf(jc.id)) === "Closure Requested", "not requested");
  return "closure requested";
});

await check("R7", "both Not Required: request → Manager returns → request again → approve", async () => {
  const jc = await makeJobCard("R7");
  await confirm(dataEntry, jc.id, "workers", "Visual check only");
  await confirm(dataEntry, jc.id, "materials");
  await requestClosure(jc.id);
  await service.returnJobCardClosure(manager, jc.id, "Please attach the inspection photo");
  const returned = await statusOf(jc.id);
  assert(returned !== "Closure Requested" && returned !== "Closed", `return gave ${returned}`);
  const rows = await confirmations(jc.id);
  assert(rows.every((r) => r.superseded_at === null), "return must keep the confirmations");
  await requestClosure(jc.id);
  await service.approveJobCardClosure(manager, jc.id);
  assert((await statusOf(jc.id)) === "Closed", "not closed");
  return `returned to ${returned}, then closed`;
});

// ── 8–9: added after Not Required ────────────────────────────────────────────

await check("R8", "workers assigned after Not Required: confirmation superseded (kept), workers must finish", async () => {
  const jc = await makeJobCard("R8");
  await materialUsedLine(jc.id);
  await confirm(dataEntry, jc.id, "workers", "Thought no one was needed");
  const w = await makeWorker("R8");
  await roster.assignInternalTeamRoster(manager, { workOrderId: jc.id, technicianIds: [w.id], helperIds: [], estimatedHoursByWorkerId: {} });
  const [row] = await confirmations(jc.id);
  assert(row.superseded_at && row.superseded_by === manager.userId && row.superseded_reason === "Workers assigned", "not superseded");
  const msg = await rejects(requestClosure(jc.id), /not started/i, "closure");
  return `superseded; ${msg.slice(40, 110)}`;
});

await check("R9", "materials added after Not Required: confirmation superseded (kept), request must complete", async () => {
  const jc = await makeJobCard("R9");
  await finishedWorker(jc.id, "R9");
  await confirm(dataEntry, jc.id, "materials");
  await partsRequests.createPartsRequest(dataEntry, {
    workOrderId: jc.id,
    remarks: `${tag} R9`,
    items: [
      {
        part_id: null,
        description: `${tag} filter`,
        part_number: null,
        ss_rec_code: null,
        quantity_requested: 1,
        unit_price: null,
        remarks: null,
        unit: "PCS",
        inventory_material_key: null,
        purchase_unit: null,
        conversion_quantity: null,
        entered_unit_price: null,
        price_basis: null,
      },
    ],
  });
  const [row] = await confirmations(jc.id);
  assert(row.superseded_at && row.superseded_reason === "Materials Request created", "not superseded");
  await rejects(requestClosure(jc.id), /pending/i, "closure");
  return "superseded; closure waits for the request";
});

// ── 13: existing Job Cards ───────────────────────────────────────────────────

await check("R13", "existing Job Cards: pending requests still approve; others now need confirmation", async () => {
  const pending = await prisma.work_orders.findMany({
    where: { id: { in: existingIds }, status: "Closure Requested" },
    select: { id: true, work_order_number: true },
  });
  let approved = 0;
  for (const wo of pending) {
    await service.approveJobCardClosure(manager, wo.id, "approved in verification");
    if ((await statusOf(wo.id)) === "Closed") approved += 1;
  }
  assert(approved === pending.length, `approved ${approved}/${pending.length}`);
  const open = [...existingReadiness].filter(([id]) => !pending.some((p) => p.id === id));
  const blockedByRule = open.filter(([, r]) => r.reasons.some((x) => /No workers assigned|No materials added/.test(x))).length;
  return `${approved} earlier closure requests approved unchanged; ${blockedByRule} of ${open.length} other existing cards now ask for workers/materials or a confirmation`;
});

// ── 14: permissions, status, concurrency ─────────────────────────────────────

await check("R14a", "Technician / Store Keeper cannot confirm", async () => {
  const jc = await makeJobCard("R14a");
  await rejects(confirm(technician, jc.id, "materials"), /permission/i, "technician");
  await rejects(confirm(storeKeeper, jc.id, "workers", "no workers"), /permission/i, "store keeper");
  assert((await confirmations(jc.id)).length === 0, "row created");
  return "both refused, nothing saved";
});

await check("R14b", "cannot confirm when workers/materials exist, or once closure is requested", async () => {
  const jc = await makeJobCard("R14b");
  await finishedWorker(jc.id, "R14b");
  await materialUsedLine(jc.id);
  await rejects(confirm(dataEntry, jc.id, "workers", "none needed"), /already assigned/i, "workers");
  await rejects(confirm(dataEntry, jc.id, "materials"), /already has materials/i, "materials");
  await requestClosure(jc.id);
  const jc2 = await makeJobCard("R14b2");
  await prisma.work_orders.update({ where: { id: jc2.id }, data: { status: "Closure Requested" } });
  await rejects(confirm(dataEntry, jc2.id, "materials"), /can no longer be changed/i, "closure requested");
  return "refused in all three cases";
});

await check("R14c", "concurrent confirmations: exactly one active row", async () => {
  const jc = await makeJobCard("R14c");
  const outcomes = await Promise.allSettled([
    confirm(dataEntry, jc.id, "materials"),
    confirm(manager, jc.id, "materials"),
    confirm(dataEntry, jc.id, "materials"),
  ]);
  const active = await prisma.jobCardRequirementConfirmation.count({ where: { work_order_id: jc.id, superseded_at: null } });
  assert(active === 1, `active rows ${active}`);
  assert(outcomes.every((o) => o.status === "fulfilled"), "a concurrent call failed");
  return "3 parallel calls → 1 row";
});

await check("R14d", "concurrent confirm vs assign: never an active confirmation alongside workers", async () => {
  for (let i = 0; i < 3; i += 1) {
    const jc = await makeJobCard(`R14d-${i}`);
    const w = await makeWorker(`R14d-${i}`);
    await Promise.allSettled([
      confirm(dataEntry, jc.id, "workers", "race check"),
      roster.assignInternalTeamRoster(manager, { workOrderId: jc.id, technicianIds: [w.id], helperIds: [], estimatedHoursByWorkerId: {} }),
    ]);
    const active = await prisma.jobCardRequirementConfirmation.count({ where: { work_order_id: jc.id, superseded_at: null } });
    const workers = await prisma.workOrderWorkerAssignment.count({ where: { work_order_id: jc.id, status: { in: ["active", "finished"] } } });
    assert(workers === 1 && active === 0, `run ${i}: workers ${workers}, active confirmations ${active}`);
  }
  return "3 races, consistent every time";
});

await check("R14e", "database refuses a second active confirmation directly", async () => {
  const jc = await makeJobCard("R14e");
  await confirm(dataEntry, jc.id, "materials");
  await rejects(
    prisma.jobCardRequirementConfirmation.create({ data: { work_order_id: jc.id, requirement: "materials", confirmed_by: dataEntry.userId } }),
    /Unique constraint|unique/i,
    "duplicate insert"
  );
  await rejects(
    prisma.jobCardRequirementConfirmation.create({ data: { work_order_id: jc.id, requirement: "workers", reason: " ", confirmed_by: dataEntry.userId } }),
    /check constraint|workers_reason/i,
    "blank workers reason"
  );
  return "unique index + reason check enforced";
});

// ── 15: time and inventory figures of existing Job Cards unchanged ──────────

await check("R15", "existing Job Cards' time and material figures unchanged", async () => {
  // Approving the earlier closure requests (R13) does not touch time or stock.
  const after = await figures(existingIds);
  assert(after === figuresBefore, "figures changed");
  return `${existingIds.length} Job Cards compared`;
});

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ` — failed: ${failed.map((f) => f.id).join(", ")}` : ""}`);
await prisma.$disconnect();
process.exit(failed.length ? 1 : 0);
