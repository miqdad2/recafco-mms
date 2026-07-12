"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";

export type ServiceContractState =
  | { ok: true }
  | { ok: false; error: string }
  | null;

function toNullable(s: string): string | null {
  const v = s.trim();
  return v === "" ? null : v;
}

export async function createServiceContractAction(
  _prev: ServiceContractState,
  formData: FormData
): Promise<ServiceContractState> {
  // requirePermission may call redirect() — must stay outside try/catch
  const context = await requirePermission("assets.view");

  try {
    const assetId      = toNullable(String(formData.get("asset_id") ?? ""));
    const title        = toNullable(String(formData.get("contract_title") ?? ""));
    const contractNum  = toNullable(String(formData.get("contract_number") ?? ""));
    const company      = toNullable(String(formData.get("service_company") ?? ""));
    const contact      = toNullable(String(formData.get("contact_person") ?? ""));
    const phone        = toNullable(String(formData.get("phone") ?? ""));
    const email        = toNullable(String(formData.get("email") ?? ""));
    const startDateStr = toNullable(String(formData.get("start_date") ?? ""));
    const endDateStr   = toNullable(String(formData.get("end_date") ?? ""));
    const renewalStr   = toNullable(String(formData.get("renewal_date") ?? ""));
    const frequency    = String(formData.get("service_frequency") ?? "One-time").trim() || "One-time";
    const scope        = toNullable(String(formData.get("scope_of_service") ?? ""));
    const remarks      = toNullable(String(formData.get("remarks") ?? ""));

    if (!assetId)      return { ok: false, error: "Asset / Equipment is required." };
    if (!title)        return { ok: false, error: "Contract title is required." };
    if (!company)      return { ok: false, error: "Service company is required." };
    if (!startDateStr) return { ok: false, error: "Start date is required." };
    if (!endDateStr)   return { ok: false, error: "End date is required." };

    const startDate = new Date(startDateStr);
    const endDate   = new Date(endDateStr);
    if (endDate < startDate) {
      return { ok: false, error: "End date must be on or after start date." };
    }

    await prisma.service_contracts.create({
      data: {
        asset_id:          assetId,
        contract_title:    title,
        contract_number:   contractNum,
        service_company:   company,
        contact_person:    contact,
        phone,
        email,
        start_date:        startDate,
        end_date:          endDate,
        renewal_date:      renewalStr ? new Date(renewalStr) : null,
        service_frequency: frequency,
        contract_status:   "Active",
        scope_of_service:  scope,
        remarks,
        created_by:        context.userId,
      },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to save." };
  }

  revalidatePath("/assets/service-contracts");
  revalidatePath("/assets");
  return { ok: true };
}
