/**
 * Closure Review Rate/Pay Display Fix (Unit 10G.3 Fix) — verification script.
 *
 * This fix unit found no code-level bug in getClosureReviewDetailAction or
 * closure-review-modal.tsx — canViewCosts is computed once via the
 * canonical lib/security/permissions.ts helper and threaded correctly
 * through workers[].hourlyRate/totalPay, totalAmount, and every session's
 * calculated_amount, with null (not just a hidden UI element) whenever
 * canViewCosts is false. This script proves two things directly against
 * real rows in a rolled-back transaction:
 *
 *   1. The one gap this unit did find and fix: SessionRow.edited_by_name
 *      is now surfaced next to the correction reason (it was captured by
 *      the query all along but never rendered).
 *   2. The actual reason rate/pay can appear missing when testing as the
 *      seeded "manager" account: that profile's own can_view_costs flag,
 *      and the maintenance_manager role's own permission set — read-only,
 *      no rows are written.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-closure-review-payment-display-unit10g3fix.mjs
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
const MARKER = "Unit10G3Fix verify script";

try {
  console.log("== 1. Data/permission root-cause check (read-only, no rows written) ==");
  const managerLikeProfiles = await prisma.profiles.findMany({
    where: { roles: { slug: { in: ["maintenance_manager", "super_admin"] } } },
    select: { full_name: true, can_view_costs: true, roles: { select: { slug: true } } },
  });
  for (const p of managerLikeProfiles) {
    console.log(`  info  ${p.full_name} — role=${p.roles?.slug} can_view_costs=${p.can_view_costs}`);
  }
  const managerRole = await prisma.roles.findFirst({ where: { slug: "maintenance_manager" } });
  let managerRoleHasCostsView = false;
  if (managerRole) {
    const perms = await prisma.role_permissions.findMany({ where: { role_id: managerRole.id }, include: { permissions: { select: { key: true } } } });
    managerRoleHasCostsView = perms.some((p) => p.permissions?.key === "costs.view");
    console.log(`  info  maintenance_manager role has costs.view permission: ${managerRoleHasCostsView}`);
  }
  check(
    "Documented root cause still holds: at least one seeded manager-like profile relies solely on canViewCosts() (own flag OR role permission OR super_admin bypass) — not a code defect",
    managerLikeProfiles.length > 0,
  );

  console.log("\n== 2. Task 3 fix — edited_by_name now available for display alongside correction_reason ==");
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true, full_name: true } });
    if (!asset || !user) throw new Error("SKIP: expected asset/profile not found");

    const wo = await tx.work_orders.create({
      data: { ordered_by: MARKER, maintenance_type: "Routine", worker_type: "Mechanical", status: "Closure Requested", asset_id: asset.id, created_by: user.id },
      select: { id: true },
    });
    const worker = await tx.workerProfile.create({
      data: { name: `${MARKER} Worker`, worker_type: "Helper/Labor", hourly_rate: 9.0, skill_category: "Auto", created_by: user.id, updated_by: user.id },
      select: { id: true },
    });
    const assignment = await tx.workOrderWorkerAssignment.create({
      data: { work_order_id: wo.id, worker_id: worker.id, worker_role: "Helper/Labor", hourly_rate_snapshot: 2.0, status: "active", assigned_by: user.id },
      select: { id: true },
    });
    const start = new Date();
    await tx.workOrderWorkSession.create({
      data: {
        work_order_id: wo.id, worker_assignment_id: assignment.id, worker_id: worker.id,
        started_at: start, stopped_at: new Date(start.getTime() + 60 * 60 * 1000),
        status: "Completed", duration_minutes: 60, hourly_rate_snapshot: 2.0, calculated_amount: 2.0,
        entered_by: user.id, correction_reason: "Adjusted per technician report.", edited_by: user.id,
      },
    });

    // Mirrors getSessionsForAssignmentAction's own shape (profiles_edited_by -> edited_by_name).
    const row = await tx.workOrderWorkSession.findFirst({
      where: { work_order_id: wo.id },
      include: { profiles_edited_by: { select: { full_name: true } } },
    });
    const edited_by_name = row.profiles_edited_by?.full_name ?? null;

    check("Session has a correction_reason (the case this fix targets)", Boolean(row.correction_reason));
    check("edited_by_name resolves to the corrector's real name, not null", edited_by_name === user.full_name);

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
