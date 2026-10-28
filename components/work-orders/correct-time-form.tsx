"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { requestWorkTimeCorrectionAction, type WorkTimeCorrectionActionState } from "@/app/actions/work-time-corrections";
import { dispatchActionToast } from "@/lib/action-messages";
import { formatDurationMinutes, formatKuwaitDateTime, parseKuwaitInputValue, toKuwaitInputValue } from "@/lib/format/kuwait-time";
import { LongPeriodConfirm } from "@/components/work-orders/long-period-confirm";
import { checkTimeCorrection, CORRECTION_REASON_MAX_LENGTH, CORRECTION_REASON_MIN_LENGTH } from "@/lib/work-orders/work-time-correction-rules";
import type { SessionRow } from "@/lib/work-orders/work-session-totals";

// Worker Time Correction — Data Entry corrects the start/end times of one
// finished TIMER period. Saved at once (the first system values are kept and
// shown as "System recorded"); the Manager reviews it in Closure Review. Inputs are Kuwait wall-clock times (labelled as
// such) and are sent to the server as typed; the server parses them with an
// explicit +03:00 offset (lib/format/kuwait-time.ts), so the browser's own
// time zone never shifts them. The live comparison uses the same rules as
// the server; only the overlap check needs the server.

const inputClass =
  "focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-base disabled:bg-gray-50";

export function CorrectTimeForm({
  session,
  workerName,
  jobCardNumber,
  onDone,
}: {
  session: SessionRow;
  workerName: string;
  jobCardNumber?: string | null;
  onDone: () => void;
}) {
  const recordedEnd = session.stopped_at ?? session.paused_at ?? session.started_at;
  const [start, setStart] = useState(() => toKuwaitInputValue(session.started_at));
  const [end, setEnd] = useState(() => toKuwaitInputValue(recordedEnd));
  const [confirmLong, setConfirmLong] = useState(false);
  // One id per opened form: a double click or retry saves once.
  const [submissionId] = useState(() => crypto.randomUUID());
  const [state, formAction, isPending] = useActionState<WorkTimeCorrectionActionState, FormData>(requestWorkTimeCorrectionAction, null);
  const handled = useRef<WorkTimeCorrectionActionState>(null);

  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: "Time corrected", description: state.message });
      onDone();
    }
  }, [state, onDone]);

  const preview = useMemo(
    () =>
      checkTimeCorrection({
        correctedStart: parseKuwaitInputValue(start),
        correctedEnd: parseKuwaitInputValue(end),
        originalStart: new Date(session.started_at),
        originalEnd: new Date(recordedEnd),
        now: new Date(),
        otherPeriods: [],
        longPeriodConfirmed: confirmLong,
      }),
    [start, end, session.started_at, recordedEnd, confirmLong]
  );
  const difference = preview.ok ? preview.durationMinutes - session.duration_minutes : 0;
  // Unusually long (confirmed or not yet): the confirmation box replaces the warning line.
  const longMinutes =
    preview.ok && preview.unusuallyLong
      ? preview.durationMinutes
      : !preview.ok && preview.needsLongPeriodConfirmation
        ? Math.round((parseKuwaitInputValue(end)!.getTime() - parseKuwaitInputValue(start)!.getTime()) / 60000)
        : null;

  return (
    <form action={formAction} className="mt-2 space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-3">
      <input type="hidden" name="session_id" value={session.id} />
      <input type="hidden" name="submission_id" value={submissionId} />
      <p className="text-sm font-black text-[#111827]">Correct Time</p>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-[#E5E7EB] bg-white p-2.5 text-sm">
        <dt className="text-[#6B7280]">Worker</dt>
        <dd className="font-semibold text-[#111827]">{workerName}</dd>
        {jobCardNumber ? (
          <>
            <dt className="text-[#6B7280]">Job Card</dt>
            <dd className="break-words font-semibold text-[#111827]">{jobCardNumber}</dd>
          </>
        ) : null}
        <dt className="text-[#6B7280]">System start</dt>
        <dd className="text-[#111827]">{formatKuwaitDateTime(session.started_at)}</dd>
        <dt className="text-[#6B7280]">System end</dt>
        <dd className="text-[#111827]">{formatKuwaitDateTime(recordedEnd)}</dd>
        <dt className="text-[#6B7280]">System time</dt>
        <dd className="font-semibold text-[#111827]">{formatDurationMinutes(session.duration_minutes)}</dd>
      </dl>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`corrected-start-${session.id}`} className="block text-sm font-bold text-[#374151]">
            Corrected start <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id={`corrected-start-${session.id}`}
            type="datetime-local"
            name="corrected_start"
            required
            value={start}
            onChange={(e) => setStart(e.target.value)}
            disabled={isPending}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`corrected-end-${session.id}`} className="block text-sm font-bold text-[#374151]">
            Corrected end <span className="text-[#ED1C24]">*</span>
          </label>
          <input
            id={`corrected-end-${session.id}`}
            type="datetime-local"
            name="corrected_end"
            required
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            disabled={isPending}
            className={inputClass}
          />
        </div>
      </div>
      <p className="text-xs text-[#6B7280]">All times are Kuwait time. For work past midnight, choose the next day as the end date.</p>

      <div className="rounded-md border border-[#E5E7EB] bg-white p-2.5 text-sm" aria-live="polite">
        {preview.ok ? (
          <p className="text-[#111827]">
            System: <strong>{formatDurationMinutes(session.duration_minutes)}</strong> → Corrected: <strong>{formatDurationMinutes(preview.durationMinutes)}</strong>{" "}
            <span className={difference === 0 ? "text-[#6B7280]" : difference > 0 ? "text-amber-700" : "text-blue-700"}>
              ({difference > 0 ? "+" : difference < 0 ? "−" : ""}
              {formatDurationMinutes(Math.abs(difference))})
            </span>
          </p>
        ) : longMinutes === null ? (
          <p className="flex items-start gap-1.5 text-amber-800">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            {preview.message}
          </p>
        ) : (
          <p className="text-[#111827]">Corrected: <strong>{formatDurationMinutes(longMinutes)}</strong></p>
        )}
      </div>
      {longMinutes !== null ? (
        <LongPeriodConfirm id={`confirm-long-${session.id}`} minutes={longMinutes} checked={confirmLong} onChange={setConfirmLong} disabled={isPending} />
      ) : null}

      <div>
        <label htmlFor={`correction-reason-${session.id}`} className="block text-sm font-bold text-[#374151]">
          Reason for correction <span className="text-[#ED1C24]">*</span>
        </label>
        <textarea
          id={`correction-reason-${session.id}`}
          name="reason"
          required
          minLength={CORRECTION_REASON_MIN_LENGTH}
          maxLength={CORRECTION_REASON_MAX_LENGTH}
          rows={2}
          disabled={isPending}
          placeholder="Example: Worker forgot to press Pause at lunch"
          className="focus-ring w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-base"
        />
      </div>

      {state?.ok === false ? (
        <p role="alert" className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {state.error}
        </p>
      ) : null}

      <p className="text-xs text-[#6B7280]">Saved at once. The system-recorded time is kept in the history, and the Manager reviews the correction when closing the Job Card.</p>
      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <button
          type="button"
          onClick={onDone}
          disabled={isPending}
          className="min-h-11 rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending || !preview.ok}
          className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
          Save Correction
        </button>
      </div>
    </form>
  );
}
