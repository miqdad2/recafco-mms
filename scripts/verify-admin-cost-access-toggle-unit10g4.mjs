/**
 * Admin Cost Visibility Toggle (Unit 10G.4) — verification script.
 *
 * updateUserCostAccessAction (app/actions/user-access.ts, "use server") can't
 * be imported into a standalone Node script (same limitation as every prior
 * *.mjs script in this directory). This script instead:
 *   (a) performs the exact same DB write the action performs
 *       (profiles.can_view_costs update + audit_logs insert with the same
 *       action name/metadata shape) against a real, disposable profile row,
 *       inside a transaction that is rolled back at the end, and
 *   (b) proves canViewCosts() (lib/security/permissions.ts, the same
 *       canonical gate Closure Review/Worker Activity/Reports/Closed Jobs
 *       all use) actually flips its answer once the flag changes — i.e.
 *       this toggle is not cosmetic, it drives the real gate.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-admin-cost-access-toggle-unit10g4.mjs
 */

import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { canViewCosts } from "../lib/security/permissions.ts";

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
const MARKER = "Unit10G4 verify script";

// Mirrors the shape requirePermission()/getCurrentUserContext() build for a
// non-super_admin Manager (no costs.view permission, no overrides) — the
// exact scenario this unit targets: canViewCosts() must depend only on
// context.profile.can_view_costs for this role.
function managerContext(canViewCostsFlag) {
  return {
    userId: "00000000-0000-0000-0000-000000000000",
    role: { slug: "maintenance_manager", name: "Maintenance Manager" },
    permissions: ["work_orders.view", "work_orders.approve"],
    profile: { can_view_costs: canViewCostsFlag },
  };
}

try {
  await prisma.$transaction(async (tx) => {
    const adminRole = await tx.roles.findFirst({ where: { slug: "maintenance_manager" } });
    if (!adminRole) throw new Error("SKIP: maintenance_manager role not found");

    console.log("== 1. Manager-equivalent context: canViewCosts() tracks the flag directly ==");
    check("can_view_costs=false -> canViewCosts() is false (no costs.view permission, no override)", canViewCosts(managerContext(false)) === false);
    check("can_view_costs=true -> canViewCosts() is true (this is exactly what the toggle flips)", canViewCosts(managerContext(true)) === true);

    console.log("\n== 2. Action's own DB write, against a real disposable profile row ==");
    const profile = await tx.profiles.create({
      data: { id: randomUUID(), full_name: `${MARKER} Manager`, role_id: adminRole.id, is_active: true, can_view_costs: false },
      select: { id: true },
    });

    // Grant — mirrors updateUserCostAccessAction(can_view_costs: true).
    const granted = await tx.profiles.update({ where: { id: profile.id }, data: { can_view_costs: true }, select: { can_view_costs: true, full_name: true } });
    await tx.audit_logs.create({
      data: {
        actor_id: null,
        action: "user.cost_access_updated",
        entity_type: "profile",
        entity_id: profile.id,
        summary: `Granted cost visibility for ${granted.full_name}`,
        metadata: { can_view_costs: true },
      },
    });
    check("Task: grant sets profiles.can_view_costs = true", granted.can_view_costs === true);

    const auditRow = await tx.audit_logs.findFirst({ where: { entity_id: profile.id, action: "user.cost_access_updated" }, orderBy: { created_at: "desc" } });
    check('Audit log written with action "user.cost_access_updated"', auditRow?.action === "user.cost_access_updated");
    check("Audit log metadata records the new flag value", auditRow?.metadata?.can_view_costs === true);

    // Revoke — mirrors updateUserCostAccessAction(can_view_costs: false).
    const revoked = await tx.profiles.update({ where: { id: profile.id }, data: { can_view_costs: false }, select: { can_view_costs: true } });
    check("Task: revoke sets profiles.can_view_costs = false again", revoked.can_view_costs === false);

    console.log("\n== 3. Data Entry is unaffected — nothing here touches role_permissions or costs.view ==");
    const dataEntryRole = await tx.roles.findFirst({ where: { slug: "maintenance_data_entry" } });
    if (dataEntryRole) {
      const grants = await tx.role_permissions.findMany({ where: { role_id: dataEntryRole.id }, include: { permissions: { select: { key: true } } } });
      check("maintenance_data_entry role still has no costs.view permission (unit grants per-profile only, never role-wide)", !grants.some((g) => g.permissions?.key === "costs.view"));
    }

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
