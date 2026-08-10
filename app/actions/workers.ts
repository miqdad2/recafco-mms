"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { logSystemError } from "@/lib/errors/logging";
import {
  createWorkerProfile,
  updateWorkerProfile,
  setWorkerProfileActive,
} from "@/lib/backend/workers/service";
import { workerProfileSchema } from "@/lib/backend/workers/validators";

// Work Assignment and Worker Profiles Foundation Unit 7, Task 3.

export type WorkerProfileState = { ok: true } | { ok: false; error: string } | null;

function parseWorkerProfileForm(formData: FormData) {
  return workerProfileSchema.parse({
    id: formData.get("id") || undefined,
    employeeId: formData.get("employee_id") || undefined,
    name: formData.get("name"),
    workerType: formData.get("worker_type"),
    hourlyRate: formData.get("hourly_rate"),
    phone: formData.get("phone") || undefined,
    skillCategory: formData.get("skill_category") || undefined,
    notes: formData.get("notes") || undefined,
  });
}

export async function saveWorkerProfileAction(
  _prev: WorkerProfileState,
  formData: FormData
): Promise<WorkerProfileState> {
  const context = await requireUser();

  try {
    const parsed = parseWorkerProfileForm(formData);
    if (parsed.id) {
      await updateWorkerProfile(context, parsed.id, parsed);
    } else {
      await createWorkerProfile(context, parsed);
    }
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }

  revalidatePath("/admin/worker-profiles");
  return { ok: true };
}

export async function setWorkerProfileActiveAction(formData: FormData) {
  const context = await requireUser();
  const id = String(formData.get("id") ?? "");
  const isActive = String(formData.get("is_active") ?? "") === "true";

  try {
    await setWorkerProfileActive(context, id, isActive);
  } catch (error) {
    // Non-fatal to the page — this is a quick inline toggle button, not a
    // full form with its own error banner (keep it simple) — but the
    // failure is still logged so a denied/failed toggle isn't silently lost.
    await logSystemError({
      severity: "warning",
      source: "workers.setWorkerProfileActiveAction",
      message: safeErrorMessage(error),
      userId: context.userId,
      entityType: "worker_profile",
      entityId: id,
    });
  }

  revalidatePath("/admin/worker-profiles");
}
