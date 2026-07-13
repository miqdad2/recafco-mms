"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission, requireUser } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { savePrivateFile } from "@/lib/files/local-storage";
import { validatePrivateFileWithOptions, ALLOWED_PRIVATE_FILE_TYPES, MAX_PRIVATE_FILE_SIZE, pickUploadedFile } from "@/lib/files/validation";
import { parsePendingAttachments, saveAttachmentBatch } from "@/lib/files/attachment-form";
import { MAX_ATTACHMENT_ROWS } from "@/lib/files/attachment-constants";
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
import { OPEN_PR_STATUSES } from "@/lib/display/parts-request-labels";

// ── Form parsing helpers (used for indexed item fields from parts-request form) ──

function field(formData: FormData, name: string, index: number) {
  return String(formData.get(`${name}_${index}`) ?? "").trim();
}

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseItems(formData: FormData) {
  return [0, 1, 2, 3, 4, 5, 6, 7]
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

  // Documents & Photos step — optional, files ride along in this same multipart submission.
  const pendingAttachments = parsePendingAttachments(formData, "pr_attachment", MAX_ATTACHMENT_ROWS);

  let targetPath = `/maintenance/work-orders/${workOrderId}`;
  try {
    const result = await createPartsRequest(context, {
      workOrderId,
      remarks: String(formData.get("remarks") ?? ""),
      items
    });

    // Uploaded only now that the materials request exists. A partial or total
    // upload failure never rolls back the materials request itself.
    let attachmentUploadFailed = false;
    if (pendingAttachments.length) {
      const savedAttachments = await saveAttachmentBatch("work-order-files", workOrderId, pendingAttachments);
      if (savedAttachments.length) {
        await prisma.parts_request_attachments.createMany({
          data: savedAttachments.map((a) => ({
            parts_request_id: result.partsRequestId,
            work_order_id: workOrderId,
            attachment_type: a.category,
            file_name: a.file.name,
            file_path: a.path,
            content_type: a.file.type,
            file_size: a.file.size,
            uploaded_by: context.userId,
          })),
        });
        for (const a of savedAttachments) {
          await writeAuditLog({
            actorId: context.userId,
            action: "file.upload",
            entityType: "parts_request",
            entityId: result.partsRequestId,
            summary: `Uploaded ${a.category} file to materials request during creation`,
            metadata: { fileName: a.file.name, bucket: "work-order-files", remarks: a.remarks },
          });
        }
      }
      if (savedAttachments.length < pendingAttachments.length) attachmentUploadFailed = true;
    }

    revalidatePath(`/maintenance/work-orders/${workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/store/parts-requests");
    revalidatePath("/dashboard");
    targetPath = `/store/parts-requests/${result.partsRequestId}${attachmentUploadFailed ? "?warning=attachments-failed" : ""}`;
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
    revalidatePath(`/store/parts-requests/${result.partsRequestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/dashboard");
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
    revalidatePath(`/store/parts-requests/${result.partsRequestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/dashboard");
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

  // Look up the linked work order now so we can revalidate its detail page after issue.
  const prLink = await prisma.parts_requests.findUnique({
    where: { id: requestId },
    select: { work_order_id: true },
  });
  const linkedWoId = prLink?.work_order_id ?? null;

  let targetPath = `/store/parts-requests/${requestId}`;
  try {
    const result = await issuePartsToRequest(context, {
      partsRequestId: requestId,
      items: storeItems,
      storeIssueComments: String(formData.get("store_issue_comments") ?? "") || null
    });
    revalidatePath(`/store/parts-requests/${requestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/store/parts");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    if (linkedWoId) revalidatePath(`/maintenance/work-orders/${linkedWoId}`);
    targetPath = `/store/parts-requests/${result.partsRequestId}`;
  } catch (error) {
    redirect(`/store/parts-requests/${requestId}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }
  redirect(targetPath);
}

// ── Quick receive from list modal (per-item, creates one movement per item) ─────

export async function quickReceiveMaterialsRequestAction(formData: FormData) {
  const context = await requireUser();
  const canReceive =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.approve") ||
    context.permissions.includes("store.issue");
  if (!canReceive) redirect("/dashboard?error=permission-denied");

  const requestId = idFrom(formData, "parts_request_id");

  try {
    const receivedFrom = String(formData.get("received_from") ?? "").trim() || null;
    const refNum = String(formData.get("reference_number") ?? "").trim() || null;
    const remarks = String(formData.get("remarks") ?? "").trim() || null;

    const request = await prisma.parts_requests.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        parts_request_number: true,
        status: true,
        work_order_id: true,
        parts_request_items: {
          select: {
            id: true,
            description: true,
            part_number: true,
            ss_rec_code: true,
            quantity_requested: true,
            issued_quantity: true,
          },
        },
      },
    });
    if (!request) throw new Error("Materials request not found.");
    if (!OPEN_PR_STATUSES.includes(request.status))
      throw new Error("This request has already been fully processed.");

    type ItemReceive = {
      itemId: string;
      description: string;
      partNumber: string | null;
      ssRecCode: string | null;
      qtyNow: number;
      unit: string;
      qtyIssued: number;
    };

    const toReceive: ItemReceive[] = [];
    for (const item of request.parts_request_items) {
      const rawQty = String(formData.get(`qty_${item.id}`) ?? "").trim();
      if (!rawQty) continue;
      const qty = parseFloat(rawQty);
      if (isNaN(qty) || qty <= 0) continue;

      const remaining = Number(item.quantity_requested) - Number(item.issued_quantity);
      if (qty > remaining + 1e-6) {
        throw new Error(
          `Cannot receive more than remaining quantity for "${item.description}". Remaining: ${remaining.toFixed(2)}.`
        );
      }

      toReceive.push({
        itemId: item.id,
        description: item.description,
        partNumber: item.part_number as string | null,
        ssRecCode: item.ss_rec_code as string | null,
        qtyNow: qty,
        unit: String(formData.get(`unit_${item.id}`) ?? "").trim() || "PCS",
        qtyIssued: Number(item.issued_quantity),
      });
    }

    if (toReceive.length === 0)
      throw new Error("Enter a quantity received for at least one item.");

    await prisma.$transaction(async (tx) => {
      for (const ir of toReceive) {
        await tx.offline_inventory_movements.create({
          data: {
            movement_type: "RECEIVED",
            movement_date: new Date(),
            manual_material_name: ir.description,
            manual_part_number: ir.partNumber ?? ir.ssRecCode ?? null,
            quantity: ir.qtyNow,
            unit: ir.unit,
            counterparty: receivedFrom,
            reference_number: refNum,
            related_work_order_id: request.work_order_id,
            purpose: `Material receive — ${request.parts_request_number ?? requestId}`,
            remarks,
            created_by: context.userId,
          },
        });

        await tx.parts_request_items.update({
          where: { id: ir.itemId },
          data: { issued_quantity: ir.qtyIssued + ir.qtyNow },
        });
      }

      const updatedItems = await tx.parts_request_items.findMany({
        where: { parts_request_id: requestId },
        select: { quantity_requested: true, issued_quantity: true },
      });

      const allFull = updatedItems.every(
        (it) => Number(it.issued_quantity) >= Number(it.quantity_requested) - 1e-6
      );
      const anyReceived = updatedItems.some((it) => Number(it.issued_quantity) > 1e-6);
      const newStatus = allFull ? "Issued" : anyReceived ? "Partially Issued" : request.status;

      await tx.parts_requests.update({
        where: { id: requestId },
        data: { status: newStatus, updated_by: context.userId },
      });

      if (newStatus === "Issued" && request.work_order_id) {
        const openSiblings = await tx.parts_requests.count({
          where: {
            work_order_id: request.work_order_id,
            id: { not: requestId },
            status: { in: OPEN_PR_STATUSES },
          },
        });
        if (openSiblings === 0) {
          const wo = await tx.work_orders.findUnique({
            where: { id: request.work_order_id },
            select: { status: true },
          });
          if (wo && ["Waiting for Parts", "Waiting for Purchase"].includes(wo.status)) {
            await tx.work_orders.update({
              where: { id: request.work_order_id },
              data: { status: "In Progress", updated_by: context.userId },
            });
          }
        }
      }
    });

    // Optional attachment — save after main transaction; failure is non-fatal.
    // The form pairs a normal file input with a camera-capture input under the
    // same name (either/or), so pick whichever one actually has content.
    const attachmentFile = pickUploadedFile(formData, "attachment_file");
    if (attachmentFile) {
      const attachmentType = String(formData.get("attachment_type") ?? "").trim() || "Received Material Photo";
      const validationErr = validatePrivateFileWithOptions(attachmentFile, {
        maxSizeBytes: MAX_PRIVATE_FILE_SIZE,
        allowedTypes: ALLOWED_PRIVATE_FILE_TYPES,
      });
      if (!validationErr) {
        try {
          const filePath = await savePrivateFile("work-order-files", request.work_order_id, attachmentFile);
          await prisma.parts_request_attachments.create({
            data: {
              parts_request_id: requestId,
              work_order_id: request.work_order_id,
              attachment_type: attachmentType,
              file_name: attachmentFile.name,
              file_path: filePath,
              content_type: attachmentFile.type,
              file_size: attachmentFile.size,
              uploaded_by: context.userId,
            },
          });
          await writeAuditLog({
            actorId: context.userId,
            action: "file.upload",
            entityType: "parts_request",
            entityId: requestId,
            summary: `Uploaded ${attachmentType} proof on material receipt`,
            metadata: { fileName: attachmentFile.name, bucket: "work-order-files", workOrderId: request.work_order_id },
          });
        } catch {
          // attachment save failure must not block the receipt confirmation
        }
      }
    }

    revalidatePath(`/store/parts-requests/${requestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/store/offline-inventory");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    if (request.work_order_id)
      revalidatePath(`/maintenance/work-orders/${request.work_order_id}`);
  } catch (error) {
    redirect(
      `/store/parts-requests?receive=${requestId}&receive_error=${encodeURIComponent(safeErrorMessage(error))}`
    );
  }
  redirect("/store/parts-requests");
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

// ── Receive material from a materials request ────────────────────────────────

export async function receiveMaterialFromRequestAction(formData: FormData) {
  const context = await requireUser();
  const canReceive =
    context.role?.slug === "super_admin" ||
    context.permissions.includes("parts_requests.approve") ||
    context.permissions.includes("store.issue");
  if (!canReceive) redirect("/dashboard?error=permission-denied");

  const requestId = idFrom(formData, "parts_request_id");
  let targetPath = `/store/parts-requests/${requestId}`;

  try {
    const qty = parseFloat(String(formData.get("quantity_received") ?? ""));
    if (isNaN(qty) || qty <= 0) throw new Error("Quantity must be greater than 0.");

    const materialName = String(formData.get("material_name") ?? "").trim();
    if (!materialName) throw new Error("Material name is required.");

    const unit = String(formData.get("unit") ?? "").trim() || "PCS";
    const counterparty = String(formData.get("received_from") ?? "").trim() || null;
    const refNum = String(formData.get("reference_number") ?? "").trim() || null;
    const remarks = String(formData.get("remarks") ?? "").trim() || null;

    const request = await prisma.parts_requests.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        work_order_id: true,
        parts_request_items: { select: { quantity_requested: true } },
      },
    });
    if (!request) throw new Error("Materials request not found.");
    if (!OPEN_PR_STATUSES.includes(request.status))
      throw new Error("This request has already been fully processed.");

    const totalRequested = request.parts_request_items.reduce(
      (sum, item) => sum + Number(item.quantity_requested),
      0,
    );
    if (totalRequested > 0 && qty > totalRequested)
      throw new Error(`Cannot receive more than requested (${totalRequested} ${unit}).`);

    const newStatus = totalRequested === 0 || qty >= totalRequested ? "Issued" : "Partially Issued";

    await prisma.$transaction(async (tx) => {
      await tx.offline_inventory_movements.create({
        data: {
          movement_type: "RECEIVED",
          movement_date: new Date(),
          manual_material_name: materialName,
          quantity: qty,
          unit,
          counterparty,
          reference_number: refNum,
          related_work_order_id: request.work_order_id,
          remarks,
          created_by: context.userId,
        },
      });

      await tx.parts_requests.update({
        where: { id: requestId },
        data: { status: newStatus, updated_by: context.userId },
      });

      // If this request is now fully received, check whether all sibling requests are done too.
      // If so, and the work order is blocked on materials, unblock it.
      if (newStatus === "Issued" && request.work_order_id) {
        const openSiblings = await tx.parts_requests.count({
          where: {
            work_order_id: request.work_order_id,
            id: { not: requestId },
            status: { in: OPEN_PR_STATUSES },
          },
        });
        if (openSiblings === 0) {
          const wo = await tx.work_orders.findUnique({
            where: { id: request.work_order_id },
            select: { status: true },
          });
          if (wo && ["Waiting for Parts", "Waiting for Purchase"].includes(wo.status)) {
            await tx.work_orders.update({
              where: { id: request.work_order_id },
              data: { status: "In Progress", updated_by: context.userId },
            });
          }
        }
      }
    });

    revalidatePath(`/store/parts-requests/${requestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/store/offline-inventory");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    if (request.work_order_id)
      revalidatePath(`/maintenance/work-orders/${request.work_order_id}`);
    targetPath = `/store/parts-requests/${requestId}`;
  } catch (error) {
    redirect(
      `/store/parts-requests/${requestId}?error=${encodeURIComponent(safeErrorMessage(error))}`,
    );
  }
  redirect(targetPath);
}

// ── Purchase request actions (already delegating to service layer) ────────────

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
