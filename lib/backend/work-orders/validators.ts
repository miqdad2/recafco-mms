import "server-only";

import { z } from "zod";

export const workOrderIdSchema = z.string().uuid();

export const workflowCommentSchema = z.string().trim().max(1000).optional();

export const technicianAssignmentSchema = z.object({
  workOrderId: workOrderIdSchema,
  technicianIds: z.array(workOrderIdSchema).min(1)
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
