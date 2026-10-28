"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Clock, Loader2, X } from "lucide-react";

import { saveManualWorkTimeAction, type WorkTimeCorrectionActionState } from "@/app/actions/work-time-corrections";
import { LongPeriodConfirm } from "@/components/work-orders/long-period-confirm";
import { dispatchActionToast } from "@/lib/action-messages";
import { formatDurationMinutes, toKuwaitInputValue } from "@/lib/format/kuwait-time";
import {
  checkManualHoursEntry,
  CORRECTION_REASON_MAX_LENGTH,
  CORRECTION_REASON_MIN_LENGTH,
  parseActualHours,
  suggestedManualMinutes,
} from "@/lib/work-orders/work-time-correction-rules";

// Enter Time Manually — Data Entry records the days a worker worked without
// the timer and the ACTUAL hours worked. Saved at once (one work period, counted
// once); the Manager reviews it in Closure Review — there is no separate
// time approval. All dates/times are Kuwait time. With `existing`, the same
// form is "Change Manual Time" for a period entered this way.

const inputClass =
  "focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-base text-[#111827] disabled:bg-gray-50 sm:text-sm";
const labelClass = "block text-sm font-bold text-[#374151]";

export type ManualTimeExisting = {
  sessionId: string;
  startedAt: string;
  stoppedAt: string;
  startTimeKnown: boolean;
  endTimeKnown: boolean;
  minutes: number;
};

function hoursText(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100);
}

export function ManualWorkTimeForm({
  workerAssignmentId,
  workerName,
  jobCardNumber,
  hasRecordedTime,
  existing,
  onClose,
  onSaved,
}: {
  workerAssignmentId: string;
  workerName: string;
  jobCardNumber: string | null;
  // The worker already has recorded periods: this adds another, separate one.
  hasRecordedTime: boolean;
  existing?: ManualTimeExisting;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const today = toKuwaitInputValue(new Date()).slice(0, 10);
  const initial = existing
    ? {
        startDate: toKuwaitInputValue(existing.startedAt).slice(0, 10),
        startTime: existing.startTimeKnown ? toKuwaitInputValue(existing.startedAt).slice(11, 16) : "",
        endDate: toKuwaitInputValue(existing.stoppedAt).slice(0, 10),
        endTime: existing.endTimeKnown ? toKuwaitInputValue(existing.stoppedAt).slice(11, 16) : "",
        hours: hoursText(existing.minutes),
      }
    : { startDate: today, startTime: "", endDate: today, endTime: "", hours: "" };
  const [startDate, setStartDate] = useState(initial.startDate);
  const [startTime, setStartTime] = useState(initial.startTime);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [endTime, setEndTime] = useState(initial.endTime);
  const [hours, setHours] = useState(initial.hours);
  const [confirmLong, setConfirmLong] = useState(false);
  // One id per opened form: a double click or retry returns the first save.
  const [submissionId] = useState(() => crypto.randomUUID());
  const [state, formAction, isPending] = useActionState<WorkTimeCorrectionActionState, FormData>(saveManualWorkTimeAction, null);
  const handled = useRef<WorkTimeCorrectionActionState>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: existing ? "Manual time changed" : "Manual time saved", description: state.message });
      onSaved?.();
      onClose();
    }
  }, [state, onClose, onSaved, existing]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isPending, onClose]);

  const suggestion = suggestedManualMinutes(startDate, startTime, endDate, endTime);
  const preview = useMemo(
    () =>
      startDate && endDate && hours.trim()
        ? checkManualHoursEntry({ startDate, startTime, endDate, endTime, actualHours: hours, now: new Date(), longPeriodConfirmed: confirmLong })
        : null,
    [startDate, startTime, endDate, endTime, hours, confirmLong]
  );
  const enteredMinutes = parseActualHours(hours);
  const needsLongConfirm = preview !== null && ((preview.ok && preview.unusuallyLong) || (!preview.ok && preview.needsLongPeriodConfirmation === true));
  const multiDay = Boolean(startDate && endDate && startDate !== endDate);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" aria-hidden="true" onClick={() => !isPending && onClose()} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" role="presentation">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="manual-time-heading"
          className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
            <div>
              <h2 id="manual-time-heading" className="flex items-center gap-2 text-lg font-black text-[#111827]">
                <Clock className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" /> {existing ? "Change Manual Time" : "Enter Time Manually"}
              </h2>
              <p className="mt-0.5 text-sm text-[#4B5563]">
                For work done without the timer. It is saved at once; the Manager checks it when reviewing the Job Card closure.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              aria-label="Close"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[#4B5563] hover:bg-gray-100"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <form action={formAction} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <input type="hidden" name="worker_assignment_id" value={workerAssignmentId} />
            <input type="hidden" name="submission_id" value={submissionId} />
            {existing ? <input type="hidden" name="session_id" value={existing.sessionId} /> : null}

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm">
              <dt className="text-[#6B7280]">Worker</dt>
              <dd className="font-bold text-[#111827]">{workerName}</dd>
              <dt className="text-[#6B7280]">Job Card</dt>
              <dd className="break-words font-bold text-[#111827]">{jobCardNumber ?? "—"}</dd>
            </dl>

            {hasRecordedTime && !existing ? (
              <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                This adds <strong>more</strong> hours. To change hours already recorded, close this and use <strong>View Sessions</strong>.
              </p>
            ) : null}

            <p className="text-sm text-[#4B5563]">
              All dates and times are <strong>Kuwait time</strong>. Enter the times only if you know them. Example: worked 25–27 Oct, 9 hours in total.
            </p>

            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="sr-only">Start</legend>
              <div>
                <label htmlFor="mwt-start-date" className={labelClass}>
                  Start Date <span className="text-[#ED1C24]">*</span>
                </label>
                <input id="mwt-start-date" ref={firstField} type="date" name="start_date" required max={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={isPending} className={inputClass} />
              </div>
              <div>
                <label htmlFor="mwt-start-time" className={labelClass}>
                  Start Time <span className="font-normal text-[#6B7280]">(if known)</span>
                </label>
                <input id="mwt-start-time" type="time" name="start_time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={isPending} className={inputClass} />
              </div>
            </fieldset>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="sr-only">End</legend>
              <div>
                <label htmlFor="mwt-end-date" className={labelClass}>
                  End Date <span className="text-[#ED1C24]">*</span>
                </label>
                <input id="mwt-end-date" type="date" name="end_date" required min={startDate || undefined} max={today} value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={isPending} className={inputClass} />
              </div>
              <div>
                <label htmlFor="mwt-end-time" className={labelClass}>
                  End Time <span className="font-normal text-[#6B7280]">(if known)</span>
                </label>
                <input id="mwt-end-time" type="time" name="end_time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={isPending} className={inputClass} />
              </div>
            </fieldset>

            <div>
              <label htmlFor="mwt-hours" className={labelClass}>
                Actual Hours Worked <span className="text-[#ED1C24]">*</span>
              </label>
              <input
                id="mwt-hours"
                type="text"
                inputMode="decimal"
                name="actual_hours"
                required
                autoComplete="off"
                placeholder="e.g. 9 or 4.5"
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                disabled={isPending}
                aria-describedby="mwt-hours-help"
                className={inputClass}
              />
              <p id="mwt-hours-help" className="mt-1 text-xs text-[#6B7280]">
                {multiDay
                  ? "Only the hours actually worked across these days — not the time between the dates."
                  : "The hours actually worked (breaks not included)."}
              </p>
              {suggestion !== null && enteredMinutes !== suggestion ? (
                <button
                  type="button"
                  onClick={() => setHours(hoursText(suggestion))}
                  disabled={isPending}
                  className="mt-1.5 inline-flex min-h-11 items-center rounded-md border border-[#E5E7EB] bg-white px-3 text-sm font-bold text-[#111827] hover:bg-gray-50 sm:min-h-9"
                >
                  Use {formatDurationMinutes(suggestion)} (from the times)
                </button>
              ) : null}
            </div>

            <div className="rounded-md border border-[#E5E7EB] bg-white p-3 text-sm" aria-live="polite">
              {!preview ? (
                <p className="text-[#6B7280]">Fill in the dates and the hours worked.</p>
              ) : preview.ok || needsLongConfirm ? (
                <p className="text-[#111827]">
                  Hours to save: <strong className="text-base">{formatDurationMinutes(enteredMinutes ?? 0)}</strong>
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {preview.message}
                </p>
              )}
            </div>
            {needsLongConfirm && enteredMinutes !== null ? (
              <LongPeriodConfirm id="mwt-confirm-long" minutes={enteredMinutes} checked={confirmLong} onChange={setConfirmLong} disabled={isPending} />
            ) : null}

            <div>
              <label htmlFor="mwt-reason" className={labelClass}>
                Reason / Remarks <span className="text-[#ED1C24]">*</span>
              </label>
              <textarea
                id="mwt-reason"
                name="reason"
                required
                rows={2}
                minLength={CORRECTION_REASON_MIN_LENGTH}
                maxLength={CORRECTION_REASON_MAX_LENGTH}
                disabled={isPending}
                placeholder="Example: Timer was not used; supervisor confirmed 9 hours over 3 days"
                className="focus-ring w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-base sm:text-sm"
              />
            </div>

            {state?.ok === false ? (
              <p role="alert" className="flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {state.error}
              </p>
            ) : null}

            <div className="flex flex-col-reverse gap-2 border-t border-[#F3F4F6] pt-4 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="min-h-11 rounded-md border border-[#E5E7EB] bg-white px-4 text-sm font-bold text-[#4B5563] hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isPending || !preview?.ok}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                {existing ? "Save Change" : "Save Manual Time"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
