"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth/context";
import { safeErrorMessage } from "@/lib/errors/error-handler";
import { assignInternalTeamRoster } from "@/lib/backend/work-orders/worker-roster";
import { internalTeamRosterSchema } from "@/lib/backend/workers/validators";

// Work Assignment and Worker Profiles Foundation Unit 7, Task 4/5.
// Separate from assignTechniciansAction/assignTechniciansModalAction
// (app/actions/workflow.ts) — this saves the new worker_profiles-backed
// Internal Team roster (Supervisor/Technicians/Helpers with rate snapshots),
// not the existing technician self-service / Freelancer / Company flow.

export type InternalTeamRosterState = { ok: true } | { ok: false; error: string } | null;

export async function saveInternalTeamRosterAction(
  _prev: InternalTeamRosterState,
  formData: FormData
): Promise<InternalTeamRosterState> {
  const context = await requireUser();

  try {
    // Estimated Work Hours for Job Cards and Workers Unit 10G.13, Task 4:
    // InternalTeamRosterForm doesn't offer per-worker estimate editing in
    // this unit, but it DOES resubmit each currently-selected worker's
    // already-known estimate as a hidden `roster_worker_estimates` JSON
    // field (same shape as the wizard's own `assign_worker_estimates`) — so
    // using this form to add/remove workers never silently wipes an
    // estimate set earlier via the wizard. See InternalTeamRosterForm.
    const rawEstimates = String(formData.get("roster_worker_estimates") ?? "").trim();
    let estimatedHoursByWorkerId: Record<string, number> = {};
    if (rawEstimates) {
      try {
        const obj = JSON.parse(rawEstimates);
        if (obj && typeof obj === "object") {
          for (const [key, value] of Object.entries(obj)) {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 0) estimatedHoursByWorkerId[key] = n;
          }
        }
      } catch {
        estimatedHoursByWorkerId = {};
      }
    }

    const parsed = internalTeamRosterSchema.parse({
      workOrderId: formData.get("work_order_id"),
      supervisorId: formData.get("supervisor_id") || undefined,
      technicianIds: formData.getAll("technician_ids").map(String).filter(Boolean),
      helperIds: formData.getAll("helper_ids").map(String).filter(Boolean),
      notes: formData.get("roster_notes") || undefined,
      estimatedHoursByWorkerId,
    });
    const result = await assignInternalTeamRoster(context, parsed);
    revalidatePath(`/maintenance/work-orders/${result.workOrderId}`);
    revalidatePath("/maintenance/work-orders");
    revalidatePath("/dashboard");
  } catch (error) {
    return { ok: false, error: safeErrorMessage(error) };
  }

  return { ok: true };
}
