"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/context";
import {
  confirmRequiredPartAvailability,
  type RequiredPartAvailabilityStatus
} from "@/lib/backend/store/service";
import { safeErrorMessage } from "@/lib/errors/error-handler";

const VALID_STATUSES: RequiredPartAvailabilityStatus[] = ["available", "partial", "unavailable"];

export async function confirmWorkOrderRequiredPartAvailabilityAction(formData: FormData) {
  const context = await requirePermission("store.issue");

  const requiredPartId = String(formData.get("required_part_id") ?? "").trim();
  const workOrderId = String(formData.get("work_order_id") ?? "").trim();
  const rawStatus = String(formData.get("availability_status") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim() || null;

  if (!requiredPartId || !workOrderId) {
    redirect(`/store/inventory-check?error=${encodeURIComponent("Missing required part or work order ID.")}`);
  }
  if (!VALID_STATUSES.includes(rawStatus as RequiredPartAvailabilityStatus)) {
    redirect(`/store/inventory-check?error=${encodeURIComponent("Invalid availability status.")}`);
  }

  try {
    await confirmRequiredPartAvailability(
      context,
      requiredPartId,
      rawStatus as RequiredPartAvailabilityStatus,
      notes
    );
    revalidatePath("/store/inventory-check");
    revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  } catch (error) {
    redirect(`/store/inventory-check?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }

  redirect("/store/inventory-check?success=part-confirmed");
}
