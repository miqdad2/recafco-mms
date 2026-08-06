"use client";

import { useEffect, useState, useActionState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

import { getSessionsForAssignmentAction, editWorkSessionAction, cancelWorkSessionAction, type WorkSessionState } from "@/app/actions/work-sessions";
import { StatusBadge } from "@/components/ui/status-badge";
import { dispatchActionToast } from "@/lib/action-messages";
import type { SessionRow } from "@/lib/work-orders/work-session-totals";

const inp =
  "w-full rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#ED1C24] disabled:bg-gray-50";

function statusTone(status: string): "green" | "amber" | "blue" | "red" | "gray" {
  if (status === "Active") return "green";
  if (status === "Paused") return "amber";
  if (status === "Completed") return "blue";
  if (status === "Cancelled") return "red";
  return "gray";
}

function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditSessionForm({ session, onDone }: { session: SessionRow; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<WorkSessionState, FormData>(editWorkSessionAction, null);

  useEffect(() => {
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: "Session Updated" });
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-[#E5E7EB] bg-gray-50 p-2">
      <input type="hidden" name="session_id" value={session.id} />
      {state?.ok === false && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[10px] font-bold text-[#4B5563]">Start</label>
          <input type="datetime-local" name="started_at" defaultValue={toLocalInputValue(session.started_at)} required className={inp} disabled={isPending} />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] font-bold text-[#4B5563]">Stop</label>
          <input
            type="datetime-local"
            name="stopped_at"
            defaultValue={toLocalInputValue(session.stopped_at ?? session.paused_at ?? session.started_at)}
            required
            className={inp}
            disabled={isPending}
          />
        </div>
      </div>
      <div>
        <label className="mb-0.5 block text-[10px] font-bold text-[#4B5563]">Correction reason (required)</label>
        <input type="text" name="correction_reason" required minLength={5} placeholder="Why is this being corrected?" className={inp} disabled={isPending} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={isPending} className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60">
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Save Correction
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#4B5563] hover:bg-gray-50">
          Cancel
        </button>
      </div>
    </form>
  );
}

function CancelSessionForm({ session, onDone }: { session: SessionRow; onDone: () => void }) {
  const [state, formAction, isPending] = useActionState<WorkSessionState, FormData>(cancelWorkSessionAction, null);

  useEffect(() => {
    if (state?.ok) {
      dispatchActionToast({ tone: "warning", title: "Session Cancelled" });
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-red-200 bg-red-50 p-2">
      <input type="hidden" name="session_id" value={session.id} />
      {state?.ok === false && <p className="text-xs text-red-700">{state.error}</p>}
      <label className="mb-0.5 block text-[10px] font-bold text-[#7F1D1D]">Reason for cancelling (required)</label>
      <input type="text" name="correction_reason" required minLength={5} placeholder="Why is this session wrong?" className={inp} disabled={isPending} />
      <div className="flex gap-2">
        <button type="submit" disabled={isPending} className="inline-flex items-center gap-1.5 rounded-md bg-red-700 px-2.5 py-1 text-xs font-bold text-white hover:bg-red-800 disabled:opacity-60">
          {isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Confirm Cancel Session
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#4B5563] hover:bg-gray-50">
          Back
        </button>
      </div>
    </form>
  );
}

export function SessionHistoryModal({
  workerAssignmentId,
  workerName,
  isManager,
  canViewCosts,
  onClose,
}: {
  workerAssignmentId: string;
  workerName: string;
  isManager: boolean;
  canViewCosts: boolean;
  onClose: () => void;
}) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getSessionsForAssignmentAction(workerAssignmentId).then((rows) => {
      if (!cancelled) setSessions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [workerAssignmentId, reloadToken]);

  function afterChange() {
    setEditingId(null);
    setCancellingId(null);
    setReloadToken((n) => n + 1);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="presentation">
        <div role="dialog" aria-modal="true" aria-labelledby="session-history-heading" className="relative flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#F3F4F6] px-6 py-4">
            <h2 id="session-history-heading" className="text-lg font-bold text-[#111827]">
              Sessions — {workerName}
            </h2>
            <button type="button" onClick={onClose} className="rounded-md p-1.5 text-[#9CA3AF] hover:bg-gray-100 hover:text-[#4B5563]" aria-label="Close">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4">
            {sessions === null ? (
              <p className="text-sm text-[#9CA3AF]">Loading…</p>
            ) : sessions.length === 0 ? (
              <p className="text-sm text-[#9CA3AF]">No sessions yet.</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((s) => (
                  <div key={s.id} className="rounded-md border border-[#E5E7EB] p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold text-[#111827]">
                          {new Date(s.started_at).toLocaleString("en-GB")}
                          {s.stopped_at || s.paused_at
                            ? ` → ${new Date(s.stopped_at ?? s.paused_at!).toLocaleString("en-GB")}`
                            : " → (in progress)"}
                        </p>
                        <p className="text-xs text-[#6B7280]">
                          {s.duration_minutes} min{s.is_manual_entry ? " — manual entry" : ""}
                          {canViewCosts ? ` — ${s.calculated_amount.toFixed(3)} KWD` : ""}
                        </p>
                      </div>
                      <StatusBadge label={s.status} tone={statusTone(s.status)} />
                    </div>
                    {s.notes && <p className="mt-1 text-xs text-[#4B5563]">Note: {s.notes}</p>}
                    {s.correction_reason && (
                      <p className="mt-1 text-xs text-amber-700">
                        Corrected{s.edited_by_name ? ` by ${s.edited_by_name}` : ""}: {s.correction_reason}
                      </p>
                    )}

                    {isManager && s.status !== "Active" && s.status !== "Cancelled" && editingId !== s.id && cancellingId !== s.id && (
                      <div className="mt-2 flex gap-2">
                        <button type="button" onClick={() => setEditingId(s.id)} className="rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-bold text-[#4B5563] hover:bg-gray-50">
                          Edit / Correct
                        </button>
                        <button type="button" onClick={() => setCancellingId(s.id)} className="rounded-md border border-red-200 bg-white px-2.5 py-1 text-xs font-bold text-red-700 hover:bg-red-50">
                          Cancel Session
                        </button>
                      </div>
                    )}
                    {isManager && editingId === s.id && <EditSessionForm session={s} onDone={afterChange} />}
                    {isManager && cancellingId === s.id && <CancelSessionForm session={s} onDone={afterChange} />}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
