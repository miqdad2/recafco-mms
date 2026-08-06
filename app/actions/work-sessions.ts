"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import {
  startWorkSession,
  pauseWorkSession,
  stopWorkSession,
  addManualTimeEntry,
  editWorkSession,
  cancelWorkSession,
} from "@/lib/backend/work-orders/work-sessions";
import {
  startWorkSessionSchema,
  pauseOrStopWorkSessionSchema,
  manualTimeEntrySchema,
  editWorkSessionSchema,
  cancelWorkSessionSchema,
} from "@/lib/backend/workers/work-session-validators";
import { getSessionsForAssignment, type SessionRow } from "@/lib/work-orders/work-session-totals";

// Work Session Time Tracking and Labor Cost Calculation Unit 8, Tasks 2/5/7.

export type WorkSessionState = { ok: true } | { ok: false; error: string } | null;

function revalidateJobCard(workOrderId: string) {
  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  revalidatePath("/maintenance/work-orders");
  revalidatePath("/dashboard");
}

export async function startWorkSessionAction(
  _prev: WorkSessionState,
  formData: FormData
): Promise<WorkSessionState> {
  const context = await requireUser();
  try {
    const parsed = startWorkSessionSchema.parse({
      workOrderId: formData.get("work_order_id"),
      workerAssignmentId: formData.get("worker_assignment_id"),
      notes: formData.get("notes") || undefined,
    });
    const result = await startWorkSession(context, parsed);
    revalidateJobCard(result.workOrderId);
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
  return { ok: true };
}

export async function pauseWorkSessionAction(
  _prev: WorkSessionState,
  formData: FormData
): Promise<WorkSessionState> {
  const context = await requireUser();
  try {
    const parsed = pauseOrStopWorkSessionSchema.parse({
      workOrderId: formData.get("work_order_id"),
      workerAssignmentId: formData.get("worker_assignment_id"),
    });
    const result = await pauseWorkSession(context, parsed);
    revalidateJobCard(result.workOrderId);
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
  return { ok: true };
}

export async function stopWorkSessionAction(
  _prev: WorkSessionState,
  formData: FormData
): Promise<WorkSessionState> {
  const context = await requireUser();
  try {
    const parsed = pauseOrStopWorkSessionSchema.parse({
      workOrderId: formData.get("work_order_id"),
      workerAssignmentId: formData.get("worker_assignment_id"),
    });
    const result = await stopWorkSession(context, parsed);
    revalidateJobCard(result.workOrderId);
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
  return { ok: true };
}

export async function addManualTimeEntryAction(
  _prev: WorkSessionState,
  formData: FormData
): Promise<WorkSessionState> {
  const context = await requireUser();
  try {
    const parsed = manualTimeEntrySchema.parse({
      workOrderId: formData.get("work_order_id"),
      workerAssignmentId: formData.get("worker_assignment_id"),
      startedAt: formData.get("started_at"),
      stoppedAt: formData.get("stopped_at"),
      notes: formData.get("notes") || undefined,
    });
    const result = await addManualTimeEntry(context, parsed);
    revalidateJobCard(result.workOrderId);
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
  return { ok: true };
}

export async function editWorkSessionAction(
  _prev: WorkSessionState,
  formData: FormData
): Promise<WorkSessionState> {
  const context = await requireUser();
  try {
    const parsed = editWorkSessionSchema.parse({
      sessionId: formData.get("session_id"),
      startedAt: formData.get("started_at"),
      stoppedAt: formData.get("stopped_at"),
      correctionReason: formData.get("correction_reason"),
    });
    const result = await editWorkSession(context, parsed);
    revalidateJobCard(result.workOrderId);
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
  return { ok: true };
}

// "View Sessions" — called directly from the client (not a form action).
// Gated on plain requireUser(), matching the read-only, low-sensitivity
// nature of session history (mirrors the Job Card detail page it's launched
// from, which is itself already permission-gated).
export async function getSessionsForAssignmentAction(workerAssignmentId: string): Promise<SessionRow[]> {
  await requireUser();
  try {
    return await getSessionsForAssignment(workerAssignmentId);
  } catch {
    return [];
  }
}

export async function cancelWorkSessionAction(
  _prev: WorkSessionState,
  formData: FormData
): Promise<WorkSessionState> {
  const context = await requireUser();
  try {
    const parsed = cancelWorkSessionSchema.parse({
      sessionId: formData.get("session_id"),
      correctionReason: formData.get("correction_reason"),
    });
    const result = await cancelWorkSession(context, parsed);
    revalidateJobCard(result.workOrderId);
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
  return { ok: true };
}
