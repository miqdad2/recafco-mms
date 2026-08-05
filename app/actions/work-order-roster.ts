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
    const parsed = internalTeamRosterSchema.parse({
      workOrderId: formData.get("work_order_id"),
      supervisorId: formData.get("supervisor_id") || undefined,
      technicianIds: formData.getAll("technician_ids").map(String).filter(Boolean),
      helperIds: formData.getAll("helper_ids").map(String).filter(Boolean),
      notes: formData.get("roster_notes") || undefined,
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
