import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors/app-error";

export const partsRequestItemSchema = z.object({
  part_id: z.string().nullable(),
  description: z.string().min(1),
  part_number: z.string().nullable(),
  ss_rec_code: z.string().nullable(),
  quantity_requested: z.number().int().positive(),
  unit_price: z.number().nonnegative(),
  remarks: z.string().nullable()
});

export const approvePartsRequestSchema = z.object({
  partsRequestId: z.string().uuid(),
  comments: z.string().trim().max(1000).optional()
});

export const rejectPartsRequestSchema = z.object({
  partsRequestId: z.string().uuid(),
  comments: z.string().trim().max(1000).optional()
});

export type PartsRequestItemInput = z.infer<typeof partsRequestItemSchema>;
export type ApprovePartsRequestInput = z.infer<typeof approvePartsRequestSchema>;
export type RejectPartsRequestInput = z.infer<typeof rejectPartsRequestSchema>;

export type CreatePartsRequestInput = {
  workOrderId: string;
  remarks: string;
  items: PartsRequestItemInput[];
};

export function parsePartsRequestId(value: unknown) {
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) throw new AppError("Invalid parts request id.", { code: "VALIDATION_ERROR" });
  return parsed.data;
}

// Unit 5 — Materials Request / Store issue engine.

export const markWaitingStockSchema = z.object({
  partsRequestId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1000)
});
export type MarkWaitingStockInput = z.infer<typeof markWaitingStockSchema>;

export const issueMaterialsItemSchema = z.object({
  itemId: z.string().uuid(),
  quantity: z.number().nonnegative()
});

export const issueMaterialsSchema = z.object({
  partsRequestId: z.string().uuid(),
  items: z.array(issueMaterialsItemSchema).min(1),
  issuedTo: z.string().trim().max(200).optional(),
  reason: z.string().trim().max(1000).optional()
});
export type IssueMaterialsInput = z.infer<typeof issueMaterialsSchema>;

export const editMaterialsRequestItemSchema = z.object({
  itemId: z.string().uuid(),
  description: z.string().trim().min(1).optional(),
  quantity_requested: z.number().int().positive().optional(),
  unit_price: z.number().nonnegative().optional(),
  remarks: z.string().trim().max(1000).nullable().optional()
});

export const editMaterialsRequestSchema = z.object({
  partsRequestId: z.string().uuid(),
  remarks: z.string().trim().max(1000).optional(),
  items: z.array(editMaterialsRequestItemSchema).optional()
});
export type EditMaterialsRequestInput = z.infer<typeof editMaterialsRequestSchema>;
