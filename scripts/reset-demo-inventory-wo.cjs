/**
 * scripts/reset-demo-inventory-wo.cjs
 *
 * Resets WO REC/MD/MECH/JOB/0013 to the pre-Store-Keeper-demo state.
 *
 * Target state:
 *   work_orders.status                     = "Approved"
 *   work_order_assignments                 = 0 rows for this WO (dry-run row deleted)
 *   work_order_required_parts              = all 3 rows → unchecked, confirmed_by/at/notes cleared
 *   workflow_step_instances.inventory_check= pending (already pending — verified read-only, no change)
 *   inventory_check_enabled                = true (not touched)
 *   parts_requests / inventory_movements   = not touched (none exist)
 *   audit_logs                             = existing logs preserved; one new demo.work_order_reset entry added
 *   work_order_status_history              = existing rows preserved; one new Assigned→Approved row added
 *
 * Safety guards:
 *   - Hardcoded WO number; refuses to run on any other WO unless --work-order override is provided.
 *   - Every UPDATE/DELETE WHERE clause includes the resolved WO UUID.
 *   - Reads current state before writing; prints before/after comparison.
 *   - Uses a single Prisma $transaction so all-or-nothing.
 *   - Exits non-zero on any error.
 *
 * Usage:
 *   node scripts/reset-demo-inventory-wo.cjs
 *   node scripts/reset-demo-inventory-wo.cjs --work-order "REC/MD/MECH/JOB/0013"
 */
"use strict";

const { PrismaClient } = require("@prisma/client");

// ─── Safety: only run on this WO ───────────────────────────────────────────
const DEFAULT_TARGET_WO = "REC/MD/MECH/JOB/0013";
const args = process.argv.slice(2);
const overrideIdx = args.indexOf("--work-order");
const TARGET_WO_NUMBER =
  overrideIdx !== -1 && args[overrideIdx + 1]
    ? args[overrideIdx + 1]
    : DEFAULT_TARGET_WO;

if (TARGET_WO_NUMBER !== DEFAULT_TARGET_WO) {
  console.error(
    `\n❌ SAFETY GUARD: This script only targets "${DEFAULT_TARGET_WO}". ` +
    `Received: "${TARGET_WO_NUMBER}". Exiting.\n`
  );
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
  log: [],
});

async function main() {
  console.log("=".repeat(70));
  console.log(`DEMO RESET — ${TARGET_WO_NUMBER}`);
  console.log("=".repeat(70));

  // ── 1. Read current state ─────────────────────────────────────────────────
  const wo = await prisma.work_orders.findUnique({
    where: { work_order_number: TARGET_WO_NUMBER },
    select: {
      id: true,
      work_order_number: true,
      status: true,
      assigned_supervisor_id: true,
      created_by: true,
    },
  });

  if (!wo) {
    console.error(`\n❌ WO "${TARGET_WO_NUMBER}" NOT FOUND. Exiting.\n`);
    process.exit(1);
  }

  const WO_ID = wo.id;

  console.log("\n[BEFORE STATE]");
  console.log(`  WO id:      ${WO_ID}`);
  console.log(`  status:     ${wo.status}`);
  console.log(`  supervisor: ${wo.assigned_supervisor_id ?? "(null)"}`);

  const beforeParts = await prisma.workOrderRequiredPart.findMany({
    where: { work_order_id: WO_ID },
    orderBy: { created_at: "asc" },
    select: { id: true, description: true, availability_status: true, confirmed_by: true, confirmed_at: true, notes: true },
  });
  console.log(`  required parts (${beforeParts.length}):`);
  beforeParts.forEach((p) =>
    console.log(`    - ${p.description}: ${p.availability_status} | confirmed: ${p.confirmed_at ?? "null"} | notes: ${p.notes ?? "null"}`)
  );

  const beforeAssignments = await prisma.work_order_assignments.findMany({
    where: { work_order_id: WO_ID },
    select: { id: true, technician_id: true },
  });
  console.log(`  assignments (${beforeAssignments.length}):`);
  beforeAssignments.forEach((a) => console.log(`    - id: ${a.id} | technician: ${a.technician_id ?? "null"}`));

  const wfInst = await prisma.workflowInstance.findFirst({
    where: { entity_type: "work_order", entity_id: WO_ID },
    select: { id: true, current_step_id: true, status: true },
  });
  const icStep = wfInst
    ? await prisma.workflowStepInstance.findFirst({
        where: {
          workflow_inst_id: wfInst.id,
          workflow_step: { code: "inventory_check" },
        },
        select: { id: true, status: true },
      })
    : null;

  console.log(`  workflow instance: ${wfInst?.id ?? "(none)"} | status: ${wfInst?.status ?? "n/a"}`);
  console.log(`  inventory_check step instance status: ${icStep?.status ?? "(not found)"}`);

  // ── 2. Validate preconditions before writing ──────────────────────────────
  const blockers = [];

  if (wo.status === "Approved" && beforeAssignments.length === 0 && beforeParts.every((p) => p.availability_status === "unchecked")) {
    console.log("\n✅ WO is already in the target pre-demo state. No reset needed.");
    await prisma.$disconnect();
    return;
  }

  if (beforeParts.length === 0) {
    blockers.push("No required parts found — demo data may be missing.");
  }
  if (blockers.length > 0) {
    console.error("\n❌ PRECONDITION FAILURES:");
    blockers.forEach((b) => console.error(`  - ${b}`));
    process.exit(1);
  }

  // ── 3. Execute reset in a single transaction ──────────────────────────────
  console.log("\n[EXECUTING RESET — single transaction]");

  await prisma.$transaction(async (tx) => {
    // 3-A: Remove the technician assignment row(s) for this WO only.
    const deletedAssignments = await tx.work_order_assignments.deleteMany({
      where: { work_order_id: WO_ID },
    });
    console.log(`  ✓ Deleted ${deletedAssignments.count} assignment row(s)`);

    // 3-B: Reset work_orders.status to Approved.
    await tx.work_orders.update({
      where: { id: WO_ID },
      data: {
        status: "Approved",
        updated_at: new Date(),
      },
    });
    console.log(`  ✓ work_orders.status set to "Approved"`);

    // 3-C: Reset all required parts for this WO to unchecked.
    const updatedParts = await tx.workOrderRequiredPart.updateMany({
      where: { work_order_id: WO_ID },
      data: {
        availability_status: "unchecked",
        confirmed_by: null,
        confirmed_at: null,
        notes: null,
        updated_at: new Date(),
      },
    });
    console.log(`  ✓ Reset ${updatedParts.count} required part(s) to unchecked`);

    // 3-D: Add a status history row showing the reset transition.
    await tx.work_order_status_history.create({
      data: {
        work_order_id: WO_ID,
        from_status: "Assigned",
        to_status: "Approved",
        notes: "Demo reset — management demo preparation. Previous technician assignment removed; inventory check restarted.",
        changed_at: new Date(),
      },
    });
    console.log(`  ✓ Added status history row: Assigned → Approved (demo reset)`);

    // 3-E: Add audit log entry for the reset.
    await tx.audit_logs.create({
      data: {
        action: "demo.work_order_reset",
        entity_type: "work_order",
        entity_id: WO_ID,
        summary: `Demo reset: ${TARGET_WO_NUMBER} reverted to Approved for management demo.`,
        metadata: {
          work_order_number: TARGET_WO_NUMBER,
          previous_status: wo.status,
          reset_reason: "Management demo — inventory check workflow Phase 5-E",
          assignments_deleted: deletedAssignments.count,
          required_parts_reset: updatedParts.count,
        },
      },
    });
    console.log(`  ✓ Inserted audit log: demo.work_order_reset`);

    return {
      deletedAssignments: deletedAssignments.count,
      updatedParts: updatedParts.count,
    };
  });

  // ── 4. Read after-state for verification ─────────────────────────────────
  console.log("\n[AFTER STATE — verification]");

  const afterWO = await prisma.work_orders.findUnique({
    where: { id: WO_ID },
    select: { status: true, assigned_supervisor_id: true },
  });
  console.log(`  WO status:     ${afterWO?.status} (expected: Approved)`);
  console.log(`  WO supervisor: ${afterWO?.assigned_supervisor_id ?? "(null)"} (expected: preserved from demo setup)`);

  const afterParts = await prisma.workOrderRequiredPart.findMany({
    where: { work_order_id: WO_ID },
    orderBy: { created_at: "asc" },
    select: { description: true, availability_status: true, confirmed_by: true, confirmed_at: true, notes: true },
  });
  console.log(`  required parts (${afterParts.length}):`);
  afterParts.forEach((p) =>
    console.log(`    - ${p.description}: ${p.availability_status} | confirmed_by: ${p.confirmed_by ?? "null"} | notes: ${p.notes ?? "null"}`)
  );

  const afterAssignments = await prisma.work_order_assignments.count({
    where: { work_order_id: WO_ID },
  });
  console.log(`  assignments remaining: ${afterAssignments} (expected: 0)`);

  const afterHistory = await prisma.work_order_status_history.findMany({
    where: { work_order_id: WO_ID },
    orderBy: { changed_at: "asc" },
    select: { from_status: true, to_status: true, notes: true, changed_at: true },
  });
  console.log(`  status history (${afterHistory.length} rows):`);
  afterHistory.forEach((h, i) =>
    console.log(`    [${i + 1}] ${h.from_status ?? "null"} → ${h.to_status} | ${h.notes ?? "(no notes)"}`)
  );

  // Workflow step — re-check (should still be pending, we did not touch it)
  const afterIC = wfInst
    ? await prisma.workflowStepInstance.findFirst({
        where: {
          workflow_inst_id: wfInst.id,
          workflow_step: { code: "inventory_check" },
        },
        select: { status: true },
      })
    : null;
  console.log(`  inventory_check step status: ${afterIC?.status ?? "(not found)"} (expected: pending)`);

  const afterInventoryMovements = await prisma.inventory_movements.count({ where: { work_order_id: WO_ID } });
  console.log(`  inventory_movements for WO: ${afterInventoryMovements} (expected: 0)`);

  const afterPartsRequests = await prisma.parts_requests.count({ where: { work_order_id: WO_ID } });
  console.log(`  parts_requests for WO:      ${afterPartsRequests} (expected: 0)`);

  const settings = await prisma.app_settings.findUnique({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    select: { inventory_check_enabled: true },
  });
  console.log(`  inventory_check_enabled:    ${settings?.inventory_check_enabled} (expected: true)`);

  // ── 5. Final pass/fail summary ────────────────────────────────────────────
  console.log("\n" + "=".repeat(70));
  const checks = [
    { label: "WO status = Approved",             pass: afterWO?.status === "Approved" },
    { label: "Assignments = 0",                  pass: afterAssignments === 0 },
    { label: "All 3 parts = unchecked",          pass: afterParts.length === 3 && afterParts.every((p) => p.availability_status === "unchecked") },
    { label: "All parts confirmed_by = null",    pass: afterParts.every((p) => p.confirmed_by === null) },
    { label: "All parts confirmed_at = null",    pass: afterParts.every((p) => p.confirmed_at === null) },
    { label: "All parts notes = null",           pass: afterParts.every((p) => p.notes === null) },
    { label: "inventory_check step = pending",   pass: afterIC?.status === "pending" },
    { label: "inventory_movements = 0",          pass: afterInventoryMovements === 0 },
    { label: "parts_requests = 0",               pass: afterPartsRequests === 0 },
    { label: "inventory_check_enabled = true",   pass: settings?.inventory_check_enabled === true },
  ];

  let allPass = true;
  checks.forEach((c) => {
    const icon = c.pass ? "✅" : "❌";
    console.log(`  ${icon} ${c.label}`);
    if (!c.pass) allPass = false;
  });

  console.log("=".repeat(70));
  if (allPass) {
    console.log("✅ RESET COMPLETE — All checks passed.");
    console.log(`   ${TARGET_WO_NUMBER} is ready for the management demo.`);
    console.log(`   Store Keeper queue will show this WO.`);
    console.log(`   Assignment gate will show amber pending / disabled.`);
    console.log(`   Technician has no assigned job for this WO.`);
  } else {
    console.error("❌ One or more post-reset checks FAILED. Review the output above.");
    process.exit(1);
  }
  console.log("=".repeat(70));
}

main()
  .catch((e) => {
    console.error("\n❌ Reset failed with error:", e.message ?? e);
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
