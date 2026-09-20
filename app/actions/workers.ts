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
    hourlyRate: formData.get("hourly_rate") || undefined,
    phone: formData.get("phone") || undefined,
    skillCategory: formData.get("skill_category") || undefined,
    notes: formData.get("notes") || undefined,
    // Worker Salary Breakdown and Manager Labor Cost View Unit 10G.41B,
    // Task 2/3: present on both forms.
    jobTitle: formData.get("job_title") || undefined,
    workLocation: formData.get("work_location") || undefined,
    // Manager-only fields — only ever present in the form when the Manager
    // Salary Details section rendered; parsed the same way either way, the
    // service layer decides whether to trust them.
    reportingManager: formData.get("reporting_manager") || undefined,
    nationality: formData.get("nationality") || undefined,
    basicSalary: formData.get("basic_salary") || undefined,
    transportAllowance: formData.get("transport_allowance") || undefined,
    accommodationAllowance: formData.get("accommodation_allowance") || undefined,
    foodAllowance: formData.get("food_allowance") || undefined,
    monthlyWorkingHours: formData.get("monthly_working_hours") || undefined,
    // Worker Salary Cost Method and Rate Calculation Unit 10G.68, Task 1/7 —
    // present only when the Salary Details section rendered (Manager/Super
    // Admin); parsed the same way either way, the service layer decides
    // whether to trust them (assertCanManageWorkers vs. isManagerRole,
    // unchanged from every other salary field above).
    salaryInputMethod: formData.get("salary_input_method") || undefined,
    yearlyCost: formData.get("yearly_cost") || undefined,
    monthlyCost: formData.get("monthly_cost") || undefined,
    monthlyWorkingDays: formData.get("monthly_working_days") || undefined,
    manualHourlyRateReason: formData.get("manual_hourly_rate_reason") || undefined,
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
