"use client";

import { useEffect, useActionState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

import { saveWorkerProfileAction, type WorkerProfileState } from "@/app/actions/workers";
import { WORKER_TYPES, SKILL_CATEGORIES } from "@/lib/backend/workers/constants";
import type { WorkerProfileRow } from "@/lib/backend/workers/service";

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm placeholder:text-[#9CA3AF] focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50 disabled:text-[#9CA3AF]";
const lbl = "block text-xs font-bold text-[#4B5563] mb-1";

export function WorkerProfileFormModal({
  worker,
  onClose,
}: {
  worker: WorkerProfileRow | null;
  onClose: () => void;
}) {
  const [state, formAction, isPending] = useActionState<WorkerProfileState, FormData>(saveWorkerProfileAction, null);

  useEffect(() => {
    if (state?.ok) onClose();
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
            </div>

            <div>
              <label htmlFor="wp-phone" className={lbl}>Phone</label>
              <input id="wp-phone" name="phone" defaultValue={worker?.phone ?? ""} placeholder="Optional" className={inp} disabled={isPending} />
            </div>

            <div>
              <label htmlFor="wp-skill" className={lbl}>Skill Category</label>
              <select id="wp-skill" name="skill_category" defaultValue={worker?.skill_category ?? ""} className={inp} disabled={isPending}>
                <option value="">Not specified</option>
                {SKILL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
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
