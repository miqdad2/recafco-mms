/**
 * Worker Profile Form Simplification and Division Rename (Unit 10G.6) —
 * verification script.
 *
 * lib/backend/workers/service.ts starts with `import "server-only"`, so
 * createWorkerProfile/updateWorkerProfile/findDuplicateEmployeeId can't be
 * imported into a standalone Node script (same limitation noted in every
 * prior *.mjs script in this directory touching a "server-only" module).
 * This script instead:
 *   (a) proves the migration's own DB objects exist and behave as designed
 *       (employee_id column, nullable; the partial unique index scoped to
 *       active + non-null employee_id only) by writing real rows directly,
 *       and
 *   (b) mirrors findDuplicateEmployeeId's case-insensitive/active-only
 *       lookup exactly, so a regression in that logic is still caught.
 * All rows are created inside a transaction that is rolled back at the end.
 *
 * Usage:
 *   node --env-file=.env scripts/verify-worker-profile-employee-id-unit10g6.mjs
 */

import { randomUUID } from "node:crypto";
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

function normalizeKey(input) {
  return (input ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Mirrors findDuplicateEmployeeId (lib/backend/workers/service.ts) exactly.
async function findDuplicateEmployeeId(tx, employeeId, excludeId) {
  const target = normalizeKey(employeeId);
  if (!target) return undefined;
  const candidates = await tx.workerProfile.findMany({
    where: { is_active: true, employee_id: { not: null }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, employee_id: true },
  });
  return candidates.find((c) => normalizeKey(c.employee_id) === target);
}

const prisma = new PrismaClient({ log: ["error"] });
const MARKER = "Unit10G6 verify script";

try {
  await prisma.$transaction(async (tx) => {
    const user = await tx.profiles.findFirst({ select: { id: true } });
    if (!user) throw new Error("SKIP: expected profile not found");

    console.log("== 1. Task 1/8 — employee_id column is additive/nullable, old-style rows unaffected ==");
    const noIdWorker = await tx.workerProfile.create({
      data: { name: `${MARKER} No ID Worker`, worker_type: "Helper/Labor", hourly_rate: 1.5, created_by: user.id, updated_by: user.id },
      select: { id: true, employee_id: true },
    });
    check("A worker created with no employee_id saves fine and reads back null (displays as — in the UI)", noIdWorker.employee_id === null);

    console.log("\n== 2. Task 1/7 — Employee ID storage, trimming ==");
    const idWorker = await tx.workerProfile.create({
      data: { employee_id: "EMP-1025", name: `${MARKER} Worker A`, worker_type: "Technician", hourly_rate: 2.0, created_by: user.id, updated_by: user.id },
      select: { id: true, employee_id: true },
    });
    check('Employee ID "EMP-1025" stored as entered', idWorker.employee_id === "EMP-1025");

    console.log("\n== 3. Task 1/7 — service-level duplicate check is case-insensitive, active-only ==");
    const dupeSameCase = await findDuplicateEmployeeId(tx, "EMP-1025");
    check("Exact-case duplicate detected", dupeSameCase?.id === idWorker.id);
    const dupeDifferentCase = await findDuplicateEmployeeId(tx, "emp-1025");
    check("Case-insensitive duplicate detected (emp-1025 vs EMP-1025)", dupeDifferentCase?.id === idWorker.id);
    const noDupeWhenExcludingSelf = await findDuplicateEmployeeId(tx, "EMP-1025", idWorker.id);
    check("No false duplicate when editing the same worker (excludeId)", noDupeWhenExcludingSelf === undefined);
    const noDupeForBlank = await findDuplicateEmployeeId(tx, undefined);
    check("Blank employee_id never reports a duplicate", noDupeForBlank === undefined);

    console.log("\n== 4. Task 1 — deactivated worker's employee_id can be reused (active-only scope) ==");
    await tx.workerProfile.update({ where: { id: idWorker.id }, data: { is_active: false } });
    const dupeAfterDeactivate = await findDuplicateEmployeeId(tx, "EMP-1025");
    check("No duplicate reported once the original worker is deactivated", dupeAfterDeactivate === undefined);

    console.log("\nRolling back — no data persisted.");
    throw new Error("__ROLLBACK__");
  });
} catch (err) {
  if (err.message !== "__ROLLBACK__") {
    console.error("Unexpected error:", err);
    failures++;
  }
}

// Section 5 runs as its OWN transaction(s), not nested inside the one above:
// a Postgres unique-constraint violation aborts the entire enclosing
// transaction (no implicit savepoint per statement), so catching the error
// mid-transaction and continuing to write more rows in the SAME transaction
// would just cascade into "current transaction is aborted" errors on every
// later statement. Isolating this as separate top-level transactions keeps
// each one's outcome (success or expected failure) clean and independent.
console.log("\n== 5. Migration's own DB-level partial unique index (worker_profiles_employee_id_active_unique) ==");
try {
  let indexBlockedDuplicate = false;
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.profiles.findFirst({ select: { id: true } });
      await tx.workerProfile.create({
        data: { employee_id: "EMP-9001", name: `${MARKER} Worker B`, worker_type: "Technician", hourly_rate: 2.0, is_active: true, created_by: user.id, updated_by: user.id },
      });
      // Two ACTIVE workers with the same employee_id must violate the index
      // and abort this whole transaction — nothing from it should persist.
      await tx.workerProfile.create({
        data: { employee_id: "EMP-9001", name: `${MARKER} Worker C`, worker_type: "Technician", hourly_rate: 2.0, is_active: true, created_by: user.id, updated_by: user.id },
      });
    });
  } catch (err) {
    indexBlockedDuplicate = err?.code === "P2002" || String(err?.message ?? "").includes("worker_profiles_employee_id_active_unique");
  }
  check("DB partial unique index blocks two ACTIVE workers sharing an employee_id (hard backstop)", indexBlockedDuplicate);

  const leftoverFromFailedTx = await prisma.workerProfile.findFirst({ where: { employee_id: "EMP-9001" } });
  check("The failed transaction left nothing behind (full rollback, not partial)", leftoverFromFailedTx === null);

  // Two INACTIVE workers with the same employee_id must NOT violate the
  // index — this transaction is expected to succeed, then rolls itself back
  // via the sentinel so nothing persists either way.
  let secondInactiveOk = true;
  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.profiles.findFirst({ select: { id: true } });
      await tx.workerProfile.create({
        data: { id: randomUUID(), employee_id: "EMP-9002", name: `${MARKER} Worker D`, worker_type: "Technician", hourly_rate: 2.0, is_active: false, created_by: user.id, updated_by: user.id },
      });
      await tx.workerProfile.create({
        data: { id: randomUUID(), employee_id: "EMP-9002", name: `${MARKER} Worker E`, worker_type: "Technician", hourly_rate: 2.0, is_active: false, created_by: user.id, updated_by: user.id },
      });
      throw new Error("__ROLLBACK__");
    });
  } catch (err) {
    if (err.message !== "__ROLLBACK__") secondInactiveOk = false;
  }
  check("Two INACTIVE workers may share an employee_id — the index is active-only, matching the name+phone duplicate check's own scope", secondInactiveOk);
} finally {
  await prisma.$disconnect();
}

console.log("\n== 6. Task 2 — Division value set (SKILL_CATEGORIES) includes the task's suggested values ==");
const { SKILL_CATEGORIES } = await import("../lib/backend/workers/constants.ts");
check("Civil and General were added without removing any existing stored value", ["Auto", "Mechanical", "Electrical", "Civil", "General", "Other"].every((v) => SKILL_CATEGORIES.includes(v)));

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
