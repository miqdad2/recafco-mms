import "server-only";

import { z } from "zod";

import { AppError } from "@/lib/errors/app-error";

export const partsRequestItemSchema = z.object({
  part_id: z.string().nullable(),
  description: z.string().min(1),
  part_number: z.string().nullable(),
  ss_rec_code: z.string().nullable(),
  quantity_requested: z.number().int().positive(),
  // Job Card Materials Request UX and Existing Inventory Selection Fix,
  // Task 8 — null means "not priced yet" (never invented as 0); the form
  // only ever sends a real number when Manager/Super Admin typed one.
  unit_price: z.number().nonnegative().nullable(),
  remarks: z.string().nullable(),
  // Task 3/4/5/6/10 — unit is the Request / Issue Unit; null only for a row
  // somehow submitted with neither an existing-match unit nor a manually
  // chosen one (the form itself always sends one or the other once a
  // description is present). inventory_material_key links to an existing,
  // non-catalog Offline Inventory material (buildBalanceKey()'s own
  // "manual:<name>|<unit>" identity) — null together with part_id means
  // "New Material Request". Task 7 — purchase_unit/conversion_quantity are
  // only set together, when "Purchased in a different unit" is used.
  unit: z.string().min(1).nullable(),
  inventory_material_key: z.string().nullable(),
  purchase_unit: z.string().nullable(),
  conversion_quantity: z.number().positive().nullable(),
  // Material Request Purchase-First Unit and Flexible Price Basis — the
  // estimated price exactly as typed and which unit it is per. unit_price
  // above stays per stock unit (converted from this on save) because the
  // generated total_price and purchase-request creation depend on it. Both
  // null when unpriced.
  entered_unit_price: z.number().nonnegative().nullable(),
  price_basis: z.enum(["purchase_unit", "stock_unit"]).nullable()
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
