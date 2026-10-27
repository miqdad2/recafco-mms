/**
 * Job Card Deletion, Job Card Dates and Worker Time Correction — integration
 * checks that call the real backend services in-process.
 *
 * DESTRUCTIVE: creates Job Cards, workers, work periods, requests and
 * corrections. Run it ONLY against a throw-away copy of the database with
 * migration 20261027000000_job_card_deletion_and_time_corrections applied:
 *
 *   createdb + pg_restore a dump of the dev DB into recafco_jcdel_test
 *   DATABASE_URL=<test db url> npx prisma migrate deploy
 *   DATABASE_URL=<test db url> node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
 *     --import ./tests/unit/register.mjs scripts/verify-job-card-deletion-time-correction.ts
 *
 * Refuses to run unless the database name contains "test".
 */

import { randomUUID } from "node:crypto";

import type { CurrentUserContext } from "@/lib/auth/context";
import type { PermissionKey, RoleSlug } from "@/types/database";

const dbName = new URL(process.env.DATABASE_URL ?? "postgresql://x/none").pathname.slice(1);
if (!/test/i.test(dbName)) {
  console.error(`Refusing to run against "${dbName}": the database name must contain "test".`);
  process.exit(2);
}

const { prisma } = await import("@/lib/db/prisma");
const deletion = await import("@/lib/backend/work-orders/job-card-deletion");
const corrections = await import("@/lib/backend/work-orders/work-time-corrections");
const sessions = await import("@/lib/backend/work-orders/work-sessions");
const roster = await import("@/lib/backend/work-orders/worker-roster");
const service = await import("@/lib/backend/work-orders/service");
const partsRequests = await import("@/lib/backend/parts-requests/service");
const creation = await import("@/lib/backend/work-orders/job-card-creation");
const { getJobCardDates } = await import("@/lib/work-orders/job-card-dates-data");
const { getWorkOrderLaborSummary, getSessionsForAssignment } = await import("@/lib/work-orders/work-session-totals");
const { getWorkOrderVisibilityFilter } = await import("@/lib/work-orders/visibility");
const { canViewCosts } = await import("@/lib/security/permissions");
const { toKuwaitInputValue } = await import("@/lib/format/kuwait-time");

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

async function contextFor(roleSlug: string, index = 0): Promise<CurrentUserContext> {
  const profiles = await prisma.profiles.findMany({
    where: { is_active: true, roles: { slug: roleSlug } },
    include: { roles: true, departments: true },
    orderBy: { created_at: "asc" },
  });
  const p = profiles[index];
  if (!p || !p.roles) throw new Error(`No active ${roleSlug} user #${index} in the test database.`);
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
    profile: {
      id: p.id,
      full_name: p.full_name,
      employee_number: p.employee_number,
      phone: p.phone,
      job_title: p.job_title,
      department_id: p.department_id,
      role_id: p.role_id,
      is_active: p.is_active,
      can_view_costs: p.can_view_costs,
    },
    department: p.departments ? { id: p.departments.id, name: p.departments.name, code: p.departments.code } : null,
    role: { id: p.roles.id, name: p.roles.name, slug: p.roles.slug as RoleSlug },
    permissions: [...set] as PermissionKey[],
  };
}

const tag = `JCDEL-${Date.now().toString(36)}`;
const fixtureAssetId = (await prisma.assets.findFirstOrThrow({ where: { deleted_at: null }, select: { id: true } })).id;
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

async function newJobCard(creator: CurrentUserContext, label: string) {
  const fd = new FormData();
  fd.set("intent", "submit_for_approval");
  fd.set("submission_id", randomUUID());
  fd.set("ordered_by", "Verification Script");
  fd.set("date_of_order", new Date().toISOString().slice(0, 10));
  fd.set("maintenance_type", "Repair");
  fd.set("worker_type", "Mechanical");
  fd.set("priority", "Normal");
  fd.set("operator_complaint", `${tag} ${label}`);
  fd.set("asset_id", fixtureAssetId);
  const res = await creation.createJobCardFromForm(creator, fd, { submissionId: String(fd.get("submission_id")), correlationId: randomUUID(), route: "verify" });
  if (!res.ok) throw new Error(`Job Card create failed: ${JSON.stringify(res)}`);
  return { id: res.jobCard.id, number: res.jobCard.number, submissionId: String(fd.get("submission_id")), fd };
}

async function newWorker(label: string, rate = 6) {
  return prisma.workerProfile.create({ data: { name: `${tag} ${label}`, worker_type: "Technician", hourly_rate: rate, is_active: true } });
}

async function assign(workOrderId: string, workerId: string, by: string, rate = 6) {
  return prisma.workOrderWorkerAssignment.create({
    data: { work_order_id: workOrderId, worker_id: workerId, worker_role: "Technician", hourly_rate_snapshot: rate, assigned_by: by },
  });
}

// A finished work period with chosen past times (the timer only records "now").
async function period(a: { id: string; work_order_id: string; worker_id: string }, startMinAgo: number, endMinAgo: number, status: "Completed" | "Paused" = "Completed", rate = 6) {
  const start = minutesAgo(startMinAgo);
  const end = minutesAgo(endMinAgo);
  const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
  return prisma.workOrderWorkSession.create({
    data: {
      work_order_id: a.work_order_id,
      worker_assignment_id: a.id,
      worker_id: a.worker_id,
      started_at: start,
      stopped_at: status === "Completed" ? end : null,
      paused_at: status === "Paused" ? end : null,
      status,
      duration_minutes: minutes,
      hourly_rate_snapshot: rate,
      calculated_amount: Math.round((minutes / 60) * rate * 1000) / 1000,
    },
  });
}

// ── Actors ───────────────────────────────────────────────────────────────────

const dataEntry = await contextFor("maintenance_data_entry", 0);
const dataEntry2 = await contextFor("maintenance_data_entry", 1);
const manager = await contextFor("maintenance_manager");
const superAdmin = await contextFor("super_admin");
const technician = await contextFor("technician");
const storeKeeper = await contextFor("store_keeper");
console.log(`Test DB: ${dbName} · run tag ${tag}`);

// ── PART A — deletion ────────────────────────────────────────────────────────

await check("A1", "Data Entry requests deletion of an eligible Job Card", async () => {
  const jc = await newJobCard(dataEntry, "eligible");
  const w = await newWorker("planned");
  await assign(jc.id, w.id, dataEntry.userId);
  const res = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Created twice by mistake" });
  assert(!res.alreadyPending, "first request reported as already pending");
  const row = await prisma.jobCardDeletionRequest.findUniqueOrThrow({ where: { id: res.requestId } });
  assert(row.status === "Pending" && row.work_order_number === jc.number, "request row wrong");
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jc.id } });
  assert(wo.deleted_at === null, "Job Card was deleted on request");
  const notes = await prisma.notifications.count({ where: { event_key: "job_card.deletion_requested", entity_id: jc.id, recipient_user_id: manager.userId } });
  assert(notes === 1, `manager notifications = ${notes}`);
  (globalThis as Record<string, unknown>).A = { jc, requestId: res.requestId, workerId: w.id };
  return `${jc.number} pending; manager notified`;
});

await check("A2", "Manager approves: soft delete, number kept, hidden from lists, roster cleared", async () => {
  const { jc, requestId } = (globalThis as Record<string, unknown>).A as { jc: { id: string; number: string }; requestId: string };
  const status = await deletion.getJobCardDeletionStatus(manager, jc.id);
  assert(status?.pending?.id === requestId && status.eligibility.eligible, "manager cannot see pending request");
  await deletion.approveJobCardDeletion(manager, { requestId, remarks: "OK" });
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jc.id } });
  assert(wo.deleted_at !== null && wo.work_order_number === jc.number, "not soft deleted / number changed");
  const req = await prisma.jobCardDeletionRequest.findUniqueOrThrow({ where: { id: requestId } });
  assert(req.status === "Approved" && req.decided_by === manager.userId && req.decided_at, "request not approved");
  const active = await prisma.workOrderWorkerAssignment.count({ where: { work_order_id: jc.id, status: "active" } });
  assert(active === 0, "planned worker still active on deleted Job Card");
  const listed = await prisma.work_orders.count({ where: { AND: [{ id: jc.id }, { deleted_at: null }, getWorkOrderVisibilityFilter(manager)] } });
  assert(listed === 0, "deleted Job Card still listed");
  const deNote = await prisma.notifications.count({ where: { event_key: "job_card.deletion_approved", recipient_user_id: dataEntry.userId, entity_id: jc.id } });
  assert(deNote === 1, "requester not notified");
  const audit = await prisma.audit_logs.count({ where: { action: "work_order.deleted", entity_id: jc.id } });
  assert(audit === 1, "no audit row");
  return `${jc.number} deleted_at set, row and number kept`;
});

await check("A2b", "After deletion: timers, roster, Materials Request, status change and duplicate approval are refused", async () => {
  const { jc, requestId, workerId } = (globalThis as Record<string, unknown>).A as { jc: { id: string }; requestId: string; workerId: string };
  const a = await prisma.workOrderWorkerAssignment.findFirstOrThrow({ where: { work_order_id: jc.id } });
  await rejects(sessions.startWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id }), /deleted/i, "start timer");
  await rejects(roster.assignInternalTeamRoster(manager, { workOrderId: jc.id, technicianIds: [workerId], helperIds: [], estimatedHoursByWorkerId: {} }), /deleted/i, "roster");
  await rejects(partsRequests.createPartsRequest(dataEntry, { workOrderId: jc.id, items: [{ description: "x", quantity: 1 }] } as never), /not found/i, "materials request");
  await rejects(service.requestJobCardClosure(dataEntry, jc.id, ""), /not found/i, "closure request");
  await rejects(deletion.approveJobCardDeletion(manager, { requestId }), /already approved/i, "second approval");
});

await check("A3", "Manager rejects: Job Card kept, reason recorded, requester notified", async () => {
  const jc = await newJobCard(dataEntry, "reject");
  const res = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Wrong asset" });
  await rejects(deletion.rejectJobCardDeletion(manager, { requestId: res.requestId, remarks: "" }), /why/i, "reject without reason");
  await deletion.rejectJobCardDeletion(manager, { requestId: res.requestId, remarks: "Asset is correct, keep it" });
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jc.id } });
  const req = await prisma.jobCardDeletionRequest.findUniqueOrThrow({ where: { id: res.requestId } });
  assert(wo.deleted_at === null, "Job Card deleted on reject");
  assert(req.status === "Rejected" && req.decision_remarks === "Asset is correct, keep it", "rejection not recorded");
  const n = await prisma.notifications.count({ where: { event_key: "job_card.deletion_rejected", recipient_user_id: dataEntry.userId, entity_id: jc.id } });
  assert(n === 1, "requester not notified");
  const again = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Asked again with more detail" });
  assert(!again.alreadyPending, "a new request after rejection should be allowed");
  await deletion.rejectJobCardDeletion(manager, { requestId: again.requestId, remarks: "Still no" });
});

await check("A4", "Issued store stock or a Materials Request blocks deletion with a clear reason", async () => {
  const jc = await newJobCard(dataEntry, "stock");
  await prisma.offline_inventory_movements.create({
    data: { movement_type: "ISSUED", movement_date: new Date(), manual_material_name: `${tag} oil`, quantity: 1, unit: "PCS", related_work_order_id: jc.id, created_by: manager.userId },
  });
  const m1 = await rejects(deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Not needed" }), /stock/i, "request with stock");
  const jc2 = await newJobCard(dataEntry, "mr");
  const mr = await prisma.parts_requests.create({ data: { work_order_id: jc2.id, status: "Requested", requested_by: dataEntry.userId, created_by: dataEntry.userId } });
  const m2 = await rejects(deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc2.id, reason: "Not needed" }), /Materials Request/i, "request with MR");
  assert(m2.includes(mr.parts_request_number ?? "Materials Request"), "MR number missing from reason");
  return `${m1.slice(0, 70)}…`;
});

await check("A5", "Recorded working hours block deletion; work recorded after the request blocks the approval", async () => {
  const jc = await newJobCard(dataEntry, "hours");
  const w = await newWorker("hours");
  const a = await assign(jc.id, w.id, dataEntry.userId);
  await period(a, 120, 60);
  await rejects(deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Not needed" }), /Worker time has been recorded/, "request with hours");

  const jc2 = await newJobCard(dataEntry, "race");
  const w2 = await newWorker("race");
  const a2 = await assign(jc2.id, w2.id, dataEntry.userId);
  const req = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc2.id, reason: "Duplicate card" });
  await sessions.startWorkSession(dataEntry, { workOrderId: jc2.id, workerAssignmentId: a2.id });
  await rejects(deletion.approveJobCardDeletion(manager, { requestId: req.requestId }), /can no longer be deleted/i, "approval after work started");
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jc2.id } });
  assert(wo.deleted_at === null, "deleted despite recorded work");
  await sessions.finishWorkSession(dataEntry, { workOrderId: jc2.id, workerAssignmentId: a2.id });
  await deletion.rejectJobCardDeletion(manager, { requestId: req.requestId, remarks: "Work has started" });
});

await check("A5b", "Approval racing a timer start: never a deleted Job Card with recorded work (10 rounds)", async () => {
  let deletedRounds = 0;
  for (let i = 0; i < 10; i++) {
    const jc = await newJobCard(dataEntry, `race-${i}`);
    const w = await newWorker(`race-${i}`);
    const a = await assign(jc.id, w.id, dataEntry.userId);
    const req = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Race check" });
    // Stagger the timer start 0–45 ms so both orderings actually happen.
    const delay = (i % 4) * 15;
    await Promise.allSettled([
      deletion.approveJobCardDeletion(manager, { requestId: req.requestId }),
      new Promise((r) => setTimeout(r, delay)).then(() => sessions.startWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id })),
    ]);
    const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jc.id } });
    const s = await prisma.workOrderWorkSession.count({ where: { work_order_id: jc.id } });
    assert(!(wo.deleted_at && s > 0), `round ${i}: deleted Job Card has ${s} work period(s)`);
    if (wo.deleted_at) deletedRounds++;
    else {
      await sessions.finishWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id }).catch(() => {});
      await prisma.jobCardDeletionRequest.updateMany({ where: { id: req.requestId, status: "Pending" }, data: { status: "Rejected", decision_remarks: "race cleanup" } });
    }
  }
  return `${deletedRounds} deleted cleanly, ${10 - deletedRounds} kept with the work`;
});

await check("A6", "Duplicate requests: retry returns the same request; others get a clear message; 6 concurrent → 1 row", async () => {
  const jc = await newJobCard(dataEntry, "dup");
  const first = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Duplicate" });
  const retry = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Duplicate" });
  assert(retry.alreadyPending && retry.requestId === first.requestId, "retry created a new request");
  await rejects(deletion.requestJobCardDeletion(superAdmin, { workOrderId: jc.id, reason: "Another person" }), /already waiting/i, "other requester");
  const jc2 = await newJobCard(dataEntry, "dup-concurrent");
  await Promise.allSettled(Array.from({ length: 6 }, () => deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc2.id, reason: "Clicked many times" })));
  const n = await prisma.jobCardDeletionRequest.count({ where: { work_order_id: jc2.id } });
  assert(n === 1, `${n} requests stored`);
  const notified = await prisma.notifications.count({ where: { event_key: "job_card.deletion_requested", entity_id: jc2.id, recipient_user_id: manager.userId } });
  assert(notified === 1, `${notified} notifications`);
});

await check("A7", "Unauthorized users cannot request or approve; nobody approves their own request", async () => {
  const jc = await newJobCard(dataEntry, "auth");
  await rejects(deletion.requestJobCardDeletion(technician, { workOrderId: jc.id, reason: "No access" }), /Only Maintenance Data Entry/, "technician request");
  await rejects(deletion.requestJobCardDeletion(storeKeeper, { workOrderId: jc.id, reason: "No access" }), /Only Maintenance Data Entry/, "store keeper request");
  await rejects(deletion.requestJobCardDeletion(manager, { workOrderId: jc.id, reason: "Manager" }), /Only Maintenance Data Entry/, "manager request");
  // Requests follow getWorkOrderVisibilityFilter. (Data Entry holds
  // store.issue in this database, which gives it the Store Keeper status
  // scope — Approved cards of others are visible — so the "not visible"
  // case uses a "Created" card owned by Data Entry #1.)
  const hidden = await newJobCard(dataEntry, "hidden");
  await prisma.work_orders.update({ where: { id: hidden.id }, data: { status: "Created" } });
  await rejects(deletion.requestJobCardDeletion(dataEntry2, { workOrderId: hidden.id, reason: "Not mine" }), /not found/i, "other Data Entry");
  await rejects(deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "x" }), /reason/i, "short reason");
  const req = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Valid reason" });
  await rejects(deletion.approveJobCardDeletion(dataEntry, { requestId: req.requestId }), /Only the Maintenance Manager/, "Data Entry approve");
  await rejects(deletion.approveJobCardDeletion(technician, { requestId: req.requestId }), /Only the Maintenance Manager/, "technician approve");
  await deletion.rejectJobCardDeletion(manager, { requestId: req.requestId, remarks: "cleanup" });
  const sa = await newJobCard(superAdmin, "self");
  const own = await deletion.requestJobCardDeletion(superAdmin, { workOrderId: sa.id, reason: "Own request" });
  await rejects(deletion.approveJobCardDeletion(superAdmin, { requestId: own.requestId }), /your own/i, "self approval");
  await deletion.rejectJobCardDeletion(manager, { requestId: own.requestId, remarks: "cleanup" });
});

await check("A8", "Closed and Closure Requested Job Cards cannot be deleted", async () => {
  const jc = await newJobCard(dataEntry, "closure-req");
  await service.requestJobCardClosure(dataEntry, jc.id, "");
  await rejects(deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Too late" }), /Closure has already been requested/, "closure requested");
  await service.approveJobCardClosure(manager, jc.id);
  await rejects(deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Too late" }), /closed/i, "closed");
});

// ── PART B — dates ───────────────────────────────────────────────────────────

async function datesOf(id: string) {
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id } });
  return getJobCardDates(prisma, wo);
}

await check("B1", "Created / not started / not finished / finished (paused + resumed, across midnight) / closed", async () => {
  const jc = await newJobCard(dataEntry, "dates");
  const w = await newWorker("dates");
  const a = await assign(jc.id, w.id, dataEntry.userId);
  let d = await datesOf(jc.id);
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jc.id } });
  assert(d.created.recorded && d.created.at === wo.created_at.toISOString(), "created wrong");
  assert(!d.workStart.recorded && d.workStart.label === "Not started", "start should be Not started");

  await sessions.startWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  d = await datesOf(jc.id);
  assert(d.workStart.recorded && !d.workEnd.recorded && d.workEnd.label === "Not finished", "working: end should be Not finished");
  const firstStart = d.workStart.recorded ? d.workStart.at : "";
  await sessions.pauseWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  await sessions.startWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id }); // resume
  await sessions.pauseWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  d = await datesOf(jc.id);
  assert(d.workStart.recorded && d.workStart.at === firstStart, "resume moved the start");
  assert(!d.workEnd.recorded && d.workEnd.label === "Not finished", "paused: end should be Not finished");
  await sessions.finishWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  d = await datesOf(jc.id);
  const lastEnd = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: a.id }, orderBy: { started_at: "desc" } });
  assert(d.workEnd.recorded && d.workEnd.at === (lastEnd.stopped_at ?? lastEnd.paused_at)!.toISOString(), "finished: end should be last period end");

  await service.requestJobCardClosure(dataEntry, jc.id, "");
  await service.approveJobCardClosure(manager, jc.id);
  const closedD = await datesOf(jc.id);
  assert(closedD.closed?.recorded && closedD.workEnd.recorded && closedD.workEnd.at !== closedD.closed.at, "closure must be separate from work end");
  return `start ${firstStart}`;
});

await check("B2", "Work across midnight (Kuwait) and existing historical Job Cards", async () => {
  const jc = await newJobCard(dataEntry, "midnight");
  const w = await newWorker("midnight");
  const a = await assign(jc.id, w.id, dataEntry.userId);
  // 22:00 → 02:00 Kuwait, a few days ago.
  const start = new Date(Date.UTC(2026, 9, 20, 19, 0));
  const end = new Date(Date.UTC(2026, 9, 20, 23, 0));
  await prisma.workOrderWorkSession.create({ data: { work_order_id: jc.id, worker_assignment_id: a.id, worker_id: w.id, started_at: start, stopped_at: end, status: "Completed", duration_minutes: 240, hourly_rate_snapshot: 6, calculated_amount: 24 } });
  await prisma.workOrderWorkerAssignment.update({ where: { id: a.id }, data: { status: "finished" } });
  const d = await datesOf(jc.id);
  assert(d.workEnd.recorded && d.workEnd.at === end.toISOString(), "midnight end wrong");
  const existing = await prisma.work_orders.findMany({ where: { deleted_at: null, NOT: { operator_complaint: { startsWith: "JCDEL-" } } }, take: 20 });
  const labels: string[] = [];
  for (const wo of existing) {
    const x = await getJobCardDates(prisma, wo);
    labels.push(`${wo.work_order_number}: ${x.workStart.recorded ? "start" : x.workStart.label}/${x.workEnd.recorded ? "end" : x.workEnd.label}`);
  }
  return `${existing.length} historical cards loaded — ${labels.slice(0, 4).join("; ")}`;
});

// ── PART D — Final Integration Review additions ─────────────────────────────

await check("D1", "Manager Edit / Correct: Kuwait wall-clock, history row (before → after, reason, who, when), overlap refused, long period needs confirmation", async () => {
  const jc = await newJobCard(dataEntry, "mgr-edit");
  const w = await newWorker("mgr-edit");
  const a = await assign(jc.id, w.id, manager.userId);
  const p = await period(a, 300, 240);
  await period(a, 200, 180);
  // "YYYY-MM-DDTHH:mm" is read as Kuwait time (UTC+3), whatever the server zone.
  const startStr = toKuwaitInputValue(minutesAgo(300));
  await sessions.editWorkSession(manager, { sessionId: p.id, startedAt: startStr, stoppedAt: toKuwaitInputValue(minutesAgo(250)), correctionReason: "Lunch not paused" });
  const edited = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: p.id } });
  assert(toKuwaitInputValue(edited.started_at) === startStr, `stored start ${edited.started_at.toISOString()} is not Kuwait ${startStr}`);
  const history = await corrections.getTimeCorrectionsForWorkOrder(prisma, jc.id, { userId: dataEntry.userId, canViewCosts: false });
  const h = history.find((c) => c.sessionId === p.id);
  assert(h && h.status === "Approved" && h.directByManager && h.originalMinutes === 60 && h.correctedMinutes === 50 && h.reason === "Lunch not paused", JSON.stringify(h));
  assert(h.costImpact === null, "cost impact shown to a non-cost viewer");
  await rejects(
    sessions.editWorkSession(manager, { sessionId: p.id, startedAt: toKuwaitInputValue(minutesAgo(300)), stoppedAt: toKuwaitInputValue(minutesAgo(190)), correctionReason: "Overlap test" }),
    /overlaps/i,
    "manager edit overlapping another period"
  );
  const longFrom = toKuwaitInputValue(minutesAgo(30 * 60));
  await rejects(
    sessions.editWorkSession(manager, { sessionId: p.id, startedAt: longFrom, stoppedAt: toKuwaitInputValue(minutesAgo(16 * 60)), correctionReason: "Long check" }),
    /unusually long/i,
    "long manager edit without confirmation"
  );
  await sessions.editWorkSession(manager, { sessionId: p.id, startedAt: longFrom, stoppedAt: toKuwaitInputValue(minutesAgo(16 * 60)), correctionReason: "Long check", confirmLongPeriod: true });
  const longRow = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: p.id } });
  assert(longRow.duration_minutes === 14 * 60 && longRow.original_duration_minutes === 60, `long edit ${longRow.duration_minutes} / original ${longRow.original_duration_minutes}`);
  const all = await corrections.getTimeCorrectionsForWorkOrder(prisma, jc.id, { userId: manager.userId, canViewCosts: true });
  assert(all.filter((c) => c.sessionId === p.id).length === 2, "each manager correction should be its own history row");
  return `2 history rows; start stored as Kuwait ${startStr}`;
});

await check("D2", "Manager manual entry: Kuwait wall-clock, overlap refused, labor counted once", async () => {
  const jc = await newJobCard(dataEntry, "manual");
  const w = await newWorker("manual");
  const a = await assign(jc.id, w.id, manager.userId);
  const before = await getWorkOrderLaborSummary(prisma, jc.id);
  const s = toKuwaitInputValue(minutesAgo(120));
  await sessions.addManualTimeEntry(manager, { workOrderId: jc.id, workerAssignmentId: a.id, startedAt: s, stoppedAt: toKuwaitInputValue(minutesAgo(60)) });
  const row = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: a.id, is_manual_entry: true } });
  assert(toKuwaitInputValue(row.started_at) === s, `manual start ${row.started_at.toISOString()} is not Kuwait ${s}`);
  await rejects(
    sessions.addManualTimeEntry(manager, { workOrderId: jc.id, workerAssignmentId: a.id, startedAt: toKuwaitInputValue(minutesAgo(90)), stoppedAt: toKuwaitInputValue(minutesAgo(30)) }),
    /overlaps/i,
    "overlapping manual entry"
  );
  const after = await getWorkOrderLaborSummary(prisma, jc.id);
  assert(after.total_minutes - before.total_minutes === 60, `labor moved by ${after.total_minutes - before.total_minutes} min`);
  return "60 min added once";
});

await check("D3", "Deletion lists: Manager sees pending requests and deleted history; Data Entry sees neither; deleted card not offered in Inventory", async () => {
  const jc = await newJobCard(dataEntry, "list-pending");
  const req = await deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Created twice by mistake" });
  const pending = await deletion.listPendingJobCardDeletionRequests(manager);
  const row = pending.find((r) => r.requestId === req.requestId);
  assert(row && row.reason === "Created twice by mistake" && row.workOrderNumber === jc.number && row.blockedReasons.length === 0, JSON.stringify(row));
  assert((await deletion.listPendingJobCardDeletionRequests(dataEntry)).length === 0, "Data Entry got the pending list");
  await deletion.approveJobCardDeletion(manager, { requestId: req.requestId, remarks: "Duplicate" });
  assert(!(await deletion.listPendingJobCardDeletionRequests(manager)).some((r) => r.requestId === req.requestId), "approved request still pending");
  const deleted = await deletion.listDeletedJobCards(manager);
  const d = deleted.find((r) => r.workOrderId === jc.id);
  assert(d && d.history.length === 1 && d.history[0].status === "Approved" && d.history[0].decisionRemarks === "Duplicate" && d.history[0].decidedByName, JSON.stringify(d));
  assert((await deletion.listDeletedJobCards(dataEntry)).length === 0, "Data Entry got the deleted history");
  const { getWorkOrderOptions } = await import("@/lib/store/offline-inventory-data");
  assert(!(await getWorkOrderOptions()).some((o) => o.id === jc.id), "deleted Job Card offered in the Inventory Job Card list");
  assert(await prisma.work_orders.findUnique({ where: { id: jc.id } }), "row physically deleted");
  return `${jc.number}: pending → approved → in deleted history`;
});

// ── PART C — time corrections ────────────────────────────────────────────────

const C = { jc: { id: "", number: "" as string | null }, worker: { id: "" }, assignmentId: "", p1: "", p2: "", correctionId: "" };

await check("C1", "Data Entry submits a correction; recorded values and totals stay until approval", async () => {
  const jc = await newJobCard(dataEntry, "correction");
  const w = await newWorker("correction", 6);
  const a = await assign(jc.id, w.id, dataEntry.userId, 6);
  // Two periods with a pause between: 8h ago → 3h ago (forgot to pause), 2h ago → 1h ago.
  const p1 = await period(a, 8 * 60, 3 * 60, "Paused");
  const p2 = await period(a, 2 * 60, 60, "Completed");
  Object.assign(C, { jc, worker: w, assignmentId: a.id, p1: p1.id, p2: p2.id });
  const before = await getWorkOrderLaborSummary(prisma, jc.id);
  const res = await corrections.requestWorkTimeCorrection(dataEntry, {
    sessionId: p1.id,
    correctedStart: toKuwaitInputValue(p1.started_at),
    correctedEnd: toKuwaitInputValue(new Date(p1.started_at.getTime() + 4 * 3600_000)),
    reason: "Forgot to press Pause at lunch",
  });
  C.correctionId = res.correctionId;
  const after = await getWorkOrderLaborSummary(prisma, jc.id);
  const p1Now = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: p1.id } });
  assert(p1Now.duration_minutes === p1.duration_minutes && p1Now.started_at.getTime() === p1.started_at.getTime() && p1Now.original_started_at === null, "period changed before approval");
  assert(after.total_amount === before.total_amount && after.total_hours === before.total_hours, "totals changed before approval");
  const n = await prisma.notifications.count({ where: { event_key: "job_card.time_correction_requested", entity_id: jc.id, recipient_user_id: manager.userId } });
  assert(n === 1, "manager not notified");
  return `pending; totals still ${before.total_hours} h`;
});

await check("C2", "Manager sees system vs corrected values and the cost impact; Data Entry sees no money", async () => {
  const mgrView = await corrections.getTimeCorrectionsForWorkOrder(prisma, C.jc.id, { userId: manager.userId, canViewCosts: canViewCosts(manager) });
  const deView = await corrections.getTimeCorrectionsForWorkOrder(prisma, C.jc.id, { userId: dataEntry.userId, canViewCosts: canViewCosts(dataEntry) });
  assert(canViewCosts(manager) && !canViewCosts(dataEntry), "unexpected cost permissions in test data");
  const m = mgrView[0];
  assert(m.status === "Pending" && m.originalMinutes === 300 && m.correctedMinutes === 240 && m.costImpact?.difference === -6, `manager view wrong: ${JSON.stringify(m)}`);
  assert(deView[0].costImpact === null, "Data Entry received cost impact");
  const deSessions = await getSessionsForAssignment(C.assignmentId, { includeCosts: false });
  assert(deSessions.every((s) => s.calculated_amount === 0 && s.hourly_rate_snapshot === 0), "session amounts sent without cost permission");
  assert(deSessions.find((s) => s.id === C.p1)?.pending_correction?.corrected_duration_minutes === 240, "pending correction not shown on period");
  return "300 min → 240 min, −6.000 KWD (manager only)";
});

await check("C3", "Closure is blocked while a correction waits", async () => {
  await prisma.workOrderWorkerAssignment.update({ where: { id: C.assignmentId }, data: { status: "finished" } });
  await rejects(service.requestJobCardClosure(dataEntry, C.jc.id, ""), /waiting for Manager review/i, "closure request");
});

await check("C4", "Manager approves: applied once, originals kept, labor hours and cost not double counted", async () => {
  const before = await getWorkOrderLaborSummary(prisma, C.jc.id);
  await rejects(corrections.approveWorkTimeCorrection(dataEntry, { correctionId: C.correctionId }), /Only the Maintenance Manager/, "Data Entry approve");
  const results5 = await Promise.allSettled(Array.from({ length: 5 }, () => corrections.approveWorkTimeCorrection(manager, { correctionId: C.correctionId, remarks: "Checked with supervisor" })));
  const ok = results5.filter((r) => r.status === "fulfilled").length;
  assert(ok === 1, `${ok} approvals succeeded`);
  const p1 = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: C.p1 } });
  assert(p1.duration_minutes === 240 && Number(p1.calculated_amount) === 24, `period not corrected: ${p1.duration_minutes} min`);
  assert(p1.original_duration_minutes === 300 && p1.original_started_at && p1.original_ended_at, "originals not kept");
  assert(p1.status === "Paused" && p1.paused_at?.getTime() === p1.started_at.getTime() + 4 * 3600_000, "end not applied to paused_at");
  const after = await getWorkOrderLaborSummary(prisma, C.jc.id);
  assert(after.total_minutes === before.total_minutes - 60, `minutes ${before.total_minutes} → ${after.total_minutes}`);
  assert(Math.abs(after.total_amount - (before.total_amount - 6)) < 0.0005, `amount ${before.total_amount} → ${after.total_amount}`);
  const c = await prisma.workSessionTimeCorrection.findUniqueOrThrow({ where: { id: C.correctionId } });
  assert(c.status === "Approved" && c.reviewed_by === manager.userId && c.review_remarks === "Checked with supervisor", "decision not recorded");
  await rejects(corrections.approveWorkTimeCorrection(manager, { correctionId: C.correctionId }), /already approved/, "re-approve");
  return `${before.total_minutes} → ${after.total_minutes} min; ${before.total_amount} → ${after.total_amount} KWD`;
});

await check("C5", "Manager rejects: recorded time kept; history of both decisions remains", async () => {
  const res = await corrections.requestWorkTimeCorrection(dataEntry, {
    sessionId: C.p2,
    correctedStart: toKuwaitInputValue(minutesAgo(150)),
    correctedEnd: toKuwaitInputValue(minutesAgo(60)),
    reason: "Started earlier than recorded",
  });
  const p2Before = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: C.p2 } });
  await corrections.rejectWorkTimeCorrection(manager, { correctionId: res.correctionId, remarks: "Supervisor confirms recorded time" });
  const p2After = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: C.p2 } });
  assert(p2After.duration_minutes === p2Before.duration_minutes && p2After.original_started_at === null, "rejected correction changed the period");
  const all = await prisma.workSessionTimeCorrection.findMany({ where: { work_order_id: C.jc.id } });
  assert(all.length === 2 && all.some((x) => x.status === "Approved") && all.some((x) => x.status === "Rejected"), "history incomplete");
});

await check("C6", "Pauses respected: a correction may not overlap the worker's other period (same or other Job Card)", async () => {
  const p1 = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: C.p1 } });
  // Stretch period 1 into period 2 (which started 2h ago).
  await rejects(
    corrections.requestWorkTimeCorrection(dataEntry, { sessionId: C.p1, correctedStart: toKuwaitInputValue(p1.started_at), correctedEnd: toKuwaitInputValue(minutesAgo(90)), reason: "Overlap test" }),
    /overlaps/i,
    "same-card overlap"
  );
  const other = await newJobCard(dataEntry, "other-card");
  const a2 = await assign(other.id, C.worker.id, dataEntry.userId);
  const op = await period(a2, 30, 10);
  await rejects(
    corrections.requestWorkTimeCorrection(dataEntry, { sessionId: op.id, correctedStart: toKuwaitInputValue(minutesAgo(100)), correctedEnd: toKuwaitInputValue(minutesAgo(10)), reason: "Overlap other card" }),
    new RegExp(`overlaps.*${(C.jc.number ?? "").replace(/\//g, "\\/")}`),
    "cross-card overlap"
  );
  // Inside the pause gap (3h ago → 2h ago) is fine.
  const ok = await corrections.requestWorkTimeCorrection(dataEntry, {
    sessionId: op.id,
    correctedStart: toKuwaitInputValue(minutesAgo(170)),
    correctedEnd: toKuwaitInputValue(minutesAgo(130)),
    reason: "Work was during the gap",
  });
  await corrections.rejectWorkTimeCorrection(manager, { correctionId: ok.correctionId, remarks: "cleanup" });
});

await check("C7", "Invalid input, active timer, cancelled period, closed Job Card and wrong roles are refused", async () => {
  const p2 = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: C.p2 } });
  const s = toKuwaitInputValue(p2.started_at);
  await rejects(corrections.requestWorkTimeCorrection(dataEntry, { sessionId: C.p2, correctedStart: "2026-02-30T10:00", correctedEnd: s, reason: "Bad date" }), /valid/i, "invalid date");
  await rejects(corrections.requestWorkTimeCorrection(dataEntry, { sessionId: C.p2, correctedStart: s, correctedEnd: toKuwaitInputValue(new Date(p2.started_at.getTime() - 60_000)), reason: "Reversed" }), /after the start/i, "end before start");
  await rejects(corrections.requestWorkTimeCorrection(dataEntry, { sessionId: C.p2, correctedStart: s, correctedEnd: toKuwaitInputValue(new Date(Date.now() + 3600_000)), reason: "Future" }), /future/i, "future");
  // Final Integration Review: no unconditional length limit — a long period
  // (here ~20 h) is refused only until it is explicitly confirmed (or for
  // overlapping the worker's other periods).
  await rejects(corrections.requestWorkTimeCorrection(dataEntry, { sessionId: C.p2, correctedStart: toKuwaitInputValue(minutesAgo(20 * 60)), correctedEnd: s, reason: "Too long" }), /unusually long|overlaps/i, "long period without confirmation");
  await rejects(corrections.requestWorkTimeCorrection(dataEntry, { sessionId: C.p2, correctedStart: s, correctedEnd: toKuwaitInputValue(p2.stopped_at!), reason: "Same times" }), /same as the recorded/i, "unchanged");
  await rejects(corrections.requestWorkTimeCorrection(technician, { sessionId: C.p2, correctedStart: s, correctedEnd: s, reason: "Tech" }), /Only Maintenance Data Entry/, "technician");
  await rejects(corrections.requestWorkTimeCorrection(manager, { sessionId: C.p2, correctedStart: s, correctedEnd: s, reason: "Manager" }), /Only Maintenance Data Entry/, "manager");
  // A card outside Data Entry #2's visibility (see A7 for why "Created").
  const hidden = await newJobCard(dataEntry, "hidden-correction");
  const hw = await newWorker("hidden");
  const hp = await period(await assign(hidden.id, hw.id, dataEntry.userId), 50, 40);
  await prisma.work_orders.update({ where: { id: hidden.id }, data: { status: "Created" } });
  await rejects(corrections.requestWorkTimeCorrection(dataEntry2, { sessionId: hp.id, correctedStart: toKuwaitInputValue(minutesAgo(50)), correctedEnd: toKuwaitInputValue(minutesAgo(45)), reason: "Not my card" }), /not found/i, "invisible card");

  const jc = await newJobCard(dataEntry, "active");
  const w = await newWorker("active");
  const a = await assign(jc.id, w.id, dataEntry.userId);
  await sessions.startWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  const running = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: a.id, status: "Active" } });
  await rejects(corrections.requestWorkTimeCorrection(dataEntry, { sessionId: running.id, correctedStart: toKuwaitInputValue(minutesAgo(30)), correctedEnd: toKuwaitInputValue(minutesAgo(5)), reason: "Running" }), /still working/i, "active timer");
  await sessions.finishWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  const cancelled = await period(a, 300, 290);
  await prisma.workOrderWorkSession.update({ where: { id: cancelled.id }, data: { status: "Cancelled" } });
  await rejects(corrections.requestWorkTimeCorrection(dataEntry, { sessionId: cancelled.id, correctedStart: toKuwaitInputValue(minutesAgo(300)), correctedEnd: toKuwaitInputValue(minutesAgo(295)), reason: "Cancelled" }), /cancelled/i, "cancelled period");
  await service.requestJobCardClosure(dataEntry, jc.id, "");
  await service.approveJobCardClosure(manager, jc.id);
  const closedPeriod = await prisma.workOrderWorkSession.findFirstOrThrow({ where: { worker_assignment_id: a.id, status: "Completed" } });
  await rejects(corrections.requestWorkTimeCorrection(dataEntry, { sessionId: closedPeriod.id, correctedStart: toKuwaitInputValue(closedPeriod.started_at), correctedEnd: toKuwaitInputValue(minutesAgo(1)), reason: "Closed" }), /closed/i, "closed card");
});

await check("C8", "Recorded time changed after the request (Manager edit) → approval refused; self-approval refused", async () => {
  const jc = await newJobCard(superAdmin, "stale");
  const w = await newWorker("stale");
  const a = await assign(jc.id, w.id, superAdmin.userId);
  const p = await period(a, 600, 540);
  const req = await corrections.requestWorkTimeCorrection(superAdmin, { sessionId: p.id, correctedStart: toKuwaitInputValue(minutesAgo(600)), correctedEnd: toKuwaitInputValue(minutesAgo(570)), reason: "Stale check" });
  await rejects(corrections.approveWorkTimeCorrection(superAdmin, { correctionId: req.correctionId }), /your own/i, "self approval");
  // Final Integration Review: the Manager cannot edit a period while a Data
  // Entry correction of it is waiting (approving that one later would
  // silently overwrite the edit) — decide the pending one first.
  await rejects(
    sessions.editWorkSession(manager, { sessionId: p.id, startedAt: toKuwaitInputValue(minutesAgo(600)), stoppedAt: toKuwaitInputValue(minutesAgo(580)), correctionReason: "Manager direct fix" }),
    /waiting for review/i,
    "manager edit while a correction is pending"
  );
  await corrections.rejectWorkTimeCorrection(manager, { correctionId: req.correctionId, remarks: "Manager will fix directly" });
  // Kuwait wall-clock strings, as the form sends them.
  await sessions.editWorkSession(manager, { sessionId: p.id, startedAt: toKuwaitInputValue(minutesAgo(600)), stoppedAt: toKuwaitInputValue(minutesAgo(580)), correctionReason: "Manager direct fix" });
  const edited = await prisma.workOrderWorkSession.findUniqueOrThrow({ where: { id: p.id } });
  assert(edited.original_duration_minutes === 60 && edited.original_started_at?.getTime() === p.started_at.getTime(), "manager edit did not keep the original");
  assert(edited.duration_minutes === 20, `edited duration ${edited.duration_minutes}`);
  // Stale-approval protection still holds for a change made outside the request flow.
  const req2 = await corrections.requestWorkTimeCorrection(superAdmin, { sessionId: p.id, correctedStart: toKuwaitInputValue(minutesAgo(600)), correctedEnd: toKuwaitInputValue(minutesAgo(590)), reason: "Second check" });
  await prisma.workOrderWorkSession.update({ where: { id: p.id }, data: { duration_minutes: 21 } });
  await rejects(corrections.approveWorkTimeCorrection(manager, { correctionId: req2.correctionId }), /changed after the correction was sent/, "stale approval");
  await prisma.workOrderWorkSession.update({ where: { id: p.id }, data: { duration_minutes: 20 } });
  await corrections.rejectWorkTimeCorrection(manager, { correctionId: req2.correctionId, remarks: "Superseded" });
});

await check("C9", "Existing timer rules still work (start/pause/resume/finish, one running timer per worker)", async () => {
  const w = await newWorker("timer");
  const j1 = await newJobCard(dataEntry, "timer-1");
  const j2 = await newJobCard(dataEntry, "timer-2");
  const a1 = await assign(j1.id, w.id, dataEntry.userId);
  const a2 = await assign(j2.id, w.id, dataEntry.userId);
  await sessions.startWorkSession(dataEntry, { workOrderId: j1.id, workerAssignmentId: a1.id });
  await rejects(sessions.startWorkSession(dataEntry, { workOrderId: j2.id, workerAssignmentId: a2.id }), /already working/i, "second timer");
  await sessions.pauseWorkSession(dataEntry, { workOrderId: j1.id, workerAssignmentId: a1.id });
  await sessions.startWorkSession(dataEntry, { workOrderId: j2.id, workerAssignmentId: a2.id });
  await sessions.finishWorkSession(dataEntry, { workOrderId: j2.id, workerAssignmentId: a2.id });
  await sessions.startWorkSession(dataEntry, { workOrderId: j1.id, workerAssignmentId: a1.id });
  await sessions.finishWorkSession(dataEntry, { workOrderId: j1.id, workerAssignmentId: a1.id });
  const n = await prisma.workOrderWorkSession.count({ where: { worker_id: w.id } });
  assert(n === 3, `${n} periods`);
});

await check("C10", "Job Card creation idempotency still holds (same submission id → same Job Card)", async () => {
  const jc = await newJobCard(dataEntry, "idem");
  const again = await creation.createJobCardFromForm(dataEntry, jc.fd, { submissionId: jc.submissionId, correlationId: randomUUID(), route: "verify" });
  assert(again.ok && again.replayed && again.jobCard.id === jc.id, "replay created a second Job Card");
  const n = await prisma.work_orders.count({ where: { client_submission_id: jc.submissionId } });
  assert(n === 1, `${n} rows`);
});

// ── PART E — Manual worker time entry (Data Entry → Manager) ────────────────

const kw = (d: Date) => toKuwaitInputValue(d);
async function manualCard(label: string, rate = 6) {
  const jc = await newJobCard(dataEntry, label);
  const w = await newWorker(label, rate);
  const a = await assign(jc.id, w.id, dataEntry.userId, rate);
  return { jc, w, a };
}

await check("E1", "No timer used: entry waits (nothing counted), Manager approves → ONE period, manual, entered by Data Entry, rate snapshot, counted once", async () => {
  const { jc, a } = await manualCard("manual-basic", 7.5);
  const before = await getWorkOrderLaborSummary(prisma, jc.id);
  const r = await corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: kw(minutesAgo(300)), end: kw(minutesAgo(180)), reason: "Timer not used" });
  const mid = await getWorkOrderLaborSummary(prisma, jc.id);
  assert(mid.total_minutes === before.total_minutes && mid.total_amount === before.total_amount, "pending entry changed totals");
  assert((await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: a.id } })) === 0, "a session exists before approval");
  await corrections.approveWorkTimeCorrection(manager, { correctionId: r.entryId });
  const sessionsAfter = await prisma.workOrderWorkSession.findMany({ where: { worker_assignment_id: a.id } });
  assert(sessionsAfter.length === 1, `${sessionsAfter.length} sessions`);
  const s = sessionsAfter[0];
  assert(s.is_manual_entry && s.entered_by === dataEntry.userId && s.status === "Completed" && s.duration_minutes === 120, JSON.stringify(s));
  assert(Number(s.hourly_rate_snapshot) === 7.5 && Number(s.calculated_amount) === 15, `rate ${s.hourly_rate_snapshot} amount ${s.calculated_amount}`);
  const entry = await prisma.workSessionTimeCorrection.findUniqueOrThrow({ where: { id: r.entryId } });
  assert(entry.status === "Approved" && entry.work_session_id === s.id && entry.reviewed_by === manager.userId, "entry not linked/approved");
  const after = await getWorkOrderLaborSummary(prisma, jc.id);
  assert(after.total_minutes - before.total_minutes === 120 && after.total_amount - before.total_amount === 15, `totals +${after.total_minutes - before.total_minutes} min`);
  await rejects(corrections.approveWorkTimeCorrection(manager, { correctionId: r.entryId }), /already approved/i, "second approval");
  assert((await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: a.id } })) === 1, "approved twice");
  return "120 min / 15.000 counted once";
});

await check("E2", "Across midnight (Kuwait) and several separate periods; overlaps with recorded, pending and running time refused", async () => {
  const { jc, a, w } = await manualCard("manual-multi");
  // 22:00 → 02:00 Kuwait, two days ago (overnight).
  const d = new Date(Date.now() - 2 * 86400_000);
  const day = kw(d).slice(0, 10);
  const next = kw(new Date(d.getTime() + 86400_000)).slice(0, 10);
  const night = await corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: `${day}T22:00`, end: `${next}T02:00`, reason: "Night shift" });
  const nightRow = await prisma.workSessionTimeCorrection.findUniqueOrThrow({ where: { id: night.entryId } });
  assert(nightRow.corrected_duration_minutes === 240, `night ${nightRow.corrected_duration_minutes}`);
  // Overlaps the pending night entry.
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: `${next}T01:00`, end: `${next}T03:00`, reason: "Overlap pending" }), /overlaps/i, "overlap with pending entry");
  // A second, separate period the next morning is fine.
  const morning = await corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: `${next}T08:00`, end: `${next}T10:30`, reason: "Morning" });
  await corrections.approveWorkTimeCorrection(manager, { correctionId: night.entryId });
  await corrections.approveWorkTimeCorrection(manager, { correctionId: morning.entryId });
  const sum = await getWorkOrderLaborSummary(prisma, jc.id);
  assert(sum.total_minutes === 240 + 150, `total ${sum.total_minutes}`);
  // Overlap with a recorded (approved) period.
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: `${next}T09:00`, end: `${next}T11:00`, reason: "Overlap recorded" }), /overlaps/i, "overlap with recorded");
  // Running timer for this worker.
  await sessions.startWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: kw(minutesAgo(600)), end: kw(minutesAgo(590)), reason: "Timer running" }), /timer is running/i, "running timer");
  await sessions.pauseWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  // Same worker on another Job Card cannot overlap either.
  const other = await newJobCard(dataEntry, "manual-other");
  const a2 = await assign(other.id, w.id, dataEntry.userId);
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a2.id, start: `${next}T09:30`, end: `${next}T09:45`, reason: "Other card overlap" }), /overlaps/i, "cross Job Card overlap");
  return "240 + 150 min";
});

await check("E3", "Duplicates: same entry twice → same row; 5 at once → 1 row; invalid / future / reversed refused", async () => {
  const { a } = await manualCard("manual-dup");
  const input = { workerAssignmentId: a.id, start: kw(minutesAgo(500)), end: kw(minutesAgo(440)), reason: "Double click" };
  const first = await corrections.requestManualWorkTimeEntry(dataEntry, input);
  const again = await corrections.requestManualWorkTimeEntry(dataEntry, input);
  assert(again.alreadyPending && again.entryId === first.entryId, "retry created a second entry");
  const { a: b } = await manualCard("manual-dup5");
  const input5 = { workerAssignmentId: b.id, start: kw(minutesAgo(500)), end: kw(minutesAgo(440)), reason: "Five clicks" };
  await Promise.allSettled(Array.from({ length: 5 }, () => corrections.requestManualWorkTimeEntry(dataEntry, input5)));
  const n = await prisma.workSessionTimeCorrection.count({ where: { worker_assignment_id: b.id, entry_kind: "manual_entry" } });
  assert(n === 1, `${n} rows from 5 concurrent submissions`);
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, { ...input, start: "2026-02-30T08:00", reason: "Bad date" }), /valid/i, "invalid date");
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, { ...input, start: kw(minutesAgo(100)), end: kw(minutesAgo(200)), reason: "Reversed" }), /after the start/i, "reversed");
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, { ...input, start: kw(minutesAgo(30)), end: kw(new Date(Date.now() + 3600_000)), reason: "Future" }), /future/i, "future");
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, { ...input, reason: "x" }), /reason/i, "short reason");
});

await check("E4", "Permissions and eligibility: Manager/technician/store keeper cannot submit; closed, Closure Requested, deleted cards and finished workers refused", async () => {
  const { jc, a } = await manualCard("manual-perm");
  const input = { workerAssignmentId: a.id, start: kw(minutesAgo(900)), end: kw(minutesAgo(880)), reason: "Perm check" };
  for (const who of [manager, technician, storeKeeper]) {
    await rejects(corrections.requestManualWorkTimeEntry(who, input), /Only Maintenance Data Entry/i, who.role?.slug ?? "role");
  }
  await prisma.work_orders.update({ where: { id: jc.id }, data: { status: "Closure Requested" } });
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, input), /Closure has already been requested/i, "closure requested");
  await prisma.work_orders.update({ where: { id: jc.id }, data: { status: "Closed" } });
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, input), /closed/i, "closed");
  await prisma.work_orders.update({ where: { id: jc.id }, data: { status: "Approved", deleted_at: new Date() } });
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, input), /not found/i, "deleted");
  await prisma.work_orders.update({ where: { id: jc.id }, data: { deleted_at: null } });
  await prisma.workOrderWorkerAssignment.update({ where: { id: a.id }, data: { status: "finished" } });
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry, input), /already marked Finished/i, "finished worker");
  // Not visible to the second Data Entry user (own cards only).
  await prisma.workOrderWorkerAssignment.update({ where: { id: a.id }, data: { status: "active" } });
  await prisma.work_orders.update({ where: { id: jc.id }, data: { status: "Created" } });
  await rejects(corrections.requestManualWorkTimeEntry(dataEntry2, input), /not found/i, "invisible card");
  await prisma.work_orders.update({ where: { id: jc.id }, data: { status: "Approved" } });
  // Requester cannot approve their own entry.
  const own = await corrections.requestManualWorkTimeEntry(superAdmin, input);
  await rejects(corrections.approveWorkTimeCorrection(superAdmin, { correctionId: own.entryId }), /your own/i, "self approval");
  await corrections.rejectWorkTimeCorrection(manager, { correctionId: own.entryId, remarks: "Test cleanup" });
});

await check("E5", "Reject: nothing recorded, totals unchanged, history kept with the decision", async () => {
  const { jc, a } = await manualCard("manual-reject");
  const before = await getWorkOrderLaborSummary(prisma, jc.id);
  const r = await corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: kw(minutesAgo(400)), end: kw(minutesAgo(300)), reason: "Maybe wrong" });
  await corrections.rejectWorkTimeCorrection(manager, { correctionId: r.entryId, remarks: "Supervisor says no" });
  const after = await getWorkOrderLaborSummary(prisma, jc.id);
  assert(after.total_minutes === before.total_minutes, "rejected entry counted");
  assert((await prisma.workOrderWorkSession.count({ where: { worker_assignment_id: a.id } })) === 0, "rejected entry created a session");
  const views = await corrections.getTimeCorrectionsForWorkOrder(prisma, jc.id, { userId: manager.userId, canViewCosts: true });
  const v = views.find((x) => x.id === r.entryId);
  assert(v && v.kind === "manual_entry" && v.status === "Rejected" && v.reviewRemarks === "Supervisor says no" && v.originalStart === null, JSON.stringify(v));
});

await check("E6", "Worker completion + closure: Finish refused with no time / while waiting; closure refused while waiting; after approval → Mark Finished → closure request OK", async () => {
  const { jc, a } = await manualCard("manual-close");
  await rejects(sessions.finishWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id }), /No work time is recorded/i, "finish with no time");
  const r = await corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: kw(minutesAgo(700)), end: kw(minutesAgo(640)), reason: "Done without timer" });
  await rejects(sessions.finishWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id }), /waiting for Manager review/i, "finish while waiting");
  await rejects(service.requestJobCardClosure(dataEntry, jc.id, ""), /waiting for Manager review|not finished|Worker not started/i, "closure while waiting");
  const assignmentMid = await prisma.workOrderWorkerAssignment.findUniqueOrThrow({ where: { id: a.id } });
  assert(assignmentMid.status === "active", "submission finished the worker");
  await corrections.approveWorkTimeCorrection(manager, { correctionId: r.entryId });
  assert((await prisma.workOrderWorkerAssignment.findUniqueOrThrow({ where: { id: a.id } })).status === "active", "approval finished the worker automatically");
  await sessions.finishWorkSession(dataEntry, { workOrderId: jc.id, workerAssignmentId: a.id });
  assert((await prisma.workOrderWorkerAssignment.findUniqueOrThrow({ where: { id: a.id } })).status === "finished", "Mark Finished did not finish");
  await service.requestJobCardClosure(dataEntry, jc.id, "");
  const wo = await prisma.work_orders.findUniqueOrThrow({ where: { id: jc.id } });
  assert(wo.status === "Closure Requested", wo.status);
  const dates = await getJobCardDates(prisma, { id: jc.id, created_at: wo.created_at!, status: wo.status, starting_datetime: null, ending_datetime: null });
  assert(dates.workStart.recorded && dates.workEnd.recorded, "dates not recorded from the approved manual period");
  return "Work Start/End from the approved manual period";
});

await check("E7", "Privacy and summary: Data Entry gets no rate/cost; minutes split timer vs manual; pending entry blocks deletion", async () => {
  const { jc, a } = await manualCard("manual-privacy", 9);
  await period(a, 1000, 940, "Completed", 9); // 60 min by timer
  const r = await corrections.requestManualWorkTimeEntry(dataEntry, { workerAssignmentId: a.id, start: kw(minutesAgo(900)), end: kw(minutesAgo(870)), reason: "Extra" });
  const deView = await corrections.getTimeCorrectionsForWorkOrder(prisma, jc.id, { userId: dataEntry.userId, canViewCosts: canViewCosts(dataEntry) });
  assert(deView.every((v) => v.costImpact === null), "Data Entry received cost data");
  const mgrView = await corrections.getTimeCorrectionsForWorkOrder(prisma, jc.id, { userId: manager.userId, canViewCosts: true });
  assert(mgrView[0].costImpact?.correctedAmount === 4.5, JSON.stringify(mgrView[0].costImpact));
  const del = await rejects(deletion.requestJobCardDeletion(dataEntry, { workOrderId: jc.id, reason: "Not needed now" }), /waiting for Manager review|Worker time has been recorded/i, "deletion with pending");
  let summary = (await corrections.getWorkTimeSourceSummaries(prisma, [jc.id])).get(jc.id)!;
  assert(summary.automaticMinutes === 60 && summary.manualMinutes === 0 && summary.pendingManualEntries === 1, JSON.stringify(summary));
  await corrections.approveWorkTimeCorrection(manager, { correctionId: r.entryId });
  summary = (await corrections.getWorkTimeSourceSummaries(prisma, [jc.id])).get(jc.id)!;
  assert(summary.automaticMinutes === 60 && summary.manualMinutes === 30 && summary.pendingManualEntries === 0, JSON.stringify(summary));
  return `deletion refused: ${del.slice(0, 50)}…`;
});

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
await prisma.$disconnect();
process.exit(failed ? 1 : 0);
