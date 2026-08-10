import "server-only";

import { z } from "zod";

import { WORKER_TYPES, SKILL_CATEGORIES } from "@/lib/backend/workers/constants";

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
  hourlyRate: z.coerce.number().min(0).max(9999.999),
  phone: z.string().trim().max(50).optional(),
  skillCategory: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(500).optional(),
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
});

export type InternalTeamRosterInput = z.infer<typeof internalTeamRosterSchema>;
