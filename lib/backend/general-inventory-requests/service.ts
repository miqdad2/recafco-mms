import "server-only";

import { z } from "zod";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { assertActiveUser } from "@/lib/backend/security/guards";
import { AppError } from "@/lib/errors/app-error";
import { canManageOfflineInventory } from "@/lib/store/offline-inventory-data";
import { OTHER_CATEGORY } from "@/components/store/offline-inventory-types";
import { emitRealtimeEvent, REALTIME_EVENTS } from "@/lib/realtime/events";

// Materials Request Type Selection Flow Unit 10G.58.
//
// Deliberately separate from lib/backend/parts-requests — see the schema
// comment above the general_inventory_requests model in prisma/schema.prisma
// for why. Nothing in this file reads or writes parts_requests,
// work_orders, or any Job Card materials table; the Receive action below
// writes to offline_inventory_movements, the same ledger table Offline
// Inventory Control's own "Receive Material" action and the Job Card
// Materials Request "Receive Materials" action both already use — Received
// stock always flows through that one ledger in this codebase, never
// inventory_movements/parts.current_stock (that system is purchase-request
// specific and its movement_type CHECK constraint doesn't even accept a
// "Received" value).

// Unit, Price, and Conversion Polish Unit 10G.58A, Task 5/6 — inventoryUnit/
// conversionQuantity are only set when this item is purchased in one unit
// but stored/issued in another (e.g. 1 BARREL = 200 LITER); the pair is
// either both present or both absent (superRefine below), matching Task
// 6's "if conversion is enabled, stock unit and conversion quantity are
// both required."
const generalRequestItemSchema = z
  .object({
    materialName: z.string().trim().min(1, "Material name is required."),
    description: z.string().trim().optional(),
    quantity: z.number().positive("Quantity must be greater than 0."),
    unit: z.string().trim().min(1, "Unit is required."),
    unitPrice: z.number().min(0, "Unit price must be 0 or greater.").optional(),
    supplier: z.string().trim().optional(),
    remarks: z.string().trim().optional(),
    inventoryUnit: z.string().trim().optional(),
    conversionQuantity: z.number().positive("Conversion quantity must be greater than 0.").optional()
  })
  .superRefine((item, ctx) => {
    const hasUnit = Boolean(item.inventoryUnit);
    const hasQty = item.conversionQuantity !== undefined;
    if (hasUnit !== hasQty) {
      ctx.addIssue({
        code: "custom",
        message: "Inventory unit and conversion quantity are both required when conversion is enabled.",
        path: hasUnit ? ["conversionQuantity"] : ["inventoryUnit"]
      });
    }
  });

export const createGeneralInventoryRequestSchema = z.object({
  purpose: z.string().trim().min(1, "Purpose / reason is required."),
  remarks: z.string().trim().optional(),
  department: z.string().trim().optional(),
  location: z.string().trim().optional(),
  items: z.array(generalRequestItemSchema).min(1, "At least one item is required.")
});

export type CreateGeneralInventoryRequestInput = z.infer<typeof createGeneralInventoryRequestSchema>;

export type ReceiveGeneralInventoryRequestInput = {
  requestId: string;
  items: Array<{ itemId: string; receivedQuantity: number; receivedUnitPrice?: number }>;
};

// Task 11: identical gate to Materials Request creation (parts_requests.create)
// — "Users who can create material requests can create General Inventory
// requests," no new permission introduced.
export function assertCanCreateGeneralInventoryRequest(context: CurrentUserContext) {
  assertActiveUser(context);
  if (context.role?.slug === "super_admin") return;
  if (context.permissions.includes("parts_requests.create")) return;
  if (context.permissions.includes("work_orders.manage")) return;
  throw new AppError("You do not have permission to create materials requests.", { code: "FORBIDDEN" });
}

// Task 11: "Receiving into inventory should follow the existing inventory
// receive permission" — this action writes offline_inventory_movements
// rows exactly like Offline Inventory Control's own Receive Material
// action, so it reuses that action's own gate rather than inventing a new
// permission concept.
export function assertCanReceiveGeneralInventoryRequest(context: CurrentUserContext) {
  assertActiveUser(context);
  if (canManageOfflineInventory(context)) return;
  throw new AppError("You do not have permission to receive materials into inventory.", { code: "FORBIDDEN" });
}

async function nextGeneralInventoryRequestNumber(tx: BackendTransaction): Promise<string> {
  const row = await tx.numbering_sequences.upsert({
    where: { key: "general_inventory_request" },
    create: { key: "general_inventory_request", current_value: 1 },
    update: { current_value: { increment: 1 } }
  });
  return `REC/MAT/GEN/${String(row.current_value).padStart(4, "0")}`;
}

export async function createGeneralInventoryRequest(
  context: CurrentUserContext,
  input: CreateGeneralInventoryRequestInput
) {
  assertCanCreateGeneralInventoryRequest(context);

  const requester = await prisma.profiles.findUnique({
    where: { id: context.userId },
    select: { full_name: true }
  });

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const requestNumber = await nextGeneralInventoryRequestNumber(tx);

    const request = await tx.general_inventory_requests.create({
      data: {
        request_number: requestNumber,
        purpose: input.purpose,
        remarks: input.remarks || null,
        department: input.department || null,
        location: input.location || null,
        requested_by_id: context.userId,
        requested_by_name: requester?.full_name ?? null,
        status: "Pending"
      },
      select: { id: true, request_number: true, status: true }
    });

    await tx.general_inventory_request_items.createMany({
      data: input.items.map((item) => ({
        request_id: request.id,
        material_name: item.materialName,
        description: item.description || null,
        quantity_requested: item.quantity,
        unit: item.unit,
        unit_price: item.unitPrice ?? null,
        supplier: item.supplier || null,
        remarks: item.remarks || null,
        inventory_unit: item.inventoryUnit || null,
        conversion_quantity: item.conversionQuantity ?? null
      }))
    });

    return request;
  });

  await emitRealtimeEvent({
    eventType: REALTIME_EVENTS.MATERIALS_REQUEST_CREATED,
    entityType: "general_inventory_request",
    entityId: result.id,
    actorProfileId: context.userId
  });

  return { id: result.id, requestNumber: result.request_number, status: result.status };
}

export async function receiveGeneralInventoryRequest(
  context: CurrentUserContext,
  input: ReceiveGeneralInventoryRequestInput
) {
  assertCanReceiveGeneralInventoryRequest(context);

  if (!input.items.length) {
    throw new AppError("No items to receive.", { code: "BAD_REQUEST" });
  }
  if (input.items.some((item) => !Number.isFinite(item.receivedQuantity) || item.receivedQuantity <= 0)) {
    throw new AppError("Received quantity must be greater than 0 for every item.", { code: "BAD_REQUEST" });
  }

  const result = await withBackendTransaction(context.userId, async (tx) => {
    const request = await tx.general_inventory_requests.findUnique({
      where: { id: input.requestId },
      include: { items: true }
    });
    if (!request) throw new AppError("General Inventory Request not found.", { code: "NOT_FOUND" });
    if (request.status !== "Pending") {
      throw new AppError("This request has already been received or cancelled.", { code: "CONFLICT" });
    }

    // Task 6: first version requires a full receive — every item on the
    // request must be included in this one confirm action.
    const itemById = new Map(request.items.map((i) => [i.id, i]));
    if (input.items.length !== request.items.length || input.items.some((row) => !itemById.has(row.itemId))) {
      throw new AppError("All items on this request must be received together.", { code: "BAD_REQUEST" });
    }

    const now = new Date();
    for (const row of input.items) {
      const item = itemById.get(row.itemId)!;

      // Task 9: no conversion -> movement is in the purchase unit, exactly
      // the received quantity. Conversion enabled -> movement quantity is
      // scaled to the inventory unit (received purchase qty * conversion),
      // and the reference records the original purchase qty/unit too, since
      // the movement's own quantity/unit no longer show that directly.
      const conversionQty = item.conversion_quantity ? Number(item.conversion_quantity) : null;
      const movementUnit = conversionQty ? (item.inventory_unit ?? item.unit) : item.unit;
      const movementQuantity = conversionQty ? row.receivedQuantity * conversionQty : row.receivedQuantity;
      const reference = conversionQty
        ? `${request.request_number} — ${row.receivedQuantity} ${item.unit} received`
        : request.request_number;

      // Inventory Cost and Stock Value Foundation Unit 10G.61, Task 4 — the
      // actual received unit price (defaulting to the request's own item
      // price, same fallback already used for received_unit_price below),
      // converted into the INVENTORY unit's cost when conversion is
      // enabled (25.000 KWD/BARREL ÷ 200 LITER/BARREL = 0.125 KWD/LITER),
      // left as-is otherwise. total_cost always = movementQuantity (already
      // in the inventory unit) * movementUnitCost, so it's consistent with
      // whatever unit the movement itself is recorded in.
      const actualUnitPrice = row.receivedUnitPrice ?? (item.unit_price !== null ? Number(item.unit_price) : null);
      const movementUnitCost = actualUnitPrice !== null ? (conversionQty ? actualUnitPrice / conversionQty : actualUnitPrice) : null;
      const totalCost = movementUnitCost !== null ? movementQuantity * movementUnitCost : null;

      await tx.offline_inventory_movements.create({
        data: {
          movement_type: "RECEIVED",
          movement_date: now,
          manual_material_name: item.material_name,
          category: OTHER_CATEGORY,
          quantity: movementQuantity,
          unit: movementUnit,
          reference_number: reference,
          purpose: request.purpose,
          remarks: item.remarks,
          unit_cost: movementUnitCost,
          total_cost: totalCost,
          created_by: context.userId
        }
      });

      await tx.general_inventory_request_items.update({
        where: { id: item.id },
        data: {
          received_quantity: row.receivedQuantity,
          received_unit_price: row.receivedUnitPrice ?? item.unit_price
        }
      });
    }

    const updated = await tx.general_inventory_requests.update({
      where: { id: request.id },
      data: { status: "Completed", completed_at: now },
      select: { id: true, request_number: true, status: true }
    });

    return updated;
  });

  await Promise.all([
    emitRealtimeEvent({
      eventType: REALTIME_EVENTS.MATERIALS_REQUEST_SENT,
      entityType: "general_inventory_request",
      entityId: result.id,
      actorProfileId: context.userId
    }),
    emitRealtimeEvent({
      eventType: REALTIME_EVENTS.MATERIAL_LEDGER_UPDATED,
      entityType: "general_inventory_request",
      entityId: result.id,
      actorProfileId: context.userId
    })
  ]);

  return result;
}
