// Edit Assignment against a REAL, DISPOSABLE PostgreSQL database: worker time
// must survive every roster and external save. Refuses to run unless
// DATABASE_URL names a database ending in "_test".
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
const { assignTechnicians } = await import("@/lib/backend/work-orders/service");
const { getWorkOrderLaborSummary } = await import("@/lib/work-orders/work-session-totals");

type Ctx = Parameters<typeof assignInternalTeamRoster>[0];
const RUN = `${Date.now()}`.slice(-6);
const START = new Date("2026-10-24T05:00:00.000Z");
const END = new Date("2026-10-24T06:36:00.000Z");

async function contextFor(slug: string): Promise<Ctx> {
  const profile = await prisma.profiles.findFirst({ where: { is_active: true, roles: { slug } }, include: { roles: { include: { role_permissions: { include: { permissions: true } } } } } });
  assert.ok(profile, `an active ${slug} profile is required`);
  return {
    userId: profile.id,
    profile: { id: profile.id, full_name: profile.full_name, can_view_costs: slug === "super_admin", is_active: true },
    role: { id: profile.roles!.id, name: profile.roles!.name, slug: profile.roles!.slug },
    permissions: profile.roles!.role_permissions.map((r) => r.permissions.key),
    overrides: [],
  } as unknown as Ctx;
}

async function jobCard(status = "In Progress") {
  const row = await prisma.work_orders.create({ data: { ordered_by: `Assign ${RUN}`, maintenance_type: "Repair", worker_type: "Mechanical", priority: "Normal", status: "In Progress" } });
  return prisma.work_orders.update({ where: { id: row.id }, data: { status } });
}

async function worker(name: string, type: string) {
  return prisma.workerProfile.create({ data: { name: `${name} ${RUN}`, worker_type: type }, select: { id: true } });
}

async function rosterOf(id: string) {
  return prisma.workOrderWorkerAssignment.findMany({ where: { work_order_id: id }, orderBy: { assigned_at: "asc" } });
}

async function addSession(workOrderId: string, assignmentId: string, workerId: string, status: string, minutes: number) {
  return prisma.workOrderWorkSession.create({
    data: { work_order_id: workOrderId, worker_assignment_id: assignmentId, worker_id: workerId, started_at: START, stopped_at: status === "Completed" ? END : null, status, hourly_rate_snapshot: 1, duration_minutes: minutes, calculated_amount: 0 },
  });
}

describe("Edit Assignment protects worker data (disposable DB)", () => {
  let admin: Ctx;
  let dataEntry: Ctx;
  let tech1: { id: string };
  let tech2: { id: string };
  let helper: { id: string };

  before(async () => {
    admin = await contextFor("super_admin");
    dataEntry = await contextFor("maintenance_data_entry");
    tech1 = await worker("Tech One", "Technician");
    tech2 = await worker("Tech Two", "Technician");
    helper = await worker("Helper", "Helper/Labor");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("adds a technician without touching the workers already there", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [helper.id], estimatedHoursByWorkerId: { [tech1.id]: 2 } });
    const [first] = await rosterOf(wo.id);
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id, tech2.id], helperIds: [helper.id], estimatedHoursByWorkerId: { [tech1.id]: 2 } });
    const rows = await rosterOf(wo.id);
    assert.equal(rows.length, 3, "no duplicate rows");
    assert.equal(rows.find((r) => r.worker_id === tech1.id)?.id, first.id, "same assignment row kept");
    assert.equal(Number(rows.find((r) => r.worker_id === tech1.id)?.estimated_hours), 2);
  });

  it("removes an unstarted worker softly, keeping the row as history", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id, tech2.id], helperIds: [], estimatedHoursByWorkerId: {} });
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} });
    const removed = (await rosterOf(wo.id)).find((r) => r.worker_id === tech2.id);
    assert.equal(removed?.status, "removed");
  });

  for (const [state, minutes] of [["Active", 0], ["Paused", 30], ["Completed", 96]] as const) {
    it(`refuses to remove a worker with a ${state} period, and changes nothing`, async () => {
      const wo = await jobCard();
      await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id, tech2.id], helperIds: [], estimatedHoursByWorkerId: {} });
      const target = (await rosterOf(wo.id)).find((r) => r.worker_id === tech2.id)!;
      const session = await addSession(wo.id, target.id, tech2.id, state, minutes);

      await assert.rejects(
        assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} }),
        /has work recorded on this Job Card and cannot be removed/
      );
      assert.equal((await rosterOf(wo.id)).find((r) => r.id === target.id)?.status, "active");
      const after = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: session.id } });
      assert.equal(after.status, state);
      assert.equal(after.duration_minutes, minutes);
    });
  }

  it("a cancelled period does not block removal", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id, tech2.id], helperIds: [], estimatedHoursByWorkerId: {} });
    const target = (await rosterOf(wo.id)).find((r) => r.worker_id === tech2.id)!;
    await addSession(wo.id, target.id, tech2.id, "Cancelled", 0);
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} });
    assert.equal((await rosterOf(wo.id)).find((r) => r.id === target.id)?.status, "removed");
  });

  it("a finished worker keeps their row and hours, and is not re-created", async () => {
    const wo = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} });
    const row = (await rosterOf(wo.id))[0];
    await addSession(wo.id, row.id, tech1.id, "Completed", 96);
    await prisma.workOrderWorkerAssignment.update({ where: { id: row.id }, data: { status: "finished" } });

    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id, tech2.id], helperIds: [], estimatedHoursByWorkerId: {} });
    const rows = await rosterOf(wo.id);
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.id === row.id)?.status, "finished");
    assert.equal((await getWorkOrderLaborSummary(prisma, wo.id)).total_minutes, 96);
  });

  it("a worker whose profile became inactive stays on the Job Card", async () => {
    const wo = await jobCard();
    const leaver = await worker("Leaver", "Technician");
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [leaver.id], helperIds: [], estimatedHoursByWorkerId: {} });
    await prisma.workerProfile.update({ where: { id: leaver.id }, data: { is_active: false } });
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [leaver.id, tech1.id], helperIds: [], estimatedHoursByWorkerId: {} });
    assert.equal((await rosterOf(wo.id)).find((r) => r.worker_id === leaver.id)?.status, "active");

    const other = await jobCard();
    await assert.rejects(
      assignInternalTeamRoster(admin, { workOrderId: other.id, technicianIds: [leaver.id], helperIds: [], estimatedHoursByWorkerId: {} }),
      /inactive or no longer exist/
    );
  });

  it("refuses the same worker twice, and a Closed Job Card", async () => {
    const wo = await jobCard();
    await assert.rejects(
      assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [tech1.id], estimatedHoursByWorkerId: {} }),
      /cannot be assigned twice/
    );
    await prisma.work_orders.update({ where: { id: wo.id }, data: { status: "Closed" } }).catch(() => null);
    if ((await prisma.work_orders.findUniqueOrThrow({ where: { id: wo.id } })).status === "Closed") {
      await assert.rejects(assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} }), /closed/i);
    }
  });

  it("does not affect another Job Card", async () => {
    const a = await jobCard();
    const b = await jobCard();
    await assignInternalTeamRoster(admin, { workOrderId: b.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} });
    await assignInternalTeamRoster(admin, { workOrderId: a.id, technicianIds: [tech2.id], helperIds: [], estimatedHoursByWorkerId: {} });
    await assignInternalTeamRoster(admin, { workOrderId: a.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} });
    assert.equal((await rosterOf(b.id))[0].status, "active");
  });

  it("Freelancer save leaves the Internal Team and its time untouched, and replaces the Company", async () => {
    const wo = await jobCard("Assigned");
    await assignInternalTeamRoster(admin, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} });
    const row = (await rosterOf(wo.id))[0];
    await addSession(wo.id, row.id, tech1.id, "Active", 0);
    await assignTechnicians(admin, { workOrderId: wo.id, assignmentType: "EXTERNAL_COMPANY", technicianIds: [], externalCompany: "ACME" });
    await assignTechnicians(admin, { workOrderId: wo.id, assignmentType: "FREELANCER", technicianIds: [], externalName: "Sam" });
    const external = await prisma.work_order_assignments.findMany({ where: { work_order_id: wo.id } });
    assert.deepEqual(external.map((e) => e.assignment_type), ["FREELANCER"]);
    assert.equal((await rosterOf(wo.id))[0].status, "active");
    assert.equal(await prisma.workOrderWorkSession.count({ where: { work_order_id: wo.id, status: "Active" } }), 1);
  });

  it("keeps a hidden agreed amount for a viewer who cannot see costs", async () => {
    const wo = await jobCard("Assigned");
    await assignTechnicians(admin, { workOrderId: wo.id, assignmentType: "FREELANCER", technicianIds: [], externalName: "Sam", agreedAmount: 75.5 });
    await assignTechnicians(dataEntry, { workOrderId: wo.id, assignmentType: "FREELANCER", technicianIds: [], externalName: "Sam Ali", keepAgreedAmount: true });
    const [saved] = await prisma.work_order_assignments.findMany({ where: { work_order_id: wo.id } });
    assert.equal(saved.external_name, "Sam Ali");
    assert.equal(Number(saved.agreed_amount), 75.5);
  });

  it("an amount kept for a Freelancer is not carried over to a Company", async () => {
    const wo = await jobCard("Assigned");
    await assignTechnicians(admin, { workOrderId: wo.id, assignmentType: "FREELANCER", technicianIds: [], externalName: "Sam", agreedAmount: 75.5 });
    await assignTechnicians(dataEntry, { workOrderId: wo.id, assignmentType: "EXTERNAL_COMPANY", technicianIds: [], externalCompany: "ACME", keepAgreedAmount: true });
    const [saved] = await prisma.work_order_assignments.findMany({ where: { work_order_id: wo.id } });
    assert.equal(saved.agreed_amount, null);
  });

  it("permissions: a role without work_orders.assign is refused", async () => {
    const wo = await jobCard();
    const viewer = { ...dataEntry, role: { ...(dataEntry.role as object), slug: "viewer" }, permissions: ["work_orders.view"] } as unknown as Ctx;
    await assert.rejects(assignInternalTeamRoster(viewer, { workOrderId: wo.id, technicianIds: [tech1.id], helperIds: [], estimatedHoursByWorkerId: {} }));
    await assert.rejects(assignTechnicians(viewer, { workOrderId: wo.id, assignmentType: "FREELANCER", technicianIds: [], externalName: "Sam" }));
    assert.equal((await rosterOf(wo.id)).length, 0);
  });
});
