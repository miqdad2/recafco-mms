"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const checkbox = z.preprocess((value) => value === "on" || value === "true", z.boolean());

const departmentSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(20).toUpperCase(),
  description: z.string().trim().max(500).optional(),
  manager_name: z.string().trim().max(120).optional(),
  is_active: checkbox.default(true)
});

const profileSchema = z.object({
  id: z.string().uuid(),
  full_name: z.string().trim().min(2).max(120),
  employee_number: z.string().trim().max(40).optional(),
  phone: z.string().trim().max(40).optional(),
  job_title: z.string().trim().max(120).optional(),
  department_id: z.string().uuid().optional().or(z.literal("")),
  role_id: z.string().uuid().optional().or(z.literal("")),
  is_active: checkbox.default(false),
  can_view_costs: checkbox.default(false)
});

const settingsSchema = z.object({
  company_name: z.string().trim().min(2).max(160),
  default_currency: z.string().trim().min(3).max(3).toUpperCase(),
  work_order_number_format: z.string().trim().min(4).max(80),
  parts_request_number_format: z.string().trim().min(4).max(80),
  purchase_request_number_format: z.string().trim().min(4).max(80),
  ceo_approval_threshold: z.coerce.number().min(0).max(1000000),
  requester_confirmation_enabled: checkbox.default(false),
  finance_approval_enabled: checkbox.default(false),
  ceo_approval_enabled: checkbox.default(false)
});

export async function upsertDepartmentAction(formData: FormData) {
  const context = await requirePermission("admin.departments.manage");
  const parsed = departmentSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    redirect("/admin/departments?error=invalid-input");
  }

  const supabase = await createSupabaseServerClient();
  const { id, ...payload } = parsed.data;
  const { data, error } = id
    ? await supabase.from("departments").update(payload).eq("id", id).select("id, name").single()
    : await supabase.from("departments").insert(payload).select("id, name").single();

  if (error || !data) {
    redirect("/admin/departments?error=save-failed");
  }

  await writeAuditLog({
    actorId: context.userId,
    action: id ? "department.update" : "department.create",
    entityType: "department",
    entityId: data.id,
    summary: `${id ? "Updated" : "Created"} department ${data.name}`,
    metadata: { code: payload.code }
  });

  revalidatePath("/admin/departments");
  revalidatePath("/dashboard");
  redirect("/admin/departments?saved=1");
}

export async function upsertProfileAction(formData: FormData) {
  const context = await requirePermission("admin.users.manage");
  const parsed = profileSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    redirect("/admin/users?error=invalid-input");
  }

  if (parsed.data.is_active && !parsed.data.role_id) {
    redirect("/admin/users?error=active-role-required");
  }

  const supabase = await createSupabaseServerClient();
  const payload = {
    ...parsed.data,
    employee_number: parsed.data.employee_number || null,
    phone: parsed.data.phone || null,
    job_title: parsed.data.job_title || null,
    department_id: parsed.data.department_id || null,
    role_id: parsed.data.role_id || null
  };

  const { data, error } = await supabase.from("profiles").upsert(payload).select("id, full_name").single();

  if (error || !data) {
    redirect("/admin/users?error=save-failed");
  }

  await writeAuditLog({
    actorId: context.userId,
    action: "profile.upsert",
    entityType: "profile",
    entityId: data.id,
    summary: `Saved profile ${data.full_name}`,
    metadata: { role_id: payload.role_id, department_id: payload.department_id }
  });

  revalidatePath("/admin/users");
  revalidatePath("/dashboard");
  redirect("/admin/users?saved=1");
}

export async function updateSettingsAction(formData: FormData) {
  const context = await requirePermission("admin.settings.manage");
  const parsed = settingsSchema.safeParse(Object.fromEntries(formData));

  if (!parsed.success) {
    redirect("/admin/settings?error=invalid-input");
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("app_settings")
    .upsert({ id: "00000000-0000-0000-0000-000000000001", ...parsed.data, updated_by: context.userId })
    .select("id, company_name")
    .single();

  if (error || !data) {
    redirect("/admin/settings?error=save-failed");
  }

  await writeAuditLog({
    actorId: context.userId,
    action: "settings.update",
    entityType: "app_settings",
    entityId: data.id,
    summary: `Updated settings for ${data.company_name}`,
    metadata: {
      ceo_approval_threshold: parsed.data.ceo_approval_threshold,
      default_currency: parsed.data.default_currency
    }
  });

  revalidatePath("/admin/settings");
  redirect("/admin/settings?saved=1");
}
