"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/log";
import { requireUser } from "@/lib/auth/context";
import { getFileSecuritySettings } from "@/lib/files/settings";
import { savePrivateFile } from "@/lib/files/local-storage";
import {
  safeStorageName,
  validatePrivateFileWithOptions,
  type PrivateFileBucket,
} from "@/lib/files/validation";
import { notifyByEvent } from "@/lib/notifications/service";
import { prisma } from "@/lib/db/prisma";

const uuid = z.string().uuid();
const text = z.string().trim().min(2).max(80);
const purchaseFileType = z.enum(["quotation", "invoice", "delivery_note"]);

function canByPermission(
  permissions: string[],
  roleSlug: string | undefined,
  permission: string
) {
  return roleSlug === "super_admin" || permissions.includes(permission);
}

/**
 * Reads IP and user-agent from the current request headers for audit metadata.
 * Wrapped in try/catch so it never blocks an upload action.
 */
async function getRequestMeta() {
  try {
    const h = await headers();
    return {
      ip: h.get("x-forwarded-for") ?? h.get("x-real-ip") ?? "unknown",
      ua: h.get("user-agent") ?? "",
    };
  } catch {
    return { ip: "unknown", ua: "" };
  }
}

/**
 * Verifies the caller may upload files to a specific work order.
 *
 * Access rules (evaluated in order):
 *   super_admin                         — always allowed (bypassed via canByPermission)
 *   files.upload + work_orders.manage   — allowed for any existing work order
 *   files.upload + technician.jobs.update
 *                                       — allowed only when assigned to the work order
 *
 * WHY work_orders.manage IS INTENTIONALLY GLOBAL
 * ─────────────────────────────────────────────
 * work_orders.manage means "create and update maintenance work orders" with no
 * per-creator or per-department qualifier. This is a deliberate design decision:
 *
 *   • maintenance_manager    — has work_orders.manage, but NOT files.upload
 *                              (Phase 5 migration). Cannot reach this path.
 *   • maintenance_supervisor — same as above. Cannot reach this path.
 *   • maintenance_data_entry — has BOTH work_orders.manage AND files.upload.
 *                              This is the only non-super-admin, non-technician
 *                              role that can upload to work-order-files.
 *
 * A data entry clerk in a construction company processes paper forms for the
 * entire maintenance department — not only work orders they personally created.
 * Restricting uploads to created_by = userId would break the core workflow
 * where one operator digitises all department paperwork.
 *
 * If per-creator scoping is required in future, add a created_by check inside
 * the canManage branch and update the permission description accordingly.
 * ─────────────────────────────────────────────
 *
 * On any denial:
 *   - writes a file.upload_denied audit log entry (non-blocking)
 *   - redirects without saving the file
 *
 * On success: returns the current user context.
 */
async function canUploadWorkOrder(workOrderId: string) {
  const context = await requireUser();
  const meta = await getRequestMeta();
  const auditBase = { bucket: "work-order-files", entity_id: workOrderId, ...meta };

  const hasUpload = canByPermission(context.permissions, context.role?.slug, "files.upload");
  const canManage = canByPermission(context.permissions, context.role?.slug, "work_orders.manage");
  const canTechUpdate = canByPermission(
    context.permissions,
    context.role?.slug,
    "technician.jobs.update"
  );

  if (!hasUpload || (!canManage && !canTechUpdate)) {
    await writeAuditLog({
      actorId: context.userId,
      action: "file.upload_denied",
      entityType: "work_order",
      entityId: workOrderId,
      summary: "Work order file upload denied: insufficient permission",
      metadata: { ...auditBase, reason: "permission" },
    }).catch(() => {});
    redirect(`/maintenance/work-orders/${workOrderId}?error=upload-permission`);
  }

  // Entity existence check — prevents uploads to non-existent records.
  let wo: { id: string } | null = null;
  try {
    wo = await prisma.work_orders.findUnique({ where: { id: workOrderId }, select: { id: true } });
  } catch {
    // fail-closed: deny on DB error
  }

  if (!wo) {
    await writeAuditLog({
      actorId: context.userId,
      action: "file.upload_denied",
      entityType: "work_order",
      entityId: workOrderId,
      summary: "Work order file upload denied: work order not found",
      metadata: { ...auditBase, reason: "entity_not_found" },
    }).catch(() => {});
    redirect(`/maintenance/work-orders?error=not-found`);
  }

  if (!canManage) {
    // Technician path: must be explicitly assigned to this specific work order.
    let assignment: { id: string } | null = null;
    try {
      assignment = await prisma.work_order_assignments.findFirst({
        where: { work_order_id: workOrderId, technician_id: context.userId },
        select: { id: true },
      });
    } catch {
      // fail-closed: deny on DB error
    }

    if (!assignment) {
      await writeAuditLog({
        actorId: context.userId,
        action: "file.upload_denied",
        entityType: "work_order",
        entityId: workOrderId,
        summary: "Work order file upload denied: technician not assigned to this work order",
        metadata: { ...auditBase, reason: "not_assigned" },
      }).catch(() => {});
      redirect(`/maintenance/work-orders/${workOrderId}?error=upload-permission`);
    }
  }

  return context;
}

async function uploadPrivateFile(bucket: PrivateFileBucket, folder: string, file: File) {
  const settings = await getFileSecuritySettings();
  const validationError = validatePrivateFileWithOptions(file, {
    maxSizeBytes: settings.maxUploadSizeBytes,
    allowedTypes: settings.allowedFileTypes,
  });
  if (validationError) {
    return { error: validationError };
  }

  return { path: await savePrivateFile(bucket, folder, file) };
}

function fileFrom(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return null;
  }
  return file;
}

export async function uploadWorkOrderFileAction(formData: FormData) {
  const workOrderId = uuid.parse(formData.get("work_order_id"));
  const context = await canUploadWorkOrder(workOrderId);
  const attachmentType = text.parse(formData.get("attachment_type") || "Attachment");
  const file = fileFrom(formData);
  if (!file) redirect(`/maintenance/work-orders/${workOrderId}?error=no-file`);

  const result = await uploadPrivateFile("work-order-files", workOrderId, file);
  if (result.error || !result.path)
    redirect(`/maintenance/work-orders/${workOrderId}?error=file-upload-failed`);

  try {
    await prisma.work_order_attachments.create({
      data: {
        work_order_id: workOrderId,
        attachment_type: attachmentType,
        file_name: file.name,
        file_path: result.path!,
        content_type: file.type,
        file_size: file.size,
        uploaded_by: context.userId,
      },
    });
  } catch {
    redirect(`/maintenance/work-orders/${workOrderId}?error=file-metadata-failed`);
  }

  await writeAuditLog({
    actorId: context.userId,
    action: "file.upload",
    entityType: "work_order",
    entityId: workOrderId,
    summary: `Uploaded ${attachmentType} file to work order`,
    metadata: { fileName: file.name, bucket: "work-order-files" },
  });
  await notifyByEvent({
    eventKey: "file.uploaded",
    entityType: "work_order",
    entityId: workOrderId,
    actorId: context.userId,
    recipientRoles: ["maintenance_manager"],
    metadata: {
      entity_type: "work_order",
      file_name: safeStorageName(file.name),
      action_url: `/maintenance/work-orders/${workOrderId}`,
    },
    actionUrl: `/maintenance/work-orders/${workOrderId}`,
    actionLabel: "Open work order",
  });

  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  revalidatePath(`/technician/jobs/${workOrderId}`);
  redirect(String(formData.get("return_to") || `/maintenance/work-orders/${workOrderId}`));
}

export async function uploadAssetFileAction(formData: FormData) {
  const context = await requireUser();
  const assetId = uuid.parse(formData.get("asset_id"));
  const meta = await getRequestMeta();
  const auditBase = { bucket: "asset-files", entity_id: assetId, ...meta };

  if (
    !canByPermission(context.permissions, context.role?.slug, "assets.manage") ||
    !canByPermission(context.permissions, context.role?.slug, "files.upload")
  ) {
    await writeAuditLog({
      actorId: context.userId,
      action: "file.upload_denied",
      entityType: "asset",
      entityId: assetId,
      summary: "Asset file upload denied: insufficient permission",
      metadata: { ...auditBase, reason: "permission" },
    }).catch(() => {});
    redirect(`/assets/${assetId}?error=upload-permission`);
  }

  // Entity existence check — prevents uploads against non-existent asset records.
  let asset: { id: string } | null = null;
  try {
    asset = await prisma.assets.findUnique({ where: { id: assetId }, select: { id: true } });
  } catch {
    // fail-closed: deny on DB error
  }

  if (!asset) {
    await writeAuditLog({
      actorId: context.userId,
      action: "file.upload_denied",
      entityType: "asset",
      entityId: assetId,
      summary: "Asset file upload denied: asset not found",
      metadata: { ...auditBase, reason: "entity_not_found" },
    }).catch(() => {});
    redirect(`/assets?error=not-found`);
  }

  const documentType = text.parse(formData.get("document_type") || "Asset Document");
  const file = fileFrom(formData);
  if (!file) redirect(`/assets/${assetId}?error=no-file`);

  const result = await uploadPrivateFile("asset-files", assetId, file);
  if (result.error || !result.path) redirect(`/assets/${assetId}?error=file-upload-failed`);

  try {
    await prisma.asset_documents.create({
      data: {
        asset_id: assetId,
        document_type: documentType,
        file_name: file.name,
        file_path: result.path!,
        content_type: file.type,
        file_size: file.size,
        uploaded_by: context.userId,
      },
    });
  } catch {
    redirect(`/assets/${assetId}?error=file-metadata-failed`);
  }

  await writeAuditLog({
    actorId: context.userId,
    action: "file.upload",
    entityType: "asset",
    entityId: assetId,
    summary: `Uploaded ${documentType} file to asset`,
    metadata: { fileName: file.name, bucket: "asset-files" },
  });
  await notifyByEvent({
    eventKey: "file.uploaded",
    entityType: "asset",
    entityId: assetId,
    actorId: context.userId,
    recipientRoles: ["maintenance_manager"],
    metadata: {
      entity_type: "asset",
      file_name: safeStorageName(file.name),
      action_url: `/assets/${assetId}`,
    },
    actionUrl: `/assets/${assetId}`,
    actionLabel: "Open asset",
  });

  revalidatePath(`/assets/${assetId}`);
  redirect(`/assets/${assetId}`);
}

export async function uploadPurchaseFileAction(formData: FormData) {
  const context = await requireUser();
  const purchaseRequestId = uuid.parse(formData.get("purchase_request_id"));
  const meta = await getRequestMeta();
  const auditBase = { bucket: "purchase-files", entity_id: purchaseRequestId, ...meta };

  // Purchase officers (purchase_requests.manage) and finance managers (finance.approve)
  // are both permitted to upload financial documents to purchase requests.
  const canUpload =
    (canByPermission(context.permissions, context.role?.slug, "purchase_requests.manage") ||
      canByPermission(context.permissions, context.role?.slug, "finance.approve")) &&
    canByPermission(context.permissions, context.role?.slug, "files.upload");

  if (!canUpload) {
    await writeAuditLog({
      actorId: context.userId,
      action: "file.upload_denied",
      entityType: "purchase_request",
      entityId: purchaseRequestId,
      summary: "Purchase file upload denied: insufficient permission",
      metadata: { ...auditBase, reason: "permission" },
    }).catch(() => {});
    redirect(`/purchase/requests/${purchaseRequestId}?error=upload-permission`);
  }

  // Entity existence check — prevents uploads against non-existent purchase requests.
  let pr: { id: string } | null = null;
  try {
    pr = await prisma.purchase_requests.findUnique({ where: { id: purchaseRequestId }, select: { id: true } });
  } catch {
    // fail-closed: deny on DB error
  }

  if (!pr) {
    await writeAuditLog({
      actorId: context.userId,
      action: "file.upload_denied",
      entityType: "purchase_request",
      entityId: purchaseRequestId,
      summary: "Purchase file upload denied: purchase request not found",
      metadata: { ...auditBase, reason: "entity_not_found" },
    }).catch(() => {});
    redirect(`/purchase/requests?error=not-found`);
  }

  const fileType = purchaseFileType.parse(formData.get("file_type"));
  const file = fileFrom(formData);
  if (!file) redirect(`/purchase/requests/${purchaseRequestId}?error=no-file`);

  const result = await uploadPrivateFile("purchase-files", purchaseRequestId, file);
  if (result.error || !result.path)
    redirect(`/purchase/requests/${purchaseRequestId}?error=file-upload-failed`);

  try {
    await prisma.purchase_requests.update({
      where: { id: purchaseRequestId },
      data:
        fileType === "quotation"
          ? { quotation_file_name: file.name, quotation_file_path: result.path!, updated_by: context.userId }
          : fileType === "invoice"
          ? { invoice_file_name: file.name, invoice_file_path: result.path!, updated_by: context.userId }
          : { delivery_note_file_name: file.name, delivery_note_file_path: result.path!, updated_by: context.userId },
    });
  } catch {
    redirect(`/purchase/requests/${purchaseRequestId}?error=file-metadata-failed`);
  }

  // Use file.uploaded (not file.upload) for finance-sensitive documents so audit
  // queries can distinguish high-value financial uploads from routine attachments.
  await writeAuditLog({
    actorId: context.userId,
    action: "file.uploaded",
    entityType: "purchase_request",
    entityId: purchaseRequestId,
    summary: `Uploaded ${fileType.replace(/_/g, " ")} to purchase request`,
    metadata: { fileName: file.name, bucket: "purchase-files", fileType, ...meta },
  });
  await notifyByEvent({
    eventKey: "file.uploaded",
    entityType: "purchase_request",
    entityId: purchaseRequestId,
    actorId: context.userId,
    recipientRoles: ["purchase_officer", "finance_manager"],
    metadata: {
      entity_type: "purchase_request",
      file_name: safeStorageName(file.name),
      action_url: `/purchase/requests/${purchaseRequestId}`,
    },
    actionUrl: `/purchase/requests/${purchaseRequestId}`,
    actionLabel: "Open purchase request",
  });

  revalidatePath(`/purchase/requests/${purchaseRequestId}`);
  redirect(`/purchase/requests/${purchaseRequestId}`);
}
