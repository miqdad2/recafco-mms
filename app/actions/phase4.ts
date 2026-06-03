"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePermission } from "@/lib/auth/context";
import { writeAuditLog } from "@/lib/audit/log";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const text = z.string().trim().max(1000).optional();

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
    .filter(Boolean);
}

async function roleUsers(slugs: string[]) {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("profiles").select("id, roles(slug)").eq("is_active", true);
  return (data ?? [])
    .filter((profile) => {
      const role = Array.isArray(profile.roles) ? profile.roles[0] : profile.roles;
      return role?.slug && slugs.includes(role.slug);
    })
    .map((profile) => profile.id as string);
}

async function notify(recipients: string[], title: string, message: string, entityType: string, entityId: string, type: string) {
  if (!recipients.length) return;
  const supabase = await createSupabaseServerClient();
  await supabase.from("notifications").insert([...new Set(recipients)].map((recipient_id) => ({ recipient_id, title, message, entity_type: entityType, entity_id: entityId, notification_type: type })));
}

function idFrom(formData: FormData, key: string) {
  const parsed = uuid.safeParse(formData.get(key));
  if (!parsed.success) redirect("/dashboard?error=invalid-id");
  return parsed.data;
}

async function getSettings() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from("app_settings").select("*").eq("id", "00000000-0000-0000-0000-000000000001").maybeSingle();
  return data;
}

export async function createPartsRequestAction(formData: FormData) {
  const context = await requirePermission("parts_requests.create");
  const workOrderId = idFrom(formData, "work_order_id");
  const items = parseItems(formData);
  if (!items.length) redirect(`/maintenance/work-orders/${workOrderId}?error=no-items`);
  const supabase = await createSupabaseServerClient();
  const { data: wo } = await supabase.from("work_orders").select("id, work_order_number, asset_id, requested_by_department_id, serial_number").eq("id", workOrderId).single();
  if (!wo) redirect(`/maintenance/work-orders/${workOrderId}?error=no-work-order`);
  const total = items.reduce((sum, item) => sum + (item?.quantity_requested ?? 0) * (item?.unit_price ?? 0), 0);
  const { data: request, error } = await supabase
    .from("parts_requests")
    .insert({
      work_order_id: workOrderId,
      asset_id: wo.asset_id,
      department_id: wo.requested_by_department_id,
      serial_number: wo.serial_number,
      requested_by: context.userId,
      prepared_by: context.userId,
      remarks: String(formData.get("remarks") ?? ""),
      status: "Pending Approval",
      total_price: total,
      created_by: context.userId,
      updated_by: context.userId
    })
    .select("id, parts_request_number")
    .single();
  if (error || !request) redirect(`/maintenance/work-orders/${workOrderId}?error=parts-request-failed`);
  await supabase.from("parts_request_items").insert(items.map((item) => ({ ...item, parts_request_id: request.id })));
  const managers = await roleUsers(["super_admin", "maintenance_manager"]);
  await notify(managers, "Parts request submitted", `${request.parts_request_number} is waiting for approval.`, "parts_request", request.id, "parts_request_submitted");
  await writeAuditLog({ actorId: context.userId, action: "parts_request.create", entityType: "parts_request", entityId: request.id, summary: `Created parts request ${request.parts_request_number}` });
  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  redirect(`/store/parts-requests/${request.id}`);
}

export async function approvePartsRequestAction(formData: FormData) {
  const context = await requirePermission("parts_requests.approve");
  const id = idFrom(formData, "parts_request_id");
  const comments = text.parse(String(formData.get("comments") ?? ""));
  const supabase = await createSupabaseServerClient();
  const { data: request } = await supabase.from("parts_requests").update({ status: "Waiting for Store", approved_by: context.userId, approval_comments: comments, updated_by: context.userId }).eq("id", id).select("id, parts_request_number").single();
  if (!request) redirect(`/store/parts-requests/${id}?error=approve-failed`);
  await supabase.from("approvals").insert({ work_order_id: null, approval_type: "Parts Request", status: "Approved", decided_by: context.userId, comments });
  const storeUsers = await roleUsers(["super_admin", "store_keeper"]);
  await notify(storeUsers, "Parts request approved", `${request.parts_request_number} is waiting for store issue.`, "parts_request", id, "parts_request_approved");
  await writeAuditLog({ actorId: context.userId, action: "parts_request.approve", entityType: "parts_request", entityId: id, summary: `Approved ${request.parts_request_number}` });
  redirect(`/store/parts-requests/${id}`);
}

export async function rejectPartsRequestAction(formData: FormData) {
  const context = await requirePermission("parts_requests.approve");
  const id = idFrom(formData, "parts_request_id");
  const comments = text.parse(String(formData.get("comments") ?? ""));
  const supabase = await createSupabaseServerClient();
  const { data: request } = await supabase.from("parts_requests").update({ status: "Rejected", approval_comments: comments, approved_by: context.userId, updated_by: context.userId }).eq("id", id).select("id, parts_request_number, requested_by").single();
  if (!request) redirect(`/store/parts-requests/${id}?error=reject-failed`);
  await notify([request.requested_by].filter(Boolean) as string[], "Parts request rejected", `${request.parts_request_number} was rejected.`, "parts_request", id, "parts_request_rejected");
  await writeAuditLog({ actorId: context.userId, action: "parts_request.reject", entityType: "parts_request", entityId: id, summary: `Rejected ${request.parts_request_number}`, metadata: { comments } });
  redirect(`/store/parts-requests/${id}`);
}

export async function storeIssueAction(formData: FormData) {
  const context = await requirePermission("store.issue");
  const requestId = idFrom(formData, "parts_request_id");
  const supabase = await createSupabaseServerClient();
  const { data: request } = await supabase.from("parts_requests").select("*, work_orders(id, work_order_number)").eq("id", requestId).single();
  if (!request) redirect(`/store/parts-requests/${requestId}?error=no-request`);
  const { data: items } = await supabase.from("parts_request_items").select("*").eq("parts_request_id", requestId);
  let anyIssued = false;
  let anyUnavailable = false;
  let allIssued = true;
  for (const item of items ?? []) {
    const issued = num(formData.get(`issued_${item.id}`));
    const unavailable = formData.get(`unavailable_${item.id}`) === "on";
    const availability = unavailable ? "Unavailable" : issued >= Number(item.quantity_requested) ? "Available" : issued > 0 ? "Partial" : "Unchecked";
    if (issued > 0 && item.part_id) {
      anyIssued = true;
      await supabase.from("parts").update({ current_stock: Math.max(0, Number((await supabase.from("parts").select("current_stock").eq("id", item.part_id).single()).data?.current_stock ?? 0) - issued), updated_by: context.userId }).eq("id", item.part_id);
      await supabase.from("inventory_movements").insert({ part_id: item.part_id, movement_type: "Issue to Work Order", quantity: issued, unit_price: item.unit_price, work_order_id: request.work_order_id, parts_request_id: requestId, reference: request.parts_request_number, comments: "Store issue", created_by: context.userId });
      await supabase.from("work_order_materials").insert({ work_order_id: request.work_order_id, part_id: item.part_id, material_name: item.description, part_number: item.part_number, ss_rec_code: item.ss_rec_code, quantity: issued, unit_price: item.unit_price });
    }
    if (unavailable) anyUnavailable = true;
    if (issued < Number(item.quantity_requested)) allIssued = false;
    await supabase.from("parts_request_items").update({ issued_quantity: issued, stock_availability: availability }).eq("id", item.id);
  }
  const nextStatus = anyUnavailable ? "Waiting for Purchase" : allIssued ? "Issued" : anyIssued ? "Partially Issued" : "Waiting for Store";
  await supabase.from("parts_requests").update({ status: nextStatus, store_issue_comments: String(formData.get("store_issue_comments") ?? ""), updated_by: context.userId }).eq("id", requestId);
  if (anyUnavailable) await supabase.from("work_orders").update({ status: "Waiting for Purchase", updated_by: context.userId }).eq("id", request.work_order_id);
  else if (anyIssued) await supabase.from("work_orders").update({ status: "Parts Issued", updated_by: context.userId }).eq("id", request.work_order_id);
  await notify([request.requested_by].filter(Boolean) as string[], nextStatus === "Issued" ? "Parts issued" : nextStatus === "Partially Issued" ? "Parts partially issued" : "Part unavailable", `${request.parts_request_number} store status: ${nextStatus}.`, "parts_request", requestId, nextStatus.toLowerCase().replaceAll(" ", "_"));
  await writeAuditLog({ actorId: context.userId, action: "store.issue", entityType: "parts_request", entityId: requestId, summary: `Store updated ${request.parts_request_number}`, metadata: { nextStatus } });
  revalidatePath(`/store/parts-requests/${requestId}`);
  redirect(`/store/parts-requests/${requestId}`);
}

export async function createPurchaseRequestAction(formData: FormData) {
  const context = await requirePermission("purchase_requests.manage");
  const partsRequestId = idFrom(formData, "parts_request_id");
  const supabase = await createSupabaseServerClient();
  const { data: request } = await supabase.from("parts_requests").select("*").eq("id", partsRequestId).single();
  const { data: items } = await supabase.from("parts_request_items").select("*").eq("parts_request_id", partsRequestId).eq("stock_availability", "Unavailable");
  if (!request || !items?.length) redirect(`/store/parts-requests/${partsRequestId}?error=no-unavailable`);
  const total = items.reduce((sum, item) => sum + Number(item.quantity_requested) * Number(item.unit_price), 0);
  const settings = await getSettings();
  const status = settings?.finance_approval_enabled ? "Pending Finance Approval" : settings?.ceo_approval_enabled && total > Number(settings.ceo_approval_threshold) ? "Pending CEO Approval" : "Pending Purchase";
  const { data: purchase } = await supabase.from("purchase_requests").insert({ work_order_id: request.work_order_id, parts_request_id: partsRequestId, estimated_total: total, status, created_by: context.userId, updated_by: context.userId }).select("id, purchase_request_number").single();
  if (!purchase) redirect(`/store/parts-requests/${partsRequestId}?error=purchase-failed`);
  await supabase.from("purchase_request_items").insert(items.map((item) => ({ purchase_request_id: purchase.id, parts_request_item_id: item.id, part_id: item.part_id, description: item.description, quantity: item.quantity_requested, estimated_unit_price: item.unit_price })));
  await supabase.from("parts_requests").update({ status: "Waiting for Purchase" }).eq("id", partsRequestId);
  const financeUsers = status === "Pending Finance Approval" ? await roleUsers(["super_admin", "finance_manager"]) : await roleUsers(["super_admin", "purchase_officer"]);
  await notify(financeUsers, status === "Pending Finance Approval" ? "Finance approval required" : "Purchase request created", `${purchase.purchase_request_number} requires action.`, "purchase_request", purchase.id, status === "Pending Finance Approval" ? "finance_required" : "purchase_request_created");
  await writeAuditLog({ actorId: context.userId, action: "purchase_request.create", entityType: "purchase_request", entityId: purchase.id, summary: `Created ${purchase.purchase_request_number}` });
  redirect(`/purchase/requests/${purchase.id}`);
}

export async function updatePurchaseRequestAction(formData: FormData) {
  const context = await requirePermission("purchase_requests.manage");
  const id = idFrom(formData, "purchase_request_id");
  const status = z.enum(["Submitted","Pending Purchase","Pending Finance Approval","Pending CEO Approval","Approved","Ordered","Received","Rejected","Cancelled"]).parse(formData.get("status"));
  const supabase = await createSupabaseServerClient();
  const { data: purchase } = await supabase.from("purchase_requests").update({
    supplier: String(formData.get("supplier") ?? ""),
    status,
    purchase_officer_notes: String(formData.get("purchase_officer_notes") ?? ""),
    quotation_file_name: String(formData.get("quotation_file_name") ?? "") || null,
    quotation_file_path: String(formData.get("quotation_file_path") ?? "") || null,
    updated_by: context.userId
  }).eq("id", id).select("id, purchase_request_number").single();
  if (!purchase) redirect(`/purchase/requests/${id}?error=save-failed`);
  if (status === "Ordered" || status === "Received") {
    const recipients = await roleUsers(["super_admin", "store_keeper", "maintenance_supervisor"]);
    await notify(recipients, status === "Ordered" ? "Purchase ordered" : "Purchase received", `${purchase.purchase_request_number} status changed to ${status}.`, "purchase_request", id, `purchase_${status.toLowerCase()}`);
  }
  await writeAuditLog({ actorId: context.userId, action: "purchase_request.update", entityType: "purchase_request", entityId: id, summary: `Updated ${purchase.purchase_request_number} to ${status}` });
  redirect(`/purchase/requests/${id}`);
}

export async function financeDecisionAction(formData: FormData) {
  const context = await requirePermission("finance.approve");
  const id = idFrom(formData, "purchase_request_id");
  const decision = z.enum(["Approved", "Rejected"]).parse(formData.get("decision"));
  const comments = text.parse(String(formData.get("comments") ?? ""));
  const settings = await getSettings();
  const supabase = await createSupabaseServerClient();
  const { data: purchase } = await supabase.from("purchase_requests").select("*").eq("id", id).single();
  if (!purchase) redirect(`/finance/approvals?error=no-purchase`);
  const nextStatus = decision === "Rejected" ? "Rejected" : settings?.ceo_approval_enabled && Number(purchase.estimated_total) > Number(settings.ceo_approval_threshold) ? "Pending CEO Approval" : "Approved";
  await supabase.from("purchase_requests").update({ status: nextStatus, finance_comments: comments, finance_approved_by: context.userId, finance_approved_at: new Date().toISOString(), updated_by: context.userId }).eq("id", id);
  const recipients = nextStatus === "Pending CEO Approval" ? await roleUsers(["super_admin", "ceo_management"]) : await roleUsers(["super_admin", "purchase_officer"]);
  await notify(recipients, nextStatus === "Pending CEO Approval" ? "CEO approval required" : `Finance ${decision.toLowerCase()}`, `${purchase.purchase_request_number} finance decision: ${decision}.`, "purchase_request", id, nextStatus === "Pending CEO Approval" ? "ceo_required" : `finance_${decision.toLowerCase()}`);
  await writeAuditLog({ actorId: context.userId, action: `finance.${decision.toLowerCase()}`, entityType: "purchase_request", entityId: id, summary: `Finance ${decision.toLowerCase()} ${purchase.purchase_request_number}` });
  redirect(`/purchase/requests/${id}`);
}

export async function ceoDecisionAction(formData: FormData) {
  const context = await requirePermission("ceo.approve");
  const id = idFrom(formData, "purchase_request_id");
  const decision = z.enum(["Approved", "Rejected"]).parse(formData.get("decision"));
  const comments = text.parse(String(formData.get("comments") ?? ""));
  const supabase = await createSupabaseServerClient();
  const { data: purchase } = await supabase.from("purchase_requests").update({ status: decision, ceo_comments: comments, ceo_approved_by: context.userId, ceo_approved_at: new Date().toISOString(), updated_by: context.userId }).eq("id", id).select("id, purchase_request_number").single();
  if (!purchase) redirect(`/purchase/requests/${id}?error=ceo-failed`);
  const purchaseUsers = await roleUsers(["super_admin", "purchase_officer"]);
  await notify(purchaseUsers, `CEO ${decision.toLowerCase()}`, `${purchase.purchase_request_number} CEO decision: ${decision}.`, "purchase_request", id, `ceo_${decision.toLowerCase()}`);
  await writeAuditLog({ actorId: context.userId, action: `ceo.${decision.toLowerCase()}`, entityType: "purchase_request", entityId: id, summary: `CEO ${decision.toLowerCase()} ${purchase.purchase_request_number}` });
  redirect(`/purchase/requests/${id}`);
}

export async function receivePurchaseAction(formData: FormData) {
  const context = await requirePermission("purchase_requests.manage");
  const id = idFrom(formData, "purchase_request_id");
  const supabase = await createSupabaseServerClient();
  const { data: purchase } = await supabase.from("purchase_requests").select("*").eq("id", id).single();
  const { data: items } = await supabase.from("purchase_request_items").select("*").eq("purchase_request_id", id);
  if (!purchase) redirect(`/purchase/requests/${id}?error=no-purchase`);
  for (const item of items ?? []) {
    if (item.part_id) {
      const { data: part } = await supabase.from("parts").select("current_stock").eq("id", item.part_id).single();
      await supabase.from("parts").update({ current_stock: Number(part?.current_stock ?? 0) + Number(item.quantity), updated_by: context.userId }).eq("id", item.part_id);
      await supabase.from("inventory_movements").insert({ part_id: item.part_id, movement_type: "Purchase Receive", quantity: item.quantity, unit_price: item.estimated_unit_price, purchase_request_id: id, parts_request_id: purchase.parts_request_id, work_order_id: purchase.work_order_id, reference: purchase.purchase_request_number, comments: "Purchase received", created_by: context.userId });
    }
  }
  await supabase.from("purchase_requests").update({ status: "Received", updated_by: context.userId }).eq("id", id);
  if (purchase.work_order_id) await supabase.from("work_orders").update({ status: "Parts Issued", updated_by: context.userId }).eq("id", purchase.work_order_id);
  const recipients = await roleUsers(["super_admin", "store_keeper", "maintenance_supervisor"]);
  await notify(recipients, "Purchase received", `${purchase.purchase_request_number} was received and inventory was updated.`, "purchase_request", id, "purchase_received");
  await writeAuditLog({ actorId: context.userId, action: "purchase.receive", entityType: "purchase_request", entityId: id, summary: `Received ${purchase.purchase_request_number}` });
  redirect(`/purchase/requests/${id}`);
}
