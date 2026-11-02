// Job Card Time Details against a REAL, DISPOSABLE PostgreSQL database: the
// closure service, approval and return, and the stored columns. Refuses to run
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
const service = await import("@/lib/backend/work-orders/service");
const requirements = await import("@/lib/backend/work-orders/closure-requirements");
const { getJobCardTiming } = await import("@/lib/work-orders/job-card-dates-data");
const { getWorkOrderLaborSummary } = await import("@/lib/work-orders/work-session-totals");
const { formatKuwaitDateTime, toKuwaitInputValue } = await import("@/lib/format/kuwait-time");

type Ctx = Parameters<typeof service.requestJobCardClosure>[0];
const RUN = `${Date.now()}`.slice(-6);
const OPENED = new Date("2026-10-24T05:00:00.000Z"); // 8:00 AM Kuwait
const COMPLETED = new Date("2026-10-24T06:36:00.000Z"); // 9:36 AM Kuwait

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

async function jobCard(n: string, extra: Record<string, unknown> = {}) {
  const row = await prisma.work_orders.create({
    data: {
      ordered_by: `Timing ${RUN} ${n}`,
      maintenance_type: "Repair",
      worker_type: "Mechanical",
      priority: "Normal",
      status: "In Progress",
      job_card_start_date: new Date("2026-10-24T00:00:00.000Z"),
      job_card_opened_at: OPENED,
      ...extra,
    } as never,
  });
  // A database trigger starts every Job Card as Created.
  return prisma.work_orders.update({ where: { id: row.id }, data: { status: "In Progress" } });
}

async function timingOf(id: string) {
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id } });
  return (await getJobCardTiming(prisma, wo)).timing;
}

async function notRequired(admin: Ctx, id: string) {
  await requirements.confirmRequirementNotRequired(admin, { workOrderId: id, requirement: "workers", reason: "Inspection only" });
  await requirements.confirmRequirementNotRequired(admin, { workOrderId: id, requirement: "materials" });
}

async function addFinishedWorker(id: string, workerId: string, sessions: { start: Date; end: Date; manual?: boolean; endKnown?: boolean; status?: string }[]) {
  const assignment = await prisma.workOrderWorkerAssignment.create({
    data: { work_order_id: id, worker_id: workerId, worker_role: "Technician", hourly_rate_snapshot: 1, status: sessions.some((s) => s.status === "Active") ? "active" : "finished" },
  });
  for (const s of sessions) {
    await prisma.workOrderWorkSession.create({
      data: {
        work_order_id: id,
        worker_assignment_id: assignment.id,
        worker_id: workerId,
        started_at: s.start,
        stopped_at: s.status === "Active" ? null : s.end,
        status: s.status ?? "Completed",
        hourly_rate_snapshot: 1,
        duration_minutes: s.status === "Active" ? 0 : Math.round((s.end.getTime() - s.start.getTime()) / 60000),
        calculated_amount: 0,
        is_manual_entry: s.manual ?? false,
        end_time_known: s.endKnown ?? true,
        start_time_known: s.endKnown ?? true,
      } as never,
    });
  }
}

describe("Job Card Time Details (disposable DB)", () => {
  let admin: Ctx;
  let dataEntry: Ctx;
  let workers: { id: string }[];

  before(async () => {
    admin = await contextFor("super_admin");
    dataEntry = await contextFor("maintenance_data_entry");
    workers = await prisma.workerProfile.findMany({ take: 3, select: { id: true } });
    assert.ok(workers.length >= 2, "worker profiles are required");
  });

  after(async () => {
    await prisma.$disconnect();
  });

  it("database: an opening moment must fall on the Job Card Open Date in Kuwait time", async () => {
    // 00:30 Kuwait on the 24th is still the 23rd in UTC: accepted.
    const wo = await jobCard("kuwait-day", { job_card_opened_at: new Date("2026-10-23T21:30:00.000Z") });
    assert.ok(wo.id);
    await assert.rejects(jobCard("wrong-day", { job_card_opened_at: new Date("2026-10-25T05:00:00.000Z") }), /opened_at_check/);
    await assert.rejects(jobCard("no-date", { job_card_start_date: null }), /opened_at_check/);
  });

  it("3 workers at 1 h 36 min: 4.8 worker hours, Duration 1 h 36 min", async () => {
    const wo = await jobCard("three");
    for (const w of workers.slice(0, 2)) await addFinishedWorker(wo.id, w.id, [{ start: OPENED, end: COMPLETED }]);
    const second = await prisma.workerProfile.findFirst({ where: { id: { notIn: workers.slice(0, 2).map((w) => w.id) } }, select: { id: true } });
    const third = second ?? (await prisma.workerProfile.create({ data: { name: `Timing ${RUN}`, worker_type: "Mechanical" } as never, select: { id: true } }));
    await addFinishedWorker(wo.id, third.id, [{ start: OPENED, end: COMPLETED }]);
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });

    const labor = await getWorkOrderLaborSummary(prisma, wo.id);
    assert.equal(labor.total_hours, 4.8);
    const t = await timingOf(wo.id);
    assert.equal(t.durationText, "1 h 36 min");
    assert.equal(t.completedText, formatKuwaitDateTime(COMPLETED));
    assert.equal(t.needsCompletionEntry, false);
  });

  it("one worker still active: not completed, and closure stays refused", async () => {
    const wo = await jobCard("active");
    await addFinishedWorker(wo.id, workers[0].id, [{ start: OPENED, end: COMPLETED }]);
    await addFinishedWorker(wo.id, workers[1].id, [{ start: OPENED, end: COMPLETED, status: "Active" }]);
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });
    assert.equal((await timingOf(wo.id)).durationText, "In progress");
    await assert.rejects(service.requestJobCardClosure(dataEntry, wo.id, ""), /not ready for closure/);
  });

  it("materials not confirmed: every worker finished is still In progress", async () => {
    const wo = await jobCard("materials");
    await addFinishedWorker(wo.id, workers[0].id, [{ start: OPENED, end: COMPLETED }]);
    const t = await timingOf(wo.id);
    assert.equal(t.completedText, "Not completed yet");
    assert.equal(t.durationText, "In progress");
  });

  it("No Workers Required: completion recorded at closure request, audited, no session created", async () => {
    const wo = await jobCard("no-workers");
    await notRequired(admin, wo.id);
    assert.equal((await timingOf(wo.id)).durationText, "Not available");

    await service.requestJobCardClosure(dataEntry, wo.id, "", toKuwaitInputValue(COMPLETED));
    const t = await timingOf(wo.id);
    assert.equal(t.completedText, formatKuwaitDateTime(COMPLETED));
    assert.equal(t.durationText, "1 h 36 min");
    assert.equal(t.managerApprovedText, null, "approval is shown only after approval");
    assert.equal(await prisma.workOrderWorkSession.count({ where: { work_order_id: wo.id } }), 0);

    const audit = await prisma.audit_logs.findFirst({ where: { entity_id: wo.id, action: "work_order.work_completed_recorded" } });
    assert.equal((audit?.metadata as { to?: string })?.to, COMPLETED.toISOString());
  });

  it("closure without the optional time still works; Duration is Not available", async () => {
    const wo = await jobCard("no-entry");
    await notRequired(admin, wo.id);
    await service.requestJobCardClosure(dataEntry, wo.id, "");
    assert.equal((await prisma.work_orders.findUniqueOrThrow({ where: { id: wo.id } })).status, "Closure Requested");
    const t = await timingOf(wo.id);
    assert.equal(t.completedText, "Not recorded");
    assert.equal(t.durationText, "Not available");
  });

  it("refuses a future time, a time before opening, and an invalid value", async () => {
    const wo = await jobCard("bad-times");
    await notRequired(admin, wo.id);
    await assert.rejects(service.requestJobCardClosure(dataEntry, wo.id, "", "2099-01-01T10:00"), /future/);
    await assert.rejects(service.requestJobCardClosure(dataEntry, wo.id, "", "2026-10-24T07:00"), /earlier than Job Card Opened/);
    await assert.rejects(service.requestJobCardClosure(dataEntry, wo.id, "", "not a time"), /valid Work Completed/);
    assert.equal((await prisma.work_orders.findUniqueOrThrow({ where: { id: wo.id } })).status, "In Progress", "nothing was saved");
  });

  it("refuses a typed time when worker time already proves the finish", async () => {
    const wo = await jobCard("proven");
    await addFinishedWorker(wo.id, workers[0].id, [{ start: OPENED, end: COMPLETED }]);
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });
    await assert.rejects(service.requestJobCardClosure(dataEntry, wo.id, "", "2026-10-24T11:00"), /already comes from the worker time/);
  });

  it("manual time without a clock time stays valid and asks for the completion time", async () => {
    const wo = await jobCard("manual");
    await addFinishedWorker(wo.id, workers[0].id, [{ start: new Date("2026-10-24T09:00:00.000Z"), end: new Date("2026-10-24T10:00:00.000Z"), manual: true, endKnown: false }]);
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });
    const t = await timingOf(wo.id);
    assert.equal(t.completedText, "24 Oct 2026 — Time not recorded");
    assert.equal(t.durationText, "Not available");
    assert.equal(t.needsCompletionEntry, true);
    assert.equal((await getWorkOrderLaborSummary(prisma, wo.id)).total_hours, 1, "worker hours still count");
  });

  it("approval a day later keeps Work Completed and Duration, and only a Manager may approve", async () => {
    const wo = await jobCard("approve");
    await addFinishedWorker(wo.id, workers[0].id, [{ start: OPENED, end: COMPLETED }]);
    await requirements.confirmRequirementNotRequired(admin, { workOrderId: wo.id, requirement: "materials" });
    await service.requestJobCardClosure(dataEntry, wo.id, "");
    const before = await timingOf(wo.id);

    await assert.rejects(service.approveJobCardClosure(dataEntry, wo.id), /permission/);
    await service.approveJobCardClosure(admin, wo.id);
    const t = await timingOf(wo.id);
    assert.equal(t.completedText, before.completedText);
    assert.equal(t.durationText, before.durationText);
    assert.ok(t.managerApprovedText);
    assert.notEqual(t.managerApprovedText, t.completedText);
  });

  it("return for correction keeps the entered time and shows no approval", async () => {
    const wo = await jobCard("return");
    await notRequired(admin, wo.id);
    await service.requestJobCardClosure(dataEntry, wo.id, "", toKuwaitInputValue(COMPLETED));
    await service.returnJobCardClosure(admin, wo.id, "Please check the time");
    const row = await prisma.work_orders.findUniqueOrThrow({ where: { id: wo.id } });
    assert.equal(row.status, "In Progress");
    assert.equal(row.work_completed_at?.toISOString(), COMPLETED.toISOString());
    assert.equal((await timingOf(wo.id)).managerApprovedText, null);
  });

  it("historical Job Card with no Open Date: nothing is invented from created_at", async () => {
    const wo = await jobCard("history", { job_card_start_date: null, job_card_opened_at: null });
    await notRequired(admin, wo.id);
    const t = await timingOf(wo.id);
    assert.equal(t.openedText, "Not recorded");
    assert.equal(t.durationText, "Not available");
  });
});
