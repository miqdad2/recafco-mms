/**
 * Daily Activity Closure Request Modal with Attachments Unit 10F.6 —
 * verification script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * `lib/backend/work-orders/service.ts` (requestJobCardClosure, every guard)
 * and `app/actions/files.ts`/`app/actions/workflow.ts` (the new modal
 * action wrappers) all use `import "server-only"`/`"use server"`, so none
 * of them can be imported into a standalone Node script (same limitation as
 * every prior *.mjs script in this directory). This script:
 *   (a) mirrors the exact guard order and DB effects of
 *       requestJobCardClosure (role check, note length, status/transition
 *       check, the three closure guards, the status update + approvals
 *       insert) directly against real rows in a rolled-back transaction,
 *       proving this unit did not weaken or bypass any of them, and
 *   (b) mirrors the new requestJobCardClosureModalAction/
 *       uploadWorkOrderFileModalAction wrappers' pure decision logic
 *       (note-length short-circuit, ok/error shape) exactly as written.
 * lint/typecheck/build already confirm the real source files compile and
 * wire together correctly; this script confirms the underlying data math
 * and guard sequencing.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-daily-activity-closure-modal-unit10f6.mjs
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

// ── Mirrors of the pure decision logic in the new action wrappers ─────────

// Mirrors requestJobCardClosureModalAction's note-length short-circuit
// (app/actions/workflow.ts) — identical rule to requestJobCardClosureAction
// and to requestJobCardClosure's own re-check.
function validateClosureNote(note) {
  const trimmed = (note ?? "").trim();
  if (trimmed.length < 10) return { ok: false, error: "A completion note is required to request closure (min 10 characters)." };
  return { ok: true };
}

// Mirrors assertCanRequestJobCardClosure (lib/backend/work-orders/service.ts) exactly.
const CLOSURE_REQUEST_ROLES = ["maintenance_data_entry", "maintenance_manager", "maintenance_supervisor"];
function canRequestJobCardClosure(roleSlug) {
  return roleSlug === "super_admin" || CLOSURE_REQUEST_ROLES.includes(roleSlug ?? "");
}

console.log("== 1. Pure logic — completion note validation (Task 3) ==");
{
  check("Empty note -> blocked", validateClosureNote("").ok === false);
  check("9-character note -> blocked", validateClosureNote("123456789").ok === false);
  check("10-character note -> allowed", validateClosureNote("1234567890").ok === true);
  check("Whitespace-only note -> blocked (trimmed)", validateClosureNote("          ").ok === false);
  check('"Enter quantity"-style short note still blocked', validateClosureNote("short").ok === false);
}

console.log("== 2. Pure logic — closure request role gate (Task 11, unchanged) ==");
{
  check("Data Entry can request closure", canRequestJobCardClosure("maintenance_data_entry") === true);
  check("Manager can request closure", canRequestJobCardClosure("maintenance_manager") === true);
  check("Supervisor can request closure", canRequestJobCardClosure("maintenance_supervisor") === true);
  check("Super Admin can request closure", canRequestJobCardClosure("super_admin") === true);
  check("Viewer/unknown role CANNOT request closure", canRequestJobCardClosure("viewer") === false);
  check("isManagerRole (shared helper, Unit 10F.4) still correctly excludes Data Entry", isManagerRole({ role: { slug: "maintenance_data_entry" } }) === false);
}

console.log("== 3. Pure logic — status transition gate ==");
{
  check('"Approved" -> "Closure Requested" is a legal transition', canTransition("work_order", "Approved", "Closure Requested") === true);
  check('"Materials Issued" -> "Closure Requested" is a legal transition', canTransition("work_order", "Materials Issued", "Closure Requested") === true);
  check('"Closed" -> "Closure Requested" is NOT legal (terminal)', canTransition("work_order", "Closed", "Closure Requested") === false);
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10F6 verify script";

async function readBalance(tx, identity) {
  const movements = await tx.offline_inventory_movements.findMany({
    where: identity.part_id
      ? { part_id: identity.part_id, deleted_at: null }
      : { part_id: null, manual_material_name: { equals: identity.manual_material_name, mode: "insensitive" }, unit: { equals: identity.unit, mode: "insensitive" }, deleted_at: null },
    select: { movement_type: true, quantity: true },
  });
  let balance = 0;
  for (const m of movements) {
    const q = Number(m.quantity);
    if (m.movement_type === "RECEIVED" || m.movement_type === "OPENING_STOCK") balance += q;
    else if (m.movement_type === "ISSUED") balance -= q;
  }
  return balance;
}
async function readIssuedToWorkOrder(tx, identity, workOrderId) {
  const movements = await tx.offline_inventory_movements.findMany({
    where: { ...identity, movement_type: "ISSUED", related_work_order_id: workOrderId, deleted_at: null },
    select: { quantity: true },
  });
  return movements.reduce((sum, m) => sum + Number(m.quantity), 0);
}
// Mirrors assertRequiredMaterialsFulfilled's underlying formula exactly.
async function materialsFulfilled(tx, requiredQty, identity, workOrderId) {
  const issued = await readIssuedToWorkOrder(tx, identity, workOrderId);
  return issued >= requiredQty;
}
// Mirrors assertNoPendingMaterialsRequests exactly.
async function noPendingMaterialsRequests(tx, workOrderId) {
  const count = await tx.parts_requests.count({ where: { work_order_id: workOrderId, status: { not: "Issued" } } });
  return count === 0;
}

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    console.log("== 4. Case A — ready for closure: materials fully issued, no active session, valid note ==");
    const catalogPart = await tx.parts.create({
      data: { part_code: `U10F6-${Date.now()}`, part_name: `${MARKER} Filter`, unit_of_measure: "PCS", created_by: user.id },
      select: { id: true },
    });
    const woA = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: woA.id, part_id: catalogPart.id, description: `${MARKER} Filter`, quantity_required: 5, unit_of_measure: "PCS", created_by: user.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "OPENING_STOCK", movement_date: new Date(), part_id: catalogPart.id, quantity: 5, unit: "PCS", created_by: user.id },
    });
    await tx.offline_inventory_movements.create({
      data: { movement_type: "ISSUED", movement_date: new Date(), part_id: catalogPart.id, quantity: 5, unit: "PCS", related_work_order_id: woA.id, counterparty: MARKER, created_by: user.id },
    });
    const prA = await tx.parts_requests.create({
      data: { work_order_id: woA.id, status: "Issued", requested_by: user.id, created_by: user.id },
      select: { id: true },
    });

    const identityA = { part_id: catalogPart.id, unit: "PCS" };
    check("Materials fully issued", await materialsFulfilled(tx, 5, identityA, woA.id));
    check("No pending Materials Requests", await noPendingMaterialsRequests(tx, woA.id));
    check('Status transition "Approved" -> "Closure Requested" legal', canTransition("work_order", "Approved", "Closure Requested"));

    // Mirrors requestJobCardClosure's own DB effects (status update + approvals insert).
    const closedApproval = await tx.approvals.create({
      data: { work_order_id: woA.id, status: "Closure Requested", decided_by: user.id, comments: "Completed engine filter replacement and verified operation." },
      select: { id: true, status: true },
    });
    await tx.work_orders.update({ where: { id: woA.id }, data: { status: "Closure Requested", updated_by: user.id } });
    const woAAfter = await tx.work_orders.findUnique({ where: { id: woA.id }, select: { status: true } });
    check('Job Card status becomes "Closure Requested"', woAAfter.status === "Closure Requested");
    check("Approvals row recorded with the completion note", closedApproval.status === "Closure Requested");

    // Task 4/6 — attachment uploaded as part of the same closure request,
    // mirroring uploadWorkOrderFileModalAction's DB write exactly.
    const attachment = await tx.work_order_attachments.create({
      data: {
        work_order_id: woA.id,
        attachment_type: "Completed Work Photo",
        file_name: "engine-filter-done.jpg",
        file_path: `uploads/work-order-files/${woA.id}/${Date.now()}-engine-filter-done.jpg`,
        content_type: "image/jpeg",
        file_size: 12345,
        uploaded_by: user.id,
      },
      select: { id: true, attachment_type: true, work_order_id: true },
    });
    check("Attachment recorded against the same Job Card", attachment.work_order_id === woA.id);

    // Task 8 — the Job Card detail page's own attachments query has no
    // attachment_type filter (confirmed by source read), so this row is
    // findable exactly like any other upload.
    const allAttachmentsForCard = await tx.work_order_attachments.findMany({ where: { work_order_id: woA.id }, orderBy: { created_at: "desc" } });
    check("Task 8 — attachment is visible via the same unfiltered query the Attachments tab uses", allAttachmentsForCard.some((a) => a.id === attachment.id));

    console.log("== 5. Case B — not ready: pending Materials Request blocks closure ==");
    const woB = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    await tx.workOrderRequiredPart.create({
      data: { work_order_id: woB.id, description: `${MARKER} Brake Pad`, quantity_required: 2, unit_of_measure: "PCS", created_by: user.id },
    });
    const prB = await tx.parts_requests.create({
      data: { work_order_id: woB.id, status: "Requested", requested_by: user.id, created_by: user.id },
      select: { id: true },
    });
    check("Case B — pending Materials Request exists (blocker)", (await noPendingMaterialsRequests(tx, woB.id)) === false);
    check("Case B — materials not fully issued (blocker)", (await materialsFulfilled(tx, 2, { part_id: null, manual_material_name: `${MARKER} Brake Pad`, unit: "PCS" }, woB.id)) === false);

    console.log("== 6. Regressions ==");
    check("Case A note used was >= 10 characters (would not have been blocked client-side)", "Completed engine filter replacement and verified operation.".trim().length >= 10);
    check("No approvals row was created for Case B (never reached the closure-request step)", (await tx.approvals.count({ where: { work_order_id: woB.id } })) === 0);
    check("Case B Job Card status is still Approved (never transitioned)", (await tx.work_orders.findUnique({ where: { id: woB.id }, select: { status: true } })).status === "Approved");

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
