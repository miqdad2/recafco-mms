import "server-only";

import { z } from "zod";

export const workOrderIdSchema = z.string().uuid();

export const workflowCommentSchema = z.string().trim().max(1000).optional();

// "OTHER" added Unit 4 for free-text assignee/company that doesn't fit
// FREELANCER/EXTERNAL_COMPANY — safe to add since assignment_type has no DB
// CHECK constraint, only this app-layer union.
export const ASSIGNMENT_TYPES = ["INTERNAL_TECHNICIAN", "FREELANCER", "EXTERNAL_COMPANY", "OTHER"] as const;
export type AssignmentType = (typeof ASSIGNMENT_TYPES)[number];

export const technicianAssignmentSchema = z.object({
  workOrderId: workOrderIdSchema,
  assignmentType: z.enum(ASSIGNMENT_TYPES).default("INTERNAL_TECHNICIAN"),
  technicianIds: z.array(workOrderIdSchema).optional().default([]),
  externalName: z.string().trim().max(200).optional(),
  externalCompany: z.string().trim().max(200).optional(),
  externalContactPerson: z.string().trim().max(200).optional(),
  externalPhone: z.string().trim().max(50).optional(),
  externalTrade: z.string().trim().max(100).optional(),
  externalExpectedVisitDate: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const technicianUpdateSchema = z.object({
  workOrderId: workOrderIdSchema,
  note: z.string().trim().min(2).max(1200),
  laborHours: z.coerce.number().min(0).max(100),
  photoFileName: z.string().trim().max(1000).optional(),
  photoFilePath: z.string().trim().max(1000).optional()
});

export type TechnicianAssignmentInput = z.infer<typeof technicianAssignmentSchema>;
export type TechnicianUpdateInput = z.infer<typeof technicianUpdateSchema>;

export function parseWorkOrderId(value: unknown) {
  return workOrderIdSchema.parse(value);
}

export function parseWorkflowComment(value: unknown) {
  return workflowCommentSchema.parse(typeof value === "string" ? value : "");
}
