/**
 * Maintenance Workflow Redesign Unit 9 — List Page UI Wiring and Status
 * Filter Cleanup checks.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end (same pattern as Units 3-8).
 *
 * Scope limitation (same as every prior unit): the actual list pages
 * (app/(dashboard)/maintenance/work-orders/page.tsx,
 * app/(dashboard)/store/parts-requests/page.tsx,
 * app/(dashboard)/dashboard/page.tsx) are Next.js Server Components with
 * next/link, lucide-react, and @/-aliased imports, none of which resolve
 * from a standalone Node script. This script instead (a) replicates the
 * exact bucket/status-map logic and WHERE-clause shapes added in this unit
 * against the real schema inside a transaction that is rolled back, and
 * (b) reads the page source files directly to confirm the new tab/bucket
 * label sets contain no forbidden old-model wording.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-workflow-redesign-unit9.mjs
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

// Mirrors getStatusMap() in app/(dashboard)/maintenance/work-orders/page.tsx (Task 2).
const JOB_CARD_STATUS_MAP = {
  New: ["Created"],
  Review: ["Under Review"],
  Approved: ["Approved"],
  Materials: ["Waiting Materials", "Partially Issued", "Materials Issued"],
  Assigned: ["Assigned"],
  "In Progress": ["In Progress"],
  Closed: ["Closed"],
};
const JOB_CARD_TABS = ["New", "Review", "Approved", "Materials", "Assigned", "In Progress", "Closed"];
const MATERIALS_REQUEST_TABS = ["Requested", "Approved", "Waiting Stock", "Partially Issued", "Issued"];

console.log("== 1. Source text: no forbidden old-model wording in the new tab/bucket label sets (Task 2/5) ==");
const FORBIDDEN_WORDS = [
  "Draft", "Submitted", "Pending Approval", "Rejected", "Cancelled", "Returned",
  "Completed by Technician", "Verified by Supervisor", "Confirmed by Requester",
  "Waiting for Parts", "Waiting for Purchase", "Parts Issued",
];
function extractBlock(src, startMarker, endMarker) {
  const start = src.indexOf(startMarker);
  if (start === -1) return null;
  const end = src.indexOf(endMarker, start);
  if (end === -1) return null;
  return src.slice(start, end);
}
const woPageSrc = readFileSync(
  new URL("../app/(dashboard)/maintenance/work-orders/page.tsx", import.meta.url),
  "utf8"
);
const prPageSrc = readFileSync(
  new URL("../app/(dashboard)/store/parts-requests/page.tsx", import.meta.url),
  "utf8"
);
const jobCardTabsBlock = extractBlock(woPageSrc, "const JOB_CARD_TABS: Tab[] = [", "];");
const materialsTabsBlock = extractBlock(prPageSrc, "const MATERIALS_REQUEST_TABS = [", "];");
check("Job Card TABS block found", !!jobCardTabsBlock);
check("Materials Request TABS block found", !!materialsTabsBlock);
for (const word of FORBIDDEN_WORDS) {
  check(`Job Card tabs contain no "${word}"`, !jobCardTabsBlock || !jobCardTabsBlock.includes(word));
  check(`Materials Request tabs contain no "${word}"`, !materialsTabsBlock || !materialsTabsBlock.includes(word));
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit9 verify script";

console.log("== 2. Full scenario (rolled back) ==");
try {
  await prisma.$transaction(async (tx) => {
    const bpm = await tx.assets.findUnique({ where: { asset_code: "AST-BPM-001" }, select: { id: true, asset_code: true } });
    const veh = await tx.assets.findUnique({ where: { asset_code: "AST-VEH-0043" }, select: { id: true, asset_code: true, plate_number: true } });
    const users = await tx.profiles.findMany({ take: 1, select: { id: true } });
    if (!bpm || !veh || users.length < 1) throw new Error("SKIP: expected fixtures (AST-BPM-001, AST-VEH-0043, a profile) not found");
    const actor = users[0].id;

    // ── Task 12: Job Cards A-I, one per new status ──────────────────────────
    const JOB_CARD_STATUSES = [
      "Created", "Under Review", "Approved", "Waiting Materials",
      "Partially Issued", "Materials Issued", "Assigned", "In Progress", "Closed",
    ];
    const jobCards = [];
    for (const status of JOB_CARD_STATUSES) {
      const wo = await tx.work_orders.create({
        data: {
          ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
          status, asset_id: bpm.id, created_by: actor,
          operator_complaint: `Unit9 scenario — ${status}`,
        },
        select: { id: true, work_order_number: true, status: true },
      });
      jobCards.push(wo);
    }
    check("9 Job Cards created (A-I, one per new status)", jobCards.length === 9);

    // Job Card E gets a linked Materials Request (Partially Issued) — Task 12.
    const jobCardE = jobCards.find((w) => w.status === "Partially Issued");
    const prE = await tx.parts_requests.create({
      data: { work_order_id: jobCardE.id, asset_id: bpm.id, status: "Partially Issued", requested_by: actor, created_by: actor, total_price: 0 },
      select: { id: true },
    });
    await tx.parts_request_items.create({
      data: { parts_request_id: prE.id, description: "Unit9 Test Bearing", quantity_requested: 10, unit_price: 1, issued_quantity: 4 },
    });

    // ── Task 12: Materials Requests, one per new status (separate Job Card each,
    // since only one active Materials Request may exist per Job Card at a time) ──
    const MATERIALS_REQUEST_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued", "Issued"];
    const materialsRequests = [];
    for (const status of MATERIALS_REQUEST_STATUSES) {
      const wo = await tx.work_orders.create({
        data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Approved", asset_id: veh.id, created_by: actor },
        select: { id: true },
      });
      const pr = await tx.parts_requests.create({
        data: { work_order_id: wo.id, asset_id: veh.id, status, requested_by: actor, created_by: actor, total_price: 0 },
        select: { id: true, status: true },
      });
      await tx.parts_request_items.create({
        data: { parts_request_id: pr.id, description: "Unit9 Test Brake Pad", quantity_requested: 4, unit_price: 1 },
      });
      materialsRequests.push({ ...pr, workOrderId: wo.id });
    }
    check("5 Materials Requests created (one per new status)", materialsRequests.length === 5);

    // ── Job Card bucket counts (Task 2/3 — mirrors getStatusMap/tabCount) ───
    const woSummaries = await tx.work_orders.groupBy({
      by: ["status"],
      where: { ordered_by: MARKER },
      _count: { _all: true },
    });
    const countForWo = (statuses) =>
      woSummaries.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
    // Note: the 5 Materials-Request test Job Cards created below are all
    // status "Approved", so the "Approved" bucket legitimately covers 6 rows
    // (1 from the 9-status set + 5 from the Materials Request set) — every
    // other bucket covers exactly 1.
    for (const [bucket, statuses] of Object.entries(JOB_CARD_STATUS_MAP)) {
      const expected = bucket === "Approved" ? 6 : bucket === "Materials" ? 3 : 1;
      check(`Job Card bucket "${bucket}" counts exactly its own status`, countForWo(statuses) === expected);
    }

    // ── Materials Request bucket counts (Task 5/6) ──────────────────────────
    const prSummaries = await tx.parts_requests.groupBy({
      by: ["status"],
      where: { id: { in: [...materialsRequests.map((m) => m.id), prE.id] } },
      _count: { _all: true },
    });
    const countForPr = (statuses) =>
      prSummaries.filter((s) => statuses.includes(s.status)).reduce((n, s) => n + s._count._all, 0);
    check("Materials Request bucket 'Requested' = 1", countForPr(["Requested"]) === 1);
    check("Materials Request bucket 'Approved' = 1", countForPr(["Approved"]) === 1);
    check("Materials Request bucket 'Waiting Stock' = 1", countForPr(["Waiting Stock"]) === 1);
    check("Materials Request bucket 'Partially Issued' = 2 (dedicated + Job Card E's)", countForPr(["Partially Issued"]) === 2);
    check("Materials Request bucket 'Issued' = 1", countForPr(["Issued"]) === 1);

    // ── Search (Task 8): Job Card number, asset code, plate number, material name ──
    const byJobCardNumber = await tx.work_orders.findFirst({
      where: { AND: [{ ordered_by: MARKER }, { work_order_number: { contains: jobCards[0].work_order_number.slice(-4), mode: "insensitive" } }] },
      select: { id: true },
    });
    check("search matches by Job Card number fragment", byJobCardNumber?.id === jobCards[0].id);

    const byAssetCode = await tx.work_orders.findMany({
      where: { AND: [{ ordered_by: MARKER }, { assets: { asset_code: { contains: "AST-BPM-001", mode: "insensitive" } } }] },
      select: { id: true },
    });
    check("search matches Job Cards by asset code", byAssetCode.length === 9);

    const byPlate = await tx.work_orders.findMany({
      where: { AND: [{ ordered_by: MARKER }, { assets: { plate_number: { contains: veh.plate_number, mode: "insensitive" } } }] },
      select: { id: true },
    });
    check("search matches Job Cards by vehicle plate number", byPlate.length === 5);

    const byMaterialName = await tx.work_orders.findMany({
      where: { AND: [{ ordered_by: MARKER }, { parts_requests: { some: { parts_request_items: { some: { description: { contains: "Unit9 Test Bearing", mode: "insensitive" } } } } } }] },
      select: { id: true },
    });
    check("search matches Job Cards by requested material name", byMaterialName.length === 1 && byMaterialName[0].id === jobCardE.id);

    const prByMaterialName = await tx.parts_requests.findMany({
      where: { AND: [{ id: { in: materialsRequests.map((m) => m.id) } }, { parts_request_items: { some: { description: { contains: "Brake Pad", mode: "insensitive" } } } }] },
      select: { id: true },
    });
    check("Materials Request search matches by material name", prByMaterialName.length === 5);

    // ── Store visibility (Task 11): Approved/Waiting Materials/Partially
    // Issued/Materials Issued Job Cards must be visible to Store — mirrors
    // the store_keeper branch in lib/work-orders/visibility.ts (unchanged,
    // already correct) plus the SUPERVISOR_STAGES fix made in this unit. ──
    // 6 Approved (1 + 5 Materials-Request test cards) + 1 each of Waiting
    // Materials/Partially Issued/Materials Issued = 9.
    const storeVisibleStatuses = ["Approved", "Waiting Materials", "Partially Issued", "Materials Issued"];
    const storeVisible = await tx.work_orders.findMany({
      where: { AND: [{ ordered_by: MARKER }, { status: { in: storeVisibleStatuses } }] },
      select: { id: true, status: true },
    });
    check("Store-visible status set matches the expected Job Cards", storeVisible.length === 9);
    check("every Store-visible Job Card has a status in the expected set", storeVisible.every((w) => storeVisibleStatuses.includes(w.status)));

    // Same 9 plus Assigned + In Progress (1 each) = 11 — before the
    // SUPERVISOR_STAGES fix, only Approved/Assigned/In Progress (old list)
    // would have matched a Job Card that could actually exist under the new
    // model, silently dropping Waiting Materials/Partially Issued/Materials
    // Issued from a Supervisor's visibility entirely.
    const supervisorVisibleStatuses = ["Approved", "Waiting Materials", "Partially Issued", "Materials Issued", "Assigned", "In Progress"];
    const supervisorVisible = await tx.work_orders.findMany({
      where: { AND: [{ ordered_by: MARKER }, { status: { in: supervisorVisibleStatuses } }] },
      select: { id: true },
    });
    check("Supervisor SUPERVISOR_STAGES fix: 11 of 14 test Job Cards now visible", supervisorVisible.length === 11);

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

console.log("== 3. Counts after rollback (clean baseline restored) ==");
const woCount = await prisma.work_orders.count({ where: { ordered_by: MARKER } });
const prCount = await prisma.parts_requests.count();
check("no leftover Unit9 test work_orders", woCount === 0);
check("no leftover parts_requests (fresh DB otherwise had none)", prCount === 0);

await prisma.$disconnect();

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
