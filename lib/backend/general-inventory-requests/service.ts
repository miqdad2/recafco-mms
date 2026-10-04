import "server-only";

import { z } from "zod";

import type { CurrentUserContext } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import type { BackendTransaction } from "@/lib/backend/shared/transaction";
import { withBackendTransaction } from "@/lib/backend/shared/transaction";
import { assertActiveUser } from "@/lib/backend/security/guards";
import { AppError } from "@/lib/errors/app-error";
import { canEnterMaterialRequestPrice, canViewCosts } from "@/lib/security/permissions";
import { pricePerPurchaseUnit, reversedUnitsMessage, unitsLookReversed } from "@/lib/materials/request-pricing";
import {
  buildBalanceKey,
  canManageOfflineInventory,
  getOfflineInventoryMaterialByKey,
  searchOfflineInventoryMaterials
} from "@/lib/store/offline-inventory-data";
import { OTHER_CATEGORY, type StockStatus } from "@/components/store/offline-inventory-types";
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

// Materials Request Existing-vs-New Material and Unit Conversion UX Fix —
// `quantity`/`unit` are the requested quantity and the Request / Issue Unit
// (what maintenance needs and the store issues in). purchaseUnit/
// conversionQuantity are only set when the supplier sells the item in a
// different unit ("1 purchaseUnit = conversionQuantity unit", e.g.
// 1 BARREL = 200 LITER); the pair is either both present or both absent
// (superRefine below). inventoryMaterialKey is the Offline Inventory
// identity the row was linked to, if any — re-verified server-side in
// createGeneralInventoryRequest, never trusted as-is. unit has no default:
// an unselected unit is a validation error, never a silent PCS.
const generalRequestItemSchema = z
  .object({
    materialName: z.string().trim().min(1, "Material name is required."),
    description: z.string().trim().optional(),
    // Purchase-first: quantity is the Requested Purchase Qty, in
    // purchaseUnit; unit is the Stock Unit.
    quantity: z.number().positive("Enter requested purchase quantity."),
    purchaseUnit: z.string().trim().min(1, "Select purchase unit."),
    unit: z.string().trim().min(1, "Select stock unit."),
    conversionQuantity: z.number().positive("Enter how many stock units are inside 1 purchase unit.").optional(),
    unitPrice: z.number().min(0, "Estimated unit price must be 0 or greater.").optional(),
    priceBasis: z.enum(["purchase_unit", "stock_unit"]).optional(),
    supplier: z.string().trim().optional(),
    remarks: z.string().trim().optional(),
    inventoryMaterialKey: z.string().trim().optional(),
    // Set only when the user chose "Keep as entered" for units that look
    // reversed (lib/materials/request-pricing.ts unitsLookReversed).
    unitsConfirmed: z.boolean().optional()
  })
  .superRefine((item, ctx) => {
    // Re-checked against the existing material's own unit in
    // createGeneralInventoryRequest, since that unit wins over the form's.
    if (!sameUnit(item.purchaseUnit, item.unit) && item.conversionQuantity === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Enter how many stock units are inside 1 purchase unit.",
        path: ["conversionQuantity"]
      });
    }
    if (item.unitPrice !== undefined && !item.priceBasis) {
      ctx.addIssue({
        code: "custom",
        message: "Select whether price is per purchase unit or per stock unit.",
        path: ["priceBasis"]
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

export type MaterialsRequestInventoryMatch = {
  key: string;
  display_name: string;
  part_number: string | null;
  ss_rec_code: string | null;
  unit: string;
  balance: number;
  stock_status: StockStatus;
};

// Existing-material autocomplete for the New Materials Request item rows —
// searches Offline Inventory by material name, part number, and SS Rec.
// Code (searchOfflineInventoryMaterials already matches all three). Same
// gate as creating the request itself. Never returns cost: the search is
// run without cost permission regardless of the viewer, since the row only
// needs name/balance/unit/status. Stock status follows
// getOfflineInventoryBalance()'s Negative / Out of Stock / Low Stock / OK
// rules; "Review Required" (a store-wide unit-mismatch scan) is not
// computed for a top-10 suggestion list.
export async function searchInventoryMaterialsForRequest(
  context: CurrentUserContext,
  query: string
): Promise<MaterialsRequestInventoryMatch[]> {
  assertCanCreateGeneralInventoryRequest(context);

  const matches = await searchOfflineInventoryMaterials({ query, limit: 10 });
  if (matches.length === 0) return [];

  const settingsRows = await prisma.inventory_material_settings.findMany({
    select: { part_id: true, manual_material_name: true, unit: true, minimum_stock_quantity: true }
  });
  const minimumByKey = new Map(
    settingsRows.map((s) => [buildBalanceKey(s), s.minimum_stock_quantity !== null ? Number(s.minimum_stock_quantity) : null])
  );

  return matches.map((m) => {
    const minimum = minimumByKey.get(m.key) ?? null;
    const isLowStock = minimum !== null ? m.balance <= minimum : m.balance === 1;
    const stock_status: StockStatus =
      m.balance < 0 ? "negative" : m.balance === 0 ? "out_of_stock" : isLowStock ? "low_stock" : "ok";
    return {
      key: m.key,
      display_name: m.display_name,
      part_number: m.part_number,
      ss_rec_code: m.ss_rec_code,
      unit: m.unit,
      balance: m.balance,
      stock_status
    };
  });
}

function sameUnit(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
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

  // A price is only ever saved for a requester allowed to price material
  // requests (Manager, Super Admin, Data Entry — see
  // canEnterMaterialRequestPrice) — the form does not render the field
  // otherwise, and a posted value is dropped here rather than trusted.
  const showCosts = canEnterMaterialRequestPrice(context);

  // Existing-vs-new is decided here, not by the form: a posted material key
  // counts only if it still resolves to an Offline Inventory material, and
  // then the material's own name and unit win over whatever was typed. A
  // key that no longer resolves falls back to a plain New Material Request.
  // Read-only lookups — submitting a request never writes a movement or
  // registers a material.
  const itemRows = await Promise.all(
    input.items.map(async (item) => {
      const existing = await getOfflineInventoryMaterialByKey(item.inventoryMaterialKey);
      // Purchase-first. An existing material's own unit is its Stock Unit.
      const stockUnit = existing?.unit ?? item.unit;
      if (unitsLookReversed(item.purchaseUnit, stockUnit) && !item.unitsConfirmed) {
        throw new AppError(reversedUnitsMessage(item.purchaseUnit, stockUnit), { code: "BAD_REQUEST" });
      }
      const unitsDiffer = !sameUnit(item.purchaseUnit, stockUnit);
      if (unitsDiffer && !item.conversionQuantity) {
        throw new AppError("Enter how many stock units are inside 1 purchase unit.", { code: "BAD_REQUEST" });
      }
      const conversion = unitsDiffer ? item.conversionQuantity! : null;
      const priced = showCosts && item.unitPrice !== undefined && item.priceBasis !== undefined;
      // One unit: the two bases are the same thing.
      const basis = priced ? (unitsDiffer ? item.priceBasis! : "purchase_unit") : null;
      // quantity_requested/unit = the purchase side (what Receive expects,
      // 2 decimals); request_quantity/request_unit = the calculated stock
      // side. unit_price stays per purchase unit — Receive and the
      // generated unit_cost/total_price columns depend on that — so a
      // per-stock-unit price is converted (1.200 KWD/PCS × 9 = 10.800
      // KWD/BOX); entered_unit_price/price_basis keep what was typed.
      return {
        material_name: existing?.display_name ?? item.materialName,
        description: item.description || null,
        quantity_requested: Math.round(item.quantity * 100) / 100,
        unit: unitsDiffer ? item.purchaseUnit : stockUnit,
        unit_price: priced ? pricePerPurchaseUnit(item.unitPrice!, basis!, conversion ?? 1) : null,
        entered_unit_price: priced ? item.unitPrice! : null,
        price_basis: basis,
        supplier: item.supplier || null,
        remarks: item.remarks || null,
        inventory_unit: unitsDiffer ? stockUnit : null,
        conversion_quantity: conversion,
        inventory_material_key: existing?.key ?? null,
        inventory_part_id: existing?.part_id ?? null,
        request_unit: stockUnit,
        request_quantity: item.quantity * (conversion ?? 1)
      };
    })
  );

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
      data: itemRows.map((row) => ({ request_id: request.id, ...row }))
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

  // The receive form only shows a unit price to a cost-permitted viewer; a
  // posted price from anyone else is ignored, and the request's own saved
  // price (if a cost-permitted requester entered one) is used instead.
  const showCosts = canViewCosts(context);

  // Rows linked to an existing Offline Inventory material receive against
  // that exact identity. Resolved up front (read-only) from the keys saved
  // on the request; a key that no longer resolves leaves that row on the
  // typed-name path below.
  const linkedKeys = await prisma.general_inventory_request_items.findMany({
    where: { request_id: input.requestId, inventory_material_key: { not: null } },
    select: { id: true, inventory_material_key: true }
  });
  const linkedMaterialByItemId = new Map(
    await Promise.all(
      linkedKeys.map(async (row) => [row.id, await getOfflineInventoryMaterialByKey(row.inventory_material_key)] as const)
    )
  );

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
      const linked = linkedMaterialByItemId.get(item.id) ?? null;
      const conversionQty = item.conversion_quantity ? Number(item.conversion_quantity) : null;
      // A linked row's movement is always in the material's own stored
      // unit (which is what the request's Request / Issue Unit was taken
      // from), so it lands on the same balance identity.
      const movementUnit = linked ? linked.unit : conversionQty ? (item.inventory_unit ?? item.unit) : item.unit;
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
      const receivedUnitPrice = showCosts ? row.receivedUnitPrice : undefined;
      const actualUnitPrice = receivedUnitPrice ?? (item.unit_price !== null ? Number(item.unit_price) : null);
      const movementUnitCost = actualUnitPrice !== null ? (conversionQty ? actualUnitPrice / conversionQty : actualUnitPrice) : null;
      const totalCost = movementUnitCost !== null ? movementQuantity * movementUnitCost : null;

      await tx.offline_inventory_movements.create({
        data: {
          movement_type: "RECEIVED",
          movement_date: now,
          // Linked row: the existing material's own identity and metadata
          // (so its part number / SS Rec. Code / category are not lost on
          // the balance view, which reads them from the latest movement).
          // Unlinked row: unchanged — the typed name is received as a
          // manual material, which is how a new material first enters
          // Offline Inventory.
          part_id: linked?.part_id ?? null,
          manual_material_name: linked ? linked.manual_material_name : item.material_name,
          manual_part_number: linked?.manual_part_number ?? null,
          ss_rec_code: linked?.ss_rec_code ?? null,
          category: linked?.category ?? OTHER_CATEGORY,
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
          received_unit_price: receivedUnitPrice ?? item.unit_price
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
