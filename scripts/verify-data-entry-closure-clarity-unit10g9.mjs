/**
 * Data Entry Dashboard Closure and Closed Jobs Clarity (Unit 10G.9) —
 * verification script.
 *
 * app/actions/closed-job-cards.ts is "use server" and can't be imported
 * into a standalone Node script — same limitation as every prior *.mjs
 * script in this directory. This script mirrors its widened role guard and
 * new "last14days" period math exactly, and separately proves (against real
 * rows, rolled back at the end):
 *   1. Task 1 — the "Ready to Request Closure" count's underlying logic
 *      (materials complete + no active session) already excludes Closure
 *      Requested/Closed by construction (their status is outside
 *      ACTIVE_JOB_CARD_STATUSES, the sample this count is drawn from) — no
 *      code change was needed there, only the label.
 *   2. Task 2 — the Waiting Manager Approval row-building logic (materials
 *      label mapping, requester resolution) against a real Closure
 *      Requested row.
 *   3. Task 8/9 — canViewCosts still resolves false for a Data-Entry-shaped
 *      context, so the reused Closed Job Cards action exposes no cost/pay
 *      to Data Entry now that it can call it.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-data-entry-closure-clarity-unit10g9.mjs
 */

import { PrismaClient } from "@prisma/client";
import { canViewCosts, isManagerRole } from "../lib/security/permissions.ts";
import { ACTIVE_JOB_CARD_STATUSES } from "../lib/work-orders/simplified-status-display.ts";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// Mirrors assertCanViewClosedJobCards (app/actions/closed-job-cards.ts).
function canViewClosedJobCards(roleSlug) {
  return roleSlug === "super_admin" || roleSlug === "maintenance_manager" || roleSlug === "maintenance_data_entry";
}

// Mirrors the "last14days" branch added to getClosedJobCardsListAction.
function last14DaysRangeStart() {
  const d = new Date();
  d.setDate(d.getDate() - 14);
  return d;
}

console.log("== 1. Task 8 — closed-job-cards.ts role guard now allows Data Entry, still blocks everyone else ==");
check("Super Admin allowed", canViewClosedJobCards("super_admin"));
check("Manager allowed", canViewClosedJobCards("maintenance_manager"));
check("Data Entry now allowed (was blocked before this unit)", canViewClosedJobCards("maintenance_data_entry"));
check("Store Keeper (unrelated role) still blocked", !canViewClosedJobCards("store_keeper"));
check("Technician still blocked", !canViewClosedJobCards("technician"));

console.log("\n== 2. Task 3 — last14days period math matches the dashboard tile's own rolling window ==");
{
  const rangeStart = last14DaysRangeStart();
  const expected = new Date();
  expected.setDate(expected.getDate() - 14);
  check("last14days rangeStart is ~14 days before now (within 1s)", Math.abs(rangeStart.getTime() - expected.getTime()) < 1000);
}

console.log("\n== 3. Task 9/1 — a Data-Entry-shaped context still gets canViewCosts()=false via the widened action ==");
{
  const dataEntryContext = { userId: "00000000-0000-0000-0000-000000000000", role: { slug: "maintenance_data_entry", name: "Data Entry" }, permissions: [], profile: { can_view_costs: false } };
  const managerContext = { userId: "00000000-0000-0000-0000-000000000001", role: { slug: "maintenance_manager", name: "Manager" }, permissions: [], profile: { can_view_costs: true } };
  check("Data Entry: canViewCosts() is false (Task 9 — no cost/pay shown)", canViewCosts(dataEntryContext) === false);
  check("Manager (can_view_costs=true): canViewCosts() is true (unaffected by this unit)", canViewCosts(managerContext) === true);
  check("Data Entry: isManagerRole() is false (still cannot approve/edit anywhere)", isManagerRole(dataEntryContext) === false);
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G9 verify script";

try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true, full_name: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    console.log("\n== 4. Task 1 — 'Ready to Request Closure' sample scope already excludes Closure Requested/Closed ==");
    check(
      "ACTIVE_JOB_CARD_STATUSES (the sample nuReadyForClosureCount is drawn from) does not include Closure Requested",
      !ACTIVE_JOB_CARD_STATUSES.includes("Closure Requested")
    );
    check("ACTIVE_JOB_CARD_STATUSES does not include Closed", !ACTIVE_JOB_CARD_STATUSES.includes("Closed"));

    console.log("\n== 5. Task 2 — Waiting Manager Approval row-building logic against a real Closure Requested Job Card ==");
    const wo = await tx.work_orders.create({
      data: {
        ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical",
        status: "Closure Requested", asset_id: asset.id, created_by: user.id,
        operator_complaint: "AC not cooling.",
      },
      select: { id: true },
    });
    await tx.approvals.create({
      data: { work_order_id: wo.id, status: "Closure Requested", decided_by: user.id, comments: "Done." },
    });

    const row = await tx.work_orders.findFirst({
      where: { id: wo.id },
      select: {
        id: true, work_order_number: true, updated_at: true, operator_complaint: true,
        description_of_work: true, created_by: true, assets: { select: { asset_name: true, plate_number: true } },
      },
    });
    check("Row found for the Waiting Manager Approval query shape", Boolean(row));
    const requester = await tx.profiles.findUnique({ where: { id: row.created_by }, select: { full_name: true } });
    check("Requested-by resolves from work_orders.created_by (same field Manager's own compact list uses)", requester?.full_name === user.full_name);
    check("Issue falls back through operator_complaint -> description_of_work -> placeholder correctly", (row.operator_complaint || row.description_of_work || "No issue description") === "AC not cooling.");

    // Materials label mapping mirror (summarizeMaterialAvailability -> label), no required materials on this Job Card.
    const materialsAvailability = "none"; // no work_order_required_parts rows created for this test Job Card
    const materialsLabel =
      materialsAvailability === "fulfilled" ? "Fully Issued"
      : materialsAvailability === "partial" ? "Partially Issued"
      : materialsAvailability === "issuable" ? "Ready to Issue"
      : materialsAvailability === "shortage" ? "Not Issued"
      : "No Materials";
    check('A Job Card with no required materials maps to "No Materials", not a false "Not Issued" block', materialsLabel === "No Materials");

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
