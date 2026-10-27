"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import {
  approveWorkTimeCorrection,
  rejectWorkTimeCorrection,
  requestManualWorkTimeEntry,
  requestWorkTimeCorrection,
} from "@/lib/backend/work-orders/work-time-corrections";

// Worker Time Corrections — thin transport layer; rules live in
// lib/backend/work-orders/work-time-corrections.ts.

export type WorkTimeCorrectionActionState = { ok: true; message: string } | { ok: false; error: string } | null;

const uuid = z.string().uuid();

function revalidateJobCard(workOrderId: string) {
  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  revalidatePath("/maintenance/daily-activity");
  revalidatePath("/dashboard");
}

export async function requestWorkTimeCorrectionAction(
  _prev: WorkTimeCorrectionActionState,
  formData: FormData
): Promise<WorkTimeCorrectionActionState> {
  const context = await requireUser();
  try {
    const result = await requestWorkTimeCorrection(context, {
      sessionId: uuid.parse(formData.get("session_id")),
      correctedStart: String(formData.get("corrected_start") ?? ""),
      correctedEnd: String(formData.get("corrected_end") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      confirmLongPeriod: formData.get("confirm_long_period") === "on",
    });
    revalidateJobCard(result.workOrderId);
    return {
      ok: true,
      message: result.alreadyPending
        ? "This correction was already sent. It is waiting for the Maintenance Manager."
        : "Correction sent to the Maintenance Manager. The recorded time stays until it is approved.",
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

// Manual work time entry (Data Entry → Manager). The form sends separate
// Kuwait date and time fields; they are joined into one Kuwait wall-clock
// value ("YYYY-MM-DDTHH:mm") the service parses explicitly as Asia/Kuwait.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
function kuwaitDateTime(formData: FormData, prefix: "start" | "end"): string {
  const date = String(formData.get(`${prefix}_date`) ?? "").trim();
  const time = String(formData.get(`${prefix}_time`) ?? "").trim();
  return DATE_RE.test(date) && TIME_RE.test(time) ? `${date}T${time}` : "";
}

export async function requestManualWorkTimeEntryAction(
  _prev: WorkTimeCorrectionActionState,
  formData: FormData
): Promise<WorkTimeCorrectionActionState> {
  const context = await requireUser();
  try {
    const result = await requestManualWorkTimeEntry(context, {
      workerAssignmentId: uuid.parse(formData.get("worker_assignment_id")),
      start: kuwaitDateTime(formData, "start"),
      end: kuwaitDateTime(formData, "end"),
      reason: String(formData.get("reason") ?? ""),
      confirmLongPeriod: formData.get("confirm_long_period") === "on",
    });
    revalidateJobCard(result.workOrderId);
    return {
      ok: true,
      message: result.alreadyPending
        ? "This time was already sent. It is waiting for the Maintenance Manager."
        : "Time sent to the Maintenance Manager. It is added to the worker's hours only after approval.",
    };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}
