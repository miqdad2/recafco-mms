/**
 * Seed for tests/e2e/daily-activity-needs-action.spec.ts — one Job Card in
 * every Daily Activity state the "Needs My Action" filter cares about, plus
 * 110 extra open Job Cards so the list is larger than its 50-row page.
 * Writes the fixture Job Card numbers as JSON to $E2E_FIXTURES.
 *
 * DESTRUCTIVE. Run ONLY against a throw-away copy of the database (with
 * migration 20261028000000_job_card_requirement_confirmations applied):
 *
 *   DATABASE_URL=<test db url> E2E_FIXTURES=<file> node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --experimental-transform-types --import ./scripts/integration-register.mjs \
 *     scripts/e2e-daily-activity-needs-action-seed.ts
 *
 * Refuses to run unless the database name contains "test".
 */

import { writeFileSync } from "node:fs";

import type { CurrentUserContext } from "@/lib/auth/context";
import type { PermissionKey, RoleSlug } from "@/types/database";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!/test/i.test(dbName)) {
  console.error(`Refusing to run against "${dbName}": the database name must contain "test".`);
  process.exit(2);
}
const out = process.env.E2E_FIXTURES;
if (!out) {
  console.error("Set E2E_FIXTURES to the JSON file to write.");
  process.exit(2);
}

const { prisma } = await import("@/lib/db/prisma");
const service = await import("@/lib/backend/work-orders/service");
const sessions = await import("@/lib/backend/work-orders/work-sessions");
const roster = await import("@/lib/backend/work-orders/worker-roster");

async function contextFor(email: string): Promise<CurrentUserContext> {
  const auth = await prisma.auth_users.findFirstOrThrow({ where: { email }, select: { profile_id: true } });
  const p = await prisma.profiles.findUniqueOrThrow({ where: { id: auth.profile_id }, include: { roles: true, departments: true } });
  const perms = await prisma.role_permissions.findMany({ where: { role_id: p.role_id! }, include: { permissions: true } });
  return {
    userId: p.id,
    authUserId: p.id,
    email,
    mustResetPassword: false,
    profile: { id: p.id, full_name: p.full_name, employee_number: p.employee_number, phone: p.phone, job_title: p.job_title, department_id: p.department_id, role_id: p.role_id, is_active: p.is_active, can_view_costs: p.can_view_costs },
    department: p.departments ? { id: p.departments.id, name: p.departments.name, code: p.departments.code } : null,
    role: { id: p.roles!.id, name: p.roles!.name, slug: p.roles!.slug as RoleSlug },
    permissions: perms.map((rp) => rp.permissions.key) as PermissionKey[],
  };
}

const dataEntry = await contextFor("dataentry@recafco.com");
const manager = await contextFor("manager1@recafco.com");
const tag = `DA-E2E-${Date.now().toString(36)}`;
const assetId = (await prisma.assets.findFirstOrThrow({ where: { deleted_at: null }, select: { id: true } })).id;

async function jobCard(label: string) {
  const wo = await prisma.work_orders.create({
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
  return { id: wo.id, number: wo.work_order_number! };
}
async function worker(workOrderId: string, label: string) {
  const w = await prisma.workerProfile.create({ data: { name: `${tag} ${label}`, worker_type: "Technician", hourly_rate: "1.000" }, select: { id: true } });
  await roster.assignInternalTeamRoster(manager, { workOrderId, technicianIds: [w.id], helperIds: [], estimatedHoursByWorkerId: {} });
  return (await prisma.workOrderWorkerAssignment.findFirstOrThrow({ where: { work_order_id: workOrderId, worker_id: w.id }, select: { id: true } })).id;
}
async function material(workOrderId: string) {
  await prisma.work_order_materials.create({ data: { work_order_id: workOrderId, material_name: `${tag} oil`, quantity: 1, unit_price: 0 } });
}

const none = await jobCard("A none");

const workersOnly = await jobCard("B workers only");
const bA = await worker(workersOnly.id, "B");
await sessions.startWorkSession(dataEntry, { workOrderId: workersOnly.id, workerAssignmentId: bA });
await sessions.finishWorkSession(dataEntry, { workOrderId: workersOnly.id, workerAssignmentId: bA });

const materialsOnly = await jobCard("C materials only");
await material(materialsOnly.id);

const working = await jobCard("D working");
await material(working.id);
await sessions.startWorkSession(dataEntry, { workOrderId: working.id, workerAssignmentId: await worker(working.id, "D") });

const paused = await jobCard("E paused");
await material(paused.id);
const eA = await worker(paused.id, "E");
await sessions.startWorkSession(dataEntry, { workOrderId: paused.id, workerAssignmentId: eA });
await sessions.pauseWorkSession(dataEntry, { workOrderId: paused.id, workerAssignmentId: eA });

async function readyCard(label: string) {
  const jc = await jobCard(label);
  await material(jc.id);
  const a = await worker(jc.id, label);
  await sessions.startWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a });
  await sessions.finishWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a });
  return jc;
}
const ready = await readyCard("F ready");
const waiting = await readyCard("G waiting approval");
await service.requestJobCardClosure(dataEntry, waiting.id, "");
const returned = await readyCard("H returned");
await service.requestJobCardClosure(dataEntry, returned.id, "");
await service.returnJobCardClosure(manager, returned.id, "Please add the inspection photo");

for (let i = 0; i < 110; i += 1) await jobCard(`Z bulk ${i}`);

writeFileSync(
  out,
  JSON.stringify({ tag, none: none.number, workersOnly: workersOnly.number, materialsOnly: materialsOnly.number, working: working.number, paused: paused.number, ready: ready.number, waiting: waiting.number, returned: returned.number }, null, 2)
);
console.log(`Seeded ${tag} → ${out}`);
await prisma.$disconnect();
