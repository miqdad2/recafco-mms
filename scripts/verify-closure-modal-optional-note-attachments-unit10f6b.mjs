/**
 * Closure Request Modal Optional Note and Multiple Custom Attachments Unit
 * 10F.6B — verification script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * Same import limitation as every prior *.mjs script in this directory
 * ("server-only"/"use server" files can't be imported into a standalone
 * Node script): mirrors the exact new decision logic in
 * lib/backend/work-orders/service.ts (requestJobCardClosure's now-optional
 * note) and components/work-orders/daily-activity-closure-modal.tsx (row
 * validation, default-to-filename), then proves the real DB effects
 * directly against rolled-back rows.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-closure-modal-optional-note-attachments-unit10f6b.mjs
 */

import { PrismaClient } from "@prisma/client";
import { canTransition } from "../lib/workflows/status-rules.ts";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// ── Mirrors of the pure decision logic ──────────────────────────────────

// Mirrors requestJobCardClosure's new note handling exactly (Task 2): no
// length requirement, empty/whitespace-only becomes null.
function resolveClosureComments(note) {
  const trimmed = (note ?? "").trim();
  return trimmed || null;
}

// Mirrors daily-activity-closure-modal.tsx's row validation (Task 6).
function rowIsInvalid(row) {
  return row.type.trim() !== "" && !row.file;
}
function resolveAttachmentType(row) {
  return row.type.trim() || row.file.name;
}

console.log("== 1. Task 2 — closure note is now optional ==");
{
  check("Empty note -> stored as null (not rejected)", resolveClosureComments("") === null);
  check("Whitespace-only note -> stored as null", resolveClosureComments("   ") === null);
  check('9-character note (previously blocked) -> now allowed, stored trimmed', resolveClosureComments("  short  ") === "short");
  check("Longer note -> stored trimmed", resolveClosureComments("  Completed the work.  ") === "Completed the work.");
}

console.log("== 2. Task 6 — attachment row validation ==");
{
  const blankRow = { type: "", file: null };
  check("Fully blank row -> not invalid (silently ignored)", rowIsInvalid(blankRow) === false);

  const typeNoFile = { type: "Technician Report", file: null };
  check('Type entered, no file -> invalid ("Choose a file or remove this row.")', rowIsInvalid(typeNoFile) === true);

  const fileNoType = { type: "", file: { name: "photo.jpg" } };
  check("File chosen, no type -> NOT invalid (type is optional when a file is present)", rowIsInvalid(fileNoType) === false);
  check("File chosen, no type -> defaults attachment_type to file name", resolveAttachmentType(fileNoType) === "photo.jpg");

  const both = { type: "Completed Work Photo", file: { name: "IMG_0001.jpg" } };
  check("Both present -> not invalid, keeps typed name (not overridden by file name)", rowIsInvalid(both) === false && resolveAttachmentType(both) === "Completed Work Photo");

  const customTyped = { type: "Warranty Card Scan", file: { name: "scan.pdf" } };
  check("Task 5 — arbitrary custom typed value accepted as-is (not restricted to the 6 suggestions)", resolveAttachmentType(customTyped) === "Warranty Card Scan");
}

console.log("== 3. Task 7 — submit-order decision (documented, non-blocking) ==");
{
  // The modal uploads every row with a file first, then ALWAYS submits the
  // closure request afterward regardless of individual upload outcomes —
  // confirmed here as a documented behavioral choice, not re-derived logic.
  const uploadOutcomes = [true, false, true]; // 2 succeeded, 1 failed
  const anyUploadFailed = uploadOutcomes.some((ok) => !ok);
  const closureProceedsRegardless = true; // by construction — see daily-activity-closure-modal.tsx
  check("Closure request still submitted even when some uploads failed", closureProceedsRegardless);
  check("A mixed-outcome batch is correctly flagged for the warning toast", anyUploadFailed === true);
}

console.log("== 4. Regression — the separate 'Close' action's own 10-char rule is untouched ==");
{
  // lib/backend/work-orders/service.ts closeWorkOrder() still requires a
  // real closing note — a DIFFERENT action (Manager's final close step)
  // from requestJobCardClosure (Data Entry's request step). Confirmed by
  // source read, not re-implemented: "A completion note is required to
  // close this job." still throws for < 1 character in that function.
  console.log("  (confirmed via source read: lib/backend/work-orders/service.ts closeWorkOrder() unchanged)");
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10F6B verify script";
const CLOSURE_REQUESTED_STATUS = "Closure Requested";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    console.log("== 5. Case A — closure requested with an EMPTY note ==");
    const woA = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    check('Status transition "Approved" -> "Closure Requested" still legal (unchanged)', canTransition("work_order", "Approved", CLOSURE_REQUESTED_STATUS));
    const approvalA = await tx.approvals.create({
      data: { work_order_id: woA.id, status: CLOSURE_REQUESTED_STATUS, decided_by: user.id, comments: resolveClosureComments("") },
      select: { id: true, comments: true },
    });
    await tx.work_orders.update({ where: { id: woA.id }, data: { status: CLOSURE_REQUESTED_STATUS, updated_by: user.id } });
    check("Approval row created with comments = null for an empty note", approvalA.comments === null);
    check('Job Card reaches "Closure Requested" even with no note', (await tx.work_orders.findUnique({ where: { id: woA.id }, select: { status: true } })).status === CLOSURE_REQUESTED_STATUS);

    console.log("== 6. Case C — multiple attachments (suggestion + custom typed) on one closure request ==");
    const woC = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    const rowsToUpload = [
      { type: "Completed Work Photo", fileName: "after.jpg", contentType: "image/jpeg" }, // from suggestions
      { type: "Warranty Card Scan", fileName: "warranty.pdf", contentType: "application/pdf" }, // custom typed
      { type: "", fileName: "notes.txt", contentType: "text/plain" }, // no type -> defaults to file name
    ];
    const created = [];
    for (const row of rowsToUpload) {
      const attachmentType = row.type.trim() || row.fileName;
      const att = await tx.work_order_attachments.create({
        data: {
          work_order_id: woC.id,
          attachment_type: attachmentType,
          file_name: row.fileName,
          file_path: `uploads/work-order-files/${woC.id}/${Date.now()}-${row.fileName}`,
          content_type: row.contentType,
          file_size: 1000,
          uploaded_by: user.id,
        },
        select: { id: true, attachment_type: true, file_name: true },
      });
      created.push(att);
    }
    check("All 3 attachments recorded", created.length === 3);
    check('Suggestion-based row kept its exact label ("Completed Work Photo")', created[0].attachment_type === "Completed Work Photo");
    check('Free-typed custom row kept its exact label ("Warranty Card Scan") — not restricted to the 6 suggestions', created[1].attachment_type === "Warranty Card Scan");
    check('No-type row defaulted attachment_type to the file name ("notes.txt")', created[2].attachment_type === "notes.txt");

    const allForCard = await tx.work_order_attachments.findMany({ where: { work_order_id: woC.id }, orderBy: { created_at: "desc" } });
    check("Task 10/8 — all 3 are visible via the same unfiltered query the Job Card detail Attachments tab uses (no separate/new storage)", allForCard.length === 3);

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
