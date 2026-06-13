"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission, requireUser } from "@/lib/auth/context";
import {
  createPurchaseFromUnavailableParts,
  decidePurchaseAsCeo,
  decidePurchaseAsFinance,
  receivePurchaseIntoInventory,
  updatePurchaseWorkflow
} from "@/lib/backend/purchase-requests/service";
import {
  ceoDecisionSchema,
  createPurchaseFromPartsRequestSchema,
  financeDecisionSchema,
  receivePurchaseSchema,
  updatePurchaseWorkflowSchema
} from "@/lib/backend/purchase-requests/validators";
import {
  approvePartsRequest,
  createPartsRequest,
  rejectPartsRequest
} from "@/lib/backend/parts-requests/service";
import { issuePartsToRequest } from "@/lib/backend/store/service";
import type { StoreIssueItem } from "@/lib/backend/store/service";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { prisma } from "@/lib/db/prisma";

// ── Form parsing helpers (used for indexed item fields from parts-request form) ──

function field(formData: FormData, name: string, index: number) {
  return String(formData.get(`${name}_${index}`) ?? "").trim();
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseItems(formData: FormData) {
  return [0, 1, 2, 3, 4]
    .map((index) => {
      const description = field(formData, "description", index);
      if (!description) return null;
      return {
        part_id: field(formData, "part_id", index) || null,
        description,
        part_number: field(formData, "part_number", index) || null,
        ss_rec_code: field(formData, "ss_rec_code", index) || null,
        quantity_requested: num(field(formData, "quantity_requested", index)),
        unit_price: num(field(formData, "unit_price", index)),
        remarks: field(formData, "remarks", index) || null
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function idFrom(formData: FormData, key: string) {
  const parsed = z.uuid().safeParse(formData.get(key));
  if (!parsed.success) redirect("/dashboard?error=invalid-id");
  return parsed.data;
}

async function requirePartsRequestCreator() {
  const context = await requireUser();
  const canCreate =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.create") ||
    context.permissions.includes("work_orders.manage");
  if (!canCreate) redirect("/dashboard?error=permission-denied");
  return context;
}

// ── Parts request actions ────────────────────────────────────────────────────

export async function createPartsRequestAction(formData: FormData) {
  const context = await requirePartsRequestCreator();
  const workOrderId = idFrom(formData, "work_order_id");
  const items = parseItems(formData);
  if (!items.length) redirect(`/maintenance/work-orders/${workOrderId}?error=no-items`);

  let targetPath = `/maintenance/work-orders/${workOrderId}`;
  try {
    const result = await createPartsRequest(context, {
      workOrderId,
      remarks: String(formData.get("remarks") ?? ""),
      items
    });
    revalidatePath(`/maintenance/work-orders/${workOrderId}`);
    targetPath = `/store/parts-requests/${result.partsRequestId}`;
  } catch (error) {
    redirect(
      `/maintenance/work-orders/${workOrderId}?error=${encodeURIComponent(safeErrorMessage(error))}`
    );
  }
  redirect(targetPath);
}

export async function approvePartsRequestAction(formData: FormData) {
  const context = await requirePermission("parts_requests.approve");
  const id = idFrom(formData, "parts_request_id");
  let targetPath = `/store/parts-requests/${id}`;

  try {
    const result = await approvePartsRequest(context, {
      partsRequestId: id,
      comments: String(formData.get("comments") ?? "") || undefined
    });
    targetPath = `/store/parts-requests/${result.partsRequestId}`;
  } catch (error) {
    redirect(`/store/parts-requests/${id}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }
  redirect(targetPath);
}

export async function rejectPartsRequestAction(formData: FormData) {
  const context = await requirePermission("parts_requests.approve");
  const id = idFrom(formData, "parts_request_id");
  let targetPath = `/store/parts-requests/${id}`;

  try {
    const result = await rejectPartsRequest(context, {
      partsRequestId: id,
      comments: String(formData.get("comments") ?? "") || undefined
    });
    targetPath = `/store/parts-requests/${result.partsRequestId}`;
  } catch (error) {
    redirect(`/store/parts-requests/${id}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }
  redirect(targetPath);
}

export async function storeIssueAction(formData: FormData) {
  const context = await requirePermission("store.issue");
  const requestId = idFrom(formData, "parts_request_id");

  // Fetch items here to resolve dynamic form keys (issued_{id}, unavailable_{id}).
  // Item IDs come from the DB, not the submitted form, so the mapping is tamper-safe.
  const rawItems = await prisma.parts_request_items.findMany({
    where: { parts_request_id: requestId },
    select: {
      id: true,
      part_id: true,
      description: true,
      part_number: true,
      ss_rec_code: true,
      quantity_requested: true,
      unit_price: true
    }
  });

  const storeItems: StoreIssueItem[] = [];
  for (const item of rawItems) {
    const issued = num(formData.get(`issued_${item.id}`));
    const unavailable = formData.get(`unavailable_${item.id}`) === "on";
    if (issued < 0 || issued > Number(item.quantity_requested)) {
      redirect(`/store/parts-requests/${requestId}?error=invalid-issued-quantity`);
    }
    storeItems.push({
      itemId: item.id,
      partId: item.part_id as string | null,
      description: item.description,
      partNumber: item.part_number as string | null,
      ssRecCode: item.ss_rec_code as string | null,
      quantityRequested: Number(item.quantity_requested),
      unitPrice: Number(item.unit_price),
      issuedQuantity: issued,
      isUnavailable: unavailable
    });
  }

  let targetPath = `/store/parts-requests/${requestId}`;
  try {
    const result = await issuePartsToRequest(context, {
      partsRequestId: requestId,
      items: storeItems,
      storeIssueComments: String(formData.get("store_issue_comments") ?? "") || null
    });
    revalidatePath(`/store/parts-requests/${requestId}`);
    targetPath = `/store/parts-requests/${result.partsRequestId}`;
  } catch (error) {
    redirect(`/store/parts-requests/${requestId}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }
  redirect(targetPath);
}

// ── Purchase request actions (already delegating to service layer) ────────────

export async function createPurchaseRequestAction(formData: FormData) {
  const context = await requirePermission("purchase_requests.manage");
  const partsRequestId = idFrom(formData, "parts_request_id");
  let targetPath = `/store/parts-requests/${partsRequestId}`;

  try {
    const result = await createPurchaseFromUnavailableParts(
      context,
      createPurchaseFromPartsRequestSchema.parse({ partsRequestId })
    );
    revalidatePath(`/store/parts-requests/${partsRequestId}`);
    revalidatePath("/purchase/requests");
    revalidatePath("/finance/approvals");
    revalidatePath("/ceo/approvals");
    targetPath = `/purchase/requests/${result.purchaseRequestId}`;
  } catch (error) {
    redirect(
      `/store/parts-requests/${partsRequestId}?error=${encodeURIComponent(safeErrorMessage(error))}`
    );
  }

  redirect(targetPath);
}

export async function updatePurchaseRequestAction(formData: FormData) {
  const context = await requirePermission("purchase_requests.manage");
  const id = idFrom(formData, "purchase_request_id");
  let targetPath = `/purchase/requests/${id}`;

  try {
    const result = await updatePurchaseWorkflow(
      context,
      updatePurchaseWorkflowSchema.parse({
        purchaseRequestId: id,
        status: formData.get("status"),
        supplier: formData.get("supplier") || undefined,
        purchaseOfficerNotes: formData.get("purchase_officer_notes") || undefined,
        quotationFileName: formData.get("quotation_file_name") || undefined,
        quotationFilePath: formData.get("quotation_file_path") || undefined
      })
    );
    revalidatePath(`/purchase/requests/${result.purchaseRequestId}`);
    revalidatePath("/purchase/requests");
    targetPath = `/purchase/requests/${result.purchaseRequestId}`;
  } catch (error) {
    redirect(`/purchase/requests/${id}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }

  redirect(targetPath);
}

export async function financeDecisionAction(formData: FormData) {
  const context = await requirePermission("finance.approve");
  const id = idFrom(formData, "purchase_request_id");
  let targetPath = `/purchase/requests/${id}`;

  try {
    const result = await decidePurchaseAsFinance(
      context,
      financeDecisionSchema.parse({
        purchaseRequestId: id,
        decision: formData.get("decision"),
        comments: formData.get("comments") || undefined
      })
    );
    revalidatePath(`/purchase/requests/${result.purchaseRequestId}`);
    revalidatePath("/finance/approvals");
    revalidatePath("/ceo/approvals");
    revalidatePath("/dashboard");
    targetPath = `/purchase/requests/${result.purchaseRequestId}`;
  } catch (error) {
    redirect(`/purchase/requests/${id}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }

  redirect(targetPath);
}

export async function ceoDecisionAction(formData: FormData) {
  const context = await requirePermission("ceo.approve");
  const id = idFrom(formData, "purchase_request_id");
  let targetPath = `/purchase/requests/${id}`;

  try {
    const result = await decidePurchaseAsCeo(
      context,
      ceoDecisionSchema.parse({
        purchaseRequestId: id,
        decision: formData.get("decision"),
        comments: formData.get("comments") || undefined
      })
    );
    revalidatePath(`/purchase/requests/${result.purchaseRequestId}`);
    revalidatePath("/ceo/approvals");
    revalidatePath("/purchase/requests");
    revalidatePath("/dashboard");
    targetPath = `/purchase/requests/${result.purchaseRequestId}`;
  } catch (error) {
    redirect(`/purchase/requests/${id}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }

  redirect(targetPath);
}

export async function receivePurchaseAction(formData: FormData) {
  const context = await requirePermission("purchase_requests.manage");
  const id = idFrom(formData, "purchase_request_id");
  let targetPath = `/purchase/requests/${id}`;

  try {
    const result = await receivePurchaseIntoInventory(
      context,
      receivePurchaseSchema.parse({ purchaseRequestId: id })
    );
    revalidatePath(`/purchase/requests/${result.purchaseRequestId}`);
    revalidatePath("/purchase/requests");
    revalidatePath("/store/parts");
    revalidatePath("/store/inventory-movements");
    if (result.workOrderId) revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    targetPath = `/purchase/requests/${result.purchaseRequestId}`;
  } catch (error) {
    redirect(`/purchase/requests/${id}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }

  redirect(targetPath);
}
