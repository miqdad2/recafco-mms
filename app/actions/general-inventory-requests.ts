"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import {
  createGeneralInventoryRequest,
  receiveGeneralInventoryRequest,
  createGeneralInventoryRequestSchema,
  searchInventoryMaterialsForRequest,
  type MaterialsRequestInventoryMatch
} from "@/lib/backend/general-inventory-requests/service";
import { CUSTOM_UNIT_VALUE } from "@/components/store/general-inventory-units";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { errorToLogInput, logSystemError } from "@/lib/errors/logging";

// Materials Request Type Selection Flow Unit 10G.58 — same plain
// FormData-POST-and-redirect convention createPartsRequestAction already
// uses (app/actions/phase4.ts), so both flows behave consistently from the
// same "New Materials Request" modal.

const MAX_ITEM_ROWS = 8;

function field(formData: FormData, name: string, index: number) {
  return String(formData.get(`${name}_${index}`) ?? "").trim();
}

function num(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

// Unit, Price, and Conversion Polish Unit 10G.58A, Task 3 — resolves the
// select's value plus its accompanying custom-unit text field down to one
// plain string. The CUSTOM_UNIT_VALUE sentinel itself is never returned —
// only the real value the user typed (or "" if they left it blank, which
// createGeneralInventoryRequestSchema's min(1) then rejects with a normal
// validation error, never silently saved as "OTHER / CUSTOM").
function resolveUnit(formData: FormData, prefix: string, index: number): string {
  const selected = field(formData, prefix, index);
  if (selected === CUSTOM_UNIT_VALUE) {
    return field(formData, `custom_${prefix}`, index);
  }
  return selected;
}

function parseGeneralItems(formData: FormData) {
  return Array.from({ length: MAX_ITEM_ROWS }, (_, i) => i)
    .map((index) => {
      const materialName = field(formData, "material_name", index);
      if (!materialName) return null;
      // Purchase-first: quantity_ is the Requested Purchase Qty in the
      // Purchase Unit; unit_ is the Stock Unit. conversion_quantity_ is only
      // rendered (and only used) when the two units differ. No PCS
      // fallback: an empty unit reaches the schema as "" and is rejected.
      const priceBasis = field(formData, "price_basis", index);
      return {
        materialName,
        description: field(formData, "description", index) || undefined,
        quantity: Number(field(formData, "quantity", index)) || 0,
        unit: resolveUnit(formData, "unit", index),
        purchaseUnit: resolveUnit(formData, "purchase_unit", index),
        conversionQuantity: num(field(formData, "conversion_quantity", index)),
        unitPrice: num(field(formData, "unit_price", index)),
        priceBasis: priceBasis || undefined,
        // "Keep as entered" on a reversed-units warning.
        unitsConfirmed: formData.get(`units_confirmed_${index}`) === "1",
        supplier: field(formData, "supplier", index) || undefined,
        remarks: field(formData, "remarks", index) || undefined,
        inventoryMaterialKey: field(formData, "material_key", index) || undefined
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

// Existing-material autocomplete for the New Materials Request item rows.
// Called directly (not as a <form action>) while the user types, debounced
// client-side; authorization lives in the service (same gate as creating
// the request). Returns no cost fields for any viewer.
export async function searchInventoryMaterialsForRequestAction(
  query: string
): Promise<MaterialsRequestInventoryMatch[]> {
  const context = await requireUser();
  try {
    return await searchInventoryMaterialsForRequest(context, query);
  } catch {
    return [];
  }
}

export async function createGeneralInventoryRequestAction(formData: FormData) {
  const context = await requireUser();

  const parsed = createGeneralInventoryRequestSchema.safeParse({
    purpose: String(formData.get("purpose") ?? ""),
    remarks: String(formData.get("remarks") ?? "") || undefined,
    department: String(formData.get("department") ?? "") || undefined,
    location: String(formData.get("location") ?? "") || undefined,
    items: parseGeneralItems(formData)
  });

  if (!parsed.success) {
    const message = parsed.error.issues[0]?.message ?? "Please check the form and try again.";
    redirect(`/store/parts-requests?newRequest=1&type=general&error=${encodeURIComponent(message)}`);
  }

  let targetPath = "/store/parts-requests?newRequest=1&type=general";
  try {
    const result = await createGeneralInventoryRequest(context, parsed.data);
    revalidatePath("/store/parts-requests");
    revalidatePath("/dashboard");
    // Opens straight into the new request's detail view as confirmation —
    // it already shows the generated request number and full item list.
    // submitted=1 makes that view show its one-time "request submitted"
    // state with next-action buttons; any later open of the same request
    // (list link, receive error redirect) has no such flag.
    targetPath = `/store/parts-requests?genPreview=${result.id}&submitted=1`;
  } catch (error) {
    await logSystemError(errorToLogInput(error, "general-inventory-requests.createGeneralInventoryRequestAction", context.userId, {
      entityType: "general_inventory_request"
    }));
    redirect(`/store/parts-requests?newRequest=1&type=general&error=${encodeURIComponent(safeErrorMessage(error))}`);
  }
  redirect(targetPath);
}

const receiveItemSchema = z.object({
  itemId: z.uuid(),
  receivedQuantity: z.coerce.number().positive(),
  receivedUnitPrice: z.coerce.number().min(0).optional()
});

const MAX_RECEIVE_ROWS = 20;

export async function receiveGeneralInventoryRequestAction(formData: FormData) {
  const context = await requireUser();
  const requestId = String(formData.get("request_id") ?? "");

  // Same indexed-field convention as the rest of this app's item rows
  // (item_id_${i} / received_quantity_${i} / received_unit_price_${i}).
  const items = Array.from({ length: MAX_RECEIVE_ROWS }, (_, i) => i)
    .map((i) => {
      const itemId = String(formData.get(`item_id_${i}`) ?? "").trim();
      if (!itemId) return null;
      const receivedUnitPriceRaw = String(formData.get(`received_unit_price_${i}`) ?? "").trim();
      const parsed = receiveItemSchema.safeParse({
        itemId,
        receivedQuantity: formData.get(`received_quantity_${i}`),
        receivedUnitPrice: receivedUnitPriceRaw ? receivedUnitPriceRaw : undefined
      });
      return parsed.success ? parsed.data : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  let targetPath = `/store/parts-requests?genPreview=${requestId}`;
  try {
    await receiveGeneralInventoryRequest(context, { requestId, items });
    revalidatePath("/store/parts-requests");
  } catch (error) {
    await logSystemError(errorToLogInput(error, "general-inventory-requests.receiveGeneralInventoryRequestAction", context.userId, {
      entityType: "general_inventory_request",
      entityId: requestId
    }));
    targetPath = `/store/parts-requests?genPreview=${requestId}&error=${encodeURIComponent(safeErrorMessage(error))}`;
  }
  redirect(targetPath);
}
