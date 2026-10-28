// Worker time correction rules (client-safe, pure).
//
// A correction replaces the start and end of ONE finished work period (one
// work_order_work_sessions row). Each period is one continuous stretch of
// work: Pause ends a period and Resume starts a new one, so a period never
// contains a pause and its worked time is exactly end minus start. Pauses
// between periods are kept because a corrected period may not overlap any
// other period of the same worker (on any Job Card).
//
// Used by the correction form (live preview) and by the server
// (lib/backend/work-orders/work-time-corrections.ts) on request and again on
// approval.

// No approved business policy limits one work period's length, so a long
// period is NOT refused (Final Integration Review removed the earlier
// unconditional 16-hour rejection). Instead, a period longer than this is
// "unusually long": the person entering it must confirm it explicitly
// (so a wrong-day typing slip is caught), and the Manager sees it flagged
// when reviewing. A review threshold, not a rule — adjust if RECAFCO sets
// a shift-length policy.
export const LONG_PERIOD_REVIEW_MINUTES = 12 * 60;
export const CORRECTION_REASON_MIN_LENGTH = 5;

export function isUnusuallyLongPeriod(minutes: number): boolean {
  return minutes > LONG_PERIOD_REVIEW_MINUTES;
}
export const CORRECTION_REASON_MAX_LENGTH = 500;

// Same rounding as lib/backend/work-orders/work-sessions.ts diffMinutes.
export function periodMinutes(start: Date, end: Date): number {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

export type OtherWorkPeriod = { start: Date; end: Date; jobCardNumber: string | null };

export type WorkPeriodCheckInput = {
  start: Date | null;
  end: Date | null;
  now: Date;
  otherPeriods: OtherWorkPeriod[];
  // The person entering it has confirmed an unusually long period is correct.
  longPeriodConfirmed: boolean;
};

export type WorkPeriodCheck =
  | { ok: true; durationMinutes: number; unusuallyLong: boolean }
  | { ok: false; message: string; needsLongPeriodConfirmation?: boolean };

// Checks any work period entered by hand — a Data Entry correction, the
// Manager's Edit / Correct, or a Manager manual entry — the same way:
// chronological order, not in the future, at least a minute, no overlap with
// the same worker's other periods on any Job Card, and an explicit
// confirmation for an unusually long period.
export function checkWorkPeriod(input: WorkPeriodCheckInput): WorkPeriodCheck {
  const { start, end } = input;
  if (!start || Number.isNaN(start.getTime())) return { ok: false, message: "Enter a valid start date and time." };
  if (!end || Number.isNaN(end.getTime())) return { ok: false, message: "Enter a valid end date and time." };
  if (end.getTime() <= start.getTime()) {
    return { ok: false, message: "The end time must be after the start time. For work past midnight, choose the next day as the end date." };
  }
  // One minute of grace for clock differences between the browser and server.
  if (end.getTime() > input.now.getTime() + 60_000) {
    return { ok: false, message: "The end time cannot be in the future." };
  }
  const durationMinutes = periodMinutes(start, end);
  if (durationMinutes < 1) return { ok: false, message: "The work period must be at least 1 minute." };
  const clash = input.otherPeriods.find((p) => p.start.getTime() < end.getTime() && start.getTime() < p.end.getTime());
  if (clash) {
    return {
      ok: false,
      message: `This time overlaps another work period of the same worker${clash.jobCardNumber ? ` on Job Card ${clash.jobCardNumber}` : ""}. A worker cannot work two periods at the same time.`,
    };
  }
  const unusuallyLong = isUnusuallyLongPeriod(durationMinutes);
  if (unusuallyLong && !input.longPeriodConfirmed) {
    const hours = Math.floor(durationMinutes / 60);
    const mins = durationMinutes % 60;
    return {
      ok: false,
      needsLongPeriodConfirmation: true,
      message: `This work period is ${hours} h${mins ? ` ${mins} min` : ""} long, which is unusually long. Check the dates. If it is correct, tick "This long period is correct" and save again.`,
    };
  }
  return { ok: true, durationMinutes, unusuallyLong };
}

export type CorrectionCheckInput = {
  correctedStart: Date | null;
  correctedEnd: Date | null;
  originalStart: Date;
  originalEnd: Date;
  now: Date;
  otherPeriods: OtherWorkPeriod[];
  longPeriodConfirmed: boolean;
};

export type CorrectionCheck = WorkPeriodCheck;

export function checkTimeCorrection(input: CorrectionCheckInput): CorrectionCheck {
  const { correctedStart: start, correctedEnd: end } = input;
  // Form inputs carry whole minutes; recorded times carry seconds.
  const sameMinute = (a: Date, b: Date) => Math.floor(a.getTime() / 60000) === Math.floor(b.getTime() / 60000);
  if (start && end && sameMinute(start, input.originalStart) && sameMinute(end, input.originalEnd)) {
    return { ok: false, message: "The corrected times are the same as the recorded times." };
  }
  return checkWorkPeriod({ start, end, now: input.now, otherPeriods: input.otherPeriods, longPeriodConfirmed: input.longPeriodConfirmed });
}

// ── Manual hours entry (Data Entry "Enter Time Manually") ───────────────────
//
// Data Entry enters the dates the work happened on (times only when known)
// and, separately, the ACTUAL hours worked — a span of 25 → 27 Oct with 9
// hours means 9 hours, never the 72 hours between the dates. The entry is
// saved at once and reviewed by the Manager in Closure Review.
//
// A period is "exact" when both times are known and the hours equal the time
// between them (one continuous stretch, like a timer period): it must not
// overlap the worker's other periods, as before. Anything else is a "span"
// (the date range the hours fall in): it never blocks another period, and
// possible overlaps are flagged for the Manager instead — the system cannot
// prove a total over several days is conflict-free.

export type ManualHoursInput = {
  startDate: string; // YYYY-MM-DD, Kuwait
  startTime: string; // HH:mm or "" when not known
  endDate: string;
  endTime: string;
  actualHours: string; // as typed, e.g. "9" or "4.5"
  now: Date;
  longPeriodConfirmed: boolean;
};

export type ManualHoursCheck =
  | {
      ok: true;
      start: Date;
      end: Date;
      actualMinutes: number;
      // The most minutes that fit between start and end (whole days when a time is not known).
      availableMinutes: number;
      startTimeKnown: boolean;
      endTimeKnown: boolean;
      isSpan: boolean;
      unusuallyLong: boolean;
    }
  | { ok: false; message: string; field: "start" | "end" | "hours"; needsLongPeriodConfirmation?: boolean };

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const HOURS_RE = /^\d{1,3}(\.\d{1,2})?$/;

// Kuwait has no daylight saving: always UTC+03:00.
function kuwaitInstant(date: string, time: string): Date | null {
  if (!ISO_DATE_RE.test(date) || !TIME_RE.test(time)) return null;
  const d = new Date(`${date}T${time}:00+03:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Reject impossible calendar dates (e.g. 2026-02-30 rolls over).
  const back = new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  return back === date ? d : null;
}

export function kuwaitDateOf(instant: Date): string {
  return new Date(instant.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

function nextIsoDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Hours typed by the user → whole minutes (same minute precision as timer periods). */
export function parseActualHours(value: string): number | null {
  const v = value.trim();
  if (!HOURS_RE.test(v)) return null;
  const minutes = Math.round(Number(v) * 60);
  return minutes >= 1 ? minutes : null;
}

/** Same-day period with both times known → its length, offered as a suggestion; otherwise null. */
export function suggestedManualMinutes(startDate: string, startTime: string, endDate: string, endTime: string): number | null {
  if (!startDate || startDate !== endDate || !startTime || !endTime) return null;
  const start = kuwaitInstant(startDate, startTime);
  const end = kuwaitInstant(endDate, endTime);
  if (!start || !end || end <= start) return null;
  return periodMinutes(start, end);
}

export function checkManualHoursEntry(input: ManualHoursInput): ManualHoursCheck {
  const startTimeKnown = input.startTime.trim() !== "";
  const endTimeKnown = input.endTime.trim() !== "";
  if (!ISO_DATE_RE.test(input.startDate) || !kuwaitInstant(input.startDate, "00:00")) {
    return { ok: false, field: "start", message: "Enter a valid Start Date." };
  }
  if (!ISO_DATE_RE.test(input.endDate) || !kuwaitInstant(input.endDate, "00:00")) {
    return { ok: false, field: "end", message: "Enter a valid End Date." };
  }
  if (startTimeKnown && !TIME_RE.test(input.startTime)) return { ok: false, field: "start", message: "Enter a valid Start Time, or leave it empty." };
  if (endTimeKnown && !TIME_RE.test(input.endTime)) return { ok: false, field: "end", message: "Enter a valid End Time, or leave it empty." };
  if (input.endDate < input.startDate) return { ok: false, field: "end", message: "End Date cannot be before Start Date." };

  const today = kuwaitDateOf(input.now);
  if (input.startDate > today || input.endDate > today) {
    return { ok: false, field: input.endDate > today ? "end" : "start", message: "The dates cannot be in the future." };
  }

  const start = kuwaitInstant(input.startDate, startTimeKnown ? input.startTime : "00:00")!;
  // Latest moment the work can have ended: the End Time, or the end of the
  // End Date (never later than now).
  const dayAfterEnd = kuwaitInstant(nextIsoDate(input.endDate), "00:00")!;
  const latestEnd = endTimeKnown ? kuwaitInstant(input.endDate, input.endTime)! : new Date(Math.min(dayAfterEnd.getTime(), input.now.getTime()));
  // One minute of grace for clock differences between the browser and server.
  if (endTimeKnown && latestEnd.getTime() > input.now.getTime() + 60_000) {
    return { ok: false, field: "end", message: "The End Time cannot be in the future." };
  }
  if (startTimeKnown && start.getTime() > input.now.getTime() + 60_000) {
    return { ok: false, field: "start", message: "The Start Time cannot be in the future." };
  }
  if (latestEnd.getTime() <= start.getTime()) {
    return { ok: false, field: "end", message: "The end must be after the start. For work past midnight, choose the next day as the End Date." };
  }

  const actualMinutes = parseActualHours(input.actualHours);
  if (actualMinutes === null) {
    return { ok: false, field: "hours", message: "Enter the Actual Hours Worked as a number, for example 9 or 4.5." };
  }
  const availableMinutes = periodMinutes(start, latestEnd);
  if (actualMinutes > availableMinutes) {
    return {
      ok: false,
      field: "hours",
      message: `The Actual Hours Worked (${formatHm(actualMinutes)}) are more than the time between the start and the end (${formatHm(availableMinutes)}). Check the dates, times and hours.`,
    };
  }
  const unusuallyLong = isUnusuallyLongPeriod(actualMinutes);
  if (unusuallyLong && !input.longPeriodConfirmed) {
    return {
      ok: false,
      field: "hours",
      needsLongPeriodConfirmation: true,
      message: `${formatHm(actualMinutes)} is more than ${LONG_PERIOD_REVIEW_MINUTES / 60} hours in one entry. Check the hours. If they are correct, tick "This long period is correct" and save again.`,
    };
  }
  // Stored end: the End Time, or the last minute of the End Date (never after now).
  const end = endTimeKnown ? latestEnd : new Date(Math.min(dayAfterEnd.getTime() - 60_000, input.now.getTime()));
  const isSpan = !(startTimeKnown && endTimeKnown && actualMinutes === periodMinutes(start, end));
  return { ok: true, start, end: end > start ? end : latestEnd, actualMinutes, availableMinutes, startTimeKnown, endTimeKnown, isSpan, unusuallyLong };
}

function formatHm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Other periods of the same worker that fall inside this period's dates (for the Manager's review). */
export function possibleConflicts(period: { start: Date; end: Date }, others: OtherWorkPeriod[]): OtherWorkPeriod[] {
  return others.filter((p) => p.start.getTime() < period.end.getTime() && period.start.getTime() < p.end.getTime());
}

// Where a work period's time came from, in the words shown on View Sessions
// and the print: the timer, a manual entry (Data Entry or a Manager), and
// whether its times were later corrected.
export type WorkPeriodSource =
  | "System Recorded"
  | "System Recorded — Manually Corrected"
  | "Manually Entered"
  | "Manually Entered — Corrected";

export function workPeriodSource(period: { is_manual_entry: boolean; original_started_at: string | Date | null }): WorkPeriodSource {
  if (period.is_manual_entry) return period.original_started_at ? "Manually Entered — Corrected" : "Manually Entered";
  return period.original_started_at ? "System Recorded — Manually Corrected" : "System Recorded";
}
