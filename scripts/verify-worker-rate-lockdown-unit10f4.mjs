/**
 * Worker Rate Visibility and Data Entry Lockdown Unit 10F.4 — verification
 * script.
 *
 * Read-only overall: everything runs inside one transaction that is
 * deliberately rolled back at the end — nothing is left behind either way.
 *
 * `lib/backend/workers/service.ts` uses `import "server-only"`, so the real
 * assertCanEditWorkerProfile/assertCanManageWorkers guards can't be imported
 * into a standalone Node script (same limitation as every prior unit's
 * verify script in this directory). This script instead:
 *   (a) imports the REAL `isManagerRole`/`canViewCosts` from
 *       lib/security/permissions.ts directly (that file has no
 *       "server-only" import, so this is not a mirror — it's the actual
 *       exported function this unit added/reused), and
 *   (b) mirrors the thin AppError-throwing wrapper around it
 *       (assertCanEditWorkerProfile) exactly as written in service.ts, and
 *   (c) mirrors the pure UI derivation (which columns/buttons render) from
 *       components/admin/worker-profiles-view.tsx and
 *       components/admin/worker-profile-form-modal.tsx.
 * lint/typecheck/build already confirm the real source files compile and
 * wire together correctly; this script confirms the permission math against
 * real role rows in the database.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-worker-rate-lockdown-unit10f4.mjs
 */

import { PrismaClient } from "@prisma/client";
import { isManagerRole, canViewCosts } from "../lib/security/permissions.ts";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// Mirrors lib/backend/workers/service.ts's assertCanEditWorkerProfile exactly.
function assertCanEditWorkerProfile(context) {
  if (!context.profile.is_active) throw new Error("Inactive user.");
  if (!isManagerRole(context)) {
    throw new Error("Only a Manager can edit or deactivate a worker profile.");
  }
}
// Mirrors assertCanManageWorkers (create) — permission-based, unchanged by this unit.
function assertCanManageWorkers(context) {
  if (!context.profile.is_active) throw new Error("Inactive user.");
  const allowed = context.role?.slug === "super_admin" || context.permissions.includes("work_orders.assign");
  if (!allowed) throw new Error("You do not have permission to manage worker profiles.");
}

// Mirrors components/admin/worker-profiles-view.tsx's column/button visibility.
function tableVisibility(context) {
  return {
    showHourlyRateColumn: canViewCosts(context),
    showEditDeactivateButtons: isManagerRole(context),
    showAddWorkerButton: true, // never gated — Task 2
  };
}
// Mirrors components/admin/worker-profile-form-modal.tsx's rate-field logic.
function formShowsRateField(context, isEditMode) {
  return !isEditMode || canViewCosts(context);
}

function fakeContext({ roleSlug, canViewCostsFlag = false, permissions = [] }) {
  return {
    profile: { is_active: true, can_view_costs: canViewCostsFlag },
    role: { slug: roleSlug },
    permissions,
  };
}

console.log("== 1. Pure derivation — role -> visibility/guard outcomes ==");
{
  const dataEntry = fakeContext({ roleSlug: "maintenance_data_entry", permissions: ["work_orders.assign"] });
  const manager = fakeContext({ roleSlug: "maintenance_manager", canViewCostsFlag: true, permissions: ["work_orders.assign"] });
  const superAdmin = fakeContext({ roleSlug: "super_admin" });

  check("Data Entry: canViewCosts false (no costs.view, no profile flag)", canViewCosts(dataEntry) === false);
  check("Data Entry: isManagerRole false", isManagerRole(dataEntry) === false);
  check("Manager: canViewCosts true (profile.can_view_costs)", canViewCosts(manager) === true);
  check("Manager: isManagerRole true", isManagerRole(manager) === true);
  check("Super Admin: isManagerRole true", isManagerRole(superAdmin) === true);

  const deVis = tableVisibility(dataEntry);
  check("Task 1 — Data Entry: Hourly Rate column hidden", deVis.showHourlyRateColumn === false);
  check("Task 2 — Data Entry: Edit/Deactivate/Reactivate hidden", deVis.showEditDeactivateButtons === false);
  check("Task 2 — Data Entry: Add Worker still visible", deVis.showAddWorkerButton === true);

  const mgrVis = tableVisibility(manager);
  check("Task 1 — Manager: Hourly Rate column visible", mgrVis.showHourlyRateColumn === true);
  check("Task 2 — Manager: Edit/Deactivate/Reactivate visible", mgrVis.showEditDeactivateButtons === true);

  check("Task 3 — Data Entry create form shows rate field (Option A)", formShowsRateField(dataEntry, false) === true);
  check("Task 3 — Data Entry edit form (UI-unreachable, defensive) hides rate field", formShowsRateField(dataEntry, true) === false);
  check("Manager edit form shows rate field", formShowsRateField(manager, true) === true);

  check("Task 4 — Data Entry create action allowed", (() => { try { assertCanManageWorkers(dataEntry); return true; } catch { return false; } })());
  check("Task 4 — Data Entry update/deactivate BLOCKED", (() => { try { assertCanEditWorkerProfile(dataEntry); return false; } catch { return true; } })());
  check("Task 4 — Manager update/deactivate ALLOWED", (() => { try { assertCanEditWorkerProfile(manager); return true; } catch { return false; } })());
  check("Task 4 — Super Admin update/deactivate ALLOWED", (() => { try { assertCanEditWorkerProfile(superAdmin); return true; } catch { return false; } })());
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10F4 verify script";

try {
  await prisma.$transaction(async (tx) => {
    console.log("== 2. Real role rows in this database resolve as expected ==");
    const roles = await tx.roles.findMany({ where: { slug: { in: ["super_admin", "maintenance_manager", "maintenance_data_entry"] } }, select: { slug: true } });
    check("All 3 expected roles exist in this database", roles.length === 3);
    for (const r of roles) {
      const ctx = fakeContext({ roleSlug: r.slug });
      const expectManager = r.slug === "super_admin" || r.slug === "maintenance_manager";
      check(`Role "${r.slug}" isManagerRole === ${expectManager}`, isManagerRole(ctx) === expectManager);
    }

    console.log("== 3. hourly_rate is still stored and readable (Task: do not remove hourly_rate) ==");
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!user) throw new Error("SKIP: expected profile not found");
    const worker = await tx.workerProfile.create({
      data: { name: `${MARKER} Worker`, worker_type: "Technician", hourly_rate: 2.5, created_by: user.id, updated_by: user.id },
      select: { id: true, hourly_rate: true },
    });
    check("hourly_rate persisted on create (schema untouched)", Number(worker.hourly_rate) === 2.5);
    const updated = await tx.workerProfile.update({ where: { id: worker.id }, data: { hourly_rate: 3.75, updated_by: user.id }, select: { hourly_rate: true } });
    check("hourly_rate can still be updated at the data layer (Manager path unchanged)", Number(updated.hourly_rate) === 3.75);

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
