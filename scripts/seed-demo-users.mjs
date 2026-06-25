/**
 * scripts/seed-demo-users.mjs
 *
 * Idempotent seed script for RECAFCO demo role users.
 * Creates 7 missing demo accounts used for multi-role lifecycle testing.
 *
 * Idempotency:
 *   Checks auth_users.email and profiles.employee_number before creating.
 *   Skips any account that already exists. Never updates existing rows.
 *   Conflicts between mismatched email/employee-number identifiers stop the
 *   script rather than guessing at the intended state.
 *
 * Password:
 *   Reads DEMO_USER_PASSWORD from the environment (min 12 characters).
 *   Never printed or logged. Hashed with bcrypt cost factor 12.
 *   Every created user has must_reset_password = true.
 *
 * Usage:
 *   DEMO_USER_PASSWORD=<password> npm run seed:demo-users
 */

import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { PrismaClient } from "@prisma/client";

// ── Demo user definitions (roles and departments resolved at runtime) ─────────

const DEMO_USERS = [
  {
    fullName:       "Maintenance Manager",
    email:          "maintenancemanager@recafco.local",
    roleSlug:       "maintenance_manager",
    deptCode:       "MNT",
    canViewCosts:   false,
    employeeNumber: "EMP-002",
    jobTitle:       "Maintenance Manager",
  },
  {
    fullName:       "Maintenance Supervisor",
    email:          "maintenancesupervisor@recafco.local",
    roleSlug:       "maintenance_supervisor",
    deptCode:       "MNT",
    canViewCosts:   false,
    employeeNumber: "EMP-003",
    jobTitle:       "Maintenance Supervisor",
  },
  {
    fullName:       "Technician",
    email:          "technician@recafco.local",
    roleSlug:       "technician",
    deptCode:       "MNT",
    canViewCosts:   false,
    employeeNumber: "EMP-004",
    jobTitle:       "Maintenance Technician",
  },
  {
    fullName:       "Store Keeper",
    email:          "storekeeper@recafco.local",
    roleSlug:       "store_keeper",
    deptCode:       "STR",
    canViewCosts:   false,
    employeeNumber: "EMP-005",
    jobTitle:       "Store Keeper",
  },
  {
    fullName:       "Purchase Officer",
    email:          "purchaseofficer@recafco.local",
    roleSlug:       "purchase_officer",
    deptCode:       "PUR",
    canViewCosts:   false,
    employeeNumber: "EMP-006",
    jobTitle:       "Purchase Officer",
  },
  {
    fullName:       "Finance Manager",
    email:          "financemanager@recafco.local",
    roleSlug:       "finance_manager",
    deptCode:       "FIN",
    canViewCosts:   true,
    employeeNumber: "EMP-007",
    jobTitle:       "Finance Manager",
  },
  {
    fullName:       "CEO Management",
    email:          "ceo@recafco.local",
    roleSlug:       "ceo_management",
    deptCode:       "CEO",
    canViewCosts:   true,
    employeeNumber: "EMP-008",
    jobTitle:       "Chief Executive Officer",
  },
];

const REQUIRED_ROLE_SLUGS = [...new Set(DEMO_USERS.map((u) => u.roleSlug))];
const REQUIRED_DEPT_CODES = [...new Set(DEMO_USERS.map((u) => u.deptCode))];

// ── Main ──────────────────────────────────────────────────────────────────────

const prisma = new PrismaClient({ log: [] });

try {
  // ── 1. Validate password ──────────────────────────────────────────────────
  const rawPassword = process.env.DEMO_USER_PASSWORD ?? "";
  if (!rawPassword) {
    console.error("ERROR: DEMO_USER_PASSWORD environment variable is not set.");
    console.error("  Usage: DEMO_USER_PASSWORD=<password> npm run seed:demo-users");
    process.exit(1);
  }
  if (rawPassword.length < 12) {
    console.error(
      `ERROR: DEMO_USER_PASSWORD must be at least 12 characters (got ${rawPassword.length}).`
    );
    process.exit(1);
  }

  const LINE68 = "=".repeat(68);
  const LINE_THIN = "─".repeat(68);

  console.log(LINE68);
  console.log("RECAFCO — Demo User Seed");
  console.log(LINE68);

  // ── 2. Resolve roles and departments from database ────────────────────────
  const [roleRows, deptRows] = await Promise.all([
    prisma.roles.findMany({
      where: { slug: { in: REQUIRED_ROLE_SLUGS } },
      select: { id: true, slug: true },
    }),
    prisma.departments.findMany({
      where: { code: { in: REQUIRED_DEPT_CODES }, is_active: true },
      select: { id: true, code: true },
    }),
  ]);

  const roleIdBySlug = new Map(roleRows.map((r) => [r.slug, r.id]));
  const deptIdByCode = new Map(deptRows.map((d) => [d.code, d.id]));

  // ── 3. Fail fast if any required role or department is missing ────────────
  const missingRoles = REQUIRED_ROLE_SLUGS.filter((s) => !roleIdBySlug.has(s));
  const missingDepts = REQUIRED_DEPT_CODES.filter((c) => !deptIdByCode.has(c));

  if (missingRoles.length > 0) {
    console.error("ERROR: Required roles are missing from the database:");
    for (const s of missingRoles) console.error(`  - ${s}`);
    process.exit(1);
  }
  if (missingDepts.length > 0) {
    console.error("ERROR: Required departments are missing from the database:");
    for (const c of missingDepts) console.error(`  - ${c}`);
    process.exit(1);
  }

  console.log(`Resolved ${roleRows.length} roles and ${deptRows.length} departments.\n`);

  // ── 4. Hash the shared demo password once ────────────────────────────────
  const passwordHash = await bcrypt.hash(rawPassword, 12);
  const now = new Date();

  // ── 5. Process each user ──────────────────────────────────────────────────
  const results = [];

  for (const user of DEMO_USERS) {
    const email = user.email.toLowerCase();
    const roleId = roleIdBySlug.get(user.roleSlug);
    const deptId = deptIdByCode.get(user.deptCode);

    // Guaranteed by fail-fast above; guards against future refactors.
    if (!roleId || !deptId) {
      console.error(`INTERNAL ERROR: role/dept missing unexpectedly for ${email}`);
      process.exit(1);
    }

    // Idempotency: check both identifiers independently.
    const [existingAuth, existingEmpNum] = await Promise.all([
      prisma.auth_users.findUnique({
        where: { email },
        select: { id: true, profile_id: true },
      }),
      prisma.profiles.findFirst({
        where: { employee_number: user.employeeNumber, deleted_at: null },
        select: { id: true },
      }),
    ]);

    // Conflict: both identifiers exist but point to different profiles.
    if (existingAuth && existingEmpNum && existingAuth.profile_id !== existingEmpNum.id) {
      console.error(
        `CONFLICT: email "${email}" (profile ${existingAuth.profile_id}) and` +
        ` employee_number "${user.employeeNumber}" (profile ${existingEmpNum.id})` +
        ` point to different profiles. Investigate before re-running.`
      );
      process.exit(1);
    }

    // Either identifier already identifies this demo user — skip without modification.
    if (existingAuth || existingEmpNum) {
      results.push({ email, roleSlug: user.roleSlug, deptCode: user.deptCode, result: "skipped" });
      continue;
    }

    // Neither exists — create profile, login, and audit record atomically.
    const profileId = randomUUID();

    try {
      await prisma.$transaction(async (tx) => {
        await tx.profiles.create({
          data: {
            id:              profileId,
            full_name:       user.fullName,
            employee_number: user.employeeNumber,
            job_title:       user.jobTitle,
            department_id:   deptId,
            role_id:         roleId,
            is_active:       true,
            can_view_costs:  user.canViewCosts,
          },
        });

        await tx.auth_users.create({
          data: {
            profile_id:                profileId,
            email,
            password_hash:             passwordHash,
            password_set_at:           now,
            must_reset_password:       true,
            temporary_password_set_at: now,
          },
        });

        await tx.audit_logs.create({
          data: {
            actor_id:    null,
            action:      "user.demo_seed",
            entity_type: "profile",
            entity_id:   profileId,
            summary:     `Demo seed: created ${user.fullName} with role ${user.roleSlug}`,
            metadata: {
              email,
              role_slug:           user.roleSlug,
              department_code:     user.deptCode,
              employee_number:     user.employeeNumber,
              must_reset_password: true,
              seeded_by:           "scripts/seed-demo-users.mjs",
            },
          },
        });
      });

      results.push({ email, roleSlug: user.roleSlug, deptCode: user.deptCode, result: "created" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Concurrent creation race — safe to treat as already present.
      if (
        msg.includes("P2002") ||
        msg.includes("unique constraint") ||
        msg.includes("duplicate key")
      ) {
        results.push({ email, roleSlug: user.roleSlug, deptCode: user.deptCode, result: "skipped" });
      } else {
        console.error(`\nERROR creating ${email}: ${msg}`);
        throw err;
      }
    }
  }

  // ── 6. Results table ──────────────────────────────────────────────────────
  console.log(LINE_THIN);
  console.log(
    "  " +
    "Email".padEnd(42) +
    "Role".padEnd(24) +
    "Dept".padEnd(6) +
    "Result"
  );
  console.log(LINE_THIN);

  for (const r of results) {
    const icon = r.result === "created" ? "✓" : "~";
    console.log(
      `${icon} ` +
      r.email.padEnd(41) +
      r.roleSlug.padEnd(24) +
      r.deptCode.padEnd(6) +
      r.result
    );
  }

  console.log(LINE_THIN);

  const created = results.filter((r) => r.result === "created").length;
  const skipped = results.filter((r) => r.result === "skipped").length;

  console.log(`\nSummary: ${created} created, ${skipped} skipped.`);

  if (created > 0) {
    console.log("\nAll created users have must_reset_password = true.");
    console.log("Each user must change their password on first login.");
  }

  console.log(LINE68);
} finally {
  await prisma.$disconnect();
}
