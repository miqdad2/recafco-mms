import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors/app-error";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import { isManagerRole } from "@/lib/security/permissions";
import { writeAuditLog } from "@/lib/audit/log";
import { emitWorkerProfileRealtimeEvent } from "@/lib/realtime/events";
import { normalizeMaterialKey } from "@/lib/materials/normalize-material";
import { computeSalary, noSalary, isSalaryPending, DEFAULT_MONTHLY_WORKING_DAYS } from "@/lib/backend/workers/salary";
import type { WorkerProfileInput } from "@/lib/backend/workers/validators";

export { isSalaryPending };

// Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B, Task
// 10: `WorkerProfileRow[]` is handed wholesale (as server-rendered props)
// to client components that then decide what to render per role — the
// existing, already-accepted pattern this codebase uses for hourly_rate
// (Unit 10F.4's own column-hiding, not payload-stripping). A full salary
// breakdown is materially more sensitive than one rate number, so pages
// that hand a worker list straight to a Data-Entry-reachable client
// component (Worker Profiles, Worker Activity) call this first — it zeroes
// every salary field out of the actual payload for non-Managers, rather
// than only hiding them client-side. hourly_rate itself is left untouched,
// matching the existing canViewCosts convention ("cost visibility still
// respects canViewCosts where the app already uses it").
//
// Worker Profile Data Entry Contact Fields and Manager Salary Only Unit
// 10G.41D, Task 1/3: reporting_manager/nationality are no longer stripped
// here — the business rule changed from "Manager-only to see" to "normal,
// non-sensitive HR/contact fields Data Entry can enter and later view on
// their own created worker" (see createWorkerProfile below). Only actual
// pay-related fields stay stripped.
export function stripSalaryForNonManager(w: WorkerProfileRow, canManage: boolean): WorkerProfileRow {
  if (canManage) return w;
  return {
    ...w,
    basic_salary: 0,
    transport_allowance: 0,
    accommodation_allowance: 0,
    food_allowance: 0,
    total_salary: 0,
    monthly_working_hours: 0,
    // Worker Salary Cost Method and Rate Calculation Unit 10G.68, Task 10 —
    // the same zero-out treatment for the new cost-method fields; none of
    // these ever reach a non-Manager's raw page payload.
    salary_input_method: null,
    yearly_cost: null,
    monthly_cost: null,
    monthly_working_days: 0,
    manual_hourly_rate_reason: null,
    // Closure Review Work and Material Cost Unit 10G.72, Task 2/9 — same
    // zero-out treatment: indirect cost is a cost-sensitive field, so it
    // never reaches a non-Manager's raw page payload either.
    indirect_cost_per_job_card: 0,
    indirect_cost_note: null,
  };
}

// Work Assignment and Worker Profiles Foundation Unit 7, Task 2/6.
//
// Reuses work_orders.assign (already granted to Data Entry, Maintenance
// Engineer, Manager, and super_admin — see
// prisma/migrations/20260720130100_workflow_redesign_unit3_roles_permissions)
// as the gate for worker-profile management instead of adding a new
// permission — worker profiles only exist to serve Job Card assignment, so
// the audience is identical and a dedicated permission would be one more
// row to seed and grant for no behavioral difference ("keep it simple").
function assertCanManageWorkers(context: CurrentUserContext) {
  assertActiveUser(context);
  assertBackendPermission(context, "work_orders.assign");
}

// Worker Rate Visibility and Data Entry Lockdown Unit 10F.4, Task 4: Data
// Entry can still create a worker profile (assertCanManageWorkers above,
// unchanged — createWorkerProfile keeps using it), but editing an EXISTING
// profile (name/type/rate/etc.) or deactivating/reactivating one is now
// Manager/Super Admin only. Hiding the Edit/Deactivate buttons in the UI
// (components/admin/worker-profiles-view.tsx) is not enough on its own — a
// Data Entry user could otherwise still reach updateWorkerProfile/
// setWorkerProfileActive with a hand-built form submission (saveWorkerProfileAction
// happily accepted a hidden `id` field before this unit). This is enforced
// here, not in app/actions/workers.ts, matching this file's existing
// pattern (the action layer is thin; the service layer is the real gate —
// same shape as editWorkSession/cancelWorkSession's assertIsManager in
// lib/backend/work-orders/work-sessions.ts).
//
// Worker Profile Data Entry Contact Fields and Manager Salary Only Unit
// 10G.41D, Task 4: kept exactly as-is — the design remains "Data Entry can
// create, but never edit an existing profile," including its own newly
// non-sensitive fields (Nationality, Reporting Manager) and Status/
// activation. If a Data Entry user needs a correction after creation, a
// Manager makes it (worker-profiles-view.tsx's Edit button, still gated by
// isManagerRole below); Data Entry instead gets a read-only "View" action
// on their own created worker (see the `readOnly` prop on
// WorkerProfileFormModal) so they can still see what they entered.
function assertCanEditWorkerProfile(context: CurrentUserContext) {
  assertActiveUser(context);
  if (!isManagerRole(context)) {
    throw new AppError("Only a Manager can edit or deactivate a worker profile.", { code: "FORBIDDEN" });
  }
}

export type WorkerProfileRow = {
  id: string;
  employee_id: string | null;
  name: string;
  worker_type: string;
  hourly_rate: number;
  phone: string | null;
  skill_category: string | null;
  is_active: boolean;
  notes: string | null;
  // Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B, Task
  // 1/3: job_title/work_location are shown to every role that can see a
  // worker profile at all; reporting_manager/nationality and every salary
  // field below are Manager/Super-Admin-only display fields — callers
  // (worker-profiles-view.tsx, worker-profile-form-modal.tsx) still receive
  // them on every row (this is a trusted, server-only module), but must
  // gate rendering behind isManagerRole/canManageWorkerProfiles themselves,
  // the same way canViewCosts already gates hourly_rate today.
  job_title: string | null;
  work_location: string | null;
  reporting_manager: string | null;
  nationality: string | null;
  basic_salary: number;
  transport_allowance: number;
  accommodation_allowance: number;
  food_allowance: number;
  total_salary: number;
  monthly_working_hours: number;
  // Worker Salary Cost Method and Rate Calculation Unit 10G.68, Task 7 —
  // additive; same Manager/Super-Admin-only display rule as every other
  // salary field above (stripped for non-Managers by stripSalaryForNonManager).
  salary_input_method: string | null;
  yearly_cost: number | null;
  monthly_cost: number | null;
  monthly_working_days: number;
  manual_hourly_rate_reason: string | null;
  // Closure Review Work and Material Cost Unit 10G.72, Task 1 — additive;
  // same Manager/Super-Admin-only display rule as every other salary field
  // above (stripped for non-Managers by stripSalaryForNonManager).
  indirect_cost_per_job_card: number;
  indirect_cost_note: string | null;
  created_at: string;
  updated_at: string;
};

function toRow(w: {
  id: string;
  employee_id: string | null;
  name: string;
  worker_type: string;
  hourly_rate: unknown;
  phone: string | null;
  skill_category: string | null;
  is_active: boolean;
  notes: string | null;
  job_title: string | null;
  work_location: string | null;
  reporting_manager: string | null;
  nationality: string | null;
  basic_salary: unknown;
  transport_allowance: unknown;
  accommodation_allowance: unknown;
  food_allowance: unknown;
  total_salary: unknown;
  monthly_working_hours: unknown;
  salary_input_method: string | null;
  yearly_cost: unknown;
  monthly_cost: unknown;
  monthly_working_days: unknown;
  manual_hourly_rate_reason: string | null;
  indirect_cost_per_job_card: unknown;
  indirect_cost_note: string | null;
  created_at: Date;
  updated_at: Date;
}): WorkerProfileRow {
  return {
    id: w.id,
    employee_id: w.employee_id,
    name: w.name,
    worker_type: w.worker_type,
    hourly_rate: Number(w.hourly_rate),
    phone: w.phone,
    skill_category: w.skill_category,
    is_active: w.is_active,
    notes: w.notes,
    job_title: w.job_title,
    work_location: w.work_location,
    reporting_manager: w.reporting_manager,
    nationality: w.nationality,
    basic_salary: Number(w.basic_salary),
    transport_allowance: Number(w.transport_allowance),
    accommodation_allowance: Number(w.accommodation_allowance),
    food_allowance: Number(w.food_allowance),
    total_salary: Number(w.total_salary),
    monthly_working_hours: Number(w.monthly_working_hours),
    salary_input_method: w.salary_input_method,
    yearly_cost: w.yearly_cost === null || w.yearly_cost === undefined ? null : Number(w.yearly_cost),
    monthly_cost: w.monthly_cost === null || w.monthly_cost === undefined ? null : Number(w.monthly_cost),
    monthly_working_days: w.monthly_working_days ? Number(w.monthly_working_days) : DEFAULT_MONTHLY_WORKING_DAYS,
    manual_hourly_rate_reason: w.manual_hourly_rate_reason,
    indirect_cost_per_job_card: w.indirect_cost_per_job_card === null || w.indirect_cost_per_job_card === undefined ? 0 : Number(w.indirect_cost_per_job_card),
    indirect_cost_note: w.indirect_cost_note,
    created_at: w.created_at.toISOString(),
    updated_at: w.updated_at.toISOString(),
  };
}

export async function listWorkerProfiles(opts?: {
  search?: string;
  workerType?: string;
  activeOnly?: boolean;
}): Promise<WorkerProfileRow[]> {
  const search = opts?.search?.trim();
  const rows = await prisma.workerProfile.findMany({
    where: {
      ...(opts?.activeOnly ? { is_active: true } : {}),
      ...(opts?.workerType ? { worker_type: opts.workerType } : {}),
      ...(search
        ? {
            // Worker Profile Form Simplification and Division Rename Unit
            // 10G.6, Task 6: search also matches Employee ID and Division
            // (skill_category) — name/phone matching is unchanged.
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { phone: { contains: search, mode: "insensitive" } },
              { employee_id: { contains: search, mode: "insensitive" } },
              { skill_category: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ is_active: "desc" }, { name: "asc" }],
    take: 500,
  });
  return rows.map(toRow);
}

// Used by the Job Card Internal Team roster picker — always active-only,
// grouped by worker_type on the client.
export async function getActiveWorkerProfilesForAssignment(): Promise<WorkerProfileRow[]> {
  return listWorkerProfiles({ activeOnly: true });
}

// Task 3: "Prevent duplicate active worker with same normalized name and
// phone if possible." Only checked against currently-active workers — a
// deactivated worker's name can be reused for a genuinely new hire without
// being blocked. Phone is optional: two workers with the same normalized
// name and no phone recorded on either side are still treated as a likely
// duplicate; if either has a phone, both must match for it to count.
async function findDuplicateActiveWorker(name: string, phone: string | undefined, excludeId?: string) {
  const targetName = normalizeMaterialKey(name);
  const targetPhone = normalizeMaterialKey(phone);

  const candidates = await prisma.workerProfile.findMany({
    where: { is_active: true, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, phone: true },
  });

  return candidates.find((c) => {
    if (normalizeMaterialKey(c.name) !== targetName) return false;
    const cPhone = normalizeMaterialKey(c.phone);
    if (!targetPhone && !cPhone) return true;
    return targetPhone === cPhone;
  });
}

// Worker Profile Form Simplification and Division Rename Unit 10G.6, Task
// 1/7: mirrors findDuplicateActiveWorker's own "active workers only" scope
// exactly — a deactivated worker's employee_id can be reused by a genuine
// replacement hire. Case-insensitive (normalizeMaterialKey), so "EMP-1025"
// and "emp-1025" are treated as the same ID. This is the clean, actionable
// error path; the migration's partial unique index
// (worker_profiles_employee_id_active_unique) is the hard backstop against
// a race between two concurrent creates.
async function findDuplicateEmployeeId(employeeId: string | undefined, excludeId?: string) {
  const target = normalizeMaterialKey(employeeId);
  if (!target) return undefined;

  const candidates = await prisma.workerProfile.findMany({
    where: { is_active: true, employee_id: { not: null }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, name: true, employee_id: true },
  });

  return candidates.find((c) => normalizeMaterialKey(c.employee_id) === target);
}

export async function createWorkerProfile(context: CurrentUserContext, input: WorkerProfileInput) {
  assertCanManageWorkers(context);

  const dupe = await findDuplicateActiveWorker(input.name, input.phone);
  if (dupe) {
    throw new AppError(
      `An active worker named "${dupe.name}" already exists. Use that profile instead, or change the name/phone to tell them apart.`,
      { code: "VALIDATION_ERROR" }
    );
  }
  const dupeEmployeeId = await findDuplicateEmployeeId(input.employeeId);
  if (dupeEmployeeId) {
    throw new AppError(
      `Employee ID "${dupeEmployeeId.employee_id}" is already used by active worker "${dupeEmployeeId.name}". Use a different Employee ID.`,
      { code: "VALIDATION_ERROR" }
    );
  }

  // Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B, Task
  // 2/3/10 (business rule updated by Unit 10G.41D, Task 1/10): Data Entry
  // can still create a worker profile (assertCanManageWorkers above,
  // unchanged), and — as of 10G.41D — can enter every normal HR/contact
  // field, including Nationality and Reporting Manager (no longer
  // Manager-only; they're not pay-related). Only the actual salary fields
  // remain Manager/Super-Admin-only to SET, checked here server-side so a
  // hand-built form submission from a Data Entry session can never sneak a
  // non-zero salary/hourly rate in, even though create itself stays open to
  // them.
  const canSetSalary = isManagerRole(context);
  const salary = canSetSalary
    ? computeSalary({
        salaryInputMethod: input.salaryInputMethod,
        yearlyCost: input.yearlyCost,
        monthlyCost: input.monthlyCost,
        basicSalary: input.basicSalary,
        transportAllowance: input.transportAllowance,
        accommodationAllowance: input.accommodationAllowance,
        foodAllowance: input.foodAllowance,
        monthlyWorkingDays: input.monthlyWorkingDays,
        monthlyWorkingHours: input.monthlyWorkingHours,
        hourlyRate: input.hourlyRate,
        manualHourlyRateReason: input.manualHourlyRateReason,
      })
    : noSalary();

  // Closure Review Work and Material Cost Unit 10G.72, Task 1/2 — same
  // canSetSalary boundary as every other salary field above: Data Entry's
  // create path always gets the defaults (0 / null), regardless of what a
  // hand-built form submission tries to send.
  const indirectCostPerJobCard = canSetSalary ? (input.indirectCostPerJobCard ?? 0) : 0;
  const indirectCostNote = canSetSalary ? (input.indirectCostNote || null) : null;

  const created = await prisma.workerProfile.create({
    data: {
      employee_id: input.employeeId || null,
      name: input.name,
      worker_type: input.workerType,
      hourly_rate: salary.hourlyRate,
      phone: input.phone || null,
      skill_category: input.skillCategory || null,
      notes: input.notes || null,
      job_title: input.jobTitle || null,
      work_location: input.workLocation || null,
      // Task 1/10 — normal, non-sensitive HR/contact fields; accepted from
      // whoever is allowed to create at all (Data Entry included).
      reporting_manager: input.reportingManager || null,
      nationality: input.nationality || null,
      basic_salary: salary.basicSalary,
      transport_allowance: salary.transportAllowance,
      accommodation_allowance: salary.accommodationAllowance,
      food_allowance: salary.foodAllowance,
      total_salary: salary.totalSalary,
      monthly_working_hours: salary.monthlyWorkingHours,
      salary_input_method: salary.salaryInputMethod,
      yearly_cost: salary.yearlyCost,
      monthly_cost: salary.monthlyCost,
      monthly_working_days: salary.monthlyWorkingDays,
      manual_hourly_rate_reason: salary.manualHourlyRateReason,
      indirect_cost_per_job_card: indirectCostPerJobCard,
      indirect_cost_note: indirectCostNote,
      created_by: context.userId,
      updated_by: context.userId,
    },
  });

  await Promise.all([
    writeAuditLog({
      actorId: context.userId,
      action: "worker_profile.create",
      entityType: "worker_profile",
      entityId: created.id,
      summary: `Created worker profile "${created.name}" (${created.worker_type})`,
      metadata: { worker_type: created.worker_type, hourly_rate: salary.hourlyRate, salary_set: canSetSalary },
    }),
    emitWorkerProfileRealtimeEvent(created.id, context.userId),
  ]);

  return toRow(created);
}

export async function updateWorkerProfile(context: CurrentUserContext, id: string, input: WorkerProfileInput) {
  assertCanEditWorkerProfile(context);

  const existing = await prisma.workerProfile.findUnique({ where: { id } });
  if (!existing) throw new AppError("Worker profile not found.", { code: "NOT_FOUND" });

  const dupe = await findDuplicateActiveWorker(input.name, input.phone, id);
  if (dupe) {
    throw new AppError(
      `An active worker named "${dupe.name}" already exists. Use that profile instead, or change the name/phone to tell them apart.`,
      { code: "VALIDATION_ERROR" }
    );
  }
  const dupeEmployeeId = await findDuplicateEmployeeId(input.employeeId, id);
  if (dupeEmployeeId) {
    throw new AppError(
      `Employee ID "${dupeEmployeeId.employee_id}" is already used by active worker "${dupeEmployeeId.name}". Use a different Employee ID.`,
      { code: "VALIDATION_ERROR" }
    );
  }

  // updateWorkerProfile is already Manager/Super-Admin-only end to end
  // (assertCanEditWorkerProfile above throws otherwise), so salary/
  // reporting_manager/nationality are always trusted here — unlike create,
  // there is no Data-Entry-reachable path into this function at all.
  const salary = computeSalary({
    salaryInputMethod: input.salaryInputMethod,
    yearlyCost: input.yearlyCost,
    monthlyCost: input.monthlyCost,
    basicSalary: input.basicSalary,
    transportAllowance: input.transportAllowance,
    accommodationAllowance: input.accommodationAllowance,
    foodAllowance: input.foodAllowance,
    monthlyWorkingDays: input.monthlyWorkingDays,
    monthlyWorkingHours: input.monthlyWorkingHours,
    hourlyRate: input.hourlyRate,
    manualHourlyRateReason: input.manualHourlyRateReason,
  });

  const updated = await prisma.workerProfile.update({
    where: { id },
    data: {
      employee_id: input.employeeId || null,
      name: input.name,
      worker_type: input.workerType,
      hourly_rate: salary.hourlyRate,
      phone: input.phone || null,
      skill_category: input.skillCategory || null,
      notes: input.notes || null,
      job_title: input.jobTitle || null,
      work_location: input.workLocation || null,
      reporting_manager: input.reportingManager || null,
      nationality: input.nationality || null,
      basic_salary: salary.basicSalary,
      transport_allowance: salary.transportAllowance,
      accommodation_allowance: salary.accommodationAllowance,
      food_allowance: salary.foodAllowance,
      total_salary: salary.totalSalary,
      monthly_working_hours: salary.monthlyWorkingHours,
      salary_input_method: salary.salaryInputMethod,
      yearly_cost: salary.yearlyCost,
      monthly_cost: salary.monthlyCost,
      monthly_working_days: salary.monthlyWorkingDays,
      manual_hourly_rate_reason: salary.manualHourlyRateReason,
      // updateWorkerProfile is already Manager/Super-Admin-only end to end
      // (assertCanEditWorkerProfile above), so this is always trusted here,
      // same as every other salary field in this call.
      indirect_cost_per_job_card: input.indirectCostPerJobCard ?? 0,
      indirect_cost_note: input.indirectCostNote || null,
      updated_by: context.userId,
    },
  });

  await Promise.all([
    writeAuditLog({
      actorId: context.userId,
      action: "worker_profile.update",
      entityType: "worker_profile",
      entityId: updated.id,
      summary: `Updated worker profile "${updated.name}"`,
      metadata: {
        worker_type: updated.worker_type,
        hourly_rate_before: Number(existing.hourly_rate),
        hourly_rate_after: salary.hourlyRate,
      },
    }),
    emitWorkerProfileRealtimeEvent(updated.id, context.userId),
  ]);

  return toRow(updated);
}

export async function setWorkerProfileActive(context: CurrentUserContext, id: string, isActive: boolean) {
  assertCanEditWorkerProfile(context);

  const existing = await prisma.workerProfile.findUnique({ where: { id } });
  if (!existing) throw new AppError("Worker profile not found.", { code: "NOT_FOUND" });
  if (existing.is_active === isActive) return toRow(existing);

  const updated = await prisma.workerProfile.update({
    where: { id },
    data: { is_active: isActive, updated_by: context.userId },
  });

  await Promise.all([
    writeAuditLog({
      actorId: context.userId,
      action: isActive ? "worker_profile.activate" : "worker_profile.deactivate",
      entityType: "worker_profile",
      entityId: updated.id,
      summary: `${isActive ? "Reactivated" : "Deactivated"} worker profile "${updated.name}"`,
    }),
    emitWorkerProfileRealtimeEvent(updated.id, context.userId),
  ]);

  return toRow(updated);
}
