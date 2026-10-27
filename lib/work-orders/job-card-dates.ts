// Job Card Dates — Created / Work Start / Work End (client-safe, pure).
//
// One definition used by the Job Card detail page and the printed Job Card
// (both load their input through lib/work-orders/job-card-dates-data.ts), so
// the two can never show different dates. Nothing here invents a time: a
// date is either read from a recorded event or shown as a plain "missing"
// label.
//
// Definitions:
// - Created: work_orders.created_at.
// - Work Start: the earliest recorded start of work — the first worker timer
//   start (work_order_work_sessions.started_at, Cancelled periods ignored)
//   or a "work started" status action (audit work_order.start /
//   work_order.start_progress, used by technician / external jobs that have
//   no timer). Pausing and resuming add later periods, so they never move it.
// - Work End: the actual end of work, never the Manager's closure approval.
//   * Internal team (timer) jobs: once EVERY assigned worker is marked
//     Finished, the end of the last recorded work period. While anyone is
//     still working, paused or not started, the work is not finished.
//   * Technician / external jobs without a timer: the "work completed"
//     action (audit work_order.complete / work_order.external_completed).
// - Older Job Cards with neither: the start/end typed on the old Job Card
//   form (starting_datetime / ending_datetime), labelled as such.
// - Closed: the Manager's closure approval, shown separately.

export type JobCardDateSource = "timer" | "status" | "form" | "closure";

export type JobCardDate =
  | { recorded: true; at: string; source: JobCardDateSource }
  | { recorded: false; label: "Not started" | "Not finished" | "Not recorded" };

export type JobCardDatesInput = {
  createdAt: string;
  status: string;
  // Non-cancelled work periods only.
  sessions: Array<{ startedAt: string; endedAt: string | null; status: string }>;
  // Active + finished internal team assignments (removed ones excluded).
  workerAssignmentStatuses: string[];
  statusStartAt: string | null;
  statusEndAt: string | null;
  formStartAt: string | null;
  formEndAt: string | null;
  closedAt: string | null;
};

export type JobCardDates = {
  created: JobCardDate;
  workStart: JobCardDate;
  workEnd: JobCardDate;
  closed: JobCardDate | null;
};

function earliest(values: Array<string | null>): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (v && (!best || new Date(v).getTime() < new Date(best).getTime())) best = v;
  }
  return best;
}

function latest(values: Array<string | null>): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (v && (!best || new Date(v).getTime() > new Date(best).getTime())) best = v;
  }
  return best;
}

export function computeJobCardDates(input: JobCardDatesInput): JobCardDates {
  const isClosed = input.status === "Closed";
  const created: JobCardDate = { recorded: true, at: input.createdAt, source: "status" };

  // ── Work Start ──
  const timerStart = earliest(input.sessions.map((s) => s.startedAt));
  const systemStart = earliest([timerStart, input.statusStartAt]);
  let workStart: JobCardDate;
  if (systemStart) {
    workStart = { recorded: true, at: systemStart, source: systemStart === timerStart ? "timer" : "status" };
  } else if (input.formStartAt) {
    workStart = { recorded: true, at: input.formStartAt, source: "form" };
  } else {
    workStart = { recorded: false, label: isClosed ? "Not recorded" : "Not started" };
  }

  // ── Work End ──
  let workEnd: JobCardDate;
  const hasInternalTeam = input.workerAssignmentStatuses.length > 0;
  if (hasInternalTeam) {
    const allFinished = input.workerAssignmentStatuses.every((s) => s === "finished");
    const anyRunning = input.sessions.some((s) => s.status === "Active");
    const lastEnd = latest(input.sessions.map((s) => s.endedAt));
    if (allFinished && !anyRunning && lastEnd) {
      workEnd = { recorded: true, at: lastEnd, source: "timer" };
    } else if (isClosed) {
      workEnd = { recorded: false, label: "Not recorded" };
    } else {
      workEnd = { recorded: false, label: workStart.recorded ? "Not finished" : "Not started" };
    }
  } else if (input.statusEndAt) {
    workEnd = { recorded: true, at: input.statusEndAt, source: "status" };
  } else if (input.formEndAt) {
    workEnd = { recorded: true, at: input.formEndAt, source: "form" };
  } else if (isClosed) {
    workEnd = { recorded: false, label: "Not recorded" };
  } else {
    workEnd = { recorded: false, label: workStart.recorded ? "Not finished" : "Not started" };
  }

  const closed: JobCardDate | null =
    isClosed && input.closedAt ? { recorded: true, at: input.closedAt, source: "closure" } : null;

  return { created, workStart, workEnd, closed };
}

export const JOB_CARD_DATE_SOURCE_NOTE: Record<JobCardDateSource, string | null> = {
  timer: "From worker time records",
  status: null,
  form: "Entered on the Job Card form",
  closure: "Manager closure approval",
};
