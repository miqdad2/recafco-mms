"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission, requireUser } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuidSchema = z.string().uuid();
const commentSchema = z.string().trim().max(1000).optional();

async function getRoleUsers(slugs: string[]) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("id, roles(slug)").eq("is_active", true);
  return (data ?? [])
    .filter((profile) => {
      const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
      return role?.slug && slugs.includes(role.slug);
    })
    .map((profile) => profile.id as string);
}

async function notifyUsers(recipientIds: string[], title: string, message: string, entityId: string, notificationType: string) {
  if (!recipientIds.length) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("notifications").insert(
    [...new Set(recipientIds)].map((recipient_id) => ({
      recipient_id,
      title,
      message,
      entity_type: "work_order",
      entity_id: entityId,
      notification_type: notificationType
    }))
  );
}

async function updateWorkOrderStatus(id: string, status: string, userId: string) {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("work_orders").update({ status, updated_by: userId }).eq("id", id).select("id, work_order_number, status, created_by").single();
  if (error || !data) redirect(`/maintenance/work-orders/${id}?error=status-failed`);
  return data;
}

function idFrom(formData: FormData) {
  const parsed = uuidSchema.safeParse(formData.get("work_order_id"));
  if (!parsed.success) redirect("/maintenance/work-orders?error=invalid-id");
  return parsed.data;
}

export async function submitWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.manage");
  const id = idFrom(formData);
  const wo = await updateWorkOrderStatus(id, "Pending Approval", context.userId);
  const managers = await getRoleUsers(["super_admin", "maintenance_manager"]);
  await notifyUsers(managers, "Work order pending approval", `${wo.work_order_number} is waiting for approval.`, id, "pending_approval");
  await writeAuditLog({ actorId: context.userId, action: "work_order.submit", entityType: "work_order", entityId: id, summary: `Submitted ${wo.work_order_number} for approval` });
  revalidatePath(`/maintenance/work-orders/${id}`);
  redirect(`/maintenance/work-orders/${id}`);
}

export async function approveWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const comments = commentSchema.parse(String(formData.get("comments") ?? ""));
  const supabase = await createSupabaseServerClient();
  const wo = await updateWorkOrderStatus(id, "Approved", context.userId);
  await supabase.from("approvals").insert({ work_order_id: id, status: "Approved", decided_by: context.userId, comments });
  const supervisors = await getRoleUsers(["super_admin", "maintenance_supervisor"]);
  await notifyUsers(supervisors, "Work order approved", `${wo.work_order_number} is approved and ready for assignment.`, id, "approved");
  await writeAuditLog({ actorId: context.userId, action: "work_order.approve", entityType: "work_order", entityId: id, summary: `Approved ${wo.work_order_number}`, metadata: { comments } });
  revalidatePath(`/maintenance/work-orders/${id}`);
  redirect(`/maintenance/work-orders/${id}`);
}

export async function rejectWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const comments = commentSchema.parse(String(formData.get("comments") ?? ""));
  const supabase = await createSupabaseServerClient();
  const wo = await updateWorkOrderStatus(id, "Rejected", context.userId);
  await supabase.from("approvals").insert({ work_order_id: id, status: "Rejected", decided_by: context.userId, comments });
  await notifyUsers([wo.created_by, context.userId].filter(Boolean) as string[], "Work order rejected", `${wo.work_order_number} was rejected.`, id, "rejected");
  await writeAuditLog({ actorId: context.userId, action: "work_order.reject", entityType: "work_order", entityId: id, summary: `Rejected ${wo.work_order_number}`, metadata: { comments } });
  revalidatePath(`/maintenance/work-orders/${id}`);
  redirect(`/maintenance/work-orders/${id}`);
}

export async function assignTechniciansAction(formData: FormData) {
  const context = await requirePermission("work_orders.assign");
  const id = idFrom(formData);
  const technicianIds = formData.getAll("technician_ids").map(String).filter((value) => uuidSchema.safeParse(value).success);
  if (!technicianIds.length) redirect(`/maintenance/assignments?error=no-technician`);
  const supabase = await createSupabaseServerClient();
  await supabase.from("work_order_assignments").delete().eq("work_order_id", id);
  await supabase.from("work_order_assignments").insert(technicianIds.map((technician_id) => ({ work_order_id: id, technician_id, assigned_by: context.userId })));
  const wo = await updateWorkOrderStatus(id, "Assigned", context.userId);
  await notifyUsers(technicianIds, "New job assigned", `${wo.work_order_number} has been assigned to you.`, id, "assigned");
  await writeAuditLog({ actorId: context.userId, action: "work_order.assign", entityType: "work_order", entityId: id, summary: `Assigned technicians to ${wo.work_order_number}`, metadata: { technicianIds } });
  revalidatePath("/maintenance/assignments");
  redirect(`/maintenance/work-orders/${id}`);
}

export async function startTechnicianJobAction(formData: FormData) {
  const context = await requirePermission("technician.jobs.update");
  const id = idFrom(formData);
  const wo = await updateWorkOrderStatus(id, "In Progress", context.userId);
  await writeAuditLog({ actorId: context.userId, action: "work_order.start", entityType: "work_order", entityId: id, summary: `Started ${wo.work_order_number}` });
  revalidatePath(`/technician/jobs/${id}`);
  redirect(`/technician/jobs/${id}`);
}

export async function addTechnicianUpdateAction(formData: FormData) {
  const context = await requirePermission("technician.jobs.update");
  const id = idFrom(formData);
  const note = z.string().trim().min(2).max(1200).parse(formData.get("note"));
  const laborHours = z.coerce.number().min(0).max(100).parse(formData.get("labor_hours") || 0);
  const photoFileName = commentSchema.parse(String(formData.get("photo_file_name") ?? ""));
  const photoFilePath = commentSchema.parse(String(formData.get("photo_file_path") ?? ""));
  const supabase = await createSupabaseServerClient();
  await supabase.from("work_order_technician_notes").insert({ work_order_id: id, technician_id: context.userId, note, labor_hours: laborHours, photo_file_name: photoFileName || null, photo_file_path: photoFilePath || null });
  if (laborHours > 0) {
    await supabase.from("work_order_labor").insert({ work_order_id: id, technician_id: context.userId, labor_name: context.profile.full_name, employee_number: context.profile.employee_number, hours: laborHours, rate: 0 });
  }
  if (photoFileName && photoFilePath) {
    await supabase.from("work_order_attachments").insert({ work_order_id: id, attachment_type: "Technician Photo", file_name: photoFileName, file_path: photoFilePath, uploaded_by: context.userId });
  }
  await writeAuditLog({ actorId: context.userId, action: "work_order.technician_update", entityType: "work_order", entityId: id, summary: `Added technician update to work order`, metadata: { laborHours } });
  revalidatePath(`/technician/jobs/${id}`);
  redirect(`/technician/jobs/${id}`);
}

export async function completeTechnicianJobAction(formData: FormData) {
  const context = await requirePermission("technician.jobs.update");
  const id = idFrom(formData);
  const wo = await updateWorkOrderStatus(id, "Completed by Technician", context.userId);
  const supervisors = await getRoleUsers(["super_admin", "maintenance_supervisor"]);
  await notifyUsers(supervisors, "Job completed", `${wo.work_order_number} is completed by technician and waiting for verification.`, id, "completed");
  await writeAuditLog({ actorId: context.userId, action: "work_order.complete", entityType: "work_order", entityId: id, summary: `Completed ${wo.work_order_number}` });
  revalidatePath(`/technician/jobs/${id}`);
  redirect(`/technician/jobs/${id}`);
}

export async function verifyWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.assign");
  const id = idFrom(formData);
  const comments = commentSchema.parse(String(formData.get("comments") ?? ""));
  const supabase = await createSupabaseServerClient();
  const wo = await updateWorkOrderStatus(id, "Verified by Supervisor", context.userId);
  await supabase.from("approvals").insert({ work_order_id: id, status: "Verified", decided_by: context.userId, comments });
  const managers = await getRoleUsers(["super_admin", "maintenance_manager"]);
  await notifyUsers(managers, "Work order verified", `${wo.work_order_number} is verified and ready for closure.`, id, "verified");
  await writeAuditLog({ actorId: context.userId, action: "work_order.verify", entityType: "work_order", entityId: id, summary: `Verified ${wo.work_order_number}`, metadata: { comments } });
  revalidatePath(`/maintenance/work-orders/${id}`);
  redirect(`/maintenance/work-orders/${id}`);
}

export async function closeWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const comments = commentSchema.parse(String(formData.get("comments") ?? ""));
  const supabase = await createSupabaseServerClient();
  const wo = await updateWorkOrderStatus(id, "Closed", context.userId);
  await supabase.from("approvals").insert({ work_order_id: id, status: "Closed", decided_by: context.userId, comments });
  await notifyUsers([context.userId], "Work order closed", `${wo.work_order_number} has been closed.`, id, "closed");
  await writeAuditLog({ actorId: context.userId, action: "work_order.close", entityType: "work_order", entityId: id, summary: `Closed ${wo.work_order_number}`, metadata: { comments } });
  revalidatePath(`/maintenance/work-orders/${id}`);
  redirect(`/maintenance/work-orders/${id}`);
}

export async function markNotificationsReadAction() {
  const context = await requireUser();
  const supabase = await createSupabaseServerClient();
  await supabase.from("notifications").update({ is_read: true }).eq("recipient_id", context.userId);
  revalidatePath("/dashboard");
}
