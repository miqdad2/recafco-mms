"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requirePermission } from "@/lib/auth/context";
import { decidePurchaseAsCeo, requestCeoClarification } from "@/lib/backend/purchase-requests/service";
import { ceoClarificationSchema, ceoDecisionSchema, parsePurchaseRequestId } from "@/lib/backend/purchase-requests/validators";
import { safeErrorMessage } from "@/lib/errors/error-handler";

function errorPath(error: unknown, fallbackId?: string) {
  const message = encodeURIComponent(safeErrorMessage(error));
  return fallbackId ? `/ceo/approvals?error=${message}&purchase=${fallbackId}` : `/ceo/approvals?error=${message}`;
}

function revalidateCeoDecisionPaths(purchaseRequestId: string) {
  revalidatePath("/ceo/approvals");
  revalidatePath("/dashboard");
  revalidatePath("/purchase/requests");
  revalidatePath(`/purchase/requests/${purchaseRequestId}`);
  revalidatePath("/finance/approvals");
}

export async function ceoApprovePurchaseAction(formData: FormData) {
  const context = await requirePermission("ceo.approve");
  const purchaseRequestId = parsePurchaseRequestId(formData.get("purchase_request_id"));
  let targetPath = "/ceo/approvals";

  try {
    const input = ceoDecisionSchema.parse({
      purchaseRequestId,
      decision: "Approved",
      comments: formData.get("comments") || undefined
    });
    const result = await decidePurchaseAsCeo(context, input);
    revalidateCeoDecisionPaths(result.purchaseRequestId);
    targetPath = `/ceo/approvals?success=approved&purchase=${result.purchaseRequestId}`;
  } catch (error) {
    redirect(errorPath(error, purchaseRequestId));
  }

  redirect(targetPath);
}

export async function ceoRejectPurchaseAction(formData: FormData) {
  const context = await requirePermission("ceo.approve");
  const purchaseRequestId = parsePurchaseRequestId(formData.get("purchase_request_id"));
  let targetPath = "/ceo/approvals";

  try {
    const input = ceoDecisionSchema.parse({
      purchaseRequestId,
      decision: "Rejected",
      comments: formData.get("comments") || undefined
    });
    const result = await decidePurchaseAsCeo(context, input);
    revalidateCeoDecisionPaths(result.purchaseRequestId);
    targetPath = `/ceo/approvals?success=rejected&purchase=${result.purchaseRequestId}`;
  } catch (error) {
    redirect(errorPath(error, purchaseRequestId));
  }

  redirect(targetPath);
}

export async function ceoRequestClarificationAction(formData: FormData) {
  const context = await requirePermission("ceo.approve");
  const purchaseRequestId = parsePurchaseRequestId(formData.get("purchase_request_id"));
  let targetPath = "/ceo/approvals";

  try {
    const input = ceoClarificationSchema.parse({
      purchaseRequestId,
      comments: formData.get("comments")
    });
    const result = await requestCeoClarification(context, input);
    revalidateCeoDecisionPaths(result.purchaseRequestId);
    targetPath = `/ceo/approvals?success=clarification&purchase=${result.purchaseRequestId}`;
  } catch (error) {
    redirect(errorPath(error, purchaseRequestId));
  }

  redirect(targetPath);
}
