import { z } from "zod";

import { AppError } from "@/lib/errors/app-error";

export const purchaseRequestIdSchema = z.string().uuid();

export const ceoDecisionSchema = z.object({
  purchaseRequestId: purchaseRequestIdSchema,
  decision: z.enum(["Approved", "Rejected"]),
  comments: z.string().trim().max(1000).optional()
});

export const financeDecisionSchema = z.object({
  purchaseRequestId: purchaseRequestIdSchema,
  decision: z.enum(["Approved", "Rejected"]),
  comments: z.string().trim().max(1000).optional()
});

export const ceoClarificationSchema = z.object({
  purchaseRequestId: purchaseRequestIdSchema,
  comments: z.string().trim().min(3, "Add a short clarification note.").max(1000)
});

export const createPurchaseFromPartsRequestSchema = z.object({
  partsRequestId: purchaseRequestIdSchema
});

export const purchaseWorkflowStatusSchema = z.enum([
  "Submitted",
  "Pending Purchase",
  "Pending Finance Approval",
  "Pending CEO Approval",
  "Approved",
  "Ordered",
  "Rejected",
  "Cancelled"
]);

export const updatePurchaseWorkflowSchema = z.object({
  purchaseRequestId: purchaseRequestIdSchema,
  supplier: z.string().trim().max(200).optional(),
  status: purchaseWorkflowStatusSchema,
  purchaseOfficerNotes: z.string().trim().max(2000).optional(),
  quotationFileName: z.string().trim().max(255).optional(),
  quotationFilePath: z.string().trim().max(500).optional()
});

export const receivePurchaseSchema = z.object({
  purchaseRequestId: purchaseRequestIdSchema
});

export type CeoDecisionInput = z.infer<typeof ceoDecisionSchema>;
export type CeoClarificationInput = z.infer<typeof ceoClarificationSchema>;
export type FinanceDecisionInput = z.infer<typeof financeDecisionSchema>;
export type CreatePurchaseFromPartsRequestInput = z.infer<typeof createPurchaseFromPartsRequestSchema>;
export type UpdatePurchaseWorkflowInput = z.infer<typeof updatePurchaseWorkflowSchema>;
export type ReceivePurchaseInput = z.infer<typeof receivePurchaseSchema>;

export function parsePurchaseRequestId(value: unknown) {
  const parsed = purchaseRequestIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new AppError("Invalid purchase request id.", { code: "VALIDATION_ERROR" });
  }
  return parsed.data;
}
