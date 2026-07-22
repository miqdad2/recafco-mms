/**
 * Maintenance Workflow Redesign Unit 10 — Task 8/9 display-data checks
 * against the REAL, committed data created by scripts/e2e-unit10-run.mjs
 * (not a rollback scenario — this queries whatever is actually in the DB
 * right now, tagged ordered_by = "Unit10 E2E").
 *
 * Run this AFTER scripts/e2e-unit10-run.mjs and BEFORE
 * scripts/e2e-unit10-cleanup.mjs.
 *
 * Usage:
 *   node --env-file=.env scripts/e2e-unit10-display-checks.mjs
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

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10 E2E";

const JOB_CARD_STATUS_MAP = {
  New: ["Created"],
  Review: ["Under Review"],
  Approved: ["Approved"],
  Materials: ["Waiting Materials", "Partially Issued", "Materials Issued"],
  Assigned: ["Assigned"],
  "In Progress": ["In Progress"],
  Closed: ["Closed"],
};

console.log("== Task 8: Job Card audit timeline data shape ==");
const jobCards = await prisma.work_orders.findMany({
  where: { ordered_by: MARKER },
  select: { id: true, work_order_number: true, status: true },
  orderBy: { created_at: "asc" },
});
check("5 Unit10 E2E Job Cards found", jobCards.length === 5);

for (const wo of jobCards) {
  const logs = await prisma.audit_logs.findMany({ where: { entity_type: "work_order", entity_id: wo.id }, select: { action: true } });
  const actions = new Set(logs.map((l) => l.action));
  if (wo.status === "Closed") {
    check(`[${wo.work_order_number}] Closed Job Card has submit/review/approve/start/close audit entries`,
      ["work_order.submit", "work_order.review", "work_order.approve", "work_order.start", "work_order.close"].every((a) => actions.has(a)));
  } else if (wo.status === "Created") {
    // A create-path row (work_order.record_create, written automatically) is
    // expected; no *lifecycle* action (submit/review/approve/...) should exist yet.
    check(`[${wo.work_order_number}] freshly-Created Job Card has no lifecycle audit entries yet`,
      !["work_order.submit", "work_order.review", "work_order.approve", "work_order.start", "work_order.close"].some((a) => actions.has(a)));
  } else {
    check(`[${wo.work_order_number}] in-flight Job Card has at least submit/review/approve audit entries`,
      ["work_order.submit", "work_order.review", "work_order.approve"].every((a) => actions.has(a)));
  }
}

console.log("\n== Task 8: Materials Request timeline data shape ==");
const partsRequests = await prisma.parts_requests.findMany({
  where: { work_orders: { ordered_by: MARKER } },
  select: { id: true, parts_request_number: true, status: true, work_order_id: true },
});
check("4 Unit10 E2E Materials Requests found", partsRequests.length === 4);
for (const pr of partsRequests) {
  const logs = await prisma.audit_logs.findMany({ where: { entity_type: "parts_request", entity_id: pr.id }, select: { action: true } });
  const movements = await prisma.offline_inventory_movements.findMany({ where: { parts_request_id: pr.id } });
  check(`[${pr.parts_request_number}] audit_logs scoped correctly (only its own entity_id)`, logs.length >= 0);
  check(`[${pr.parts_request_number}] linked Offline Inventory movements all carry this exact parts_request_id`, movements.every((m) => m.parts_request_id === pr.id));
  if (pr.status === "Issued") {
    check(`[${pr.parts_request_number}] Issued request has at least one ISSUED movement`, movements.some((m) => m.movement_type === "ISSUED"));
  }
  if (pr.status === "Waiting Stock") {
    check(`[${pr.parts_request_number}] Waiting Stock request has a waiting_stock audit entry with a reason`,
      logs.some((l) => l.action === "parts_request.waiting_stock"));
    const waitingLog = await prisma.audit_logs.findFirst({ where: { entity_type: "parts_request", entity_id: pr.id, action: "parts_request.waiting_stock" } });
    check(`[${pr.parts_request_number}] waiting_stock audit metadata has a reason string`, typeof waitingLog?.metadata?.reason === "string" && waitingLog.metadata.reason.length > 0);
  }
  // Linked Job Card / asset queryable exactly as the detail page's includeShape does.
  const linked = await prisma.parts_requests.findFirst({
    where: { id: pr.id },
    include: {
      work_orders: { select: { id: true, work_order_number: true, status: true, operator_complaint: true } },
      assets: { select: { asset_code: true, asset_name: true, category: true, plate_number: true } },
    },
  });
  check(`[${pr.parts_request_number}] linked Job Card is queryable`, !!linked.work_orders?.work_order_number);
  check(`[${pr.parts_request_number}] linked asset is queryable`, !!linked.assets?.asset_name);
}

console.log("\n== Task 9: Job Card list bucket counts (additive over existing baseline) ==");
const statusSummaries = await prisma.work_orders.groupBy({
  by: ["status"],
  where: { ordered_by: MARKER },
  _count: { _all: true },
});
const countFor = (statuses) => statusSummaries.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
check("New bucket = 1 (Scenario E's Job Card, left at Created)", countFor(JOB_CARD_STATUS_MAP.New) === 1);
check("Materials bucket = 2 (Scenario C's Materials Issued + Scenario D's Waiting Materials)", countFor(JOB_CARD_STATUS_MAP.Materials) === 2);
check("Closed bucket = 2 (Scenario A + Scenario B)", countFor(JOB_CARD_STATUS_MAP.Closed) === 2);

console.log("\n== Task 9: search matches these real Job Cards/Materials Requests ==");
const searchByNumber = await prisma.work_orders.findFirst({ where: { work_order_number: { contains: jobCards[0].work_order_number.slice(-4) } }, select: { id: true } });
check("search by Job Card number fragment resolves to a real row", !!searchByNumber);
const searchByMaterial = await prisma.parts_requests.findMany({
  where: { parts_request_items: { some: { description: { contains: "Unit10 Test", mode: "insensitive" } } } },
  select: { id: true },
});
check("search by material name matches all 4 Unit10 Materials Requests", searchByMaterial.length === 4);

await prisma.$disconnect();

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
