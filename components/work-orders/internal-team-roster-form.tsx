"use client";

import { useActionState, useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { saveInternalTeamRosterAction, type InternalTeamRosterState } from "@/app/actions/work-order-roster";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";
import { dispatchActionToast } from "@/lib/action-messages";

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";
const lbl = "mb-1 block text-xs font-bold text-[#4B5563]";

type CurrentRosterRow = { worker_id: string; worker_role: string };

export function InternalTeamRosterForm({
  workOrderId,
  workers,
  currentRoster,
  onSaved,
  canViewCosts = false,
}: {
  workOrderId: string;
  workers: WorkerProfileRow[];
  currentRoster: CurrentRosterRow[];
  onSaved?: () => void;
  // Hide Worker Hourly Rate from Data Entry Assignment Picker Unit 10F.1,
  // Task 2: this same roster form is also used from the Job Card detail
  // Assignment & Work Time tab, where Manager/Super Admin should still see
  // rates per the existing cost-visibility rule. Defaults to hidden so any
  // other caller that doesn't pass this explicitly stays on the safe side.
  canViewCosts?: boolean;
}) {
  const [state, formAction, isPending] = useActionState<InternalTeamRosterState, FormData>(
    saveInternalTeamRosterAction,
    null
  );
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (state?.ok) {
      // Popup and Feedback Design Standardization Unit 8D, Task 6: a quick
      // edit to who's assigned — a toast, not a full workflow modal (this
      // doesn't change the Job Card's workflow status/meaning the way
      // starting/closing it does).
      dispatchActionToast({ tone: "success", title: "Assignment Updated" });
      onSaved?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  const activeWorkers = workers.filter((w) => w.is_active);
  const supervisors = activeWorkers.filter((w) => w.worker_type === "Supervisor");
  const technicians = activeWorkers.filter((w) => w.worker_type === "Technician");
  const helpers = activeWorkers.filter((w) => w.worker_type === "Helper/Labor");

  const currentSupervisorId = currentRoster.find((r) => r.worker_role === "Supervisor")?.worker_id ?? "";
  const currentTechnicianIds = currentRoster.filter((r) => r.worker_role === "Technician").map((r) => r.worker_id);
  const currentHelperIds = currentRoster.filter((r) => r.worker_role === "Helper/Labor").map((r) => r.worker_id);

  if (activeWorkers.length === 0) {
    return (
      <p className="text-sm text-[#6B7280]">
        No active worker profiles yet. Add Supervisors, Technicians, and Helpers/Labor under{" "}
        <span className="font-semibold">Worker Profiles</span> first.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="work_order_id" value={workOrderId} />
      <input type="hidden" name="roster_notes" value={notes} />

      {state?.ok === false && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      )}

      <div>
        <label htmlFor="itr-supervisor" className={lbl}>Supervisor</label>
        <select id="itr-supervisor" name="supervisor_id" defaultValue={currentSupervisorId} className={inp} disabled={isPending}>
          <option value="">No supervisor</option>
          {supervisors.map((w) => (
            <option key={w.id} value={w.id}>
              {canViewCosts ? `${w.name} — ${w.hourly_rate.toFixed(3)} KWD/hr` : w.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="itr-technicians" className={lbl}>Technicians (Ctrl/Cmd-click to select multiple)</label>
        <select
          id="itr-technicians"
          name="technician_ids"
          multiple
          defaultValue={currentTechnicianIds}
          className={`${inp} h-24`}
          disabled={isPending}
        >
          {technicians.map((w) => (
            <option key={w.id} value={w.id}>
              {canViewCosts ? `${w.name} — ${w.hourly_rate.toFixed(3)} KWD/hr` : w.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="itr-helpers" className={lbl}>Helpers / Labor (Ctrl/Cmd-click to select multiple)</label>
        <select
          id="itr-helpers"
          name="helper_ids"
          multiple
          defaultValue={currentHelperIds}
          className={`${inp} h-24`}
          disabled={isPending}
        >
          {helpers.map((w) => (
            <option key={w.id} value={w.id}>
              {canViewCosts ? `${w.name} — ${w.hourly_rate.toFixed(3)} KWD/hr` : w.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="itr-notes" className={lbl}>Assignment notes</label>
        <textarea
          id="itr-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional"
          className={`${inp} resize-none`}
          rows={2}
          disabled={isPending}
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="flex w-full items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {isPending ? "Saving…" : "Save Internal Team"}
      </button>
    </form>
  );
}
