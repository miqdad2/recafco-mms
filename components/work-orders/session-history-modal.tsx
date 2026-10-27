"use client";

import { useEffect, useState, useActionState } from "react";
import { AlertCircle, Loader2, X } from "lucide-react";

import { getSessionsForAssignmentAction, editWorkSessionAction, cancelWorkSessionAction, type WorkSessionState } from "@/app/actions/work-sessions";
import { CorrectTimeForm } from "@/components/work-orders/correct-time-form";
import { StatusBadge } from "@/components/ui/status-badge";
import { dispatchActionToast } from "@/lib/action-messages";
import { formatDurationMinutes, formatKuwaitDateTime, parseKuwaitInputValue, toKuwaitInputValue } from "@/lib/format/kuwait-time";
import { LongPeriodConfirm } from "@/components/work-orders/long-period-confirm";
import { isUnusuallyLongPeriod, periodMinutes, workPeriodSource } from "@/lib/work-orders/work-time-correction-rules";
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


function EditSessionForm({
  session,
  workerName,
  jobCardNumber,
  assetLabel,
  canViewCosts,
  onDone,
}: {
  session: SessionRow;
  workerName: string;
  jobCardNumber?: string | null;
  assetLabel?: string | null;
  canViewCosts: boolean;
  onDone: () => void;
}) {
  const [state, formAction, isPending] = useActionState<WorkSessionState, FormData>(editWorkSessionAction, null);
  // Final Integration Review: Kuwait wall-clock in, Kuwait wall-clock out —
  // never the browser's or the server's own time zone.
  const [start, setStart] = useState(() => toKuwaitInputValue(session.started_at));
  const [stop, setStop] = useState(() => toKuwaitInputValue(session.stopped_at ?? session.paused_at ?? session.started_at));
  const [confirmLong, setConfirmLong] = useState(false);
  const startDate = parseKuwaitInputValue(start);
  const stopDate = parseKuwaitInputValue(stop);
  const enteredMinutes = startDate && stopDate && stopDate > startDate ? periodMinutes(startDate, stopDate) : null;
  const isLong = enteredMinutes !== null && isUnusuallyLongPeriod(enteredMinutes);

  useEffect(() => {
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: "Session Updated" });
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.ok]);

  // Manager Worker Time Correction Enhancement Unit 10C.1, Task 3 — the
  // "Original session" reference block. Start/end editing above remains the
  // primary correction mechanism (Task 3 allows a direct duration edit "only
  // if safer" — reusing the existing start/end fields is safer since it's
  // already validated, audited, and recalculates duration/amount correctly);
  // this block exists purely so the original values stay visible while the
  // Manager edits, per the task's explicit requirement.
  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-md border border-[#E5E7EB] bg-gray-50 p-2">
      <input type="hidden" name="session_id" value={session.id} />
      <div className="rounded-md border border-[#E5E7EB] bg-white p-2 text-xs text-[#4B5563]">
        <p className="mb-1 font-bold text-[#111827]">Original session</p>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          <dt className="text-[#9CA3AF]">Worker</dt>
          <dd className="text-[#111827]">{workerName}</dd>
          {jobCardNumber && (
            <>
              <dt className="text-[#9CA3AF]">Job Card</dt>
              <dd className="text-[#111827]">{jobCardNumber}</dd>
            </>
          )}
          {assetLabel && (
            <>
              <dt className="text-[#9CA3AF]">Asset</dt>
              <dd className="text-[#111827]">{assetLabel}</dd>
            </>
          )}
          <dt className="text-[#9CA3AF]">Original start</dt>
          <dd className="text-[#111827]">{formatKuwaitDateTime(session.started_at)}</dd>
          <dt className="text-[#9CA3AF]">Original end</dt>
          <dd className="text-[#111827]">
            {session.stopped_at || session.paused_at ? formatKuwaitDateTime(session.stopped_at ?? session.paused_at!) : "(in progress)"}
          </dd>
          <dt className="text-[#9CA3AF]">Original duration</dt>
          <dd className="text-[#111827]">{session.duration_minutes} min</dd>
          {canViewCosts && (
            <>
              <dt className="text-[#9CA3AF]">Original amount</dt>
              <dd className="text-[#111827]">{session.calculated_amount.toFixed(3)} KWD</dd>
            </>
          )}
          <dt className="text-[#9CA3AF]">Current status</dt>
          <dd className="text-[#111827]">{session.status}</dd>
        </dl>
      </div>
      {state?.ok === false && (
        <div className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>{state.error}</span>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-0.5 block text-[10px] font-bold text-[#4B5563]">Start</label>
          <input type="datetime-local" name="started_at" value={start} onChange={(e) => setStart(e.target.value)} required className={inp} disabled={isPending} />
        </div>
        <div>
          <label className="mb-0.5 block text-[10px] font-bold text-[#4B5563]">Stop</label>
          <input
            type="datetime-local"
            name="stopped_at"
            value={stop}
            onChange={(e) => setStop(e.target.value)}
            required
            className={inp}
            disabled={isPending}
          />
        </div>
      </div>
      <p className="text-[10px] text-[#6B7280]">Kuwait time. For work past midnight, choose the next day as the stop date.</p>
      {isLong && enteredMinutes !== null ? (
        <LongPeriodConfirm id={`edit-confirm-long-${session.id}`} minutes={enteredMinutes} checked={confirmLong} onChange={setConfirmLong} disabled={isPending} />
      ) : null}
      <div>
        <label className="mb-0.5 block text-[10px] font-bold text-[#4B5563]">Correction reason (required)</label>
        <input type="text" name="correction_reason" required minLength={5} placeholder="Why is this being corrected?" className={inp} disabled={isPending} />
      </div>
      <div className="flex gap-2">
        <button type="submit" disabled={isPending || (isLong && !confirmLong)} className="inline-flex items-center gap-1.5 rounded-md bg-[#ED1C24] px-2.5 py-1 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-60">
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
  initialEditSessionId,
  jobCardNumber,
  assetLabel,
  canRequestCorrection = false,
}: {
  workerAssignmentId: string;
  workerName: string;
  isManager: boolean;
  canViewCosts: boolean;
  onClose: () => void;
  // Worker Time Correction: Data Entry's "Correct Time" (sent to the Manager
  // for approval) on finished work periods. Off unless the caller passes it.
  canRequestCorrection?: boolean;
  // Manager Worker Time Correction Enhancement Unit 10C.1, Task 2 — when set,
  // the correction form for this exact session opens immediately instead of
  // requiring the Manager to find and click "Edit / Correct" in the list.
  initialEditSessionId?: string;
  // Task 3 — carried through into the "Original session" reference block;
  // the session row itself doesn't know its own Job Card number/asset, only
  // the caller (WorkerActivityDetailModal) does.
  jobCardNumber?: string | null;
  assetLabel?: string | null;
}) {
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(initialEditSessionId ?? null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
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
    setCorrectingId(null);
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
                          {formatKuwaitDateTime(s.started_at)}
                          {s.stopped_at || s.paused_at
                            ? ` → ${formatKuwaitDateTime(s.stopped_at ?? s.paused_at!)}`
                            : " → (in progress)"}
                        </p>
                        <p className="text-xs text-[#6B7280]">
                          {formatDurationMinutes(s.duration_minutes)}
                          {s.is_manual_entry && s.entered_by_name ? ` — entered by ${s.entered_by_name}` : ""}
                          {canViewCosts ? ` — ${s.calculated_amount.toFixed(3)} KWD` : ""}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        {(() => {
                          const source = workPeriodSource(s);
                          return <StatusBadge label={source} tone={source === "System Recorded" ? "gray" : "blue"} />;
                        })()}
                        <StatusBadge label={s.status} tone={statusTone(s.status)} />
                      </div>
                    </div>
                    {s.notes && <p className="mt-1 text-xs text-[#4B5563]">Note: {s.notes}</p>}
                    {s.correction_reason && (
                      <p className="mt-1 text-xs text-amber-700">
                        Corrected{s.edited_by_name ? ` by ${s.edited_by_name}` : ""}: {s.correction_reason}
                      </p>
                    )}
                    {s.original_started_at ? (
                      <p className="mt-1 text-xs text-[#4B5563]">
                        System recorded: {formatKuwaitDateTime(s.original_started_at)} → {formatKuwaitDateTime(s.original_ended_at)} (
                        {formatDurationMinutes(s.original_duration_minutes ?? 0)})
                      </p>
                    ) : null}
                    {s.pending_correction ? (
                      <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                        <p className="font-bold">Time correction waiting for Manager review</p>
                        <p className="mt-0.5">
                          Corrected: {formatKuwaitDateTime(s.pending_correction.corrected_started_at)} →{" "}
                          {formatKuwaitDateTime(s.pending_correction.corrected_ended_at)} (
                          {formatDurationMinutes(s.pending_correction.corrected_duration_minutes)}) — sent by {s.pending_correction.requested_by_name}
                        </p>
                        <p className="mt-0.5">The system time above is used until the Manager approves.</p>
                      </div>
                    ) : null}
                    {canRequestCorrection && s.status === "Active" ? (
                      <p className="mt-2 text-xs font-semibold text-amber-700">Pause or finish the work before correcting this time.</p>
                    ) : null}
                    {canRequestCorrection && (s.status === "Completed" || s.status === "Paused") && !s.pending_correction && correctingId !== s.id ? (
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={() => setCorrectingId(s.id)}
                          className="min-h-11 rounded-md border border-[#E5E7EB] bg-white px-3 text-sm font-bold text-[#111827] hover:bg-gray-50 sm:min-h-9 sm:text-xs"
                        >
                          Correct Time
                        </button>
                      </div>
                    ) : null}
                    {canRequestCorrection && correctingId === s.id ? (
                      <CorrectTimeForm session={s} workerName={workerName} jobCardNumber={jobCardNumber} onDone={afterChange} />
                    ) : null}

                    {isManager && s.status === "Active" && (
                      // Task 4 — an explicit message instead of silently
                      // hiding the buttons, so the Manager understands why
                      // this session can't be corrected yet.
                      <p className="mt-2 text-xs font-semibold text-amber-700">Stop or pause this session before correction.</p>
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
                    {isManager && editingId === s.id && (
                      <EditSessionForm
                        session={s}
                        workerName={workerName}
                        jobCardNumber={jobCardNumber}
                        assetLabel={assetLabel}
                        canViewCosts={canViewCosts}
                        onDone={afterChange}
                      />
                    )}
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
