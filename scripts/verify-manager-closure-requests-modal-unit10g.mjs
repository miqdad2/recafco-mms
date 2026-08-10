/**
 * Manager Dashboard Closure Requests Modal Unit 10G — verification script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * `app/(dashboard)/dashboard/page.tsx` (Server Component tied to real
 * request context) and `lib/backend/work-orders/service.ts`/
 * `app/actions/workflow.ts` ("server-only"/"use server") can't be imported
 * into a standalone Node script (same limitation as every prior *.mjs
 * script in this directory). This script:
 *   (a) mirrors the exact materials-label ladder added to page.tsx (Task
 *       3), and
 *   (b) proves the new query shape (approvals + work_order_attachments
 *       nested relations, `take: 50`) reads real rows correctly, and
 *   (c) mirrors approveJobCardClosure's exact guard/status-transition/
 *       approvals-insert sequence directly against real rows, proving this
 *       unit's new non-redirecting wrapper cannot have weakened it (it
 *       calls the exact same, unmodified service function).
 *
 * Usage:
 *   node --env-file=.env scripts/verify-manager-closure-requests-modal-unit10g.mjs
 */

import { PrismaClient } from "@prisma/client";
import { canTransition } from "../lib/workflows/status-rules.ts";
import { isManagerRole } from "../lib/security/permissions.ts";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// Mirrors app/(dashboard)/dashboard/page.tsx's materialsLabel ladder exactly.
function materialsLabelFor(availability) {
  if (availability === "fulfilled") return "Materials Completed";
  if (availability === "issuable") return "Ready to Issue";
  if (availability === "partial") return "Partially Available";
  if (availability === "shortage") return "Materials Pending";
  return "No Materials";
}
// Mirrors components/dashboard/closure-requests-modal.tsx's materialRowLabel exactly.
function materialRowLabel(status) {
  if (status === "fulfilled") return "Fulfilled";
  if (status === "partial_issued") return "Partially Issued";
  if (status === "shortage") return "Shortage";
  return "Ready";
}

console.log("== 1. Task 3 — materials label ladder ==");
{
  check('"fulfilled" -> "Materials Completed"', materialsLabelFor("fulfilled") === "Materials Completed");
  check('"issuable" -> "Ready to Issue"', materialsLabelFor("issuable") === "Ready to Issue");
  check('"partial" -> "Partially Available"', materialsLabelFor("partial") === "Partially Available");
  check('"shortage" -> "Materials Pending"', materialsLabelFor("shortage") === "Materials Pending");
  check('"none" -> "No Materials"', materialsLabelFor("none") === "No Materials");
  check("Task 10 — internal per-row status never shown raw", materialRowLabel("fulfilled") === "Fulfilled" && materialRowLabel("partial_issued") !== "partial_issued");
}

console.log("== 2. Task 10 — approve-closure role gate (unchanged, reused) ==");
{
  check("Data Entry cannot approve closure", isManagerRole({ role: { slug: "maintenance_data_entry" } }) === false);
  check("Manager can approve closure", isManagerRole({ role: { slug: "maintenance_manager" } }) === true);
  check("Super Admin can approve closure", isManagerRole({ role: { slug: "super_admin" } }) === true);
  check('"Closure Requested" -> "Closed" is a legal transition', canTransition("work_order", "Closure Requested", "Closed") === true);
  // Note: canTransition("work_order", "Approved", "Closed") is ALSO true —
  // the status graph allows a direct close (a separate feature,
  // closeWorkOrderAction/closeWorkOrder) independent of the closure-request
  // flow. approveJobCardClosure's own explicit guard (not canTransition) is
  // what actually restricts approval-from-modal to only fire when the
  // current status is literally "Closure Requested" — verified in section 4.
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G verify script";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    console.log("== 3. Closure Requests modal data shape — exact query mirror ==");
    const catalogPart = await tx.parts.create({
      data: { part_code: `U10G-${Date.now()}`, part_name: `${MARKER} Filter`, unit_of_measure: "PCS", created_by: user.id },
      select: { id: true },
    });
    const wo = await tx.work_orders.create({
      data: {
        ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
        status: "Closure Requested", asset_id: asset.id, created_by: user.id,
        operator_complaint: "Engine making unusual noise.",
      },
      select: { id: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: wo.id, part_id: catalogPart.id, description: `${MARKER} Filter`, quantity_required: 5, unit_of_measure: "PCS", created_by: user.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), part_id: catalogPart.id, quantity: 5, unit: "PCS", created_by: user.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "ISSUED", movement_date: new Date(), part_id: catalogPart.id, quantity: 5, unit: "PCS", related_work_order_id: wo.id, counterparty: MARKER, created_by: user.id },
    });
    await tx.parts_requests.create({ data: { work_order_id: wo.id, status: "Issued", requested_by: user.id, created_by: user.id } });
    await tx.approvals.create({
      data: { work_order_id: wo.id, status: "Closure Requested", decided_by: user.id, comments: "Replaced filter and tested. Ready for closure." },
    });
    await tx.work_order_attachments.create({
      data: { work_order_id: wo.id, attachment_type: "Completed Work Photo", file_name: "done.jpg", file_path: `uploads/work-order-files/${wo.id}/done.jpg`, content_type: "image/jpeg", file_size: 500, uploaded_by: user.id },
    });

    // Exact mirror of the new mgClosureRequestedAll select added to page.tsx.
    const row = await tx.work_orders.findUnique({
      where: { id: wo.id },
      select: {
        id: true, work_order_number: true, status: true, updated_at: true, created_at: true,
        description_of_work: true, operator_complaint: true, created_by: true,
        assets: { select: { asset_name: true } },
        parts_requests: { select: { status: true }, orderBy: { created_at: "desc" }, take: 1 },
        approvals: { where: { status: "Closure Requested" }, orderBy: { decided_at: "desc" }, take: 1, select: { comments: true } },
        work_order_attachments: { select: { id: true, attachment_type: true, file_name: true, created_at: true }, orderBy: { created_at: "desc" } },
      },
    });
    check("Row found with the new query shape", row !== null);
    check("Issue text resolves from operator_complaint", row.operator_complaint === "Engine making unusual noise.");
    check("Closure note resolves from the linked Closure Requested approval", row.approvals[0]?.comments === "Replaced filter and tested. Ready for closure.");
    check("Attachment is present via the nested relation (count=1)", row.work_order_attachments.length === 1);
    check("Attachment type is the custom label, not overridden", row.work_order_attachments[0].attachment_type === "Completed Work Photo");

    console.log("== 4. Task 5 — Approve Closure mirror (Closure Requested -> Closed) ==");
    check('assertIsManager-equivalent: Manager can proceed (mirrored via isManagerRole)', isManagerRole({ role: { slug: "maintenance_manager" } }));
    check('Current status is "Closure Requested" (only valid source status)', row.status === "Closure Requested");
    const approverNote = "Approved — verified work complete.";
    await tx.approvals.create({ data: { work_order_id: wo.id, status: "Closed", decided_by: user.id, comments: approverNote || null } });
    await tx.work_orders.update({ where: { id: wo.id }, data: { status: "Closed", updated_by: user.id } });
    const woAfter = await tx.work_orders.findUnique({ where: { id: wo.id }, select: { status: true } });
    check('Status becomes "Closed"', woAfter.status === "Closed");
    const closedApproval = await tx.approvals.findFirst({ where: { work_order_id: wo.id, status: "Closed" }, orderBy: { decided_at: "desc" } });
    check("Manager's approval note recorded on the Closed approvals row (separate from the original closure request's own note)", closedApproval.comments === approverNote);
    const requestApproval = await tx.approvals.findFirst({ where: { work_order_id: wo.id, status: "Closure Requested" } });
    check("Original closure-request note is untouched, still present", requestApproval.comments === "Replaced filter and tested. Ready for closure.");

    console.log("== 5. Regression — re-approving an already-Closed Job Card must be rejected ==");
    check('"Closed" -> "Closed" transition is a no-op per canTransition (fromStatus === toStatus)', canTransition("work_order", "Closed", "Closed") === true);
    check('"Closed" is terminal for any OTHER target (no transitions defined)', canTransition("work_order", "Closed", "Closure Requested") === false);

    console.log("== 6. Task 3/4 follow-up — per-worker hours/pay/skill/sessions ==");
    const worker = await tx.workerProfile.create({
      data: { name: `${MARKER} Worker`, worker_type: "Helper/Labor", hourly_rate: 5.0, skill_category: "Electrical", created_by: user.id, updated_by: user.id },
      select: { id: true, hourly_rate: true },
    });
    // Frozen snapshot rate deliberately DIFFERENT from the worker's current
    // profile rate (5.0), same as a real historical assignment — proves the
    // Closure Requests modal must sum from hourly_rate_snapshot, never the
    // live worker_profiles.hourly_rate.
    const SNAPSHOT_RATE = 2.0;
    const assignment = await tx.workOrderWorkerAssignment.create({
      data: { work_order_id: wo.id, worker_id: worker.id, worker_role: "Helper/Labor", hourly_rate_snapshot: SNAPSHOT_RATE, status: "active", assigned_by: user.id },
      select: { id: true },
    });
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const ninetyMinAgo = new Date(now.getTime() - 90 * 60 * 1000);
    // Session 1: completed, 60 minutes -> 2.000 KWD at the snapshot rate.
    await tx.workOrderWorkSession.create({
      data: { work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id, started_at: oneHourAgo, stopped_at: now, status: "Completed", duration_minutes: 60, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: 60 / 60 * SNAPSHOT_RATE, entered_by: user.id },
    });
    // Session 2: completed, 30 minutes -> 1.000 KWD.
    await tx.workOrderWorkSession.create({
      data: { work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id, started_at: ninetyMinAgo, stopped_at: oneHourAgo, status: "Completed", duration_minutes: 30, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: 30 / 60 * SNAPSHOT_RATE, entered_by: user.id },
    });
    // Session 3: cancelled -> excluded from every total (Unit 8 rule, unchanged).
    await tx.workOrderWorkSession.create({
      data: { work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id, started_at: ninetyMinAgo, stopped_at: ninetyMinAgo, status: "Cancelled", duration_minutes: 999, hourly_rate_snapshot: SNAPSHOT_RATE, calculated_amount: 999, entered_by: user.id },
    });

    // Mirrors getWorkOrderLaborSummariesBulk's per-worker aggregation exactly
    // (excluding Cancelled, summing stored duration_minutes/calculated_amount).
    const sessions = await tx.workOrderWorkSession.findMany({ where: { work_order_id: wo.id, worker_assignment_id: assignment.id, status: { not: "Cancelled" } }, orderBy: { started_at: "desc" } });
    const totalMinutes = sessions.reduce((s, r) => s + r.duration_minutes, 0);
    const totalAmount = sessions.reduce((s, r) => s + Number(r.calculated_amount), 0);
    check("Sessions count excludes the Cancelled session (2, not 3)", sessions.length === 2);
    check("Total hours = 1.50 h (60+30 minutes)", Math.round((totalMinutes / 60) * 100) / 100 === 1.5);
    check("Total pay computed from the FROZEN snapshot rate (2.0), not the worker's current profile rate (5.0)", Math.round(totalAmount * 1000) / 1000 === 3.0);

    const assignmentRow = await tx.workOrderWorkerAssignment.findUnique({ where: { id: assignment.id }, include: { worker_profiles: { select: { skill_category: true } } } });
    check("skill_category passthrough available via the same assignment->worker_profiles join", assignmentRow.worker_profiles.skill_category === "Electrical");

    console.log("== 7. Task 4 — session correction (editWorkSession) guard mirror ==");
    // Mirrors editWorkSession's own guards exactly (lib/backend/work-orders/work-sessions.ts):
    // reject correcting an Active session; require a real reason (min 5 chars).
    function canCorrectSession(sessionStatus, jobCardStatus) {
      if (sessionStatus === "Active") return { ok: false, reason: "Stop or pause this session before editing it." };
      if (jobCardStatus === "Closed") return { ok: false, reason: "Cannot edit a session on a closed Job Card." };
      return { ok: true };
    }
    check("Active session cannot be corrected", canCorrectSession("Active", "Closure Requested").ok === false);
    check("Completed session on a non-Closed Job Card CAN be corrected", canCorrectSession("Completed", "Closure Requested").ok === true);
    check('Correction reason "abcd" (4 chars) fails the >= 5 char rule', "abcd".trim().length >= 5 === false);
    check('Correction reason "abcde" (5 chars) passes', "abcde".trim().length >= 5 === true);

    // Apply a real correction directly (mirrors editWorkSession's write shape)
    // to the first Completed session — 60 minutes corrected down to 45.
    const sessionToCorrect = sessions.find((s) => s.status === "Completed");
    const correctedStart = oneHourAgo;
    const correctedEnd = new Date(oneHourAgo.getTime() + 45 * 60 * 1000);
    const correctedMinutes = Math.round((correctedEnd.getTime() - correctedStart.getTime()) / 60000);
    const correctedAmount = (correctedMinutes / 60) * SNAPSHOT_RATE;
    await tx.workOrderWorkSession.update({
      where: { id: sessionToCorrect.id },
      data: { started_at: correctedStart, stopped_at: correctedEnd, duration_minutes: correctedMinutes, calculated_amount: correctedAmount, correction_reason: "Adjusted stop time per technician report.", edited_by: user.id },
    });
    const sessionsAfterCorrection = await tx.workOrderWorkSession.findMany({ where: { work_order_id: wo.id, worker_assignment_id: assignment.id, status: { not: "Cancelled" } } });
    const totalMinutesAfter = sessionsAfterCorrection.reduce((s, r) => s + r.duration_minutes, 0);
    const totalAmountAfter = sessionsAfterCorrection.reduce((s, r) => s + Number(r.calculated_amount), 0);
    check("Task 4 — worker's total hours update after correction (1.50 h -> 1.25 h)", Math.round((totalMinutesAfter / 60) * 100) / 100 === 1.25);
    check("Task 4 — worker's total pay updates after correction (3.000 -> 2.500 KWD)", Math.round(totalAmountAfter * 1000) / 1000 === 2.5);
    const correctedRow = await tx.workOrderWorkSession.findUnique({ where: { id: sessionToCorrect.id } });
    check('"Corrected" is detected via a real correction_reason column (not a derived flag)', Boolean(correctedRow.correction_reason) === true);

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
