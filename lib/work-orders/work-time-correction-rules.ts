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

// Where a work period's time came from, in the words shown on View Sessions
// and the print: the timer, a manual entry (Data Entry with Manager approval,
// or a Manager directly), and whether its times were later corrected.
export type WorkPeriodSource =
  | "System Recorded"
  | "System Recorded — Manually Corrected"
  | "Manually Entered"
  | "Manually Entered — Corrected";

export function workPeriodSource(period: { is_manual_entry: boolean; original_started_at: string | Date | null }): WorkPeriodSource {
  if (period.is_manual_entry) return period.original_started_at ? "Manually Entered — Corrected" : "Manually Entered";
  return period.original_started_at ? "System Recorded — Manually Corrected" : "System Recorded";
}
