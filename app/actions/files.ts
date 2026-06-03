"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { writeAuditLog } from "@/lib/audit/log";
import { requireUser } from "@/lib/auth/context";
import { safeStorageName, validatePrivateFile, type PrivateFileBucket } from "@/lib/files/validation";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const text = z.string().trim().min(2).max(80);
const purchaseFileType = z.enum(["quotation", "invoice", "delivery_note"]);

function canByPermission(permissions: string[], roleSlug: string | undefined, permission: string) {
  return roleSlug === "super_admin" || permissions.includes(permission);
}

async function canUploadWorkOrder(workOrderId: string) {
  const context = await requireUser();
  if (
    canByPermission(context.permissions, context.role?.slug, "files.upload") &&
    (canByPermission(context.permissions, context.role?.slug, "work_orders.manage") ||
      canByPermission(context.permissions, context.role?.slug, "technician.jobs.update"))
  ) {
    const supabase = await createSupabaseServerClient();
    if (canByPermission(context.permissions, context.role?.slug, "work_orders.manage")) return context;
    const { data } = await supabase
      .from("work_order_assignments")
      .select("id")
      .eq("work_order_id", workOrderId)
      .eq("technician_id", context.userId)
      .maybeSingle();
    if (data) return context;
  }
  redirect(`/maintenance/work-orders/${workOrderId}?error=upload-permission`);
}

async function uploadPrivateFile(bucket: PrivateFileBucket, folder: string, file: File) {
  const validationError = validatePrivateFile(file);
  if (validationError) {
    return { error: validationError };
  }

  const supabase = createSupabaseAdminClient();
  const storagePath = `${folder}/${Date.now()}-${safeStorageName(file.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(storagePath, file, {
    contentType: file.type,
    upsert: false
  });

  if (error) {
    return { error: "File upload failed. Check bucket setup and permissions." };
  }

  return { path: storagePath };
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
  if (result.error || !result.path) redirect(`/maintenance/work-orders/${workOrderId}?error=file-upload-failed`);

  const supabase = await createSupabaseServerClient();
  await supabase.from("work_order_attachments").insert({
    work_order_id: workOrderId,
    attachment_type: attachmentType,
    file_name: file.name,
    file_path: result.path,
    content_type: file.type,
    file_size: file.size,
    uploaded_by: context.userId
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "file.upload",
    entityType: "work_order",
    entityId: workOrderId,
    summary: `Uploaded ${attachmentType} file to work order`,
    metadata: { fileName: file.name, bucket: "work-order-files" }
  });

  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  revalidatePath(`/technician/jobs/${workOrderId}`);
  redirect(String(formData.get("return_to") || `/maintenance/work-orders/${workOrderId}`));
}

export async function uploadAssetFileAction(formData: FormData) {
  const context = await requireUser();
  const assetId = uuid.parse(formData.get("asset_id"));
  if (!canByPermission(context.permissions, context.role?.slug, "assets.manage") || !canByPermission(context.permissions, context.role?.slug, "files.upload")) {
    redirect(`/assets/${assetId}?error=upload-permission`);
  }

  const documentType = text.parse(formData.get("document_type") || "Asset Document");
  const file = fileFrom(formData);
  if (!file) redirect(`/assets/${assetId}?error=no-file`);

  const result = await uploadPrivateFile("asset-files", assetId, file);
  if (result.error || !result.path) redirect(`/assets/${assetId}?error=file-upload-failed`);

  const supabase = await createSupabaseServerClient();
  await supabase.from("asset_documents").insert({
    asset_id: assetId,
    document_type: documentType,
    file_name: file.name,
    file_path: result.path,
    content_type: file.type,
    file_size: file.size,
    uploaded_by: context.userId
  });

  await writeAuditLog({
    actorId: context.userId,
    action: "file.upload",
    entityType: "asset",
    entityId: assetId,
    summary: `Uploaded ${documentType} file to asset`,
    metadata: { fileName: file.name, bucket: "asset-files" }
  });

  revalidatePath(`/assets/${assetId}`);
  redirect(`/assets/${assetId}`);
}

export async function uploadPurchaseFileAction(formData: FormData) {
  const context = await requireUser();
  const purchaseRequestId = uuid.parse(formData.get("purchase_request_id"));
  if (!canByPermission(context.permissions, context.role?.slug, "purchase_requests.manage") || !canByPermission(context.permissions, context.role?.slug, "files.upload")) {
    redirect(`/purchase/requests/${purchaseRequestId}?error=upload-permission`);
  }

  const fileType = purchaseFileType.parse(formData.get("file_type"));
  const file = fileFrom(formData);
  if (!file) redirect(`/purchase/requests/${purchaseRequestId}?error=no-file`);

  const result = await uploadPrivateFile("purchase-files", purchaseRequestId, file);
  if (result.error || !result.path) redirect(`/purchase/requests/${purchaseRequestId}?error=file-upload-failed`);

  const nameColumn = `${fileType}_file_name`;
  const pathColumn = `${fileType}_file_path`;
  const supabase = await createSupabaseServerClient();
  await supabase
    .from("purchase_requests")
    .update({ [nameColumn]: file.name, [pathColumn]: result.path, updated_by: context.userId })
    .eq("id", purchaseRequestId);

  await writeAuditLog({
    actorId: context.userId,
    action: "file.upload",
    entityType: "purchase_request",
    entityId: purchaseRequestId,
    summary: `Uploaded ${fileType.replace("_", " ")} file to purchase request`,
    metadata: { fileName: file.name, bucket: "purchase-files" }
  });

  revalidatePath(`/purchase/requests/${purchaseRequestId}`);
  redirect(`/purchase/requests/${purchaseRequestId}`);
}
