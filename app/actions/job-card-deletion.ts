"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import {
  approveJobCardDeletion,
  rejectJobCardDeletion,
  requestJobCardDeletion,
} from "@/lib/backend/work-orders/job-card-deletion";

// Job Card Deletion Requests — thin transport layer; every rule (role,
// visibility, eligibility, self-approval, concurrency) lives in
// lib/backend/work-orders/job-card-deletion.ts.

export type JobCardDeletionActionState = { ok: true; message: string } | { ok: false; error: string } | null;

const uuid = z.string().uuid();

function revalidateJobCard(workOrderId: string) {
  revalidatePath(`/maintenance/work-orders/${workOrderId}`);
  revalidatePath("/maintenance/work-orders");
  revalidatePath("/dashboard");
}

export async function requestJobCardDeletionAction(
  _prev: JobCardDeletionActionState,
  formData: FormData
): Promise<JobCardDeletionActionState> {
  const context = await requireUser();
  try {
    const workOrderId = uuid.parse(formData.get("work_order_id"));
    const result = await requestJobCardDeletion(context, {
      workOrderId,
      reason: String(formData.get("reason") ?? ""),
    });
    revalidateJobCard(workOrderId);
    return {
      ok: true,
      message: result.alreadyPending
        ? "Your request was already sent. It is waiting for the Maintenance Manager."
        : "Your request was sent to the Maintenance Manager.",
    };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}

export async function approveJobCardDeletionAction(
  _prev: JobCardDeletionActionState,
  formData: FormData
): Promise<JobCardDeletionActionState> {
  const context = await requireUser();
  try {
    const result = await approveJobCardDeletion(context, {
      requestId: uuid.parse(formData.get("request_id")),
      remarks: String(formData.get("remarks") ?? ""),
    });
    revalidateJobCard(result.workOrderId);
    return { ok: true, message: `Job Card ${result.workOrderNumber ?? ""} was deleted.` };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}

export async function rejectJobCardDeletionAction(
  _prev: JobCardDeletionActionState,
  formData: FormData
): Promise<JobCardDeletionActionState> {
  const context = await requireUser();
  try {
    const result = await rejectJobCardDeletion(context, {
      requestId: uuid.parse(formData.get("request_id")),
      remarks: String(formData.get("remarks") ?? ""),
    });
    revalidateJobCard(result.workOrderId);
    return { ok: true, message: "The delete request was rejected. The Job Card is kept." };
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }
}
