"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const optionalString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}, z.string().optional());

const optionalUuid = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.trim().length ? value : undefined;
}, z.string().uuid().optional());

const optionalNumber = z.preprocess((value) => {
  if (value === null || value === undefined || value === "") return undefined;
  return Number(value);
}, z.number().finite().nonnegative().optional());

const optionalDate = z.preprocess((value) => {
  if (typeof value !== "string" || !value.trim()) return undefined;
  return value;
}, z.string().optional());

const assetSchema = z.object({
  id: optionalUuid,
  asset_code: z.string().trim().min(2).max(60),
  asset_name: z.string().trim().min(2).max(160),
  category: z.string().trim().min(2),
  department_id: optionalUuid,
  location: optionalString,
  brand: optionalString,
  model: optionalString,
  serial_number: optionalString,
  plate_number: optionalString,
  chassis_number: optionalString,
  engine_number: optionalString,
  purchase_date: optionalDate,
  warranty_expiry_date: optionalDate,
  registration_expiry_date: optionalDate,
  insurance_expiry_date: optionalDate,
  current_kilometer_reading: optionalNumber,
  current_running_hours: optionalNumber,
  assigned_operator_driver: optionalString,
  status: z.string().trim().min(2),
  next_service_date: optionalDate,
  next_service_kilometer: optionalNumber,
  next_service_running_hours: optionalNumber,
  notes: optionalString
});

const partSchema = z.object({
  id: optionalUuid,
  part_code: z.string().trim().min(2).max(60),
  part_name: z.string().trim().min(2).max(160),
  description: optionalString,
  category: optionalString,
  part_number: optionalString,
  ss_rec_code: optionalString,
  unit_of_measure: z.string().trim().min(1).max(20),
  current_stock: optionalNumber.default(0),
  minimum_stock: optionalNumber.default(0),
  unit_price: optionalNumber.default(0),
  supplier: optionalString,
  store_location_bin: optionalString,
  compatible_asset_categories: optionalString,
  status: z.string().trim().min(2),
  notes: optionalString
});

const workOrderSchema = z.object({
  id: optionalUuid,
  ordered_by: z.string().trim().min(2).max(160),
  requested_by_department_id: optionalUuid,
  asset_id: optionalUuid,
  asset_category: optionalString,
  serial_number: optionalString,
  plate_number: optionalString,
  date_of_order: z.string().min(8),
  job_location: optionalString,
  starting_datetime: optionalString,
  ending_datetime: optionalString,
  maintenance_type: z.string().trim().min(2),
  worker_type: z.string().trim().min(2),
  running_hours: optionalNumber,
  kilometers: optionalNumber,
  operator_complaint: optionalString,
  description_of_work: optionalString,
  priority: z.string().trim().min(2),
  status: z.string().trim().min(2),
  assigned_supervisor_id: optionalUuid,
  operator_requester_confirmation: optionalString,
  supervisor_verification: optionalString,
  maintenance_manager_closure: optionalString,
  next_service_date: optionalDate,
  next_service_kilometer: optionalNumber,
  next_service_running_hours: optionalNumber,
  notes: optionalString
});

function clean<T extends Record<string, unknown>>(input: T) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === undefined ? null : value]));
}

function rowValue(formData: FormData, name: string, index: number) {
  return String(formData.get(`${name}_${index}`) ?? "").trim();
}

function numberValue(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLaborRows(formData: FormData) {
  return [0, 1, 2]
    .map((index) => {
      const labor_name = rowValue(formData, "labor_name", index);
      if (!labor_name) return null;
      return {
        labor_name,
        employee_number: rowValue(formData, "labor_employee_number", index) || null,
        hours: numberValue(rowValue(formData, "labor_hours", index)),
        rate: numberValue(rowValue(formData, "labor_rate", index))
      };
    })
    .filter(Boolean);
}

function parseMaterialRows(formData: FormData) {
  return [0, 1, 2]
    .map((index) => {
      const material_name = rowValue(formData, "material_name", index);
      if (!material_name) return null;
      return {
        material_name,
        part_number: rowValue(formData, "material_part_number", index) || null,
        ss_rec_code: rowValue(formData, "material_ss_rec_code", index) || null,
        quantity: numberValue(rowValue(formData, "material_quantity", index)),
        unit_price: numberValue(rowValue(formData, "material_unit_price", index))
      };
    })
    .filter(Boolean);
}

function parseAttachmentRows(formData: FormData) {
  return [0, 1]
    .map((index) => {
      const file_name = rowValue(formData, "attachment_file_name", index);
      const file_path = rowValue(formData, "attachment_file_path", index);
      if (!file_name || !file_path) return null;
      return {
        attachment_type: rowValue(formData, "attachment_type", index) || "Photo",
        file_name,
        file_path
      };
    })
    .filter(Boolean);
}

export async function upsertAssetAction(formData: FormData) {
  const context = await requirePermission("assets.manage");
  const parsed = assetSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/assets?error=invalid-input");

  const supabase = await createSupabaseServerClient();
  const { id, ...values } = parsed.data;
  const payload = clean({ ...values, updated_by: context.userId, created_by: context.userId });
  const query = id
    ? supabase.from("assets").update(clean({ ...values, updated_by: context.userId })).eq("id", id).select("id, asset_code").single()
    : supabase.from("assets").insert(payload).select("id, asset_code").single();

  const { data, error } = await query;
  if (error || !data) redirect("/assets?error=save-failed");

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "asset.update" : "asset.create",
    entityType: "asset",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} asset ${data.asset_code}`,
    metadata: { category: parsed.data.category, status: parsed.data.status }
  });

  revalidatePath("/assets");
  redirect(`/assets/${data.id}`);
}

export async function upsertPartAction(formData: FormData) {
  const context = await requirePermission("parts.manage");
  const parsed = partSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/store/parts?error=invalid-input");

  const supabase = await createSupabaseServerClient();
  const { id, compatible_asset_categories, ...values } = parsed.data;
  const categories = compatible_asset_categories?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
  const payload = clean({ ...values, compatible_asset_categories: categories, updated_by: context.userId, created_by: context.userId });
  const query = id
    ? supabase.from("parts").update(clean({ ...values, compatible_asset_categories: categories, updated_by: context.userId })).eq("id", id).select("id, part_code").single()
    : supabase.from("parts").insert(payload).select("id, part_code").single();

  const { data, error } = await query;
  if (error || !data) redirect("/store/parts?error=save-failed");

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "part.update" : "part.create",
    entityType: "part",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} part ${data.part_code}`,
    metadata: { stock: parsed.data.current_stock, status: parsed.data.status }
  });

  revalidatePath("/store/parts");
  redirect("/store/parts");
}

export async function upsertWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.manage");
  const parsed = workOrderSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) redirect("/maintenance/work-orders?error=invalid-input");

  const supabase = await createSupabaseServerClient();
  const laborRows = parseLaborRows(formData);
  const materialRows = parseMaterialRows(formData);
  const attachmentRows = parseAttachmentRows(formData);
  const totalLabor = laborRows.reduce((sum, row) => sum + (row?.hours ?? 0) * (row?.rate ?? 0), 0);
  const totalMaterials = materialRows.reduce((sum, row) => sum + (row?.quantity ?? 0) * (row?.unit_price ?? 0), 0);
  const { id, ...values } = parsed.data;
  const payload = clean({
    ...values,
    starting_datetime: values.starting_datetime || null,
    ending_datetime: values.ending_datetime || null,
    total_labor_cost: totalLabor,
    total_material_cost: totalMaterials,
    updated_by: context.userId,
    created_by: context.userId
  });

  const { data, error } = id
    ? await supabase.from("work_orders").update(payload).eq("id", id).select("id, work_order_number").single()
    : await supabase.from("work_orders").insert(payload).select("id, work_order_number").single();

  if (error || !data) redirect("/maintenance/work-orders?error=save-failed");

  if (id) {
    await Promise.all([
      supabase.from("work_order_labor").delete().eq("work_order_id", id),
      supabase.from("work_order_materials").delete().eq("work_order_id", id),
      supabase.from("work_order_attachments").delete().eq("work_order_id", id)
    ]);
  }

  const work_order_id = data.id;
  if (laborRows.length) await supabase.from("work_order_labor").insert(laborRows.map((row) => ({ ...row, work_order_id })));
  if (materialRows.length) await supabase.from("work_order_materials").insert(materialRows.map((row) => ({ ...row, work_order_id })));
  if (attachmentRows.length) await supabase.from("work_order_attachments").insert(attachmentRows.map((row) => ({ ...row, work_order_id, uploaded_by: context.userId })));

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "work_order.update" : "work_order.create",
    entityType: "work_order",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} work order ${data.work_order_number}`,
    metadata: { status: parsed.data.status, worker_type: parsed.data.worker_type }
  });

  if (!id && ["Submitted", "Pending Approval"].includes(parsed.data.status)) {
    const { data: managerProfiles } = await supabase.from("profiles").select("id, roles(slug)").eq("is_active", true);
    const recipients = (managerProfiles ?? [])
      .filter((profile) => {
        const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
        return role?.slug === "super_admin" || role?.slug === "maintenance_manager";
      })
      .map((profile) => profile.id);
    if (recipients.length) {
      await supabase.from("notifications").insert(
        recipients.map((recipient_id) => ({
          recipient_id,
          title: "Work order pending approval",
          message: `${data.work_order_number} is waiting for maintenance manager review.`,
          entity_type: "work_order",
          entity_id: data.id,
          notification_type: "pending_approval"
        }))
      );
    }
  }

  revalidatePath("/maintenance/work-orders");
  redirect(`/maintenance/work-orders/${data.id}`);
}
