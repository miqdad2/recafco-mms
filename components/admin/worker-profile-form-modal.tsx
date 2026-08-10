"use client";

import { useEffect, useActionState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

import { saveWorkerProfileAction, type WorkerProfileState } from "@/app/actions/workers";
import { WORKER_TYPES, SKILL_CATEGORIES } from "@/lib/backend/workers/constants";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";
import { dispatchActionToast } from "@/lib/action-messages";

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";
const lbl = "block text-xs font-bold text-[#4B5563] mb-1";

export function WorkerProfileFormModal({
  worker,
  canViewCosts,
  onClose,
}: {
  worker: WorkerProfileRow | null;
  // Worker Rate Visibility and Data Entry Lockdown Unit 10F.4, Task 3: this
  // modal only ever opens in edit mode (`worker` set) for Manager/Super
  // Admin — the caller (worker-profiles-view.tsx) hides the Edit button for
  // everyone else. Data Entry only ever reaches this in create mode
  // (`worker` null), where the rate field still shows (Task 3, Option A —
  // Data Entry enters it once at creation) with an explanatory note; it
  // stays hidden for anyone without cost visibility in the (Data-Entry-
  // unreachable) edit case, as a defensive default.
  canViewCosts: boolean;
  onClose: () => void;
}) {
  const showRateField = !worker || canViewCosts;
  const [state, formAction, isPending] = useActionState<WorkerProfileState, FormData>(saveWorkerProfileAction, null);

  useEffect(() => {
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: "Worker Profile Saved" });
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="worker-profile-heading"
          className="relative flex w-full max-w-md flex-col rounded-xl bg-white p-6 shadow-2xl"
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 id="worker-profile-heading" className="text-lg font-bold text-[#111827]">
              {worker ? "Edit Worker" : "Add Worker"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563]"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {state?.ok === false && (
            <div className="mb-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{state.error}</span>
            </div>
          )}

          <form action={formAction} className="space-y-3">
            {worker && <input type="hidden" name="id" value={worker.id} />}

            {/* Worker Profile Form Simplification and Division Rename Unit
                10G.6, Task 1: Employee ID, Name, Worker Type, Division,
                Hourly Rate — that exact order, matching the task's own
                "company-style" form spec. Required on create (a fresh
                profile should always get one); left optional on edit so an
                existing pre-Unit-10G.6 profile with no employee_id yet
                doesn't get blocked from being saved for an unrelated change
                (Task 8 — old rows are never required to backfill one). */}
            <div>
              <label htmlFor="wp-employee-id" className={lbl}>
                Employee ID {!worker && <span className="text-[#ED1C24]">*</span>}
              </label>
              <input
                id="wp-employee-id"
                name="employee_id"
                required={!worker}
                defaultValue={worker?.employee_id ?? ""}
                placeholder="e.g. EMP-1025"
                className={inp}
                disabled={isPending}
              />
            </div>

            <div>
              <label htmlFor="wp-name" className={lbl}>
                Name <span className="text-[#ED1C24]">*</span>
              </label>
              <input
                id="wp-name"
                name="name"
                required
                defaultValue={worker?.name ?? ""}
                placeholder="e.g. Ahmed Hassan"
                className={inp}
                disabled={isPending}
              />
            </div>

            <div>
              <label htmlFor="wp-type" className={lbl}>
                Worker Type <span className="text-[#ED1C24]">*</span>
              </label>
              <select id="wp-type" name="worker_type" required defaultValue={worker?.worker_type ?? WORKER_TYPES[0]} className={inp} disabled={isPending}>
                {WORKER_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Task 2: label is "Division" — the underlying field name
                (skill_category) and stored values are unchanged. */}
            <div>
              <label htmlFor="wp-skill" className={lbl}>Division</label>
              <select id="wp-skill" name="skill_category" defaultValue={worker?.skill_category ?? ""} className={inp} disabled={isPending}>
                <option value="">Not specified</option>
                {SKILL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            {showRateField ? (
              <div>
                <label htmlFor="wp-rate" className={lbl}>
                  Hourly Rate (KWD) <span className="text-[#ED1C24]">*</span>
                </label>
                <input
                  id="wp-rate"
                  name="hourly_rate"
                  type="number"
                  min="0"
                  step="0.001"
                  required
                  defaultValue={worker?.hourly_rate ?? 0}
                  className={inp}
                  disabled={isPending}
                />
                {/* Task 3/4 — shown only for Data Entry (canViewCosts false) at
                    creation; a Manager/Super Admin never sees this note. */}
                {!worker && !canViewCosts && (
                  <p className="mt-1 text-xs text-[#9CA3AF]">
                    Hourly rate is saved for Manager review and cannot be edited by Data Entry after creation.
                  </p>
                )}
              </div>
            ) : (
              <input type="hidden" name="hourly_rate" value={worker?.hourly_rate ?? 0} />
            )}

            {/* Task 3, Option A: Phone/Notes removed from the Add Worker
                (create) form entirely — Data Entry is never asked for them,
                and the "company-style" simplified form stops at Hourly Rate.
                They stay available only in edit mode, which this modal only
                ever opens in for Manager/Super Admin (Data Entry has no Edit
                button — see worker-profiles-view.tsx and this file's own
                canViewCosts comment above), so `worker` being set already
                means the actor is authorized to see/change them. */}
            {worker && (
              <>
                <div>
                  <label htmlFor="wp-phone" className={lbl}>Phone</label>
                  <input id="wp-phone" name="phone" defaultValue={worker?.phone ?? ""} placeholder="Optional" className={inp} disabled={isPending} />
                </div>

                <div>
                  <label htmlFor="wp-notes" className={lbl}>Notes</label>
                  <textarea
                    id="wp-notes"
                    name="notes"
                    rows={2}
                    defaultValue={worker?.notes ?? ""}
                    placeholder="Optional"
                    className={`${inp} resize-none`}
                    disabled={isPending}
                  />
                </div>
              </>
            )}

            <div className="flex items-center gap-2 border-t border-[#F3F4F6] pt-4">
              <button
                type="submit"
                disabled={isPending}
                className="flex flex-1 items-center justify-center gap-2 rounded-md bg-[#ED1C24] py-2.5 text-sm font-bold text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {isPending ? "Saving…" : worker ? "Save Changes" : "Add Worker"}
              </button>
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="rounded-md border border-[#E5E7EB] bg-white px-4 py-2.5 text-sm font-bold text-[#4B5563] transition hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
