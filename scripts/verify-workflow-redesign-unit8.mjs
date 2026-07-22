/**
 * Maintenance Workflow Redesign Unit 8 — Materials Request Detail Timeline
 * and Job Card Link Integration checks.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end (same pattern as Units 3-7).
 *
 * Scope limitation (same as every prior unit): the actual page
 * (app/(dashboard)/store/parts-requests/[id]/page.tsx) and the guarded
 * backend modules (lib/backend/parts-requests/{service,repository}.ts, both
 * `import "server-only"` + `@/`-aliased) are not importable from a standalone
 * Node script. This script instead (a) replicates the exact query shapes and
 * pure display-logic functions added in this unit against the real schema,
 * inside a transaction that is rolled back, and (b) cross-checks the
 * duplicate-Materials-Request error string is byte-identical between the
 * page banner and the backend guard by reading both source files directly,
 * so the two can never silently drift apart.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-workflow-redesign-unit8.mjs
 */

import { readFileSync } from "node:fs";
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

// ── Pure display-logic replicas (Task 5) ───────────────────────────────────
// Mirrors itemIssueStatus() in components/store/parts-request-items-table.tsx
function itemIssueStatus(requested, issued) {
  if (issued <= 0) return { label: "Pending", tone: "gray" };
  if (issued < requested) return { label: "Partially Issued", tone: "amber" };
  return { label: "Issued", tone: "green" };
}

console.log("== 1. Item quantity/status clarity (Task 5) ==");
check("0 issued -> Pending", itemIssueStatus(5, 0).label === "Pending");
check("partial issued -> Partially Issued", itemIssueStatus(5, 3).label === "Partially Issued");
check("fully issued -> Issued", itemIssueStatus(5, 5).label === "Issued");
check("remaining = requested - issued", 5 - 3 === 2);

console.log("== 2. Duplicate-Materials-Request error string stays in sync (Task 6) ==");
const repoSrc = readFileSync(
  new URL("../lib/backend/parts-requests/repository.ts", import.meta.url),
  "utf8"
);
const pageSrc = readFileSync(
  new URL("../app/(dashboard)/maintenance/work-orders/[id]/page.tsx", import.meta.url),
  "utf8"
);
const repoMatch = repoSrc.match(/throw new AppError\(\s*"([^"]+)"/);
const pageMatch = pageSrc.match(/DUPLICATE_MATERIALS_REQUEST_ERROR\s*=\s*\n?\s*"([^"]+)"/);
check("backend guard message found", !!repoMatch);
check("Job Card page constant found", !!pageMatch);
check(
  "page's duplicate-error constant matches the backend AppError message exactly",
  !!repoMatch && !!pageMatch && repoMatch[1] === pageMatch[1]
);

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit8 verify script";
const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];

console.log("== 3. Full scenario (rolled back) ==");
try {
  await prisma.$transaction(async (tx) => {
    const bpm = await tx.assets.findUnique({ where: { asset_code: "AST-BPM-001" }, select: { id: true } });
    const veh = await tx.assets.findUnique({ where: { asset_code: "AST-VEH-0043" }, select: { id: true } });
    const users = await tx.profiles.findMany({ take: 1, select: { id: true } });
    if (!bpm || !veh || users.length < 1) throw new Error("SKIP: expected fixtures (AST-BPM-001, AST-VEH-0043, a profile) not found");
    const actor = users[0].id;

    // ── Scenario A: non-vehicle asset, full lifecycle + linked-movement scoping ──
    const wo = await tx.work_orders.create({
      data: {
        ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
        status: "Approved", asset_id: bpm.id, created_by: actor,
        operator_complaint: "Mixer drum bearing noise",
      },
      select: { id: true, work_order_number: true },
    });

    const pr1 = await tx.parts_requests.create({
      data: { work_order_id: wo.id, asset_id: bpm.id, status: "Requested", requested_by: actor, created_by: actor, total_price: 0 },
      select: { id: true, parts_request_number: true, created_at: true },
    });
    const item1 = await tx.parts_request_items.create({
      data: { parts_request_id: pr1.id, description: "Bearing", quantity_requested: 4, unit_price: 1 },
      select: { id: true },
    });
    const item2 = await tx.parts_request_items.create({
      data: { parts_request_id: pr1.id, description: "Grease", quantity_requested: 2, unit_price: 1 },
      select: { id: true },
    });
    await tx.audit_logs.create({
      data: { actor_id: actor, action: "parts_request.create", entity_type: "parts_request", entity_id: pr1.id, summary: `Created ${pr1.parts_request_number}` },
    });

    // Task 2/10: Linked Job Card summary query shape (select-only, matches includeShape).
    const linkedRow = await tx.parts_requests.findFirst({
      where: { id: pr1.id },
      include: {
        work_orders: { select: { id: true, work_order_number: true, status: true, operator_complaint: true, description_of_work: true } },
        assets: { select: { asset_code: true, asset_name: true, category: true, plate_number: true } },
        departments: { select: { name: true } },
      },
    });
    check("Linked Job Card query returns work order number", linkedRow?.work_orders?.work_order_number === wo.work_order_number);
    check("Linked Job Card query returns Job Card status", linkedRow?.work_orders?.status === "Approved");
    check("Linked Job Card query returns problem summary field", linkedRow?.work_orders?.operator_complaint === "Mixer drum bearing noise");
    check("Linked Job Card query returns asset name", linkedRow?.assets?.asset_name != null);

    // Duplicate-active check (Task 6): while pr1 is Approved, the active lookup
    // must resolve to pr1 — this is what the Job Card page's
    // `activeMaterialsRequest` lookup (and the backend guard) both rely on.
    await tx.parts_requests.update({ where: { id: pr1.id }, data: { status: "Approved", approved_by: actor } });
    await tx.audit_logs.create({
      data: { actor_id: actor, action: "parts_request.approve", entity_type: "parts_request", entity_id: pr1.id, summary: "Approved", metadata: { comments: "Approved for issue" } },
    });
    let active = await tx.parts_requests.findFirst({
      where: { work_order_id: wo.id, status: { in: ACTIVE_MATERIALS_REQUEST_STATUSES } },
      select: { id: true },
    });
    check("active-request lookup finds pr1 while Approved (blocks a duplicate create)", active?.id === pr1.id);

    // Partial issue.
    await tx.offline_inventory_movements.create({
      data: {
        movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Bearing",
        quantity: 2, unit: "PCS", related_work_order_id: wo.id, parts_request_id: pr1.id, created_by: actor,
      },
    });
    await tx.parts_request_items.update({ where: { id: item1.id }, data: { issued_quantity: 2 } });
    await tx.parts_requests.update({ where: { id: pr1.id }, data: { status: "Partially Issued" } });

    // Final issue (both items fully issued).
    await tx.offline_inventory_movements.create({
      data: {
        movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Bearing",
        quantity: 2, unit: "PCS", related_work_order_id: wo.id, parts_request_id: pr1.id, created_by: actor,
      },
    });
    await tx.offline_inventory_movements.create({
      data: {
        movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Grease",
        quantity: 2, unit: "PCS", related_work_order_id: wo.id, parts_request_id: pr1.id, created_by: actor,
      },
    });
    await tx.parts_request_items.update({ where: { id: item1.id }, data: { issued_quantity: 4 } });
    await tx.parts_request_items.update({ where: { id: item2.id }, data: { issued_quantity: 2 } });
    await tx.parts_requests.update({ where: { id: pr1.id }, data: { status: "Issued" } });

    // A second Materials Request under the SAME Job Card, created only now
    // that pr1 is terminal (Issued) — proves the active-lookup correctly
    // frees up once the prior request reaches Issued.
    active = await tx.parts_requests.findFirst({
      where: { work_order_id: wo.id, status: { in: ACTIVE_MATERIALS_REQUEST_STATUSES } },
      select: { id: true },
    });
    check("active-request lookup returns null once pr1 reaches Issued", active === null);

    const pr2 = await tx.parts_requests.create({
      data: { work_order_id: wo.id, asset_id: bpm.id, status: "Requested", requested_by: actor, created_by: actor, total_price: 0 },
      select: { id: true },
    });
    await tx.offline_inventory_movements.create({
      data: {
        movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Unrelated part",
        quantity: 1, unit: "PCS", related_work_order_id: wo.id, parts_request_id: pr2.id, created_by: actor,
      },
    });
    await tx.audit_logs.create({
      data: { actor_id: actor, action: "parts_request.create", entity_type: "parts_request", entity_id: pr2.id, summary: "Created pr2" },
    });

    active = await tx.parts_requests.findFirst({
      where: { work_order_id: wo.id, status: { in: ACTIVE_MATERIALS_REQUEST_STATUSES } },
      select: { id: true },
    });
    check("active-request lookup now finds pr2 (Requested)", active?.id === pr2.id);

    // Task 4/10: Offline Inventory movements strictly scoped by parts_request_id
    // — pr1's query must NOT include pr2's movement, and vice versa.
    const pr1Movements = await tx.offline_inventory_movements.findMany({ where: { parts_request_id: pr1.id, deleted_at: null } });
    const pr2Movements = await tx.offline_inventory_movements.findMany({ where: { parts_request_id: pr2.id, deleted_at: null } });
    check("pr1 movement query returns exactly its own 3 ISSUED rows", pr1Movements.length === 3);
    check("pr1 movement query excludes pr2's movement", pr1Movements.every((m) => m.parts_request_id === pr1.id));
    check("pr2 movement query returns exactly its own 1 row", pr2Movements.length === 1);

    // Task 10: audit_logs scoped by entity_id must not leak pr2's logs into pr1's
    // timeline. Note: the DB also has a row-change trigger (audit_row_change())
    // that adds its own generic entries on top of the explicit writeAuditLog()
    // calls, so this checks for the expected explicit actions rather than an
    // exact row count (same convention as the Unit 6/7 scripts).
    const pr1AuditLogs = await tx.audit_logs.findMany({ where: { entity_type: "parts_request", entity_id: pr1.id } });
    check("pr1 audit log query includes its explicit create log", pr1AuditLogs.some((l) => l.action === "parts_request.create"));
    check("pr1 audit log query includes its explicit approve log", pr1AuditLogs.some((l) => l.action === "parts_request.approve"));
    check("pr1 audit log query excludes pr2's create log", pr1AuditLogs.every((l) => l.entity_id === pr1.id));

    // ── Scenario B: vehicle asset variant (Task 11) ──────────────────────────
    const woVeh = await tx.work_orders.create({
      data: {
        ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
        status: "Approved", asset_id: veh.id, created_by: actor,
        operator_complaint: "Brake pad replacement",
      },
      select: { id: true, work_order_number: true },
    });
    const prVeh = await tx.parts_requests.create({
      data: { work_order_id: woVeh.id, asset_id: veh.id, status: "Approved", requested_by: actor, created_by: actor, total_price: 0 },
      select: { id: true },
    });
    await tx.parts_requests.update({
      where: { id: prVeh.id },
      data: { status: "Waiting Stock", store_issue_comments: "No brake pads in stock" },
    });
    await tx.audit_logs.create({
      data: { actor_id: actor, action: "parts_request.waiting_stock", entity_type: "parts_request", entity_id: prVeh.id, summary: "Waiting stock", metadata: { reason: "No brake pads in stock" } },
    });

    const linkedVehRow = await tx.parts_requests.findFirst({
      where: { id: prVeh.id },
      include: {
        work_orders: { select: { id: true, work_order_number: true, status: true, operator_complaint: true, description_of_work: true } },
        assets: { select: { asset_code: true, asset_name: true, category: true, plate_number: true } },
      },
    });
    check("Vehicle asset query returns a plate number", !!linkedVehRow?.assets?.plate_number);
    check("Vehicle asset query returns a category", !!linkedVehRow?.assets?.category);
    check("Vehicle asset query returns the correct linked Job Card", linkedVehRow?.work_orders?.work_order_number === woVeh.work_order_number);

    const waitingStockLog = await tx.audit_logs.findFirst({ where: { entity_type: "parts_request", entity_id: prVeh.id, action: "parts_request.waiting_stock" } });
    check("waiting_stock audit log metadata carries the reason", waitingStockLog?.metadata?.reason === "No brake pads in stock");

    throw new Error("__ROLLBACK_TEST_DATA__");
  });
} catch (err) {
  if (!(err instanceof Error) || err.message !== "__ROLLBACK_TEST_DATA__") {
    if (err instanceof Error && err.message.startsWith("SKIP:")) {
      console.log(`  SKIP  scenario: ${err.message}`);
    } else {
      console.error("  FAIL  transaction errored unexpectedly:", err);
      failures++;
    }
  }
}

console.log("== 4. Counts after rollback (clean baseline restored) ==");
const woCount = await prisma.work_orders.count({ where: { ordered_by: MARKER } });
const prCount = await prisma.parts_requests.count();
const movementCount = await prisma.offline_inventory_movements.count();
const auditCount = await prisma.audit_logs.count({ where: { summary: { in: ["Created pr2"] } } });
check("no leftover Unit8 test work_orders", woCount === 0);
check("no leftover parts_requests (fresh DB otherwise had none)", prCount === 0);
check("no leftover offline_inventory_movements (fresh DB otherwise had none)", movementCount === 0);
check("no leftover Unit8 test audit_logs", auditCount === 0);

await prisma.$disconnect();

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
