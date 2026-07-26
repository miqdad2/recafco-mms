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
  issueMaterials,
  rejectPartsRequest
} from "@/lib/backend/parts-requests/service";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { errorToLogInput, logSystemError } from "@/lib/errors/logging";
import { prisma } from "@/lib/db/prisma";
import { OPEN_PR_STATUSES } from "@/lib/display/parts-request-labels";
import { canReceiveIssueMaterials } from "@/lib/parts-requests/visibility";
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
    // New Job Card Wizard Cleanup + Draft/Material Submit Fix Task 10: this
    // previously redirected with a safe message but never wrote to
    // system_error_logs — matches the workflowErrorPath pattern already used
    // for every action in app/actions/workflow.ts.
    await logSystemError(errorToLogInput(error, "phase4.createPartsRequestAction", context.userId, {
      entityType: "work_order",
      entityId: workOrderId,
      route: `/maintenance/work-orders/${workOrderId}`
    }));
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

// Unit 5: now delegates to issueMaterials — the Offline Inventory Control-
// backed engine — instead of the disabled, parts-catalog-based
// issuePartsToRequest. The form is unchanged (issued_{id} inputs still send
// the item's new total issued quantity, matching issueMaterials' absolute
// semantics), so the existing StoreIssuePanel UI keeps working as-is.
// "Unavailable" checkboxes no longer set a per-item state (that concept is
// gone) — leaving an item's issued quantity unchanged and checking it as
// unavailable simply means nothing is recorded for that item this call.
export async function storeIssueAction(formData: FormData) {
  const context = await requirePermission("store.issue");
  const requestId = idFrom(formData, "parts_request_id");

  // Fetch items here to resolve dynamic form keys (issued_{id}).
  // Item IDs come from the DB, not the submitted form, so the mapping is tamper-safe.
  const rawItems = await prisma.parts_request_items.findMany({
    where: { parts_request_id: requestId },
    select: { id: true, quantity_requested: true }
  });

  const items: { itemId: string; quantity: number }[] = [];
  for (const item of rawItems) {
    const issued = num(formData.get(`issued_${item.id}`));
    if (issued < 0 || issued > Number(item.quantity_requested)) {
      redirect(`/store/parts-requests/${requestId}?error=invalid-issued-quantity`);
    }
    items.push({ itemId: item.id, quantity: issued });
  }

  // Look up the linked work order now so we can revalidate its detail page after issue.
  const prLink = await prisma.parts_requests.findUnique({
    where: { id: requestId },
    select: { work_order_id: true },
  });
  const linkedWoId = prLink?.work_order_id ?? null;

  let targetPath = `/store/parts-requests/${requestId}`;
  try {
    const result = await issueMaterials(context, {
      partsRequestId: requestId,
      items,
      reason: String(formData.get("store_issue_comments") ?? "") || undefined
    });
    revalidatePath(`/store/parts-requests/${requestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/store/issue-materials");
    revalidatePath("/store/offline-inventory");
    revalidatePath("/store/offline-inventory/movements");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    if (linkedWoId) revalidatePath(`/maintenance/work-orders/${linkedWoId}`);
    targetPath = `/store/parts-requests/${result.partsRequestId}`;
  } catch (error) {
    redirect(`/store/parts-requests/${requestId}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }
  redirect(targetPath);
}

export type StoreIssueModalState = {
  ok: boolean;
  error?: string;
  partsRequestId?: string;
  partsRequestNumber?: string | null;
  workOrderId?: string | null;
  workOrderNumber?: string | null;
  status?: string;
} | null;

// Store Guided Send Materials Popup Workflow Unit Task 3/4/5: a non-redirecting
// sibling of storeIssueAction, for the dashboard's guided popup — reuses
// issueMaterials exactly as-is (same permission check, same Job Card approval
// gate, same quantity validation, same no-stock-balance behavior, same
// movement/notification/realtime side effects), just returns a result instead
// of redirecting so the popup can show a success/error state in place.
export async function storeIssueModalAction(
  _prev: StoreIssueModalState,
  formData: FormData
): Promise<StoreIssueModalState> {
  const context = await requirePermission("store.issue");
  const parsedId = z.uuid().safeParse(formData.get("parts_request_id"));
  if (!parsedId.success) {
    return { ok: false, error: "Invalid Materials Request." };
  }
  const requestId = parsedId.data;

  const rawItems = await prisma.parts_request_items.findMany({
    where: { parts_request_id: requestId },
    select: { id: true, quantity_requested: true }
  });

  const items: { itemId: string; quantity: number }[] = [];
  for (const item of rawItems) {
    const issued = num(formData.get(`issued_${item.id}`));
    if (issued < 0 || issued > Number(item.quantity_requested)) {
      return { ok: false, error: "Quantity cannot be more than the remaining requested quantity." };
    }
    items.push({ itemId: item.id, quantity: issued });
  }

  try {
    const result = await issueMaterials(context, {
      partsRequestId: requestId,
      items,
      reason: String(formData.get("store_issue_comments") ?? "") || undefined
    });

    const updated = await prisma.parts_requests.findUnique({
      where: { id: result.partsRequestId },
      select: {
        parts_request_number: true,
        status: true,
        work_order_id: true,
        work_orders: { select: { work_order_number: true } }
      }
    });

    revalidatePath(`/store/parts-requests/${requestId}`);
    revalidatePath("/store/parts-requests");
    revalidatePath("/store/issue-materials");
    revalidatePath("/store/offline-inventory");
    revalidatePath("/store/offline-inventory/movements");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    if (updated?.work_order_id) revalidatePath(`/maintenance/work-orders/${updated.work_order_id}`);

    return {
      ok: true,
      partsRequestId: result.partsRequestId,
      partsRequestNumber: updated?.parts_request_number ?? null,
      workOrderId: updated?.work_order_id ?? null,
      workOrderNumber: updated?.work_orders?.work_order_number ?? null,
      status: updated?.status
    };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
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
    };

    const toReceive: ItemReceive[] = [];
    for (const item of request.parts_request_items) {
      const rawQty = String(formData.get(`qty_${item.id}`) ?? "").trim();
      if (!rawQty) continue;
      const qty = Number(rawQty);
      if (!Number.isInteger(qty) || qty <= 0) {
        throw new Error("Quantity received must be a whole number greater than 0.");
      }

      // Data Entry is capped at the requested quantity; Manager/Admin may
      // receive more than requested (Task 4's explicit exception). Unit 5:
      // receiving no longer touches issued_quantity (that's issueMaterials'
      // job now), so the cap is against the requested total, not a
      // receive-tracked "remaining".
      const requestedQty = Number(item.quantity_requested);
      if (!isManagerOrAdmin && qty > requestedQty + 1e-6) {
        throw new Error(
          `Cannot receive more than the requested quantity for "${item.description}" (${requestedQty}).`
        );
      }

      toReceive.push({
        itemId: item.id,
        description: item.description,
        partNumber: item.part_number as string | null,
        ssRecCode: item.ss_rec_code as string | null,
        qtyNow: qty,
        unit: String(formData.get(`unit_${item.id}`) ?? "").trim() || "PCS",
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

      // Unit 5: receiving stock into the Offline Inventory Control ledger no
      // longer changes the Materials Request's status — "Waiting for Store"
      // is not a valid status in the simplified model. Receiving is now a
      // general store stock-in event, decoupled from any one request's
      // lifecycle; issuing (issueMaterials) is what advances request status.
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
// Disabled (Unit 5). This action's model — issue against whatever was
// RECEIVED specifically for this request, keyed by a derived part/material
// line rather than parts_request_items.id — no longer fits the simplified
// engine: receiving is now decoupled from any one request (see
// receiveMaterialsForRequestAction above), and issuing goes through
// issueMaterials (itemId-based, absolute-total semantics) via storeIssueAction
// on the Materials Request detail page instead. That page's Store Issue
// panel is the supported issue path; this list-page quick action returns a
// clear "not ready" message until Unit 9 wires it to the new engine.
export async function issueMaterialsForRequestAction(formData: FormData) {
  await requireReceiveIssuePermission();
  const requestId = idFrom(formData, "parts_request_id");
  redirect(
    `/store/parts-requests?issueMr=${requestId}&issue_error=${encodeURIComponent("This action is no longer used in the simplified workflow. Use the Materials Request detail page to issue materials.")}`
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
    // Unit 5: receiving is a general store stock-in event, decoupled from the
    // request's lifecycle status — only blocked once the request is fully
    // Issued (nothing left to usefully receive against it).
    if (request.status === "Issued")
      throw new Error("This request has already been fully issued.");

    const totalRequested = request.parts_request_items.reduce(
      (sum, item) => sum + Number(item.quantity_requested),
      0,
    );
    const isManagerOrAdmin =
      context.role?.slug === "super_admin" || context.role?.slug === "maintenance_manager";
    if (!isManagerOrAdmin && totalRequested > 0 && qty > totalRequested)
      throw new Error(`Cannot receive more than requested (${totalRequested} ${unit}).`);

    // Unit 5: receiving into the Offline Inventory Control ledger no longer
    // changes the Materials Request's status ("Waiting for Store" is not a
    // valid status in the simplified model) — issuing (issueMaterials) is
    // what advances request status.
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
