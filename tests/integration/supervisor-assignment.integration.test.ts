// A Supervisor oversees a Job Card and is not a worker until they have work
// recorded, against a REAL, DISPOSABLE PostgreSQL database. Refuses to run
// unless DATABASE_URL names a database ending in "_test".
import assert from "node:assert/strict";
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

const { prisma } = await import("@/lib/db/prisma");
const { assignInternalTeamRoster } = await import("@/lib/backend/work-orders/worker-roster");
const service = await import("@/lib/backend/work-orders/service");
const requirements = await import("@/lib/backend/work-orders/closure-requirements");
const { getClosureReadinessForWorkOrders } = await import("@/lib/work-orders/closure-readiness-data");
const { getWorkOrderLaborSummary } = await import("@/lib/work-orders/work-session-totals");
const { getJobCardDatesBulk, getJobCardTiming } = await import("@/lib/work-orders/job-card-dates-data");

type Ctx = Parameters<typeof assignInternalTeamRoster>[0];
const RUN = `${Date.now()}`.slice(-6);
const START = new Date("2026-10-24T05:00:00.000Z");
const END = new Date("2026-10-24T06:36:00.000Z");

async function contextFor(slug: string): Promise<Ctx> {
  const profile = await prisma.profiles.findFirst({ where: { is_active: true, roles: { slug } }, include: { roles: true } });
  assert.ok(profile, `an active ${slug} profile is required`);
  return {
    userId: profile.id,
    profile: { id: profile.id, full_name: profile.full_name, can_view_costs: true, is_active: true },
    role: { id: profile.roles!.id, name: profile.roles!.name, slug: profile.roles!.slug },
    permissions: [],
    overrides: [],
  } as unknown as Ctx;
}

async function jobCard() {
  const row = await prisma.work_orders.create({ data: { ordered_by: `Supervisor ${RUN}`, maintenance_type: "Repair", worker_type: "Mechanical", priority: "Normal", status: "In Progress" } });
  return prisma.work_orders.update({ where: { id: row.id }, data: { status: "In Progress" } });
}

const ready = async (id: string) => (await getClosureReadinessForWorkOrders(prisma, [id])).get(id)!;

async function finishedWork(workOrderId: string, workerId: string) {
  const a = await prisma.workOrderWorkerAssignment.findFirstOrThrow({ where: { work_order_id: workOrderId, worker_id: workerId } });
  await prisma.workOrderWorkSession.create({
    data: { work_order_id: workOrderId, worker_assignment_id: a.id, worker_id: workerId, started_at: START, stopped_at: END, status: "Completed", hourly_rate_snapshot: 1, duration_minutes: 96, calculated_amount: 0 },
  });
  await prisma.workOrderWorkerAssignment.update({ where: { id: a.id }, data: { status: "finished" } });
}

describe("Supervisor stays separate from worker time (disposable DB)", () => {
  let admin: Ctx;
  let supervisor: { id: string };
  let tech: { id: string };

  before(async () => {
    admin = await contextFor("super_admin");
    supervisor = await prisma.workerProfile.create({ data: { name: `Sup ${RUN}`, worker_type: "Supervisor" }, select: { id: true } });
    tech = await prisma.workerProfile.create({ data: { name: `Tech ${RUN}`, worker_type: "Technician" }, select: { id: true } });
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("assigning a Supervisor creates no timer or hours", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: supervisor.id, technicianIds: [tech.id], helperIds: [], estimatedHoursByWorkerId: {} });
    assert.equal(await prisma.workOrderWorkSession.count({ where: { work_order_id: wo.id } }), 0);
    assert.equal((await getWorkOrderLaborSummary(prisma, wo.id)).total_minutes, 0);
  });

  it("an unstarted Supervisor does not hold up closure once the workers finish", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: supervisor.id, technicianIds: [tech.id], helperIds: [], estimatedHoursByWorkerId: {} });
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });
    assert.equal((await ready(wo.id)).ready, false, "the technician has not finished");
    await finishedWork(wo.id, tech.id);
    assert.deepEqual((await ready(wo.id)).reasons, []);
    await service.requestJobCardClosure(admin, wo.id, "");
    assert.equal((await prisma.work_orders.findUniqueOrThrow({ where: { id: wo.id } })).status, "Closure Requested");
    assert.equal((await getWorkOrderLaborSummary(prisma, wo.id)).total_minutes, 96, "Supervisor adds no hours");
  });

  it("Work Completed comes from the workers even with an unstarted Supervisor", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: supervisor.id, technicianIds: [tech.id], helperIds: [], estimatedHoursByWorkerId: {} });
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });
    await finishedWork(wo.id, tech.id);
    const row = await prisma.work_orders.findUniqueOrThrow({ where: { id: wo.id } });
    const { timing } = await getJobCardTiming(prisma, row);
    assert.equal(timing.completed.state, "exact");
    assert.equal(timing.needsCompletionEntry, false, "no typed time needed");
    const bulk = (await getJobCardDatesBulk(prisma, [row])).get(wo.id)!;
    assert.equal(bulk.workEnd.recorded, true, "Daily Activity reads the same result");
  });

  it("a Supervisor alone is not workers: closure still needs workers or Not Required", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: supervisor.id, technicianIds: [], helperIds: [], estimatedHoursByWorkerId: {} });
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });
    assert.match((await ready(wo.id)).reasons.join(" "), /No workers assigned/);
    await assert.rejects(service.requestJobCardClosure(admin, wo.id, ""), /No workers assigned/);

    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "workers", reason: "Inspection only" });
    assert.equal((await ready(wo.id)).ready, true);
    await service.requestJobCardClosure(admin, wo.id, "");
  });

  it("adding a Supervisor keeps a No Workers Required confirmation; adding a worker supersedes it", async () => {
    const wo = await jobCard();
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "workers", reason: "Inspection only" });
    const active = () => prisma.jobCardRequirementConfirmation.count({ where: { work_order_id: wo.id, requirement: "workers", superseded_at: null } });
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: supervisor.id, technicianIds: [], helperIds: [], estimatedHoursByWorkerId: {} });
    assert.equal(await active(), 1);
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: supervisor.id, technicianIds: [tech.id], helperIds: [], estimatedHoursByWorkerId: {} });
    assert.equal(await active(), 0);
  });

  it("a Supervisor who really works counts like any worker", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: supervisor.id, technicianIds: [], helperIds: [], estimatedHoursByWorkerId: {} });
    const a = await prisma.workOrderWorkerAssignment.findFirstOrThrow({ where: { work_order_id: wo.id, worker_id: supervisor.id } });
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });
    await prisma.workOrderWorkSession.create({
      data: { work_order_id: wo.id, worker_assignment_id: a.id, worker_id: supervisor.id, started_at: START, status: "Active", hourly_rate_snapshot: 1, duration_minutes: 0, calculated_amount: 0 },
    });
    assert.match((await ready(wo.id)).reasons.join(" "), /still working/);
    await prisma.workOrderWorkSession.updateMany({ where: { worker_assignment_id: a.id }, data: { status: "Completed", stopped_at: END, duration_minutes: 96 } });
    await prisma.workOrderWorkerAssignment.update({ where: { id: a.id }, data: { status: "finished" } });
    assert.equal((await ready(wo.id)).ready, true);
    assert.equal((await getWorkOrderLaborSummary(prisma, wo.id)).total_minutes, 96);
  });

  it("changing the Supervisor leaves worker sessions alone", async () => {
    const wo = await jobCard();
    const other = await prisma.workerProfile.create({ data: { name: `Sup Two ${RUN}`, worker_type: "Supervisor" }, select: { id: true } });
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: supervisor.id, technicianIds: [tech.id], helperIds: [], estimatedHoursByWorkerId: {} });
    await finishedWork(wo.id, tech.id);
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, supervisorId: other.id, technicianIds: [tech.id], helperIds: [], estimatedHoursByWorkerId: {} });
    const rows = await prisma.workOrderWorkerAssignment.findMany({ where: { work_order_id: wo.id }, select: { worker_id: true, status: true } });
    assert.equal(rows.find((r) => r.worker_id === supervisor.id)?.status, "removed");
    assert.equal(rows.find((r) => r.worker_id === other.id)?.status, "active");
    assert.equal((await getWorkOrderLaborSummary(prisma, wo.id)).total_minutes, 96);
  });
});
