import "server-only";

import { z } from "zod";

import { WORKER_TYPES, SKILL_CATEGORIES } from "@/lib/backend/workers/constants";
import { SALARY_INPUT_METHODS } from "@/lib/backend/workers/salary";

export { WORKER_TYPES, SKILL_CATEGORIES };

export const workerProfileSchema = z.object({
  id: z.string().uuid().optional(),
  // Worker Profile Form Simplification and Division Rename Unit 10G.6, Task
  // 1/7: optional at the schema level — existing worker profiles have no
  // employee_id and must keep saving/validating fine without one. Trimmed
  // here (Task 7's "trim value"); uniqueness among active workers is checked
  // in the service layer (lib/backend/workers/service.ts), same pattern as
  // the existing name+phone duplicate check.
  employeeId: z.string().trim().max(50).optional(),
  name: z.string().trim().min(2).max(150),
  workerType: z.enum(WORKER_TYPES),
  // Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B, Task
  // 2: no longer required — Data Entry's Add Worker form doesn't submit
  // this field at all any more (a Manager's own Salary Details section
  // supplies it instead). The service layer, not this schema, is what
  // actually decides whether a submitted value is trusted (Manager/Super
  // Admin only) — see assertCanManageWorkers/computeSalary in service.ts.
  hourlyRate: z.coerce.number().min(0).max(9999.999).optional(),
  phone: z.string().trim().max(50).optional(),
  skillCategory: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
  // Task 2/3 — shown on both the Data Entry and Manager forms.
  jobTitle: z.string().trim().max(150).optional(),
  workLocation: z.string().trim().max(150).optional(),
  // Task 3 — Manager/Super-Admin-only fields (enforced in service.ts).
  reportingManager: z.string().trim().max(150).optional(),
  nationality: z.string().trim().max(100).optional(),
  // Task 1/3 — salary breakdown (Manager/Super-Admin-only to set; enforced
  // in service.ts). total_salary is intentionally NOT accepted here — it is
  // always server-recomputed from these four parts (lib/backend/workers/salary.ts).
  basicSalary: z.coerce.number().min(0).max(999999.999).optional(),
  transportAllowance: z.coerce.number().min(0).max(999999.999).optional(),
  accommodationAllowance: z.coerce.number().min(0).max(999999.999).optional(),
  foodAllowance: z.coerce.number().min(0).max(999999.999).optional(),
  monthlyWorkingHours: z.coerce.number().min(1).max(999).optional(),
  // Worker Salary Cost Method and Rate Calculation Unit 10G.68, Task 1/7 —
  // Manager/Super-Admin-only to set (enforced in service.ts, same as every
  // other salary field above). yearlyCost/monthlyCost are each only
  // meaningful for their own method, but both stay simply optional here —
  // computeSalary (lib/backend/workers/salary.ts) is what decides which one
  // actually matters based on salaryInputMethod.
  salaryInputMethod: z.enum(SALARY_INPUT_METHODS).optional(),
  yearlyCost: z.coerce.number().min(0).max(9999999.999).optional(),
  monthlyCost: z.coerce.number().min(0).max(999999.999).optional(),
  monthlyWorkingDays: z.coerce.number().min(1).max(31).optional(),
  manualHourlyRateReason: z.string().trim().max(300).optional(),
  // Closure Review Work and Material Cost Unit 10G.72, Task 1/2 —
  // Manager/Super-Admin-only to set (enforced in service.ts, same as every
  // other salary field above). Deliberately not part of computeSalary()'s
  // SalaryInputs — this is a flat, one-time-per-Job-Card amount, never an
  // hourly-rate input.
  indirectCostPerJobCard: z.coerce.number().min(0).max(999999.999).optional(),
  indirectCostNote: z.string().trim().max(300).optional(),
});

export type WorkerProfileInput = z.infer<typeof workerProfileSchema>;

// Internal Team roster on a Job Card.
export const INTERNAL_ROSTER_ROLES = ["Supervisor", "Technician", "Helper/Labor"] as const;

export const internalTeamRosterSchema = z.object({
  workOrderId: z.string().uuid(),
  supervisorId: z.string().uuid().optional(),
  technicianIds: z.array(z.string().uuid()).optional().default([]),
  helperIds: z.array(z.string().uuid()).optional().default([]),
  notes: z.string().trim().max(500).optional(),
  // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 2/4:
  // optional per-worker planning estimate, keyed by worker_profiles.id (not
  // worker_assignment_id — a new assignment row's id doesn't exist yet at
  // the moment this form is submitted). Only entries whose key matches a
  // worker actually being assigned in this same submission are applied
  // (checked in assignInternalTeamRoster); a stray/stale key is silently
  // ignored, never an error.
  estimatedHoursByWorkerId: z.record(z.string().uuid(), z.number().min(0)).optional().default({}),
});

export type InternalTeamRosterInput = z.infer<typeof internalTeamRosterSchema>;
