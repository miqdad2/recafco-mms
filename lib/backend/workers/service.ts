import "server-only";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { AppError } from "@/lib/errors/app-error";
import { assertActiveUser, assertBackendPermission } from "@/lib/backend/security/guards";
import { isManagerRole } from "@/lib/security/permissions";
import { writeAuditLog } from "@/lib/audit/log";
import { emitWorkerProfileRealtimeEvent } from "@/lib/realtime/events";
import { normalizeMaterialKey } from "@/lib/materials/normalize-material";
import type { WorkerProfileInput } from "@/lib/backend/workers/validators";

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

  const created = await prisma.workerProfile.create({
    data: {
      employee_id: input.employeeId || null,
      name: input.name,
      worker_type: input.workerType,
      hourly_rate: input.hourlyRate,
      phone: input.phone || null,
      skill_category: input.skillCategory || null,
      notes: input.notes || null,
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
      metadata: { worker_type: created.worker_type, hourly_rate: input.hourlyRate },
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

  const updated = await prisma.workerProfile.update({
    where: { id },
    data: {
      employee_id: input.employeeId || null,
      name: input.name,
      worker_type: input.workerType,
      hourly_rate: input.hourlyRate,
      phone: input.phone || null,
      skill_category: input.skillCategory || null,
      notes: input.notes || null,
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
        hourly_rate_after: input.hourlyRate,
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
