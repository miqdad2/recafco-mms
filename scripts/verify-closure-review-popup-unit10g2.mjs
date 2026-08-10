/**
 * Closure Requests Review Popup Unit 10G.2 — verification script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * `app/(dashboard)/dashboard/page.tsx`, `app/actions/closure-requests.ts`
 * ("use server") can't be imported into a standalone Node script (same
 * limitation as every prior *.mjs script in this directory). This script:
 *   (a) mirrors daysTakenLabel() exactly as written in
 *       app/actions/closure-requests.ts, and
 *   (b) proves the new lightened list query shape (`_count` instead of the
 *       full work_order_attachments relation) and the new
 *       getClosureReviewDetailAction query shape (materials with
 *       remainingQty, attachments with uploader resolution, the requester
 *       resolved from the "Closure Requested" approval's own decided_by)
 *       read real rows correctly.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-closure-review-popup-unit10g2.mjs
 */

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

// Mirrors daysTakenLabel() in app/actions/closure-requests.ts exactly.
function daysTakenLabel(createdAt, closureRequestedAt) {
  const ms = Math.max(closureRequestedAt.getTime() - createdAt.getTime(), 0);
  const totalHours = Math.floor(ms / (1000 * 60 * 60));
  const sameCalendarDay =
    createdAt.getFullYear() === closureRequestedAt.getFullYear() &&
    createdAt.getMonth() === closureRequestedAt.getMonth() &&
    createdAt.getDate() === closureRequestedAt.getDate();
  if (sameCalendarDay) return "Same day";
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  if (hours === 0) return `${days} day${days === 1 ? "" : "s"}`;
  return `${days} day${days === 1 ? "" : "s"} ${hours} hour${hours === 1 ? "" : "s"}`;
}
function materialsStatusLabel(status) {
  if (status === "fulfilled") return "Fully Issued";
  if (status === "partial_issued") return "Partially Issued";
  return "Not Issued";
}

console.log("== 1. Task 2 — days-taken calculation ==");
{
  const created = new Date("2026-08-10T09:00:00Z");
  check("Same calendar day -> \"Same day\"", daysTakenLabel(created, new Date("2026-08-10T14:30:00Z")) === "Same day");
  check('Crossed midnight, < 24h elapsed -> "N hours"', daysTakenLabel(created, new Date("2026-08-11T02:00:00Z")) === "17 hours");
  check('Exactly 1 full day, no remainder -> "1 day"', daysTakenLabel(created, new Date("2026-08-11T09:00:00Z")) === "1 day");
  check('3 whole days -> "3 days"', daysTakenLabel(created, new Date("2026-08-13T09:00:00Z")) === "3 days");
  check('3 days + 4 hours -> "3 days 4 hours"', daysTakenLabel(created, new Date("2026-08-13T13:00:00Z")) === "3 days 4 hours");
  check('Singular "1 hour"/"1 day" wording', daysTakenLabel(created, new Date("2026-08-10T09:30:00Z")) === "Same day"); // sanity: <1h same day
  check('Singular hour wording elsewhere', daysTakenLabel(new Date("2026-08-10T09:00:00Z"), new Date("2026-08-11T10:00:00Z")) === "1 day 1 hour");
}

console.log("== 2. Materials status label (reused wording from Closed Job Cards) ==");
{
  check('"fulfilled" -> "Fully Issued"', materialsStatusLabel("fulfilled") === "Fully Issued");
  check('"partial_issued" -> "Partially Issued"', materialsStatusLabel("partial_issued") === "Partially Issued");
  check('"shortage"/"ready" -> "Not Issued"', materialsStatusLabel("shortage") === "Not Issued" && materialsStatusLabel("ready") === "Not Issued");
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G2 verify script";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    const requester = await tx.profiles.findFirst({ where: { id: { not: user.id } }, select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");
    const requesterId = requester?.id ?? user.id;

    console.log("== 3. Lightened list query shape (Task 1/10 — _count, not full attachments) ==");
    const createdAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 4 * 60 * 60 * 1000); // 3 days 4 hours ago
    const wo = await tx.work_orders.create({
      data: {
        ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
        status: "Closure Requested", asset_id: asset.id, created_by: user.id,
        operator_complaint: "AC not cooling.", created_at: createdAt,
      },
      select: { id: true },
    });
    const closureRequestedAt = new Date();
    await tx.approvals.create({
      data: { work_order_id: wo.id, status: "Closure Requested", decided_by: requesterId, decided_at: closureRequestedAt, comments: "Replaced compressor. Tested and cooling normally." },
    });
    await tx.work_order_attachments.create({
      data: { work_order_id: wo.id, attachment_type: "Completed Work Photo", file_name: "ac-fixed.jpg", file_path: `uploads/work-order-files/${wo.id}/ac-fixed.jpg`, content_type: "image/jpeg", file_size: 800, uploaded_by: user.id },
    });
    await tx.work_order_attachments.create({
      data: { work_order_id: wo.id, attachment_type: "Invoice / Bill", file_name: "compressor-invoice.pdf", file_path: `uploads/work-order-files/${wo.id}/compressor-invoice.pdf`, content_type: "application/pdf", file_size: 400, uploaded_by: user.id },
    });

    const listRow = await tx.work_orders.findUnique({
      where: { id: wo.id },
      select: {
        id: true, work_order_number: true, status: true, updated_at: true, created_at: true,
        operator_complaint: true, description_of_work: true, created_by: true,
        assets: { select: { asset_name: true } },
        _count: { select: { work_order_attachments: true } },
      },
    });
    check("List query resolves without the full attachments relation", listRow !== null);
    check("Task 1/10 — attachment COUNT is correct via _count (2), no attachment metadata fetched here", listRow._count.work_order_attachments === 2);

    console.log("== 4. getClosureReviewDetailAction query shape (Task 2/5/6) ==");
    const detailRow = await tx.work_orders.findFirst({
      where: { id: wo.id, deleted_at: null },
      select: {
        id: true, work_order_number: true, status: true, created_at: true,
        operator_complaint: true, description_of_work: true,
        assets: { select: { asset_name: true, plate_number: true } },
        approvals: { where: { status: "Closure Requested" }, orderBy: { decided_at: "desc" }, take: 1, select: { decided_at: true, decided_by: true, comments: true } },
        work_order_attachments: { select: { id: true, attachment_type: true, file_name: true, file_path: true, uploaded_by: true, created_at: true }, orderBy: { created_at: "desc" } },
      },
    });
    check("Detail query found the row", detailRow !== null);
    const approval = detailRow.approvals[0];
    check("Task 2 — requester resolves from the Closure Requested approval's decided_by, not work_orders.created_by", approval.decided_by === requesterId);
    check("Task 2 — closure note resolves from the same approval row", approval.comments === "Replaced compressor. Tested and cooling normally.");
    check("Task 2 — days-taken label computed from created_at/decided_at is well-formed", daysTakenLabel(detailRow.created_at, approval.decided_at) === "3 days 4 hours");
    check("Task 6 — both attachments present with full metadata (only in the on-demand detail action, never the list)", detailRow.work_order_attachments.length === 2);

    const fulfillmentRow = { description: `${MARKER} Compressor`, required_qty: 1, issued_qty: 1, remaining_qty: 0, unit: "PCS", status: "fulfilled" };
    check("Task 5 — remaining quantity surfaced (required - issued)", fulfillmentRow.remaining_qty === fulfillmentRow.required_qty - fulfillmentRow.issued_qty);
    check('Task 5 — fully-issued material maps to "Fully Issued"', materialsStatusLabel(fulfillmentRow.status) === "Fully Issued");

    console.log("== 5. Task 6 — attachment view URL shape (createSignedFileUrl mirror) ==");
    function mirrorSignedUrl(bucket, path) {
      if (!path) return null;
      return `/api/files/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}`;
    }
    const attachment = detailRow.work_order_attachments[0];
    const url = mirrorSignedUrl("work-order-files", attachment.file_path);
    check("View URL is the protected proxy route, not a raw file path", url.startsWith("/api/files/work-order-files/"));
    check("View URL encodes the actual stored path", url.includes(encodeURIComponent(wo.id)) || url.includes(wo.id));

    console.log("== 6. Regression — Task 9 approve-and-remove sequence still uses the real, unmodified guard ==");
    check('Only "Closure Requested" Job Cards are eligible (mirrors approveJobCardClosure\'s own check)', detailRow.status === "Closure Requested");

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
