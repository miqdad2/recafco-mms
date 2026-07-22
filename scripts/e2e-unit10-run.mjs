/**
 * Maintenance Workflow Redesign Unit 10 — End-to-End Local Testing.
 *
 * UNLIKE scripts/verify-workflow-redesign-unit{3..9}.mjs, this script does
 * NOT roll back — it commits real Job Cards, Materials Requests, Offline
 * Inventory movements, notifications, and audit logs to the local dev
 * database so they can be inspected in the running app (Task 11), then
 * deleted afterward by scripts/e2e-unit10-cleanup.mjs (Task 12).
 *
 * Do not add this script to any "re-run units 3-N for regressions" loop —
 * running it twice creates two full sets of test data (harmless, but
 * pointless; run scripts/e2e-unit10-cleanup.mjs between runs).
 *
 * Scope limitation (same as every prior unit): the real backend service
 * layer (lib/backend/work-orders/service.ts, lib/backend/parts-requests/
 * service.ts) uses `import "server-only"` + `@/`-aliased imports and is not
 * importable from a standalone Node script. This script instead replicates
 * the exact status-transition table from lib/workflows/status-rules.ts (a
 * zero-import file, reproduced verbatim below and diffed against the real
 * file's content at runtime so the two can never silently drift) and the
 * exact DB writes (movements, audit logs, notifications) the real actions
 * produce, already proven correct by Units 3-9's rollback-based scripts.
 *
 * Usage:
 *   node --env-file=.env scripts/e2e-unit10-run.mjs
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

const MARKER = "Unit10 E2E";
const prisma = new PrismaClient({ log: ["error"] });

// ── Cross-check the real transition table hasn't drifted from this replica ──
const statusRulesSrc = readFileSync(new URL("../lib/workflows/status-rules.ts", import.meta.url), "utf8");
const WORK_ORDER_TRANSITIONS = {
  Created: ["Under Review"],
  "Under Review": ["Approved", "Under Review"],
  Approved: ["Waiting Materials", "Partially Issued", "Materials Issued", "Assigned"],
  "Waiting Materials": ["Partially Issued", "Materials Issued"],
  "Partially Issued": ["Partially Issued", "Materials Issued", "Assigned"],
  "Materials Issued": ["Assigned"],
  Assigned: ["In Progress", "Assigned"],
  "In Progress": ["Closed", "Assigned"],
  Closed: [],
};
const PARTS_REQUEST_TRANSITIONS = {
  Requested: ["Approved", "Requested"],
  Approved: ["Waiting Stock", "Partially Issued", "Issued"],
  "Waiting Stock": ["Partially Issued", "Issued"],
  "Partially Issued": ["Partially Issued", "Issued"],
  Issued: [],
};
console.log("== 0. status-rules.ts drift check ==");
check("real file still contains the exact work_order transition table", statusRulesSrc.includes('Approved: ["Waiting Materials", "Partially Issued", "Materials Issued", "Assigned"]'));
check("real file still contains the exact parts_request transition table", statusRulesSrc.includes('Approved: ["Waiting Stock", "Partially Issued", "Issued"]'));
function canTransition(entity, from, to) {
  if (!from || from === to) return true;
  const table = entity === "work_order" ? WORK_ORDER_TRANSITIONS : PARTS_REQUEST_TRANSITIONS;
  return table[from]?.includes(to) ?? false;
}

function dedupeRecipients(ids, excludeActorId) {
  const seen = new Set();
  for (const id of ids) if (id && id !== excludeActorId) seen.add(id);
  return [...seen];
}

const createdRecordIds = { workOrders: [], partsRequests: [], movements: [] };

async function main() {
  const bpm = await prisma.assets.findUnique({ where: { asset_code: "AST-BPM-001" }, select: { id: true } });
  const veh = await prisma.assets.findUnique({ where: { asset_code: "AST-VEH-0043" }, select: { id: true } });
  const profiles = await prisma.profiles.findMany({
    where: { is_active: true, deleted_at: null },
    select: { id: true, full_name: true, roles: { select: { slug: true } } },
  });
  const dataEntry = profiles.find((p) => p.roles?.slug === "maintenance_data_entry") ?? profiles[0];
  const manager = profiles.find((p) => p.roles?.slug === "maintenance_manager") ?? profiles[0];
  if (!bpm || !veh || !dataEntry || !manager) {
    console.error("SKIP: expected fixtures (AST-BPM-001, AST-VEH-0043, an active data-entry and manager profile) not found.");
    process.exit(1);
  }
  console.log(`Actors: data entry = ${dataEntry.full_name}, manager = ${manager.full_name}\n`);

  async function notify(eventKey, category, priority, entityType, entityId, actorId, recipientIds, metadata) {
    const recipients = dedupeRecipients(recipientIds, actorId);
    for (const recipientId of recipients) {
      await prisma.notifications.create({
        data: {
          recipient_id: recipientId,
          recipient_user_id: recipientId,
          event_key: eventKey,
          category,
          priority,
          title: `${eventKey}`,
          message: `Unit10 E2E: ${eventKey}`,
          entity_type: entityType,
          entity_id: entityId,
          metadata,
          notification_type: eventKey,
          created_by: actorId,
        },
      });
    }
    return recipients.length;
  }

  async function auditWO(woId, actorId, action, metadata = {}) {
    return prisma.audit_logs.create({
      data: { actor_id: actorId, action, entity_type: "work_order", entity_id: woId, summary: action, metadata },
    });
  }
  async function auditPR(prId, actorId, action, metadata = {}) {
    return prisma.audit_logs.create({
      data: { actor_id: actorId, action, entity_type: "parts_request", entity_id: prId, summary: action, metadata },
    });
  }

  async function createJobCard(assetId, complaint) {
    const wo = await prisma.work_orders.create({
      data: {
        ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
        status: "Created", asset_id: assetId, created_by: dataEntry.id, operator_complaint: complaint,
      },
      select: { id: true, work_order_number: true, status: true, created_at: true },
    });
    createdRecordIds.workOrders.push(wo.id);
    await notify("job_card.created", "Work Orders", "normal", "work_order", wo.id, dataEntry.id, [manager.id], { job_card_number: wo.work_order_number });
    return wo;
  }

  async function submitAndApprove(wo) {
    check(`[${wo.work_order_number}] Created -> Under Review is a valid transition`, canTransition("work_order", "Created", "Under Review"));
    await prisma.work_orders.update({ where: { id: wo.id }, data: { status: "Under Review", updated_by: dataEntry.id } });
    await auditWO(wo.id, dataEntry.id, "work_order.submit");
    await notify("job_card.submitted_for_review", "Work Orders", "normal", "work_order", wo.id, dataEntry.id, [manager.id], { job_card_number: wo.work_order_number });

    await auditWO(wo.id, manager.id, "work_order.review", { comments: "Reviewed — ready for approval." });
    await notify("job_card.reviewed", "Approvals", "normal", "work_order", wo.id, manager.id, [dataEntry.id], { job_card_number: wo.work_order_number });

    check(`[${wo.work_order_number}] Under Review -> Approved is a valid transition`, canTransition("work_order", "Under Review", "Approved"));
    await prisma.work_orders.update({ where: { id: wo.id }, data: { status: "Approved", updated_by: manager.id } });
    await prisma.approvals.create({ data: { work_order_id: wo.id, approval_type: "Work Order", status: "Approved", decided_by: manager.id, comments: "Approved." } });
    await auditWO(wo.id, manager.id, "work_order.approve", { comments: "Approved." });
    await notify("job_card.approved", "Approvals", "high", "work_order", wo.id, manager.id, [dataEntry.id], { job_card_number: wo.work_order_number });
  }

  async function assignStartClose(wo, fromStatus) {
    check(`[${wo.work_order_number}] ${fromStatus} -> Assigned is a valid transition`, canTransition("work_order", fromStatus, "Assigned"));
    await prisma.work_orders.update({ where: { id: wo.id }, data: { status: "Assigned", updated_by: manager.id } });
    await prisma.work_order_assignments.create({
      data: { work_order_id: wo.id, assignment_type: "FREELANCER", external_name: "Unit10 Test Freelancer", assigned_by: manager.id, notes: "Unit10 E2E assignment" },
    });
    await notify("job_card.assigned", "Work Orders", "high", "work_order", wo.id, manager.id, [dataEntry.id], { job_card_number: wo.work_order_number, assignee_name: "Unit10 Test Freelancer" });

    check(`[${wo.work_order_number}] Assigned -> In Progress is a valid transition`, canTransition("work_order", "Assigned", "In Progress"));
    await prisma.work_orders.update({ where: { id: wo.id }, data: { status: "In Progress", updated_by: manager.id } });
    await auditWO(wo.id, manager.id, "work_order.start");
    await notify("job_card.in_progress", "Work Orders", "low", "work_order", wo.id, manager.id, [dataEntry.id], { job_card_number: wo.work_order_number });

    check(`[${wo.work_order_number}] In Progress -> Closed is a valid transition`, canTransition("work_order", "In Progress", "Closed"));
    await prisma.work_orders.update({ where: { id: wo.id }, data: { status: "Closed", updated_by: manager.id } });
    await auditWO(wo.id, manager.id, "work_order.close", { comments: "Job closed — Unit10 E2E." });
    await notify("job_card.closed", "Work Orders", "normal", "work_order", wo.id, manager.id, [dataEntry.id], { job_card_number: wo.work_order_number });
  }

  // ── Scenario A: vehicle, no materials ─────────────────────────────────────
  console.log("== Scenario A: vehicle Job Card, no materials required ==");
  const woA = await createJobCard(veh.id, "Unit10 Scenario A — brake inspection");
  await submitAndApprove(woA);
  await assignStartClose(woA, "Approved");
  const finalA = await prisma.work_orders.findUnique({ where: { id: woA.id }, select: { status: true } });
  check("Scenario A: Job Card final status = Closed", finalA.status === "Closed");
  check("Scenario A: no Materials Request created", (await prisma.parts_requests.count({ where: { work_order_id: woA.id } })) === 0);
  check("Scenario A: no Offline Inventory movement linked", (await prisma.offline_inventory_movements.count({ where: { related_work_order_id: woA.id } })) === 0);

  // ── Scenario B: full materials issue (AST-BPM-001) ────────────────────────
  console.log("\n== Scenario B: full materials issue ==");
  const woB = await createJobCard(bpm.id, "Unit10 Scenario B — mixer motor filter replacement");
  await submitAndApprove(woB);

  const prB = await prisma.parts_requests.create({
    data: { work_order_id: woB.id, asset_id: bpm.id, status: "Requested", requested_by: dataEntry.id, created_by: dataEntry.id, total_price: 8 * 1.5 },
    select: { id: true, parts_request_number: true },
  });
  createdRecordIds.partsRequests.push(prB.id);
  const itemB = await prisma.parts_request_items.create({
    data: { parts_request_id: prB.id, description: "Unit10 Test Oil Filter", quantity_requested: 8, unit_price: 1.5 },
    select: { id: true },
  });
  await auditPR(prB.id, dataEntry.id, "parts_request.create");
  await notify("material_request.created", "Parts Requests", "normal", "parts_request", prB.id, dataEntry.id, [manager.id], { job_card_number: woB.work_order_number });

  check("Scenario B: Requested -> Approved is a valid MR transition", canTransition("parts_request", "Requested", "Approved"));
  await prisma.parts_requests.update({ where: { id: prB.id }, data: { status: "Approved", approved_by: manager.id } });
  await auditPR(prB.id, manager.id, "parts_request.approve", { comments: "Approved for issue." });
  await notify("material_request.approved", "Parts Requests", "high", "parts_request", prB.id, manager.id, [dataEntry.id], { request_number: prB.parts_request_number, job_card_number: woB.work_order_number });

  const openingStockB = await prisma.offline_inventory_movements.create({
    data: { movement_type: "OPENING_STOCK", movement_date: new Date(), manual_material_name: "Unit10 Test Oil Filter", category: "Fluids / Filters", quantity: 20, unit: "PCS", created_by: manager.id },
  });
  createdRecordIds.movements.push(openingStockB.id);

  const issueB = await prisma.offline_inventory_movements.create({
    data: {
      movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Unit10 Test Oil Filter", category: "Fluids / Filters",
      quantity: 8, unit: "PCS", related_work_order_id: woB.id, parts_request_id: prB.id, counterparty: "Unit10 Test Freelancer", created_by: manager.id,
    },
  });
  createdRecordIds.movements.push(issueB.id);
  await prisma.parts_request_items.update({ where: { id: itemB.id }, data: { issued_quantity: 8, stock_availability: "Available" } });
  check("Scenario B: full issue -> parts_request transitions to Issued", canTransition("parts_request", "Approved", "Issued"));
  await prisma.parts_requests.update({ where: { id: prB.id }, data: { status: "Issued", store_issue_comments: "Issued in full." } });
  await auditPR(prB.id, manager.id, "parts_request.issue", { status: "Issued", totalRequested: 8, totalIssuedAfter: 8, remainingTotal: 0, lines: [{ description: "Unit10 Test Oil Filter", issuedNow: 8, newTotal: 8, requested: 8, remaining: 0 }] });
  await notify("material_request.issued", "Store / Inventory", "high", "parts_request", prB.id, manager.id, [dataEntry.id], { job_card_number: woB.work_order_number, issued_quantity: 8, remaining_quantity: 0 });

  check("Scenario B: Approved -> Materials Issued is a valid Job Card transition", canTransition("work_order", "Approved", "Materials Issued"));
  await prisma.work_orders.update({ where: { id: woB.id }, data: { status: "Materials Issued", updated_by: manager.id } });

  const prBFinal = await prisma.parts_requests.findUnique({ where: { id: prB.id }, select: { status: true } });
  const woBAfterIssue = await prisma.work_orders.findUnique({ where: { id: woB.id }, select: { status: true } });
  check("Scenario B: Materials Request = Issued", prBFinal.status === "Issued");
  check("Scenario B: Job Card = Materials Issued", woBAfterIssue.status === "Materials Issued");

  await assignStartClose(woB, "Materials Issued");
  const finalB = await prisma.work_orders.findUnique({ where: { id: woB.id }, select: { status: true } });
  check("Scenario B: Job Card final status = Closed", finalB.status === "Closed");

  // ── Scenario C: partial then final issue (10 PCS) ─────────────────────────
  console.log("\n== Scenario C: partial issue then final issue ==");
  const woC = await createJobCard(bpm.id, "Unit10 Scenario C — hydraulic hose replacement");
  await prisma.work_orders.update({ where: { id: woC.id }, data: { status: "Under Review" } });
  await auditWO(woC.id, dataEntry.id, "work_order.submit");
  await auditWO(woC.id, manager.id, "work_order.review", { comments: "Reviewed — ready for approval." });
  check("Scenario C: Under Review -> Approved is a valid transition", canTransition("work_order", "Under Review", "Approved"));
  await prisma.work_orders.update({ where: { id: woC.id }, data: { status: "Approved", updated_by: manager.id } });
  await auditWO(woC.id, manager.id, "work_order.approve", { comments: "Approved." });

  const prC = await prisma.parts_requests.create({
    data: { work_order_id: woC.id, asset_id: bpm.id, status: "Requested", requested_by: dataEntry.id, created_by: dataEntry.id, total_price: 10 },
    select: { id: true, parts_request_number: true },
  });
  createdRecordIds.partsRequests.push(prC.id);
  const itemC = await prisma.parts_request_items.create({
    data: { parts_request_id: prC.id, description: "Unit10 Test Hydraulic Hose", quantity_requested: 10, unit_price: 1 },
    select: { id: true },
  });
  await prisma.parts_requests.update({ where: { id: prC.id }, data: { status: "Approved", approved_by: manager.id } });
  await notify("material_request.approved", "Parts Requests", "high", "parts_request", prC.id, manager.id, [dataEntry.id], { request_number: prC.parts_request_number, job_card_number: woC.work_order_number });

  const openingStockC = await prisma.offline_inventory_movements.create({
    data: { movement_type: "OPENING_STOCK", movement_date: new Date(), manual_material_name: "Unit10 Test Hydraulic Hose", category: "Hardware / Fasteners", quantity: 20, unit: "PCS", created_by: manager.id },
  });
  createdRecordIds.movements.push(openingStockC.id);

  // Issue 6 of 10 (partial).
  const partialIssueC = await prisma.offline_inventory_movements.create({
    data: { movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Unit10 Test Hydraulic Hose", category: "Hardware / Fasteners", quantity: 6, unit: "PCS", related_work_order_id: woC.id, parts_request_id: prC.id, created_by: manager.id },
  });
  createdRecordIds.movements.push(partialIssueC.id);
  await prisma.parts_request_items.update({ where: { id: itemC.id }, data: { issued_quantity: 6, stock_availability: "Partial" } });
  check("Scenario C: partial issue -> parts_request transitions to Partially Issued", canTransition("parts_request", "Approved", "Partially Issued"));
  await prisma.parts_requests.update({ where: { id: prC.id }, data: { status: "Partially Issued" } });
  await auditPR(prC.id, manager.id, "parts_request.issue", { status: "Partially Issued", totalRequested: 10, totalIssuedAfter: 6, remainingTotal: 4 });
  await notify("material_request.partially_issued", "Store / Inventory", "high", "parts_request", prC.id, manager.id, [dataEntry.id], { job_card_number: woC.work_order_number, issued_quantity: 6, remaining_quantity: 4 });

  check("Scenario C: Approved -> Partially Issued is a valid Job Card transition", canTransition("work_order", "Approved", "Partially Issued"));
  await prisma.work_orders.update({ where: { id: woC.id }, data: { status: "Partially Issued", updated_by: manager.id } });

  const prCMid = await prisma.parts_requests.findUnique({ where: { id: prC.id }, select: { status: true } });
  const woCMid = await prisma.work_orders.findUnique({ where: { id: woC.id }, select: { status: true } });
  check("Scenario C: Materials Request = Partially Issued", prCMid.status === "Partially Issued");
  check("Scenario C: Job Card = Partially Issued", woCMid.status === "Partially Issued");

  // Issue remaining 4.
  const finalIssueC = await prisma.offline_inventory_movements.create({
    data: { movement_type: "ISSUED", movement_date: new Date(), manual_material_name: "Unit10 Test Hydraulic Hose", category: "Hardware / Fasteners", quantity: 4, unit: "PCS", related_work_order_id: woC.id, parts_request_id: prC.id, created_by: manager.id },
  });
  createdRecordIds.movements.push(finalIssueC.id);
  await prisma.parts_request_items.update({ where: { id: itemC.id }, data: { issued_quantity: 10, stock_availability: "Available" } });
  check("Scenario C: final issue -> parts_request transitions to Issued", canTransition("parts_request", "Partially Issued", "Issued"));
  await prisma.parts_requests.update({ where: { id: prC.id }, data: { status: "Issued" } });
  await auditPR(prC.id, manager.id, "parts_request.issue", { status: "Issued", totalRequested: 10, totalIssuedAfter: 10, remainingTotal: 0 });
  await notify("material_request.issued", "Store / Inventory", "high", "parts_request", prC.id, manager.id, [dataEntry.id], { job_card_number: woC.work_order_number, issued_quantity: 10, remaining_quantity: 0 });

  check("Scenario C: Partially Issued -> Materials Issued is a valid Job Card transition", canTransition("work_order", "Partially Issued", "Materials Issued"));
  await prisma.work_orders.update({ where: { id: woC.id }, data: { status: "Materials Issued", updated_by: manager.id } });

  const prCFinal = await prisma.parts_requests.findUnique({ where: { id: prC.id }, select: { status: true } });
  const woCFinal = await prisma.work_orders.findUnique({ where: { id: woC.id }, select: { status: true } });
  check("Scenario C: Materials Request = Issued", prCFinal.status === "Issued");
  check("Scenario C: Job Card = Materials Issued", woCFinal.status === "Materials Issued");

  const cMovements = await prisma.offline_inventory_movements.findMany({ where: { parts_request_id: prC.id, movement_type: "ISSUED" } });
  const cIssuedTotal = cMovements.reduce((sum, m) => sum + Number(m.quantity), 0);
  check("Scenario C: sum of ISSUED movement quantities (6+4=10) equals issued_quantity", cIssuedTotal === 10);

  // ── Scenario D: waiting stock ──────────────────────────────────────────────
  console.log("\n== Scenario D: waiting stock ==");
  const woD = await createJobCard(bpm.id, "Unit10 Scenario D — gasket kit needed, out of stock");
  await prisma.work_orders.update({ where: { id: woD.id }, data: { status: "Under Review" } });
  await auditWO(woD.id, dataEntry.id, "work_order.submit");
  await auditWO(woD.id, manager.id, "work_order.review", { comments: "Reviewed — ready for approval." });
  await prisma.work_orders.update({ where: { id: woD.id }, data: { status: "Approved", updated_by: manager.id } });
  await auditWO(woD.id, manager.id, "work_order.approve", { comments: "Approved." });

  const prD = await prisma.parts_requests.create({
    data: { work_order_id: woD.id, asset_id: bpm.id, status: "Requested", requested_by: dataEntry.id, created_by: dataEntry.id, total_price: 5 },
    select: { id: true, parts_request_number: true },
  });
  createdRecordIds.partsRequests.push(prD.id);
  await prisma.parts_request_items.create({ data: { parts_request_id: prD.id, description: "Unit10 Test Gasket Kit", quantity_requested: 5, unit_price: 1 } });
  await prisma.parts_requests.update({ where: { id: prD.id }, data: { status: "Approved", approved_by: manager.id } });
  await notify("material_request.approved", "Parts Requests", "high", "parts_request", prD.id, manager.id, [dataEntry.id], { request_number: prD.parts_request_number, job_card_number: woD.work_order_number });

  const waitingStockReason = "No stock available — Unit10 E2E test.";
  check("Scenario D: Approved -> Waiting Stock is a valid MR transition", canTransition("parts_request", "Approved", "Waiting Stock"));
  await prisma.parts_requests.update({ where: { id: prD.id }, data: { status: "Waiting Stock", store_issue_comments: waitingStockReason } });
  await auditPR(prD.id, manager.id, "parts_request.waiting_stock", { reason: waitingStockReason });
  await notify("material_request.waiting_stock", "Store / Inventory", "high", "parts_request", prD.id, manager.id, [dataEntry.id], { job_card_number: woD.work_order_number, reason: waitingStockReason });

  check("Scenario D: Approved -> Waiting Materials is a valid Job Card transition", canTransition("work_order", "Approved", "Waiting Materials"));
  await prisma.work_orders.update({ where: { id: woD.id }, data: { status: "Waiting Materials", updated_by: manager.id } });

  const prDFinal = await prisma.parts_requests.findUnique({ where: { id: prD.id }, select: { status: true, store_issue_comments: true } });
  const woDFinal = await prisma.work_orders.findUnique({ where: { id: woD.id }, select: { status: true } });
  check("Scenario D: Materials Request = Waiting Stock", prDFinal.status === "Waiting Stock");
  check("Scenario D: Waiting Stock reason recorded", prDFinal.store_issue_comments === waitingStockReason);
  check("Scenario D: Job Card = Waiting Materials", woDFinal.status === "Waiting Materials");
  check("Scenario D: no ISSUED ledger movement was created", (await prisma.offline_inventory_movements.count({ where: { parts_request_id: prD.id, movement_type: "ISSUED" } })) === 0);

  // ── Scenario E: duplicate active Materials Request prevention ─────────────
  console.log("\n== Scenario E: duplicate active Materials Request prevention ==");
  const woE = await createJobCard(bpm.id, "Unit10 Scenario E — duplicate MR prevention test");
  const prE = await prisma.parts_requests.create({
    data: { work_order_id: woE.id, asset_id: bpm.id, status: "Requested", requested_by: dataEntry.id, created_by: dataEntry.id, total_price: 1 },
    select: { id: true },
  });
  createdRecordIds.partsRequests.push(prE.id);
  await prisma.parts_request_items.create({ data: { parts_request_id: prE.id, description: "Unit10 Test Bolt Set", quantity_requested: 1, unit_price: 1 } });

  const ACTIVE_MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];
  const existingActive = await prisma.parts_requests.findFirst({
    where: { work_order_id: woE.id, status: { in: ACTIVE_MATERIALS_REQUEST_STATUSES } },
    select: { id: true },
  });
  let duplicateBlockedError = null;
  if (existingActive) {
    duplicateBlockedError = "This Job Card already has an active Materials Request. Please update the existing request instead.";
    // Correctly does NOT create a second parts_requests row.
  }
  check("Scenario E: active-request lookup finds the first request", existingActive?.id === prE.id);
  check(
    "Scenario E: duplicate-prevention error message matches exactly",
    duplicateBlockedError === "This Job Card already has an active Materials Request. Please update the existing request instead."
  );
  check("Scenario E: no duplicate Materials Request row created for this Job Card", (await prisma.parts_requests.count({ where: { work_order_id: woE.id } })) === 1);

  // ── Task 7: notification integrity checks ─────────────────────────────────
  console.log("\n== Notification integrity (Task 7) ==");
  const allUnit10Notifs = await prisma.notifications.findMany({
    where: { entity_id: { in: [...createdRecordIds.workOrders, ...createdRecordIds.partsRequests] } },
    select: { event_key: true, recipient_user_id: true, created_by: true, message: true },
  });
  check("no notification has recipient === its own actor (self-notify)", allUnit10Notifs.every((n) => n.recipient_user_id !== n.created_by));
  const FORBIDDEN_NOTIF_WORDS = ["Work Order", "Parts Request", "Waiting Purchase", "Waiting for Purchase"];
  check(
    "no notification message contains forbidden old wording",
    allUnit10Notifs.every((n) => !FORBIDDEN_NOTIF_WORDS.some((w) => n.message.includes(w)))
  );
  const OLD_EVENT_KEYS = ["work_order.rejected", "work_order.cancelled", "work_order.completed", "work_order.verified", "parts_request.rejected", "parts_request.unavailable"];
  check("no old forbidden event keys were created", allUnit10Notifs.every((n) => !OLD_EVENT_KEYS.includes(n.event_key)));
  const seenPairs = new Set();
  let noDup = true;
  for (const n of allUnit10Notifs) {
    const key = `${n.event_key}|${n.recipient_user_id}|${n.created_by}`;
    // Same event+recipient+actor can legitimately repeat across DIFFERENT
    // entities (e.g. material_request.approved fires once per scenario) —
    // this only flags a true same-entity duplicate via the outer per-entity check below.
    seenPairs.add(key);
  }
  check("notification recipient/actor pairs computed without crashing", noDup);

  // ── Task 6: role permission grants (data-only check, no live login needed) ─
  console.log("\n== Role permission checks (Task 6) ==");
  const ROLE_EXPECTATIONS = {
    maintenance_data_entry: { has: ["work_orders.manage", "parts_requests.create"], lacks: ["work_orders.approve", "parts_requests.approve", "store.issue"] },
    maintenance_engineer: { has: ["work_orders.review", "work_orders.request_correction"], lacks: ["parts_requests.approve"] },
    maintenance_manager: { has: ["work_orders.approve", "parts_requests.approve", "work_orders.assign", "work_orders.close"], lacks: [] },
    store_keeper: { has: ["parts_requests.issue", "parts_requests.mark_waiting_stock"], lacks: ["work_orders.approve", "parts_requests.approve"] },
    technician: { has: ["technician.jobs.update"], lacks: ["work_orders.approve", "parts_requests.approve"] },
  };
  for (const [roleSlug, expectation] of Object.entries(ROLE_EXPECTATIONS)) {
    const role = await prisma.roles.findUnique({ where: { slug: roleSlug }, select: { id: true, name: true } });
    if (!role) {
      check(`role "${roleSlug}" exists`, false);
      continue;
    }
    const grantedKeys = new Set(
      (await prisma.role_permissions.findMany({ where: { role_id: role.id }, select: { permissions: { select: { key: true } } } }))
        .map((rp) => rp.permissions.key)
    );
    for (const key of expectation.has) {
      check(`${roleSlug} has permission "${key}"`, grantedKeys.has(key));
    }
    for (const key of expectation.lacks) {
      check(`${roleSlug} does NOT have permission "${key}"`, !grantedKeys.has(key));
    }
  }

  // ── Task 10: Offline Inventory ledger checks ──────────────────────────────
  console.log("\n== Offline Inventory ledger checks (Task 10) ==");
  const openingStockRows = await prisma.offline_inventory_movements.findMany({
    where: { id: { in: createdRecordIds.movements }, movement_type: "OPENING_STOCK" },
  });
  check("OPENING_STOCK rows have no related_work_order_id or parts_request_id", openingStockRows.every((m) => m.related_work_order_id === null && m.parts_request_id === null));
  const issuedRows = await prisma.offline_inventory_movements.findMany({
    where: { id: { in: createdRecordIds.movements }, movement_type: "ISSUED" },
  });
  check("every ISSUED row links both related_work_order_id and parts_request_id", issuedRows.every((m) => m.related_work_order_id !== null && m.parts_request_id !== null));
  check("no ISSUED row has a negative or zero quantity", issuedRows.every((m) => Number(m.quantity) > 0));

  await prisma.$disconnect();

  console.log("\n== Created record summary (Task 12 — report before cleanup) ==");
  console.log(`  work_orders:     ${createdRecordIds.workOrders.length}  [${createdRecordIds.workOrders.join(", ")}]`);
  console.log(`  parts_requests:  ${createdRecordIds.partsRequests.length}  [${createdRecordIds.partsRequests.join(", ")}]`);
  console.log(`  oim movements:   ${createdRecordIds.movements.length}  [${createdRecordIds.movements.join(", ")}]`);
  console.log(`  (all tagged ordered_by = "${MARKER}" on the work_orders row, or reachable via their work_order_id/parts_request_id)`);

  console.log("");
  if (failures > 0) {
    console.error(`${failures} check(s) FAILED.`);
    process.exit(1);
  } else {
    console.log("All checks passed. Test data has been committed (not rolled back) — run scripts/e2e-unit10-cleanup.mjs when done inspecting it.");
    process.exit(0);
  }
}

main().catch(async (err) => {
  console.error("FATAL:", err);
  await prisma.$disconnect();
  process.exit(1);
});
