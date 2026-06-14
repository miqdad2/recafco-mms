import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors/app-error";

export const partsRequestItemSchema = z.object({
  part_id: z.string().nullable(),
  description: z.string().min(1),
  part_number: z.string().nullable(),
  ss_rec_code: z.string().nullable(),
  quantity_requested: z.number().nonnegative(),
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
