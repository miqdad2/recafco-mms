"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { confirmRequirementNotRequired } from "@/lib/backend/work-orders/closure-requirements";

// "No Workers Required" / "No Materials Required" — thin transport layer;
// every rule (role, visibility, status, nothing already added, lock) lives in
// lib/backend/work-orders/closure-requirements.ts.

export type RequirementActionState = { ok: true; message: string } | { ok: false; error: string } | null;

const input = z.object({
  work_order_id: z.string().uuid(),
  requirement: z.enum(["workers", "materials"]),
});

export async function confirmRequirementNotRequiredAction(
  _prev: RequirementActionState,
  formData: FormData
): Promise<RequirementActionState> {
  const context = await requireUser();
  try {
    const parsed = input.parse({ work_order_id: formData.get("work_order_id"), requirement: formData.get("requirement") });
    const result = await confirmRequirementNotRequired(context, {
      workOrderId: parsed.work_order_id,
      requirement: parsed.requirement,
      reason: String(formData.get("reason") ?? ""),
    });
    revalidatePath(`/maintenance/work-orders/${parsed.work_order_id}`);
    revalidatePath("/maintenance/daily-activity");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    const label = parsed.requirement === "workers" ? "No Workers Required" : "No Materials Required";
    return { ok: true, message: result.alreadyConfirmed ? `${label} was already confirmed.` : `${label} confirmed.` };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}
