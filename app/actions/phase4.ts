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
import { OPEN_PR_STATUSES, displayPartsRequestStatus } from "@/lib/display/parts-request-labels";
import { canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";
import { computeBalance } from "@/app/actions/offline-inventory";
import { normalizeCategory } from "@/components/store/offline-inventory-types";

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

async function requireReceiveIssuePermission() {
  const context = await requireUser();
  if (!canReceiveIssueMaterials(context)) redirect("/dashboard?error=permission-denied");
  return context;
}

// ── Parts request actions ────────────────────────────────────────────────────

export async function createPartsRequestAction(formData: FormData) {
  const context = await requirePartsRequestCreator();
  const workOrderId = idFrom(formData, "work_order_id");
  const items = parseItems(formData);
  if (!items.length) redirect(`/maintenance/work-orders/${workOrderId}?error=no-items`);
  if (items.some((item) => !Number.isInteger(item.quantity_requested) || item.quantity_requested <= 0)) {
    redirect(
      `/maintenance/work-orders/${workOrderId}?error=${encodeURIComponent("Quantity must be a whole number greater than 0.")}`
    );
  }

  // Attachments step — optional, files ride along in this same multipart submission.
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

    // Redirect to the list, never straight to the detail page — the detail
    // page already degrades gracefully (no notFound()), but landing on the
    // list keeps this consistent with the Job Card create flow and lets the
    // success modal render from query params alone (MaterialsRequest-
    // CreateSuccess-UX-01 Tasks 3/4).
    targetPath =
      `/store/parts-requests?success=materials-request-created&created=${result.partsRequestId}&mr=${encodeURIComponent(result.partsRequestNumber ?? "")}${attachmentUploadFailed ? "&warning=attachments-failed" : ""}`;

    console.log("[phase4.createPartsRequestAction] Materials Request created:", {
      id: result.partsRequestId,
      parts_request_number: result.partsRequestNumber,
      created_by: context.userId,
      status: result.status,
      work_order_id: result.workOrderId,
      redirectUrl: targetPath,
    });
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

// ── Receive materials against a request (Data Entry/Manager/Admin) ──────────────
// Creates one "RECEIVED" Offline Inventory Control movement per item with a
// quantity entered, linked to both the Materials Request and its Job Card,
// then moves the request to the simple "Received" status (internally still
// "Waiting for Store" — see lib/display/parts-request-labels.ts).
// MaterialsRequest-DataEntryReceiveIssue-01 Tasks 1/4/5/12.

export async function receiveMaterialsForRequestAction(formData: FormData) {
  const context = await requireReceiveIssuePermission();
  const isManagerOrAdmin =
    context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";

  const requestId = idFrom(formData, "parts_request_id");
  let attachmentUploadFailed = false;

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
      const qty = Number(rawQty);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error("Quantity received must be a whole number greater than 0.");
      }

      // Data Entry is capped at the remaining requested quantity; Manager/Admin
      // may receive more than requested (Task 4's explicit exception).
      const remaining = Number(item.quantity_requested) - Number(item.issued_quantity);
      if (!isManagerOrAdmin && qty > remaining + 1e-6) {
        throw new Error(
          `Cannot receive more than the requested quantity for "${item.description}". Remaining: ${remaining.toFixed(2)}.`
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
            manual_part_number: ir.partNumber,
            ss_rec_code: ir.ssRecCode,
            category: normalizeCategory(null),
            quantity: ir.qtyNow,
            unit: ir.unit,
            counterparty: receivedFrom,
            reference_number: refNum,
            related_work_order_id: request.work_order_id,
            parts_request_id: requestId,
            purpose: `Material receive — ${request.parts_request_number ?? requestId}`,
            remarks,
            created_by: context.userId,
          },
        });

        await tx.parts_request_items.update({
          where: { id: ir.itemId },
          data: { issued_quantity: ir.qtyIssued + ir.qtyNow },
        });

        await writeAuditLog({
          actorId: context.userId,
          action: "parts_request.receive",
          entityType: "parts_request",
          entityId: requestId,
          summary: `Received ${ir.qtyNow} ${ir.unit} of "${ir.description}" for ${request.parts_request_number ?? requestId}`,
          metadata: {
            partsRequestId: requestId,
            workOrderId: request.work_order_id,
            materialName: ir.description,
            quantity: ir.qtyNow,
            unit: ir.unit,
            receivedFrom,
            referenceNumber: refNum,
            remarks,
          },
        });
      }

      // Simple status model (Task 2/5): any successful receive moves the
      // request straight to "Received" — no partial/full distinction any
      // more. Internally this is the pre-existing, otherwise-unused
      // "Waiting for Store" status value; see parts-request-labels.ts.
      await tx.parts_requests.update({
        where: { id: requestId },
        data: { status: "Waiting for Store", updated_by: context.userId },
      });
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
      if (validationErr) {
        attachmentUploadFailed = true;
      } else {
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
          attachmentUploadFailed = true;
        }
      }
    }

    revalidatePath(`/store/parts-requests/${requestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/store/offline-inventory");
    revalidatePath("/store/offline-inventory/movements");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    if (request.work_order_id)
      revalidatePath(`/maintenance/work-orders/${request.work_order_id}`);
  } catch (error) {
    redirect(
      `/store/parts-requests?receive=${requestId}&receive_error=${encodeURIComponent(safeErrorMessage(error))}`
    );
  }
  redirect(
    `/store/parts-requests?success=material-request-received&received=${encodeURIComponent(requestId)}${attachmentUploadFailed ? "&warning=attachments-failed" : ""}`
  );
}

// ── Issue materials against a request (Data Entry/Manager/Admin) ────────────────
// Creates one "ISSUED" Offline Inventory Control movement per material line
// that was previously received against this request, decreasing the store
// balance, linked to both the Materials Request and its Job Card.
// MaterialsRequest-DataEntryReceiveIssue-01 Tasks 1/6/7/12.

export async function issueMaterialsForRequestAction(formData: FormData) {
  const context = await requireReceiveIssuePermission();

  const requestId = idFrom(formData, "parts_request_id");
  let attachmentUploadFailed = false;

  try {
    const issuedTo = String(formData.get("issued_to") ?? "").trim() || null;
    const remarks = String(formData.get("remarks") ?? "").trim() || null;

    const request = await prisma.parts_requests.findUnique({
      where: { id: requestId },
      select: { id: true, parts_request_number: true, status: true, work_order_id: true },
    });
    if (!request) throw new Error("Materials request not found.");
    if (request.status !== "Waiting for Store" && request.status !== "Partially Issued") {
      throw new Error("This request has no received materials waiting to be issued.");
    }

    // The materials actually available to issue are whatever was received
    // against THIS request — read from the movement ledger itself (the
    // source of truth for the store balance), not the item rows, since the
    // unit chosen at receive time isn't stored anywhere else.
    const receivedLines = await prisma.offline_inventory_movements.findMany({
      where: { parts_request_id: requestId, movement_type: "RECEIVED", deleted_at: null },
      select: {
        part_id: true,
        manual_material_name: true,
        manual_part_number: true,
        ss_rec_code: true,
        unit: true,
      },
      distinct: ["part_id", "manual_material_name", "unit"],
    });
    if (receivedLines.length === 0) {
      throw new Error("No received materials found for this request.");
    }

    type ItemIssue = {
      partId: string | null;
      materialName: string | null;
      partNumber: string | null;
      ssRecCode: string | null;
      unit: string;
      qty: number;
      available: number;
    };

    const toIssue: ItemIssue[] = [];
    for (const line of receivedLines) {
      const lineKey = line.part_id ?? `${line.manual_material_name ?? ""}|${line.unit}`;
      const rawQty = String(formData.get(`issueQty_${lineKey}`) ?? "").trim();
      if (!rawQty) continue;
      const qty = Number(rawQty);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error("Quantity to issue must be a whole number greater than 0.");
      }

      const available = await computeBalance({
        partId: line.part_id,
        manualName: line.manual_material_name,
        unit: line.unit,
      });
      if (available <= 0) {
        throw new Error(`No available balance for "${line.manual_material_name ?? "this material"}".`);
      }
      if (qty > available) {
        throw new Error(
          `Cannot issue more than the available balance for "${line.manual_material_name ?? "this material"}". Available: ${available} ${line.unit}.`
        );
      }

      toIssue.push({
        partId: line.part_id,
        materialName: line.manual_material_name,
        partNumber: line.manual_part_number,
        ssRecCode: line.ss_rec_code,
        unit: line.unit,
        qty,
        available,
      });
    }

    if (toIssue.length === 0) throw new Error("Enter a quantity to issue for at least one material.");

    await prisma.$transaction(async (tx) => {
      for (const ii of toIssue) {
        await tx.offline_inventory_movements.create({
          data: {
            movement_type: "ISSUED",
            movement_date: new Date(),
            part_id: ii.partId,
            manual_material_name: ii.partId ? null : ii.materialName,
            manual_part_number: ii.partId ? null : ii.partNumber,
            ss_rec_code: ii.ssRecCode,
            category: normalizeCategory(null),
            quantity: ii.qty,
            unit: ii.unit,
            counterparty: issuedTo,
            purpose: `Material issue — ${request.parts_request_number ?? requestId}`,
            related_work_order_id: request.work_order_id,
            parts_request_id: requestId,
            remarks,
            created_by: context.userId,
          },
        });

        await writeAuditLog({
          actorId: context.userId,
          action: "parts_request.issue",
          entityType: "parts_request",
          entityId: requestId,
          summary: `Issued ${ii.qty} ${ii.unit} of "${ii.materialName ?? ii.partNumber ?? "material"}" for ${request.parts_request_number ?? requestId}`,
          metadata: {
            partsRequestId: requestId,
            workOrderId: request.work_order_id,
            materialName: ii.materialName,
            quantity: ii.qty,
            unit: ii.unit,
            issuedTo,
            remarks,
          },
        });
      }

      // Simple status model (Task 2/7): any successful issue against a
      // Received request moves it straight to "Issued".
      await tx.parts_requests.update({
        where: { id: requestId },
        data: { status: "Issued", updated_by: context.userId },
      });

      if (request.work_order_id) {
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

    // Optional attachment — same non-fatal pattern as receive.
    const attachmentFile = pickUploadedFile(formData, "attachment_file");
    if (attachmentFile) {
      const attachmentType = String(formData.get("attachment_type") ?? "").trim() || "Material Issue Photo";
      const validationErr = validatePrivateFileWithOptions(attachmentFile, {
        maxSizeBytes: MAX_PRIVATE_FILE_SIZE,
        allowedTypes: ALLOWED_PRIVATE_FILE_TYPES,
      });
      if (validationErr) {
        attachmentUploadFailed = true;
      } else {
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
            summary: `Uploaded ${attachmentType} proof on material issue`,
            metadata: { fileName: attachmentFile.name, bucket: "work-order-files", workOrderId: request.work_order_id },
          });
        } catch {
          // attachment save failure must not block the issue confirmation
          attachmentUploadFailed = true;
        }
      }
    }

    revalidatePath(`/store/parts-requests/${requestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/store/offline-inventory");
    revalidatePath("/store/offline-inventory/movements");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    if (request.work_order_id)
      revalidatePath(`/maintenance/work-orders/${request.work_order_id}`);
  } catch (error) {
    redirect(
      `/store/parts-requests?issueMr=${requestId}&issue_error=${encodeURIComponent(safeErrorMessage(error))}`
    );
  }
  redirect(
    `/store/parts-requests?success=material-request-issued&issued=${encodeURIComponent(requestId)}${attachmentUploadFailed ? "&warning=attachments-failed" : ""}`
  );
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
  const context = await requireReceiveIssuePermission();

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
        parts_request_number: true,
        status: true,
        work_order_id: true,
        parts_request_items: { select: { quantity_requested: true } },
      },
    });
    if (!request) throw new Error("Materials request not found.");
    if (displayPartsRequestStatus(request.status) !== "Requested")
      throw new Error("This request has already been received or processed.");

    const totalRequested = request.parts_request_items.reduce(
      (sum, item) => sum + Number(item.quantity_requested),
      0,
    );
    const isManagerOrAdmin =
      context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
    if (!isManagerOrAdmin && totalRequested > 0 && qty > totalRequested)
      throw new Error(`Cannot receive more than requested (${totalRequested} ${unit}).`);

    // Simple status model (Task 2/5): receiving always moves the request to
    // "Received" (internally "Waiting for Store") — Issued only happens via
    // a separate, explicit issue action against the store balance.
    await prisma.$transaction(async (tx) => {
      await tx.offline_inventory_movements.create({
        data: {
          movement_type: "RECEIVED",
          movement_date: new Date(),
          manual_material_name: materialName,
          category: normalizeCategory(null),
          quantity: qty,
          unit,
          counterparty,
          reference_number: refNum,
          related_work_order_id: request.work_order_id,
          parts_request_id: requestId,
          purpose: `Material receive — ${request.parts_request_number ?? requestId}`,
          remarks,
          created_by: context.userId,
        },
      });

      await tx.parts_requests.update({
        where: { id: requestId },
        data: { status: "Waiting for Store", updated_by: context.userId },
      });
    });

    await writeAuditLog({
      actorId: context.userId,
      action: "parts_request.receive",
      entityType: "parts_request",
      entityId: requestId,
      summary: `Received ${qty} ${unit} of "${materialName}" for ${request.parts_request_number ?? requestId}`,
      metadata: {
        partsRequestId: requestId,
        workOrderId: request.work_order_id,
        materialName,
        quantity: qty,
        unit,
        receivedFrom: counterparty,
        referenceNumber: refNum,
        remarks,
      },
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
