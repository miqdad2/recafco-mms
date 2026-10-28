"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import {
  approveWorkTimeCorrection,
  changeManualWorkTime,
  correctRecordedWorkTime,
  recordManualWorkTime,
  rejectWorkTimeCorrection,
  type ManualWorkTimeFields,
} from "@/lib/backend/work-orders/work-time-corrections";
import { formatDurationMinutes } from "@/lib/format/kuwait-time";

// Worker Time — thin transport layer; rules live in
// lib/backend/work-orders/work-time-corrections.ts. Manual time and
// corrections are saved at once; the Manager reviews them in Closure Review.

export type WorkTimeCorrectionActionState = { ok: true; message: string } | { ok: false; error: string } | null;

const uuid = z.string().uuid();
// Optional on the timer-correction form (older open forms have none).
const optionalUuid = z.string().uuid().optional().catch(undefined);

function revalidateJobCard(workOrderId: string) {
  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  revalidatePath("/maintenance/daily-activity");
  revalidatePath("/maintenance/assignments"); // Worker Activity
  revalidatePath("/dashboard");
}

export async function requestWorkTimeCorrectionAction(
  _prev: WorkTimeCorrectionActionState,
  formData: FormData
): Promise<WorkTimeCorrectionActionState> {
  const context = await requireUser();
  try {
    const result = await correctRecordedWorkTime(context, {
      sessionId: uuid.parse(formData.get("session_id")),
      correctedStart: String(formData.get("corrected_start") ?? ""),
      correctedEnd: String(formData.get("corrected_end") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      confirmLongPeriod: formData.get("confirm_long_period") === "on",
      submissionId: optionalUuid.parse(formData.get("submission_id") ?? undefined) ?? null,
    });
    revalidateJobCard(result.workOrderId);
    return {
      ok: true,
      message: result.alreadySaved
        ? "This correction was already saved."
        : `Time corrected for ${result.workerName}: now ${formatDurationMinutes(result.minutes)}. The Manager sees it when reviewing the closure.`,
    };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}

function manualFields(formData: FormData): ManualWorkTimeFields {
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  return {
    startDate: text("start_date"),
    startTime: text("start_time"),
    endDate: text("end_date"),
    endTime: text("end_time"),
    actualHours: text("actual_hours"),
    reason: text("reason"),
    confirmLongPeriod: formData.get("confirm_long_period") === "on",
    submissionId: uuid.parse(formData.get("submission_id")),
  };
}

// Save Manual Time — or, with session_id, Change Manual Time.
export async function saveManualWorkTimeAction(
  _prev: WorkTimeCorrectionActionState,
  formData: FormData
): Promise<WorkTimeCorrectionActionState> {
  const context = await requireUser();
  try {
    const sessionId = formData.get("session_id");
    if (sessionId) {
      const result = await changeManualWorkTime(context, { ...manualFields(formData), sessionId: uuid.parse(sessionId) });
      revalidateJobCard(result.workOrderId);
      return {
        ok: true,
        message: result.alreadySaved ? "This change was already saved." : `Manual time changed for ${result.workerName}: now ${formatDurationMinutes(result.minutes)}.`,
      };
    }
    const result = await recordManualWorkTime(context, { ...manualFields(formData), workerAssignmentId: uuid.parse(formData.get("worker_assignment_id")) });
    revalidateJobCard(result.workOrderId);
    return {
      ok: true,
      message: result.alreadySaved
        ? "This time was already saved."
        : `${formatDurationMinutes(result.minutes)} saved for ${result.workerName}.${
            result.possibleConflictCount
              ? " The dates overlap other work of this worker; the Manager will see this when reviewing the closure."
              : ""
          }`,
    };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}

export async function approveWorkTimeCorrectionAction(
  _prev: WorkTimeCorrectionActionState,
  formData: FormData
): Promise<WorkTimeCorrectionActionState> {
  const context = await requireUser();
  try {
    const result = await approveWorkTimeCorrection(context, {
      correctionId: uuid.parse(formData.get("correction_id")),
      remarks: String(formData.get("remarks") ?? ""),
    });
    revalidateJobCard(result.workOrderId);
    return { ok: true, message: `Correction approved for ${result.workerName}.` };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}

export async function rejectWorkTimeCorrectionAction(
  _prev: WorkTimeCorrectionActionState,
  formData: FormData
): Promise<WorkTimeCorrectionActionState> {
  const context = await requireUser();
  try {
    const result = await rejectWorkTimeCorrection(context, {
      correctionId: uuid.parse(formData.get("correction_id")),
      remarks: String(formData.get("remarks") ?? ""),
    });
    revalidateJobCard(result.workOrderId);
    return { ok: true, message: `Correction rejected. ${result.workerName}'s recorded time is kept.` };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}
