"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import {
  createGeneralInventoryRequest,
  receiveGeneralInventoryRequest,
  createGeneralInventoryRequestSchema
} from "@/lib/backend/general-inventory-requests/service";
import { CUSTOM_UNIT_VALUE, DEFAULT_UNIT } from "@/components/store/general-inventory-units";
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
      // Task 5/6: conversion is only "on" when the row's checkbox was
      // checked — its inventory_unit/conversion fields are otherwise
      // ignored even if stray values are present, so a toggled-off row
      // never accidentally saves a conversion.
      const conversionEnabled = formData.get(`use_conversion_${index}`) === "on";
      const inventoryUnit = conversionEnabled ? resolveUnit(formData, "inventory_unit", index) : "";
      const conversionQuantity = conversionEnabled ? num(field(formData, "conversion_quantity", index)) : undefined;
      return {
        materialName,
        description: field(formData, "description", index) || undefined,
        quantity: Number(field(formData, "quantity", index)) || 0,
        unit: resolveUnit(formData, "unit", index) || DEFAULT_UNIT,
        unitPrice: num(field(formData, "unit_price", index)),
        supplier: field(formData, "supplier", index) || undefined,
        remarks: field(formData, "remarks", index) || undefined,
        inventoryUnit: inventoryUnit || undefined,
        conversionQuantity
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
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
    targetPath = `/store/parts-requests?genPreview=${result.id}`;
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
