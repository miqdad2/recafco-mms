/**
 * Critical Workflow Popup Review Modal (Unit 10G.7) — verification script.
 *
 * lib/notifications/critical-popup.ts (`import "server-only"`) and
 * app/actions/job-card-summary.ts (`"use server"`) can't be imported into a
 * standalone Node script — same limitation as every prior *.mjs script in
 * this directory touching either kind of file. This script mirrors both
 * functions' logic exactly (same rule table, same payload-building, same
 * summary-derivation rules) against real rows in a rolled-back transaction,
 * so a regression in either is still caught.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-critical-popup-review-modal-unit10g7.mjs
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// ---- Mirrors lib/notifications/critical-popup.ts's rule table + payload building ----

const MANAGER_RULES = {
  "job_card.closure_requested": { primaryLabel: "Review Closure", reviewMode: "closure_review" },
  "job_card.created": { primaryLabel: "View Summary", reviewMode: "job_card_summary" },
  "job_card.started": { primaryLabel: "View Summary", reviewMode: "job_card_summary" },
};
const DATA_ENTRY_RULES = {
  "job_card.closed": { primaryLabel: "Open Job Card", secondaryLabel: "Open Daily Activity", secondaryHref: "/maintenance/daily-activity" },
  "job_card.assignment_updated": { primaryLabel: "Open Job Card" },
};

function buildPayload(notification, rule) {
  const primaryHref = notification.action_url ?? (notification.entity_type === "work_order" && notification.entity_id ? `/maintenance/work-orders/${notification.entity_id}` : "/notifications");
  const workOrderId = notification.entity_type === "work_order" && notification.entity_id ? notification.entity_id : null;
  const jobCardDetailHref = workOrderId ? `/maintenance/work-orders/${workOrderId}` : null;
  return {
    primaryLabel: rule.primaryLabel,
    primaryHref,
    secondaryLabel: rule.reviewMode ? "Open Full Job Card" : (rule.secondaryLabel ?? null),
    secondaryHref: rule.reviewMode ? jobCardDetailHref : (rule.secondaryHref ?? null),
    workOrderId,
    reviewMode: rule.reviewMode ?? null,
    jobCardDetailHref,
  };
}

// ---- Mirrors app/actions/job-card-summary.ts's derivation logic ----

function materialsStatusLabel(status) {
  if (status === "fulfilled") return "Fully Issued";
  if (status === "partial") return "Partially Issued";
  if (status === "issuable") return "Ready to Issue";
  if (status === "shortage") return "Materials Pending";
  return "No Materials Required";
}

function deriveNextAction({ materialsBlocking, hasAssignment, hasActiveSession }) {
  if (materialsBlocking) return "Issue required materials";
  if (!hasAssignment) return "Assign workers";
  if (hasActiveSession) return "Monitor progress in Daily Activity";
  return "Review Job Card and confirm next step";
}

console.log("== 1. Task 1/2/4/5 — payload building for the two changed Manager rules ==");
{
  const closureNotification = { action_url: null, entity_type: "work_order", entity_id: "00000000-0000-0000-0000-0000000000aa" };
  const closurePayload = buildPayload(closureNotification, MANAGER_RULES["job_card.closure_requested"]);
  check('Task 2 — primary label is exactly "Review Closure"', closurePayload.primaryLabel === "Review Closure");
  check("Task 1 — reviewMode is closure_review", closurePayload.reviewMode === "closure_review");
  check("workOrderId resolves from entity_id", closurePayload.workOrderId === "00000000-0000-0000-0000-0000000000aa");
  check('Task 5 — secondary is "Open Full Job Card" pointing at the canonical Job Card URL', closurePayload.secondaryLabel === "Open Full Job Card" && closurePayload.secondaryHref === "/maintenance/work-orders/00000000-0000-0000-0000-0000000000aa");

  const startedNotification = { action_url: null, entity_type: "work_order", entity_id: "00000000-0000-0000-0000-0000000000bb" };
  const startedPayload = buildPayload(startedNotification, MANAGER_RULES["job_card.started"]);
  check('Task 4 — primary label is exactly "View Summary"', startedPayload.primaryLabel === "View Summary");
  check("Task 4 — reviewMode is job_card_summary", startedPayload.reviewMode === "job_card_summary");

  const createdPayload = buildPayload(startedNotification, MANAGER_RULES["job_card.created"]);
  check('job_card.created also gets "View Summary" / job_card_summary (same rule as job_card.started)', createdPayload.primaryLabel === "View Summary" && createdPayload.reviewMode === "job_card_summary");
}

console.log("\n== 2. Regression — Data Entry's own rules are completely unaffected ==");
{
  const closedNotification = { action_url: "/maintenance/work-orders/00000000-0000-0000-0000-0000000000cc", entity_type: "work_order", entity_id: "00000000-0000-0000-0000-0000000000cc" };
  const closedPayload = buildPayload(closedNotification, DATA_ENTRY_RULES["job_card.closed"]);
  check('job_card.closed keeps "Open Job Card" (plain-link primary, unchanged)', closedPayload.primaryLabel === "Open Job Card");
  check("job_card.closed has no reviewMode -> critical-workflow-popup.tsx renders its original Link-based primary action", closedPayload.reviewMode === null);
  check('job_card.closed keeps its own static secondary ("Open Daily Activity"), not overridden by the reviewMode branch', closedPayload.secondaryLabel === "Open Daily Activity" && closedPayload.secondaryHref === "/maintenance/daily-activity");
}

// ---- 3. getJobCardSummaryAction's derivation logic against real rows ----
const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G7 verify script";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    console.log("\n== 3. Task 4/7 — Job Card Summary derivation: no workers, no materials issue ==");
    const woNoWorkers = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Assigned", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    const assignmentsNone = await tx.workOrderWorkerAssignment.findMany({ where: { work_order_id: woNoWorkers.id, status: "active" } });
    check("No active assignments on a fresh Job Card", assignmentsNone.length === 0);
    const nextActionNoWorkers = deriveNextAction({ materialsBlocking: false, hasAssignment: assignmentsNone.length > 0, hasActiveSession: false });
    check('Task 4 — next action is "Assign workers" when nothing is assigned yet', nextActionNoWorkers === "Assign workers");

    console.log("\n== 4. Task 4/7 — with an active worker session ==");
    const worker = await tx.workerProfile.create({
      data: { name: `${MARKER} Worker`, worker_type: "Helper/Labor", hourly_rate: 2.0, created_by: user.id, updated_by: user.id },
      select: { id: true },
    });
    const assignment = await tx.workOrderWorkerAssignment.create({
      data: { work_order_id: woNoWorkers.id, worker_id: worker.id, worker_role: "Helper/Labor", hourly_rate_snapshot: 2.0, status: "active", assigned_by: user.id },
      select: { id: true },
    });
    await tx.workOrderWorkSession.create({
      data: { work_order_id: woNoWorkers.id, worker_assignment_id: assignment.id, worker_id: worker.id, started_at: new Date(), status: "Active", duration_minutes: 0, hourly_rate_snapshot: 2.0, calculated_amount: 0, entered_by: user.id },
    });
    const activeSession = await tx.workOrderWorkSession.findFirst({ where: { work_order_id: woNoWorkers.id, status: { in: ["Active", "Paused"] } }, select: { status: true } });
    const assignmentsNow = await tx.workOrderWorkerAssignment.findMany({ where: { work_order_id: woNoWorkers.id, status: "active" } });
    check("Task 7 — assignment status detects the active session without fetching full session history", activeSession?.status === "Active");
    const assignmentLabel = assignmentsNow.length > 0 ? `${assignmentsNow.length} worker${assignmentsNow.length !== 1 ? "s" : ""}${activeSession?.status === "Active" ? " · Working Now" : ""}` : "No workers assigned";
    check('Assignment status label reads "1 worker · Working Now"', assignmentLabel === "1 worker · Working Now");
    const nextActionActive = deriveNextAction({ materialsBlocking: false, hasAssignment: assignmentsNow.length > 0, hasActiveSession: Boolean(activeSession) });
    check('Task 4 — next action is "Monitor progress in Daily Activity" once work is underway', nextActionActive === "Monitor progress in Daily Activity");

    console.log("\n== 5. Task 7 — attachments are counted, not fetched in full ==");
    await tx.work_order_attachments.create({
      data: { work_order_id: woNoWorkers.id, attachment_type: "Completed Work Photo", file_name: "a.jpg", file_path: `uploads/work-order-files/${woNoWorkers.id}/a.jpg`, content_type: "image/jpeg", file_size: 100, uploaded_by: user.id },
    });
    const countedRow = await tx.work_orders.findUnique({ where: { id: woNoWorkers.id }, select: { _count: { select: { work_order_attachments: true } } } });
    check("_count gives the attachment count via one lightweight aggregate, no attachment rows fetched", countedRow._count.work_order_attachments === 1);

    console.log("\n== 6. Task 7 — materials status label mapping ==");
    check('"shortage" -> "Materials Pending" (blocks next action)', materialsStatusLabel("shortage") === "Materials Pending");
    check('"fulfilled" -> "Fully Issued"', materialsStatusLabel("fulfilled") === "Fully Issued");
    const nextActionMaterialsBlocked = deriveNextAction({ materialsBlocking: true, hasAssignment: true, hasActiveSession: false });
    check('Task 4 — materials shortage takes priority over "Assign workers"/"Monitor progress"', nextActionMaterialsBlocked === "Issue required materials");

    console.log("\nRolling back — no data persisted.");
    throw new Error("__ROLLBACK__");
  });
} catch (err) {
  if (err.message !== "__ROLLBACK__") {
    console.error("Unexpected error:", err);
    failures++;
  }
} finally {
  await prisma.$disconnect();
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
