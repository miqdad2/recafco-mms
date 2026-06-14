/**
 * scripts/inspect-demo-wo.cjs
 * READ-ONLY inspection of WO REC/MD/MECH/JOB/0013 and all related rows.
 * No writes. Run before the reset script.
 */
"use strict";

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
  log: [],
});

const TARGET_WO_NUMBER = "REC/MD/MECH/JOB/0013";

async function main() {
  console.log("=".repeat(70));
  console.log(`INSPECTION REPORT — ${TARGET_WO_NUMBER}`);
  console.log("=".repeat(70));

  // --- 1. Work Order row ---
  const wo = await prisma.work_orders.findUnique({
    where: { work_order_number: TARGET_WO_NUMBER },
    select: {
      id: true,
      work_order_number: true,
      status: true,
      assigned_supervisor_id: true,
      priority: true,
      maintenance_type: true,
      worker_type: true,
      created_by: true,
      updated_by: true,
      created_at: true,
      updated_at: true,
      deleted_at: true,
    },
  });

  if (!wo) {
    console.error(`\n❌ WO "${TARGET_WO_NUMBER}" NOT FOUND in database.`);
    process.exit(1);
  }

  console.log("\n--- 1. work_orders ---");
  console.log(`  id:                    ${wo.id}`);
  console.log(`  work_order_number:     ${wo.work_order_number}`);
  console.log(`  status:                ${wo.status}`);
  console.log(`  assigned_supervisor_id:${wo.assigned_supervisor_id ?? "(null)"}`);
  console.log(`  priority:              ${wo.priority}`);
  console.log(`  maintenance_type:      ${wo.maintenance_type}`);
  console.log(`  worker_type:           ${wo.worker_type}`);
  console.log(`  created_by:            ${wo.created_by ?? "(null)"}`);
  console.log(`  updated_by:            ${wo.updated_by ?? "(null)"}`);
  console.log(`  created_at:            ${wo.created_at}`);
  console.log(`  updated_at:            ${wo.updated_at}`);
  console.log(`  deleted_at:            ${wo.deleted_at ?? "(null)"}`);

  const woId = wo.id;

  // --- 2. Required Parts ---
  const requiredParts = await prisma.workOrderRequiredPart.findMany({
    where: { work_order_id: woId },
    orderBy: { created_at: "asc" },
    select: {
      id: true,
      description: true,
      part_number: true,
      quantity_required: true,
      unit_of_measure: true,
      availability_status: true,
      confirmed_by: true,
      confirmed_at: true,
      notes: true,
      created_at: true,
    },
  });

  console.log(`\n--- 2. work_order_required_parts (${requiredParts.length} rows) ---`);
  if (requiredParts.length === 0) {
    console.log("  (none)");
  } else {
    requiredParts.forEach((p, i) => {
      console.log(`  [${i + 1}] id:               ${p.id}`);
      console.log(`      description:      ${p.description}`);
      console.log(`      part_number:      ${p.part_number ?? "(null)"}`);
      console.log(`      qty / uom:        ${p.quantity_required} ${p.unit_of_measure}`);
      console.log(`      availability:     ${p.availability_status}`);
      console.log(`      confirmed_by:     ${p.confirmed_by ?? "(null)"}`);
      console.log(`      confirmed_at:     ${p.confirmed_at ?? "(null)"}`);
      console.log(`      notes:            ${p.notes ?? "(null)"}`);
    });
  }

  // --- 3. Technician Assignments ---
  const assignments = await prisma.work_order_assignments.findMany({
    where: { work_order_id: woId },
    select: {
      id: true,
      technician_id: true,
      assigned_by: true,
      assigned_at: true,
      notes: true,
    },
  });

  console.log(`\n--- 3. work_order_assignments (${assignments.length} rows) ---`);
  if (assignments.length === 0) {
    console.log("  (none)");
  } else {
    assignments.forEach((a, i) => {
      console.log(`  [${i + 1}] id:           ${a.id}`);
      console.log(`      technician_id: ${a.technician_id ?? "(null)"}`);
      console.log(`      assigned_by:   ${a.assigned_by ?? "(null)"}`);
      console.log(`      assigned_at:   ${a.assigned_at}`);
      console.log(`      notes:         ${a.notes ?? "(null)"}`);
    });
  }

  // --- 4. Status History ---
  const history = await prisma.work_order_status_history.findMany({
    where: { work_order_id: woId },
    orderBy: { changed_at: "asc" },
    select: {
      id: true,
      from_status: true,
      to_status: true,
      changed_by: true,
      changed_at: true,
      notes: true,
    },
  });

  console.log(`\n--- 4. work_order_status_history (${history.length} rows) ---`);
  if (history.length === 0) {
    console.log("  (none)");
  } else {
    history.forEach((h, i) => {
      console.log(`  [${i + 1}] ${h.from_status ?? "null"} → ${h.to_status} | by ${h.changed_by ?? "null"} | at ${h.changed_at} | notes: ${h.notes ?? "(none)"}`);
    });
  }

  // --- 5. Workflow Instance ---
  const wfInstance = await prisma.workflowInstance.findFirst({
    where: { entity_type: "work_order", entity_id: woId },
    select: {
      id: true,
      workflow_def_id: true,
      current_step_id: true,
      status: true,
      started_at: true,
      completed_at: true,
      cancelled_at: true,
    },
  });

  console.log(`\n--- 5. workflow_instances ---`);
  if (!wfInstance) {
    console.log("  (none)");
  } else {
    console.log(`  id:              ${wfInstance.id}`);
    console.log(`  workflow_def_id: ${wfInstance.workflow_def_id}`);
    console.log(`  current_step_id: ${wfInstance.current_step_id ?? "(null)"}`);
    console.log(`  status:          ${wfInstance.status}`);
    console.log(`  started_at:      ${wfInstance.started_at}`);
    console.log(`  completed_at:    ${wfInstance.completed_at ?? "(null)"}`);
    console.log(`  cancelled_at:    ${wfInstance.cancelled_at ?? "(null)"}`);
  }

  // --- 6. Workflow Step Instances ---
  const stepInstances = wfInstance
    ? await prisma.workflowStepInstance.findMany({
        where: { workflow_inst_id: wfInstance.id },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          step_id: true,
          status: true,
          actor_id: true,
          decision: true,
          comments: true,
          started_at: true,
          completed_at: true,
          workflow_step: { select: { code: true, name: true, step_order: true } },
        },
      })
    : [];

  console.log(`\n--- 6. workflow_step_instances (${stepInstances.length} rows) ---`);
  if (stepInstances.length === 0) {
    console.log("  (none)");
  } else {
    stepInstances.forEach((s, i) => {
      console.log(`  [${i + 1}] step: ${s.workflow_step?.code ?? s.step_id} (order ${s.workflow_step?.step_order})`);
      console.log(`      name:        ${s.workflow_step?.name}`);
      console.log(`      step_id:     ${s.step_id}`);
      console.log(`      inst_id:     ${s.id}`);
      console.log(`      status:      ${s.status}`);
      console.log(`      actor_id:    ${s.actor_id ?? "(null)"}`);
      console.log(`      decision:    ${s.decision ?? "(null)"}`);
      console.log(`      started_at:  ${s.started_at ?? "(null)"}`);
      console.log(`      completed_at:${s.completed_at ?? "(null)"}`);
    });
  }

  // --- 7. inventory_check step ID for reference ---
  const inventoryCheckStep = stepInstances.find((s) => s.workflow_step?.code === "inventory_check");
  if (inventoryCheckStep) {
    console.log(`\n  → inventory_check step instance id: ${inventoryCheckStep.id} | status: ${inventoryCheckStep.status}`);
  }

  // --- 8. Parts Requests ---
  const partsRequests = await prisma.parts_requests.findMany({
    where: { work_order_id: woId },
    select: {
      id: true,
      parts_request_number: true,
      status: true,
      created_at: true,
    },
  });

  console.log(`\n--- 7. parts_requests (${partsRequests.length} rows) ---`);
  if (partsRequests.length === 0) {
    console.log("  (none)");
  } else {
    partsRequests.forEach((pr, i) => {
      console.log(`  [${i + 1}] ${pr.parts_request_number} | status: ${pr.status} | created: ${pr.created_at}`);
    });
  }

  // --- 9. Inventory Movements ---
  const movements = await prisma.inventory_movements.findMany({
    where: { work_order_id: woId },
    select: {
      id: true,
      movement_type: true,
      quantity: true,
      created_at: true,
    },
  });

  console.log(`\n--- 8. inventory_movements (${movements.length} rows) ---`);
  if (movements.length === 0) {
    console.log("  (none)");
  } else {
    movements.forEach((m, i) => {
      console.log(`  [${i + 1}] ${m.movement_type} | qty: ${m.quantity} | created: ${m.created_at}`);
    });
  }

  // --- 10. Recent Audit Logs ---
  const auditLogs = await prisma.audit_logs.findMany({
    where: { entity_id: woId },
    orderBy: { created_at: "desc" },
    take: 15,
    select: {
      id: true,
      action: true,
      summary: true,
      actor_id: true,
      created_at: true,
    },
  });

  // Also get audit logs for required part IDs
  const requiredPartIds = requiredParts.map((p) => p.id);
  const partAuditLogs = requiredPartIds.length > 0
    ? await prisma.audit_logs.findMany({
        where: { entity_id: { in: requiredPartIds } },
        orderBy: { created_at: "desc" },
        take: 10,
        select: {
          id: true,
          action: true,
          summary: true,
          actor_id: true,
          created_at: true,
        },
      })
    : [];

  console.log(`\n--- 9. audit_logs for WO (last 15, ${auditLogs.length} shown) ---`);
  if (auditLogs.length === 0) {
    console.log("  (none)");
  } else {
    auditLogs.forEach((l, i) => {
      console.log(`  [${i + 1}] ${l.action} | ${l.summary} | ${l.created_at}`);
    });
  }

  console.log(`\n--- 10. audit_logs for required parts (last 10, ${partAuditLogs.length} shown) ---`);
  if (partAuditLogs.length === 0) {
    console.log("  (none)");
  } else {
    partAuditLogs.forEach((l, i) => {
      console.log(`  [${i + 1}] ${l.action} | ${l.summary} | ${l.created_at}`);
    });
  }

  // --- 11. inventory_check_enabled ---
  const settings = await prisma.app_settings.findUnique({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    select: { inventory_check_enabled: true },
  });
  console.log(`\n--- 11. app_settings.inventory_check_enabled: ${settings?.inventory_check_enabled ?? "(not found)"} ---`);

  console.log("\n" + "=".repeat(70));
  console.log("Inspection complete. No writes were made.");
  console.log("=".repeat(70));
}

main()
  .catch((e) => {
    console.error("Inspection failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
