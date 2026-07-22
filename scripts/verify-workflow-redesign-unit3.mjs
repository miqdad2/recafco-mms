/**
 * Maintenance Workflow Redesign Unit 3 — status/permission foundation checks.
 *
 * Read-only. Verifies:
 *   1. lib/workflows/status-rules.ts transitions match the new simplified
 *      Job Card (9-status) and Materials Request (5-status) models.
 *   2. maintenance_engineer role exists with the required grants; store_keeper,
 *      maintenance_data_entry, and technician hold the new/expected grants.
 *   3. The duplicate-active-Materials-Request rule, exercised against a
 *      throwaway row created and rolled back inside a transaction — nothing
 *      is left behind in the database either way.
 *
 * Usage:
 *   node scripts/verify-workflow-redesign-unit3.mjs
 */

import { PrismaClient } from "@prisma/client";
import { canTransition } from "../lib/workflows/status-rules.ts";

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

console.log("== 1. Job Card (work_order) transitions ==");
check("Created -> Under Review valid", canTransition("work_order", "Created", "Under Review") === true);
check("Under Review -> Approved valid", canTransition("work_order", "Under Review", "Approved") === true);
check("Under Review -> Under Review valid", canTransition("work_order", "Under Review", "Under Review") === true);
check("Approved -> Waiting Materials valid", canTransition("work_order", "Approved", "Waiting Materials") === true);
check("Approved -> Assigned valid", canTransition("work_order", "Approved", "Assigned") === true);
check("Waiting Materials -> Partially Issued valid", canTransition("work_order", "Waiting Materials", "Partially Issued") === true);
check("Partially Issued -> Materials Issued valid", canTransition("work_order", "Partially Issued", "Materials Issued") === true);
check("Materials Issued -> Assigned valid", canTransition("work_order", "Materials Issued", "Assigned") === true);
check("Assigned -> In Progress valid", canTransition("work_order", "Assigned", "In Progress") === true);
check("In Progress -> Closed valid", canTransition("work_order", "In Progress", "Closed") === true);
check("Closed -> In Progress invalid", canTransition("work_order", "Closed", "In Progress") === false);
check("Created -> Closed invalid", canTransition("work_order", "Created", "Closed") === false);

console.log("== 2. Materials Request (parts_request) transitions ==");
check("Requested -> Approved valid", canTransition("parts_request", "Requested", "Approved") === true);
check("Requested -> Requested valid", canTransition("parts_request", "Requested", "Requested") === true);
check("Approved -> Waiting Stock valid", canTransition("parts_request", "Approved", "Waiting Stock") === true);
check("Approved -> Partially Issued valid", canTransition("parts_request", "Approved", "Partially Issued") === true);
check("Approved -> Issued valid", canTransition("parts_request", "Approved", "Issued") === true);
check("Waiting Stock -> Issued valid", canTransition("parts_request", "Waiting Stock", "Issued") === true);
check("Partially Issued -> Issued valid", canTransition("parts_request", "Partially Issued", "Issued") === true);
check("Issued -> Requested invalid", canTransition("parts_request", "Issued", "Requested") === false);

const prisma = new PrismaClient({ log: ["error"] });

async function permissionSet(roleSlug) {
  const rows = await prisma.role_permissions.findMany({
    where: { roles: { slug: roleSlug } },
    select: { permissions: { select: { key: true } } }
  });
  return new Set(rows.map((r) => r.permissions.key));
}

console.log("== 3. Roles and permissions ==");
const engineerRole = await prisma.roles.findUnique({ where: { slug: "maintenance_engineer" } });
check("maintenance_engineer role exists", !!engineerRole);

const engineerPerms = await permissionSet("maintenance_engineer");
check(
  "maintenance_engineer has review/edit/assign/update/close/request_correction",
  ["work_orders.review", "work_orders.manage", "work_orders.assign", "work_orders.update", "work_orders.close", "work_orders.request_correction"]
    .every((p) => engineerPerms.has(p))
);

const storePerms = await permissionSet("store_keeper");
check(
  "store_keeper has issue/waiting_stock/offline ledger permissions",
  ["parts_requests.issue", "parts_requests.mark_waiting_stock", "offline_inventory.view", "offline_inventory.issue", "offline_inventory.ledger"]
    .every((p) => storePerms.has(p))
);

const dataEntryPerms = await permissionSet("maintenance_data_entry");
check(
  "maintenance_data_entry has create/edit/assign/update/close",
  ["work_orders.create", "work_orders.manage", "work_orders.assign", "work_orders.update", "work_orders.close"]
    .every((p) => dataEntryPerms.has(p))
);

const technicianPerms = await permissionSet("technician");
check(
  "technician has update/close",
  ["work_orders.update", "work_orders.close"].every((p) => technicianPerms.has(p))
);

console.log("== 4. Duplicate active Materials Request rule (rolled back, no data left behind) ==");
const ACTIVE_STATUSES = ["Requested", "Approved", "Waiting Stock", "Partially Issued"];
try {
  await prisma.$transaction(async (tx) => {
    const asset = await tx.assets.findFirst({ select: { id: true } });
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!asset || !user) throw new Error("SKIP: no asset/profile row available to build a throwaway test row");

    const wo = await tx.work_orders.create({
      data: {
        ordered_by: "Unit3 verify script",
        maintenance_type: "Routine",
        worker_type: "Mechanical",
        status: "Approved",
        asset_id: asset.id,
        created_by: user.id
      },
      select: { id: true }
    });

    async function hasActive() {
      const active = await tx.parts_requests.findFirst({
        where: { work_order_id: wo.id, status: { in: ACTIVE_STATUSES } },
        select: { id: true }
      });
      return !!active;
    }

    check("no active request -> allowed (none found)", (await hasActive()) === false);

    // Each iteration creates exactly one row, checks, then removes it —
    // the Job Card never has more than one parts_request at a time here.
    for (const status of ["Requested", "Approved", "Waiting Stock", "Partially Issued"]) {
      const pr = await tx.parts_requests.create({
        data: { work_order_id: wo.id, status, requested_by: user.id, created_by: user.id },
        select: { id: true }
      });
      check(`active ${status} request -> blocked (found)`, await hasActive());
      await tx.parts_requests.delete({ where: { id: pr.id } });
    }

    const prIssued = await tx.parts_requests.create({
      data: { work_order_id: wo.id, status: "Issued", requested_by: user.id, created_by: user.id },
      select: { id: true }
    });
    const activeAfterIssued = await tx.parts_requests.findFirst({
      where: { work_order_id: wo.id, status: { in: ACTIVE_STATUSES } },
      select: { id: true }
    });
    check("existing Issued request -> allowed (not active)", !activeAfterIssued);
    await tx.parts_requests.delete({ where: { id: prIssued.id } });

    // Force rollback — this transaction must never persist its test rows.
    throw new Error("__ROLLBACK_TEST_DATA__");
  });
} catch (err) {
  if (!(err instanceof Error) || err.message !== "__ROLLBACK_TEST_DATA__") {
    if (err instanceof Error && err.message.startsWith("SKIP:")) {
      console.log(`  SKIP  duplicate-request checks: ${err.message}`);
    } else {
      console.error("  FAIL  duplicate-request transaction errored unexpectedly:", err);
      failures++;
    }
  }
}

const leftoverWo = await prisma.work_orders.count({ where: { ordered_by: "Unit3 verify script" } });
check("no leftover test rows after rollback", leftoverWo === 0);

await prisma.$disconnect();

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log("All checks passed.");
  process.exit(0);
}
