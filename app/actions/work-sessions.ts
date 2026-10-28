"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/context";
import { prisma } from "@/lib/db/prisma";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { canViewCosts } from "@/lib/security/permissions";
import { getWorkOrderVisibilityFilter } from "@/lib/work-orders/visibility";
import {
  startWorkSession,
  pauseWorkSession,
  stopWorkSession,
  finishWorkSession,
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
  // Start / Pause / Resume / Finish change the Paused / Working counts on
  // these pages too — never leave them stale after navigating.
  revalidatePath("/maintenance/daily-activity");
  revalidatePath("/maintenance/assignments");
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
      // Record Additional Work: both the flag and the user's confirmation tick.
      additionalWork: formData.get("additional_work") === "1" && formData.get("confirm_additional_work") === "on" ? true : undefined,
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

// Worker Timer and Closure Logic Hardening Unit 10G.53, Task 3 — thin
// wrapper matching pauseWorkSessionAction/stopWorkSessionAction above
// exactly (same input shape, same schema).
export async function finishWorkSessionAction(
  _prev: WorkSessionState,
  formData: FormData
): Promise<WorkSessionState> {
  const context = await requireUser();
  try {
    const parsed = pauseOrStopWorkSessionSchema.parse({
      workOrderId: formData.get("work_order_id"),
      workerAssignmentId: formData.get("worker_assignment_id"),
    });
    const result = await finishWorkSession(context, parsed);
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
      confirmLongPeriod: formData.get("confirm_long_period") === "on",
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
      confirmLongPeriod: formData.get("confirm_long_period") === "on",
    });
    const result = await editWorkSession(context, parsed);
    revalidateJobCard(result.workOrderId);
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
  return { ok: true };
}

// "View Sessions" — called directly from the client (not a form action).
// Job Card Deletion and Worker Time Correction: now also checks that the
// worker assignment's Job Card is visible to the caller (same
// getWorkOrderVisibilityFilter as the Job Card page) and returns rate/amount
// only to cost viewers — previously any signed-in user could read every
// period's pay for any assignment id, hidden only in the browser.
export async function getSessionsForAssignmentAction(workerAssignmentId: string): Promise<SessionRow[]> {
  const context = await requireUser();
  try {
    const visible = await prisma.workOrderWorkerAssignment.findFirst({
      where: {
        id: workerAssignmentId,
        work_orders: { AND: [{ deleted_at: null }, getWorkOrderVisibilityFilter(context)] },
      },
      select: { id: true },
    });
    if (!visible) return [];
    return await getSessionsForAssignment(workerAssignmentId, { includeCosts: canViewCosts(context) });
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
