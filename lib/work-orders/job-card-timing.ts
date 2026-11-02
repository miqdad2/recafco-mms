// Job Card Time Details (client-safe, pure).
//
// One definition of the three different time figures, used by Daily Activity,
// the Job Card page, print, Closure Review and Closed Job Cards:
//
// - Job Card Duration: Work Completed - Job Card Opened. Elapsed calendar
//   time; nights, breaks and paused time are not deducted, and it is never
//   calculated from worker hours.
// - Worker Hours: the combined time of all workers (WorkOrderLaborSummary).
// - Manager Approved On: approvals.decided_at, which changes neither of the
//   others.
//
// Nothing here invents a time. Opened comes only from the typed Job Card Open
// Date (and time, if entered). Work Completed comes from worker time once the
// Job Card is ready for closure, or from the time entered at closure request
// when worker time cannot prove it. See lib/work-orders/job-card-dates.ts for
// how the worker-time end is derived.

import { currentKuwaitInputValue, formatDurationMinutes, formatKuwaitDateTime, toKuwaitInputValue } from "@/lib/format/kuwait-time";
import type { JobCardDates } from "@/lib/work-orders/job-card-dates";
import { formatJobCardDate } from "@/lib/work-orders/job-card-edit";

export const TIME_NOT_RECORDED = "Time not recorded";
export const DURATION_NOT_AVAILABLE = "Not available";
export const DURATION_IN_PROGRESS = "In progress";
export const DURATION_CHECK_DATES = "Check dates";
export const WORK_NOT_COMPLETED = "Not completed yet";
export const COMPLETED_BEFORE_OPENED_MESSAGE = "Work Completed is earlier than Job Card Opened. Please correct the dates.";
export const WORKER_HOURS_EXPLANATION = "Combined working hours of all assigned workers.";
export const WORK_COMPLETED_AUTOFILL_HELP = "Current Kuwait date and time are filled automatically. Change them if the work finished earlier.";

// A browser clock slightly ahead of the server must not make a time filled in
// a moment ago count as the future.
const ENTRY_CLOCK_TOLERANCE_MS = 5 * 60 * 1000;

// A closure request has passed every readiness check, and the Manager's
// approval does not change when the work finished.
const WORK_FINISHED_STATUSES = ["Closure Requested", "Closed"];
const NOT_RUNNING_STATUSES = ["Rejected", "Cancelled"];

export type JobCardOpened =
  | { state: "exact"; at: string }
  | { state: "date_only"; date: string }
  | { state: "not_recorded" };

export type JobCardCompleted =
  | { state: "exact"; at: string; source: "worker_time" | "entered" }
  | { state: "date_only"; at: string }
  | { state: "not_completed" }
  | { state: "not_recorded" };

export type JobCardDuration =
  | { state: "value"; minutes: number }
  | { state: "in_progress" }
  | { state: "not_available" }
  | { state: "invalid" };

export type JobCardTimingInput = {
  status: string;
  // Job Card Open Date (YYYY-MM-DD) and the exact moment, when a time was entered.
  openDate: string | null;
  openedAt: string | null;
  // Entered at closure request (work_orders.work_completed_at).
  workCompletedAt: string | null;
  dates: JobCardDates;
  // Could closure be requested now? Workers, worker time and materials.
  readyForClosure: boolean;
};

export type JobCardTiming = {
  opened: JobCardOpened;
  completed: JobCardCompleted;
  duration: JobCardDuration;
  openedText: string;
  completedText: string;
  durationText: string;
  managerApprovedAt: string | null;
  managerApprovedText: string | null;
  problem: string | null;
  // The Request Closure form asks for the time: worker time cannot prove it.
  needsCompletionEntry: boolean;
  // Kuwait wall-clock value to pre-fill that form with.
  completionEntryValue: string;
};

function kuwaitDay(iso: string): string {
  return toKuwaitInputValue(iso).slice(0, 10);
}

/** "1 h 36 min", or "1 day 3 h 20 min" once it spans 24 hours. */
export function formatElapsedDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const days = Math.floor(total / 1440);
  if (days === 0) return formatDurationMinutes(total);
  const dayText = `${days} ${days === 1 ? "day" : "days"}`;
  const rest = total - days * 1440;
  return rest === 0 ? dayText : `${dayText} ${formatDurationMinutes(rest)}`;
}

function openedFrom(openDate: string | null, openedAt: string | null): JobCardOpened {
  if (openedAt) return { state: "exact", at: openedAt };
  if (openDate) return { state: "date_only", date: openDate };
  return { state: "not_recorded" };
}

/** Every worker period has a clock time, so the end of the last one is the real finish. */
export function workEndProvenByWorkerTime(dates: JobCardDates): boolean {
  return dates.workEnd.recorded && !dates.workEnd.dateOnly && dates.allEndTimesKnown;
}

function completedFrom(input: JobCardTimingInput): JobCardCompleted {
  const finished = WORK_FINISHED_STATUSES.includes(input.status);
  if (!finished && !input.readyForClosure) {
    return NOT_RUNNING_STATUSES.includes(input.status) ? { state: "not_recorded" } : { state: "not_completed" };
  }
  const { workEnd } = input.dates;
  if (workEnd.recorded && workEndProvenByWorkerTime(input.dates)) {
    return { state: "exact", at: workEnd.at, source: "worker_time" };
  }
  if (input.workCompletedAt) return { state: "exact", at: input.workCompletedAt, source: "entered" };
  if (workEnd.recorded) return { state: "date_only", at: workEnd.at };
  return { state: "not_recorded" };
}

function completedBeforeOpened(opened: JobCardOpened, completed: JobCardCompleted): boolean {
  if (completed.state !== "exact" && completed.state !== "date_only") return false;
  if (opened.state === "exact" && completed.state === "exact") {
    return new Date(completed.at).getTime() < new Date(opened.at).getTime();
  }
  if (opened.state === "not_recorded") return false;
  const openedDay = opened.state === "exact" ? kuwaitDay(opened.at) : opened.date;
  return kuwaitDay(completed.at) < openedDay;
}

export function computeJobCardTiming(input: JobCardTimingInput): JobCardTiming {
  const opened = openedFrom(input.openDate, input.openedAt);
  const completed = completedFrom(input);
  const invalid = completedBeforeOpened(opened, completed);

  let duration: JobCardDuration;
  if (invalid) {
    duration = { state: "invalid" };
  } else if (completed.state === "not_completed") {
    duration = { state: "in_progress" };
  } else if (opened.state === "exact" && completed.state === "exact") {
    duration = { state: "value", minutes: Math.round((new Date(completed.at).getTime() - new Date(opened.at).getTime()) / 60000) };
  } else {
    duration = { state: "not_available" };
  }

  const openedText =
    opened.state === "exact"
      ? formatKuwaitDateTime(opened.at)
      : opened.state === "date_only"
        ? `${formatJobCardDate(opened.date)} — ${TIME_NOT_RECORDED}`
        : "Not recorded";

  let completedText = "Not recorded";
  if (completed.state === "exact") completedText = formatKuwaitDateTime(completed.at);
  else if (completed.state === "date_only") completedText = `${formatJobCardDate(kuwaitDay(completed.at))} — ${TIME_NOT_RECORDED}`;
  else if (completed.state === "not_completed") completedText = WORK_NOT_COMPLETED;

  let durationText = DURATION_NOT_AVAILABLE;
  if (duration.state === "value") durationText = formatElapsedDuration(duration.minutes);
  else if (duration.state === "in_progress") durationText = DURATION_IN_PROGRESS;
  else if (duration.state === "invalid") durationText = DURATION_CHECK_DATES;

  const managerApprovedAt = input.dates.closed?.recorded ? input.dates.closed.at : null;

  return {
    opened,
    completed,
    duration,
    openedText,
    completedText,
    durationText,
    managerApprovedAt,
    managerApprovedText: managerApprovedAt ? formatKuwaitDateTime(managerApprovedAt) : null,
    problem: invalid ? COMPLETED_BEFORE_OPENED_MESSAGE : null,
    needsCompletionEntry: !(completed.state === "exact" && completed.source === "worker_time"),
    completionEntryValue: input.workCompletedAt ? toKuwaitInputValue(input.workCompletedAt) : "",
  };
}

/**
 * What the Request Closure form starts with: the saved time, otherwise the
 * current Kuwait time. Null when worker time proves the finish: the form then
 * shows no field and must send no value.
 */
export function suggestedWorkCompleted(timing: JobCardTiming, now: Date = new Date()): string | null {
  if (!timing.needsCompletionEntry) return null;
  return timing.completionEntryValue || currentKuwaitInputValue(now);
}

export type WorkCompletedCheckInput = {
  at: Date;
  now: Date;
  openDate: string | null;
  openedAt: string | null;
  dates: JobCardDates;
};

/** Rule for a time typed at closure request. Returns the problem, or null. */
export function checkWorkCompletedEntry({ at, now, openDate, openedAt, dates }: WorkCompletedCheckInput): string | null {
  if (at.getTime() > now.getTime() + ENTRY_CLOCK_TOLERANCE_MS) return "Work Completed cannot be in the future.";
  const iso = at.toISOString();
  if (completedBeforeOpened(openedFrom(openDate, openedAt), { state: "exact", at: iso, source: "entered" })) {
    return COMPLETED_BEFORE_OPENED_MESSAGE;
  }
  // Form times have no seconds: the same minute as the last end is not earlier.
  const lastEndMinute = dates.lastKnownWorkEnd === null ? null : Math.floor(new Date(dates.lastKnownWorkEnd).getTime() / 60000) * 60000;
  const beforeKnownEnd = lastEndMinute !== null && at.getTime() < lastEndMinute;
  const beforeLastWorkDay = dates.workEnd.recorded && dates.workEnd.dateOnly === true && kuwaitDay(iso) < kuwaitDay(dates.workEnd.at);
  if (beforeKnownEnd || beforeLastWorkDay) return "Work Completed cannot be earlier than the last recorded worker time.";
  return null;
}
