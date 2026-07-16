"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addTechnicianUpdate,
  approveWorkOrder,
  assignTechnicians,
  cancelWorkOrder,
  closeWorkOrder,
  completeTechnicianJob,
  markExternalWorkCompleted,
  rejectWorkOrder,
  requestWorkOrderClarification,
  respondToWorkOrderClarification,
  returnWorkOrderToDraft,
  startTechnicianJob,
  submitWorkOrder,
  verifyWorkOrder
} from "@/lib/backend/work-orders/service";
import {
  parseWorkflowComment,
  parseWorkOrderId,
  technicianAssignmentSchema,
  technicianUpdateSchema
} from "@/lib/backend/work-orders/validators";
import { requirePermission, requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { markAllNotificationsRead } from "@/lib/notifications/service";

function workflowErrorPath(workOrderId: string, error: unknown, basePath = "/maintenance/work-orders") {
  return `${basePath}/${workOrderId}?error=${encodeURIComponent(safeErrorMessage(error))}`;
}

function idFrom(formData: FormData, fallbackPath = "/maintenance/work-orders") {
  try {
    return parseWorkOrderId(formData.get("work_order_id"));
  } catch (error) {
    redirect(`${fallbackPath}?error=${encodeURIComponent(safeErrorMessage(error))}`);
  }
}

export async function submitWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.manage");
  const id = idFrom(formData);
  let targetPath = `/maintenance/work-orders/${id}`;

  try {
    const result = await submitWorkOrder(context, id);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export async function approveWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const comments = parseWorkflowComment(formData.get("comments"));
  let targetPath = `/maintenance/work-orders/${id}`;

  try {
    const result = await approveWorkOrder(context, id, comments);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/technician/jobs");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export async function rejectWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const comments = parseWorkflowComment(formData.get("comments"));
  let targetPath = `/maintenance/work-orders/${id}`;

  try {
    const result = await rejectWorkOrder(context, id, comments);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export async function requestClarificationAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const question = String(formData.get("question") ?? "").trim();
  let targetPath = `/maintenance/work-orders/${id}`;

  if (question.length < 10) {
    redirect(`${targetPath}?error=clarification-question-too-short`);
  }

  try {
    const result = await requestWorkOrderClarification(context, id, question);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}?success=clarification-sent`;
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export async function respondToClarificationAction(formData: FormData) {
  const context = await requirePermission("work_orders.view");
  const id = idFrom(formData);
  const response = String(formData.get("response") ?? "").trim();
  let targetPath = `/maintenance/work-orders/${id}`;

  if (response.length < 10) {
    redirect(`${targetPath}?error=clarification-response-too-short`);
  }

  try {
    const result = await respondToWorkOrderClarification(context, id, response);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}?success=clarification-responded`;
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export type AssignModalState = {
  ok: boolean;
  error?: string;
  workOrderId?: string;
  assignmentType?: string;
} | null;

export async function assignTechniciansModalAction(
  _prev: AssignModalState,
  formData: FormData
): Promise<AssignModalState> {
  const context = await requirePermission("work_orders.assign");
  const workOrderId = formData.get("work_order_id") as string | null;
  if (!workOrderId || !/^[0-9a-f-]{36}$/i.test(workOrderId)) {
    return { ok: false, error: "Invalid Job Card ID." };
  }
  const assignmentType = (formData.get("assignment_type") as string) || "INTERNAL_TECHNICIAN";
  try {
    const technicianIds = formData.getAll("technician_ids").map(String).filter(Boolean);
    const input = technicianAssignmentSchema.parse({
      workOrderId,
      assignmentType,
      technicianIds,
      externalName: formData.get("external_name") || undefined,
      externalCompany: formData.get("external_company") || undefined,
      externalContactPerson: formData.get("external_contact_person") || undefined,
      externalPhone: formData.get("external_phone") || undefined,
      externalTrade: formData.get("external_trade") || undefined,
      externalExpectedVisitDate: formData.get("external_expected_visit_date") || undefined,
      notes: formData.get("assign_notes") || undefined,
    });
    const result = await assignTechnicians(context, input);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/technician/jobs");
    revalidatePath("/dashboard");
    return { ok: true, workOrderId: result.workOrderId, assignmentType };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}

export async function assignTechniciansAction(formData: FormData) {
  const context = await requirePermission("work_orders.assign");
  const workOrderId = idFrom(formData);
  const assignmentType = (formData.get("assignment_type") as string) || "INTERNAL_TECHNICIAN";
  let targetPath = `/maintenance/work-orders/${workOrderId}`;

  try {
    const technicianIds = formData.getAll("technician_ids").map(String).filter(Boolean);
    const input = technicianAssignmentSchema.parse({
      workOrderId,
      assignmentType,
      technicianIds,
      externalName: formData.get("external_name") || undefined,
      externalCompany: formData.get("external_company") || undefined,
      externalContactPerson: formData.get("external_contact_person") || undefined,
      externalPhone: formData.get("external_phone") || undefined,
      externalTrade: formData.get("external_trade") || undefined,
      externalExpectedVisitDate: formData.get("external_expected_visit_date") || undefined,
      notes: formData.get("assign_notes") || undefined,
    });
    const result = await assignTechnicians(context, input);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/technician/jobs");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(workOrderId, error));
  }
  redirect(targetPath);
}

export async function markExternalWorkCompletedAction(formData: FormData) {
  const context = await requirePermission("work_orders.assign");
  const workOrderId = idFrom(formData);
  const notes = (formData.get("completion_notes") as string | null) ?? undefined;
  let targetPath = `/maintenance/work-orders/${workOrderId}`;

  try {
    const result = await markExternalWorkCompleted(context, workOrderId, notes);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(workOrderId, error));
  }
  redirect(targetPath);
}

export async function startTechnicianJobAction(formData: FormData) {
  const context = await requirePermission("technician.jobs.update");
  const id = idFrom(formData, "/technician/jobs");
  let targetPath = `/technician/jobs/${id}`;

  try {
    const result = await startTechnicianJob(context, id);
    revalidatePath(`/technician/jobs/${result.workOrderId}`);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/technician/jobs");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/technician/jobs/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(id, error, "/technician/jobs"));
  }
  redirect(targetPath);
}

export async function addTechnicianUpdateAction(formData: FormData) {
  const context = await requirePermission("technician.jobs.update");
  const workOrderId = idFrom(formData, "/technician/jobs");
  let targetPath = `/technician/jobs/${workOrderId}`;

  try {
    const input = technicianUpdateSchema.parse({
      workOrderId,
      note: formData.get("note"),
      laborHours: formData.get("labor_hours") || 0,
      photoFileName: formData.get("photo_file_name") || undefined,
      photoFilePath: formData.get("photo_file_path") || undefined
    });
    const result = await addTechnicianUpdate(context, input);
    revalidatePath(`/technician/jobs/${result.workOrderId}`);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/technician/jobs");
    revalidatePath("/maintenance/work-orders");
    targetPath = `/technician/jobs/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(workOrderId, error, "/technician/jobs"));
  }
  redirect(targetPath);
}

export async function completeTechnicianJobAction(formData: FormData) {
  const context = await requirePermission("technician.jobs.update");
  const id = idFrom(formData, "/technician/jobs");
  let targetPath = `/technician/jobs/${id}`;

  try {
    const result = await completeTechnicianJob(context, id);
    revalidatePath(`/technician/jobs/${result.workOrderId}`);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/technician/jobs");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/technician/jobs/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(id, error, "/technician/jobs"));
  }
  redirect(targetPath);
}

export async function verifyWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.assign");
  const id = idFrom(formData);
  const comments = parseWorkflowComment(formData.get("comments"));
  let targetPath = `/maintenance/work-orders/${id}`;

  try {
    const result = await verifyWorkOrder(context, id, comments);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export async function closeWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const comments = parseWorkflowComment(formData.get("comments"));
  let targetPath = `/maintenance/work-orders/${id}`;

  try {
    const result = await closeWorkOrder(context, id, comments);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export async function returnWorkOrderToDraftAction(formData: FormData) {
  const context = await requirePermission("work_orders.manage");
  const id = idFrom(formData);
  let targetPath = `/maintenance/work-orders/${id}/edit`;

  try {
    const result = await returnWorkOrderToDraft(context, id);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    targetPath = `/maintenance/work-orders/${result.workOrderId}/edit`;
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export async function cancelWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const comments = String(formData.get("comments") ?? "").trim();
  const targetPath = `/maintenance/work-orders/${id}`;

  if (comments.length < 5) {
    redirect(`${targetPath}?error=cancel-reason-required`);
  }

  try {
    const result = await cancelWorkOrder(context, id, comments);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
  } catch (error) {
    redirect(workflowErrorPath(id, error));
  }
  redirect(`${targetPath}?success=cancelled`);
}

export async function markNotificationsReadAction() {
  const context = await requireUser();
  await markAllNotificationsRead(context.userId);
  revalidatePath("/dashboard");
}
