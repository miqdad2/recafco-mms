"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  addTechnicianUpdate,
  approveJobCardAndMaterials,
  approveWorkOrder,
  assignTechnicians,
  cancelWorkOrder,
  closeWorkOrder,
  completeTechnicianJob,
  markExternalWorkCompleted,
  rejectWorkOrder,
  requestJobCardCorrection,
  respondToJobCardCorrection,
  returnWorkOrderToDraft,
  reviewJobCard,
  startJobCardProgress,
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
import { getCurrentUserContext, requirePermission, requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { errorToLogInput, logSystemError } from "@/lib/errors/logging";
import { markAllNotificationsRead } from "@/lib/notifications/service";

// Enterprise Error Handling Audit Unit Task 9: every workflow action in this
// file redirected with a safe message but never wrote to system_error_logs —
// centralizing the fix here covers every call site in one change instead of
// touching 16 individual catch blocks.
async function workflowErrorPath(workOrderId: string, error: unknown, basePath = "/maintenance/work-orders") {
  const context = await getCurrentUserContext();
  await logSystemError(errorToLogInput(error, "workflow.action", context?.userId ?? null, {
    entityType: "work_order",
    entityId: workOrderId,
    route: basePath
  }));
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
    redirect(await workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

// Wires up reviewJobCard (lib/backend/work-orders/service.ts) to the UI for
// the first time — the function already existed (Under Review -> Under
// Review, audit note + notifies the Manager) but had no action wrapper and
// was unreachable from anywhere, including the full Job Card detail page.
// Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 4/8: redirects
// with ?success=reviewed so the Full Details page (WorkflowActions form) can
// show a clear confirmation banner instead of a silent redirect.
export async function reviewJobCardAction(formData: FormData) {
  const context = await requirePermission("work_orders.review");
  const id = idFrom(formData);
  const comments = parseWorkflowComment(formData.get("comments"));
  let targetPath = `/maintenance/work-orders/${id}`;

  try {
    const result = await reviewJobCard(context, id, comments);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}?success=reviewed`;
  } catch (error) {
    redirect(await workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

export type ReviewModalState = {
  ok: boolean;
  error?: string;
  workOrderId?: string;
  workOrderNumber?: string | null;
} | null;

// Maintenance Engineer Dashboard + Review-to-Manager UX Fix Task 4/8: the
// quick-view's Review panel uses this non-redirecting variant (mirrors
// assignTechniciansModalAction) so it can stay open, show an inline success
// banner with the Job Card number, and refresh in place — instead of the
// plain form-action redirect, which silently jumped to the Full Details page
// with no visible confirmation (the exact issue this unit reports).
export async function reviewJobCardModalAction(
  _prev: ReviewModalState,
  formData: FormData
): Promise<ReviewModalState> {
  const context = await requirePermission("work_orders.review");
  const workOrderId = formData.get("work_order_id") as string | null;
  if (!workOrderId || !/^[0-9a-f-]{36}$/i.test(workOrderId)) {
    return { ok: false, error: "Invalid Job Card ID." };
  }
  const comments = parseWorkflowComment(formData.get("comments"));
  try {
    const result = await reviewJobCard(context, workOrderId, comments);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    return { ok: true, workOrderId: result.workOrderId, workOrderNumber: result.workOrderNumber };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
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
    redirect(await workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

// Unified Manager Job Card + Materials Approval Flow Fix Task 3: one action
// for the popup's single main button — approves the Job Card, any linked
// Requested Materials Request(s), or both, whichever actually still needs it
// (see approveJobCardAndMaterials for the exact per-case behavior).
export async function approveJobCardAndMaterialsAction(formData: FormData) {
  const context = await requirePermission("work_orders.approve");
  const id = idFrom(formData);
  const comments = parseWorkflowComment(formData.get("comments"));
  let targetPath = `/maintenance/work-orders/${id}`;

  try {
    const result = await approveJobCardAndMaterials(context, id, comments);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/store/parts-requests");
    revalidatePath("/store/issue-materials");
    revalidatePath("/technician/jobs");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(await workflowErrorPath(id, error));
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
    redirect(await workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

// Unit 4: permission changed from work_orders.approve to work_orders.request_correction
// so Maintenance Engineer (not just Manager) can request a correction.
export async function requestClarificationAction(formData: FormData) {
  const context = await requirePermission("work_orders.request_correction");
  const id = idFrom(formData);
  const question = String(formData.get("question") ?? "").trim();
  let targetPath = `/maintenance/work-orders/${id}`;

  if (question.length < 10) {
    redirect(`${targetPath}?error=clarification-question-too-short`);
  }

  try {
    const result = await requestJobCardCorrection(context, id, question);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}?success=clarification-sent`;
  } catch (error) {
    redirect(await workflowErrorPath(id, error));
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
    const result = await respondToJobCardCorrection(context, id, response);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}?success=clarification-responded`;
  } catch (error) {
    redirect(await workflowErrorPath(id, error));
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
    redirect(await workflowErrorPath(workOrderId, error));
  }
  redirect(targetPath);
}

// Data Entry Job Card Progress Update and Close Action Unit: generic
// Assigned -> In Progress step for whoever holds work_orders.update (Data
// Entry, Engineer, Manager) — distinct from startTechnicianJobAction below,
// which is technician-only and drives /technician/jobs.
export async function startJobCardProgressAction(formData: FormData) {
  const context = await requirePermission("work_orders.update");
  const id = idFrom(formData);
  const note = (formData.get("note") as string | null)?.trim() || undefined;
  let targetPath = `/maintenance/work-orders/${id}`;

  try {
    const result = await startJobCardProgress(context, id, note);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/maintenance/work-orders/${result.workOrderId}`;
  } catch (error) {
    redirect(await workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

// Unit 4: permission changed from work_orders.assign to work_orders.close — this
// action now closes the Job Card directly (no more "Completed by Technician").
export async function markExternalWorkCompletedAction(formData: FormData) {
  const context = await requirePermission("work_orders.close");
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
    redirect(await workflowErrorPath(workOrderId, error));
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
    redirect(await workflowErrorPath(id, error, "/technician/jobs"));
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
    redirect(await workflowErrorPath(workOrderId, error, "/technician/jobs"));
  }
  redirect(targetPath);
}

export async function completeTechnicianJobAction(formData: FormData) {
  const context = await requirePermission("technician.jobs.update");
  const id = idFrom(formData, "/technician/jobs");
  const comments = (formData.get("comments") as string | null)?.trim() ?? "";
  let targetPath = `/technician/jobs/${id}`;

  try {
    const result = await completeTechnicianJob(context, id, comments);
    revalidatePath(`/technician/jobs/${result.workOrderId}`);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/technician/jobs");
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
    targetPath = `/technician/jobs/${result.workOrderId}`;
  } catch (error) {
    redirect(await workflowErrorPath(id, error, "/technician/jobs"));
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
    redirect(await workflowErrorPath(id, error));
  }
  redirect(targetPath);
}

// Unit 4: permission changed from work_orders.approve to work_orders.close so
// Manager/Engineer/Data Entry/Technician can all close a Job Card (Unit 3 grants).
export async function closeWorkOrderAction(formData: FormData) {
  const context = await requirePermission("work_orders.close");
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
    redirect(await workflowErrorPath(id, error));
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
    redirect(await workflowErrorPath(id, error));
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
    redirect(await workflowErrorPath(id, error));
  }
  redirect(`${targetPath}?success=cancelled`);
}

export async function markNotificationsReadAction() {
  const context = await requireUser();
  await markAllNotificationsRead(context.userId);
  revalidatePath("/dashboard");
}
