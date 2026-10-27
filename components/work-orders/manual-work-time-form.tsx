"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Clock, Loader2, X } from "lucide-react";

import { requestManualWorkTimeEntryAction, type WorkTimeCorrectionActionState } from "@/app/actions/work-time-corrections";
import { LongPeriodConfirm } from "@/components/work-orders/long-period-confirm";
import { dispatchActionToast } from "@/lib/action-messages";
import { formatDurationMinutes, formatKuwaitDateTime, parseKuwaitInputValue, toKuwaitInputValue } from "@/lib/format/kuwait-time";
import { checkWorkPeriod, CORRECTION_REASON_MAX_LENGTH, CORRECTION_REASON_MIN_LENGTH } from "@/lib/work-orders/work-time-correction-rules";

// Manual Worker Time Entry — Data Entry records a worker's real start and
// end when the timer was not used. Nothing is counted until the Maintenance
// Manager approves it (the server enforces that; this form only collects
// and previews). All times are Kuwait time; the duration is calculated here
// and again on the server — staff never type hours.

const inputClass =
  "focus-ring min-h-11 w-full rounded-md border border-[#D1D5DB] bg-white px-3 text-base text-[#111827] disabled:bg-gray-50 sm:text-sm";
const labelClass = "block text-sm font-bold text-[#374151]";

export function ManualWorkTimeForm({
  workerAssignmentId,
  workerName,
  jobCardNumber,
  hasRecordedTime,
  onClose,
}: {
  workerAssignmentId: string;
  workerName: string;
  jobCardNumber: string | null;
  // The worker already has recorded periods: this adds another, separate
  // period; changing a recorded one is Correct Time (View Sessions).
  hasRecordedTime: boolean;
  onClose: () => void;
}) {
  const today = toKuwaitInputValue(new Date()).slice(0, 10);
  const [startDate, setStartDate] = useState(today);
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState(today);
  const [endTime, setEndTime] = useState("");
  const [confirmLong, setConfirmLong] = useState(false);
  const [state, formAction, isPending] = useActionState<WorkTimeCorrectionActionState, FormData>(requestManualWorkTimeEntryAction, null);
  const handled = useRef<WorkTimeCorrectionActionState>(null);
  const firstField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstField.current?.focus();
  }, []);
  useEffect(() => {
    if (state === handled.current) return;
    handled.current = state;
    if (state?.ok) {
      dispatchActionToast({ tone: "success", title: "Time sent for approval", description: state.message });
      onClose();
    }
  }, [state, onClose]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !isPending) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [isPending, onClose]);

  const start = startDate && startTime ? parseKuwaitInputValue(`${startDate}T${startTime}`) : null;
  const end = endDate && endTime ? parseKuwaitInputValue(`${endDate}T${endTime}`) : null;
  const ready = Boolean(startDate && startTime && endDate && endTime);
  // Overlaps are checked on the server (it knows the worker's other periods).
  const preview = useMemo(
    () => (ready ? checkWorkPeriod({ start, end, now: new Date(), otherPeriods: [], longPeriodConfirmed: confirmLong }) : null),
    [ready, start, end, confirmLong]
  );
  const longMinutes =
    preview && ((preview.ok && preview.unusuallyLong) || (!preview.ok && preview.needsLongPeriodConfirmation)) && start && end
      ? Math.round((end.getTime() - start.getTime()) / 60000)
      : null;

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
                <Clock className="h-5 w-5 text-[#ED1C24]" aria-hidden="true" /> Enter Time Manually
              </h2>
              <p className="mt-0.5 text-sm text-[#4B5563]">For work done without the timer. The Manager must approve it before it counts.</p>
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

            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-3 text-sm">
              <dt className="text-[#6B7280]">Worker</dt>
              <dd className="font-bold text-[#111827]">{workerName}</dd>
              <dt className="text-[#6B7280]">Job Card</dt>
              <dd className="break-words font-bold text-[#111827]">{jobCardNumber ?? "—"}</dd>
            </dl>

            {hasRecordedTime ? (
              <p className="rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                This adds a <strong>separate</strong> work period. To change time that is already recorded, close this and use{" "}
                <strong>View Sessions → Correct Time</strong>.
              </p>
            ) : null}

            <p className="text-sm text-[#4B5563]">
              All times are <strong>Kuwait time</strong>. Example: started 26 Oct at 08:00, finished 26 Oct at 12:30. For work past midnight, choose the next
              day as the end date.
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
                  Start Time <span className="text-[#ED1C24]">*</span>
                </label>
                <input id="mwt-start-time" type="time" name="start_time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={isPending} className={inputClass} />
              </div>
            </fieldset>
            <fieldset className="grid grid-cols-2 gap-3">
              <legend className="sr-only">End</legend>
              <div>
                <label htmlFor="mwt-end-date" className={labelClass}>
                  End Date <span className="text-[#ED1C24]">*</span>
                </label>
                <input id="mwt-end-date" type="date" name="end_date" required max={today} value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={isPending} className={inputClass} />
              </div>
              <div>
                <label htmlFor="mwt-end-time" className={labelClass}>
                  End Time <span className="text-[#ED1C24]">*</span>
                </label>
                <input id="mwt-end-time" type="time" name="end_time" required value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={isPending} className={inputClass} />
              </div>
            </fieldset>

            <div className="rounded-md border border-[#E5E7EB] bg-white p-3 text-sm" aria-live="polite">
              {!ready ? (
                <p className="text-[#6B7280]">Worked time is calculated when start and end are filled in.</p>
              ) : preview?.ok || longMinutes !== null ? (
                <p className="text-[#111827]">
                  Worked time: <strong className="text-base">{formatDurationMinutes(preview?.ok ? preview.durationMinutes : (longMinutes ?? 0))}</strong>
                  {start && end ? (
                    <span className="block text-xs text-[#6B7280]">
                      {formatKuwaitDateTime(start)} → {formatKuwaitDateTime(end)}
                    </span>
                  ) : null}
                </p>
              ) : (
                <p className="flex items-start gap-1.5 text-amber-800">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  {preview && !preview.ok ? preview.message : "Check the dates and times."}
                </p>
              )}
            </div>
            {longMinutes !== null ? (
              <LongPeriodConfirm id="mwt-confirm-long" minutes={longMinutes} checked={confirmLong} onChange={setConfirmLong} disabled={isPending} />
            ) : null}

            <div>
              <label htmlFor="mwt-reason" className={labelClass}>
                Reason for manual entry <span className="text-[#ED1C24]">*</span>
              </label>
              <textarea
                id="mwt-reason"
                name="reason"
                required
                rows={2}
                minLength={CORRECTION_REASON_MIN_LENGTH}
                maxLength={CORRECTION_REASON_MAX_LENGTH}
                disabled={isPending}
                placeholder="Example: Timer was not started; supervisor confirmed the worker worked 08:00–12:30"
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
                disabled={isPending || !ready || !preview?.ok}
                className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md bg-[#ED1C24] px-4 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                Send to Manager for Approval
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
