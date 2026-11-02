// Job Card Time Details: Duration, Work Completed and Manager Approved On are
// three separate figures. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { currentKuwaitInputValue, formatClockTime } from "@/lib/format/kuwait-time";
import { computeJobCardDates, type JobCardDatesInput } from "@/lib/work-orders/job-card-dates";
import { jobCardOpenedAt } from "@/lib/work-orders/job-card-edit";
import { checkWorkCompletedEntry, computeJobCardTiming, formatElapsedDuration, suggestedWorkCompleted, type JobCardTimingInput } from "@/lib/work-orders/job-card-timing";

// 24 Oct 2026, Kuwait is UTC+3: 05:00Z = 8:00 AM.
const OPEN = "2026-10-24T05:00:00.000Z";
const NINE_THIRTY_SIX = "2026-10-24T06:36:00.000Z";

function period(startedAt: string, endedAt: string | null, extra: Partial<JobCardDatesInput["sessions"][number]> = {}) {
  return { startedAt, endedAt, status: endedAt ? "Completed" : "Active", ...extra };
}

function dates(overrides: Partial<JobCardDatesInput> = {}) {
  return computeJobCardDates({
    createdAt: "2026-10-24T04:00:00.000Z",
    status: "In Progress",
    sessions: [],
    workerAssignmentStatuses: [],
    statusStartAt: null,
    statusEndAt: null,
    formStartAt: null,
    formEndAt: null,
    closedAt: null,
    ...overrides,
  });
}

function timing(overrides: Partial<JobCardTimingInput> = {}, dateOverrides: Partial<JobCardDatesInput> = {}) {
  const status = overrides.status ?? "In Progress";
  return computeJobCardTiming({
    status,
    openDate: "2026-10-24",
    openedAt: OPEN,
    workCompletedAt: null,
    readyForClosure: true,
    dates: dates({ status, ...dateOverrides }),
    ...overrides,
  });
}

const threeFinished = {
  workerAssignmentStatuses: ["finished", "finished", "finished"],
  sessions: [period(OPEN, NINE_THIRTY_SIX), period(OPEN, NINE_THIRTY_SIX), period(OPEN, NINE_THIRTY_SIX)],
};

describe("Job Card Duration", () => {
  it("is 1 h 36 min for three workers together, never their 4.8 combined hours", () => {
    const t = timing({}, threeFinished);
    assert.equal(t.openedText, "24 Oct 2026, 8:00 AM");
    assert.equal(t.completedText, "24 Oct 2026, 9:36 AM");
    assert.equal(t.durationText, "1 h 36 min");
  });

  it("uses the last end when workers finish at different times", () => {
    const t = timing({}, {
      workerAssignmentStatuses: ["finished", "finished"],
      sessions: [period(OPEN, "2026-10-24T05:30:00.000Z"), period(OPEN, NINE_THIRTY_SIX)],
    });
    assert.equal(t.durationText, "1 h 36 min");
  });

  it("does not deduct a pause: elapsed time runs from opening to the last end", () => {
    const t = timing({}, {
      workerAssignmentStatuses: ["finished"],
      sessions: [period(OPEN, "2026-10-24T05:30:00.000Z"), period("2026-10-24T06:00:00.000Z", NINE_THIRTY_SIX)],
    });
    assert.equal(t.durationText, "1 h 36 min");
  });

  it("spans midnight and several days without removing nights", () => {
    const overMidnight = timing(
      { openedAt: "2026-10-24T19:30:00.000Z", openDate: "2026-10-24" },
      { workerAssignmentStatuses: ["finished"], sessions: [period("2026-10-24T19:30:00.000Z", "2026-10-24T21:30:00.000Z")] }
    );
    assert.equal(overMidnight.durationText, "2 h");
    const days = timing({}, { workerAssignmentStatuses: ["finished"], sessions: [period(OPEN, "2026-10-25T08:20:00.000Z")] });
    assert.equal(days.durationText, "1 day 3 h 20 min");
    assert.equal(formatElapsedDuration(2880), "2 days");
    assert.equal(formatElapsedDuration(1445), "1 day 5 min");
  });

  it("is Not available without an opening time, and says so without assuming midnight", () => {
    const t = timing({ openedAt: null }, threeFinished);
    assert.equal(t.openedText, "24 Oct 2026 — Time not recorded");
    assert.equal(t.durationText, "Not available");
  });

  it("is Not available for a historical Job Card with no Open Date; created_at is never used", () => {
    const t = timing({ status: "Closed", openDate: null, openedAt: null }, { ...threeFinished, closedAt: "2026-10-25T07:15:00.000Z" });
    assert.equal(t.openedText, "Not recorded");
    assert.equal(t.completedText, "24 Oct 2026, 9:36 AM");
    assert.equal(t.durationText, "Not available");
  });

  it("reports completion before opening instead of a negative duration", () => {
    const t = timing({ openedAt: "2026-10-24T08:00:00.000Z" }, threeFinished);
    assert.equal(t.durationText, "Check dates");
    assert.match(t.problem ?? "", /earlier than Job Card Opened/);
    const dayOnly = timing({ openDate: "2026-10-25", openedAt: null }, threeFinished);
    assert.equal(dayOnly.durationText, "Check dates");
  });
});

describe("Work Completed", () => {
  it("waits while one worker is active and the others have finished", () => {
    const t = timing({ readyForClosure: false }, {
      workerAssignmentStatuses: ["finished", "finished", "active"],
      sessions: [period(OPEN, NINE_THIRTY_SIX), period(OPEN, NINE_THIRTY_SIX), period(OPEN, null)],
    });
    assert.equal(t.completedText, "Not completed yet");
    assert.equal(t.durationText, "In progress");
  });

  it("waits while materials are pending, even with every worker finished", () => {
    const t = timing({ readyForClosure: false }, threeFinished);
    assert.equal(t.completed.state, "not_completed");
    assert.equal(t.durationText, "In progress");
  });

  it("a manual entry with a real end time counts as that time", () => {
    const t = timing({}, { workerAssignmentStatuses: ["finished"], sessions: [period(OPEN, NINE_THIRTY_SIX, { endTimeKnown: true })] });
    assert.equal(t.completedText, "24 Oct 2026, 9:36 AM");
  });

  it("manual time without a clock time stays valid but gives no completion time", () => {
    const t = timing({}, {
      workerAssignmentStatuses: ["finished"],
      sessions: [period("2026-10-24T09:00:00.000Z", "2026-10-24T10:00:00.000Z", { startTimeKnown: false, endTimeKnown: false })],
    });
    assert.equal(t.completedText, "24 Oct 2026 — Time not recorded");
    assert.equal(t.durationText, "Not available");
    assert.equal(t.needsCompletionEntry, true);
  });

  it("one worker's known end does not prove the finish while another has no clock time", () => {
    const t = timing({}, {
      workerAssignmentStatuses: ["finished", "finished"],
      sessions: [period(OPEN, "2026-10-24T09:00:00.000Z"), period(OPEN, NINE_THIRTY_SIX, { endTimeKnown: false })],
    });
    assert.equal(t.completed.state, "date_only");
    assert.equal(t.durationText, "Not available");
  });

  it("the time entered at closure request fills that gap, with no worker session", () => {
    const entered = timing({ workCompletedAt: NINE_THIRTY_SIX }, {
      workerAssignmentStatuses: ["finished"],
      sessions: [period(OPEN, "2026-10-24T07:00:00.000Z", { endTimeKnown: false })],
    });
    assert.deepEqual(entered.completed, { state: "exact", at: NINE_THIRTY_SIX, source: "entered" });
    assert.equal(entered.durationText, "1 h 36 min");
  });

  it("No Workers Required: unavailable until explicitly recorded", () => {
    const missing = timing();
    assert.equal(missing.completedText, "Not recorded");
    assert.equal(missing.durationText, "Not available");
    assert.equal(missing.needsCompletionEntry, true);
    const recorded = timing({ workCompletedAt: NINE_THIRTY_SIX });
    assert.equal(recorded.completedText, "24 Oct 2026, 9:36 AM");
    assert.equal(recorded.durationText, "1 h 36 min");
  });

  it("worker time wins over an older typed time and needs no entry", () => {
    const t = timing({ workCompletedAt: "2026-10-24T05:10:00.000Z" }, threeFinished);
    assert.equal(t.completedText, "24 Oct 2026, 9:36 AM");
    assert.equal(t.needsCompletionEntry, false);
  });
});

describe("Manager Approved On", () => {
  it("is hidden while waiting for approval, and work times are already final", () => {
    const t = timing({ status: "Closure Requested", readyForClosure: false }, threeFinished);
    assert.equal(t.managerApprovedText, null);
    assert.equal(t.durationText, "1 h 36 min");
  });

  it("approval a day later changes neither Work Completed nor Duration", () => {
    const t = timing({ status: "Closed", readyForClosure: false }, { ...threeFinished, closedAt: "2026-10-25T07:15:00.000Z" });
    assert.equal(t.managerApprovedText, "25 Oct 2026, 10:15 AM");
    assert.equal(t.completedText, "24 Oct 2026, 9:36 AM");
    assert.equal(t.durationText, "1 h 36 min");
  });

  it("a returned closure is back in progress with no approval shown, and the entered time is kept", () => {
    const t = timing({ status: "In Progress", readyForClosure: false, workCompletedAt: NINE_THIRTY_SIX }, threeFinished);
    assert.equal(t.managerApprovedText, null);
    assert.equal(t.durationText, "In progress");
    assert.equal(t.completionEntryValue, "2026-10-24T09:36");
  });
});

describe("Automatic date and time", () => {
  const now = new Date("2026-11-02T21:30:00.000Z"); // 12:30 AM on 3 Nov in Kuwait

  it("uses the Kuwait calendar day even when UTC is still on the day before", () => {
    assert.equal(currentKuwaitInputValue(now), "2026-11-03T00:30");
  });

  it("shows form times in 12-hour AM/PM", () => {
    assert.equal(formatClockTime("00:30"), "12:30 AM");
    assert.equal(formatClockTime("08:05"), "8:05 AM");
    assert.equal(formatClockTime("12:00"), "12:00 PM");
    assert.equal(formatClockTime("14:05"), "2:05 PM");
    assert.equal(formatClockTime(""), "");
  });

  it("suggests the current time when nothing is saved", () => {
    assert.equal(suggestedWorkCompleted(timing(), now), "2026-11-03T00:30");
  });

  it("shows a saved completion time instead of the current time", () => {
    assert.equal(suggestedWorkCompleted(timing({ workCompletedAt: NINE_THIRTY_SIX }), now), "2026-10-24T09:36");
  });

  it("sends nothing when worker time proves the finish, even with an older saved time", () => {
    assert.equal(suggestedWorkCompleted(timing({ workCompletedAt: "2026-10-24T05:10:00.000Z" }, threeFinished), now), null);
  });
});

describe("Entered times", () => {
  const base = { now: new Date("2026-10-26T00:00:00.000Z"), openDate: "2026-10-24", openedAt: OPEN, dates: dates() };

  it("accepts a real completion time", () => {
    assert.equal(checkWorkCompletedEntry({ ...base, at: new Date(NINE_THIRTY_SIX) }), null);
  });

  it("treats the same minute as the last worker end as not earlier", () => {
    const withWork = dates({ workerAssignmentStatuses: ["finished"], sessions: [period(OPEN, "2026-10-24T07:00:40.000Z", { endTimeKnown: false }), period(OPEN, "2026-10-24T07:00:40.000Z")] });
    assert.equal(checkWorkCompletedEntry({ ...base, dates: withWork, at: new Date("2026-10-24T07:00:00.000Z") }), null);
    assert.match(checkWorkCompletedEntry({ ...base, dates: withWork, at: new Date("2026-10-24T06:59:00.000Z") }) ?? "", /last recorded worker time/);
  });

  it("allows a browser clock a few minutes ahead, but not a later time", () => {
    const now = new Date("2026-10-24T07:00:00.000Z");
    assert.equal(checkWorkCompletedEntry({ ...base, now, at: new Date("2026-10-24T07:04:00.000Z") }), null);
    assert.match(checkWorkCompletedEntry({ ...base, now, at: new Date("2026-10-24T07:06:00.000Z") }) ?? "", /future/);
  });

  it("refuses future, before opening, and before recorded worker time", () => {
    assert.match(checkWorkCompletedEntry({ ...base, at: new Date("2026-10-27T00:00:00.000Z") }) ?? "", /future/);
    assert.match(checkWorkCompletedEntry({ ...base, at: new Date("2026-10-24T04:00:00.000Z") }) ?? "", /earlier than Job Card Opened/);
    const withWork = dates({ workerAssignmentStatuses: ["finished"], sessions: [period(OPEN, "2026-10-24T07:00:00.000Z"), period(OPEN, "2026-10-24T07:30:00.000Z", { endTimeKnown: false })] });
    assert.match(checkWorkCompletedEntry({ ...base, dates: withWork, at: new Date("2026-10-24T06:00:00.000Z") }) ?? "", /last recorded worker time/);
  });

  it("combines the Open Date and time as Kuwait time, on that same calendar day", () => {
    assert.equal(jobCardOpenedAt("2026-10-24", "08:00")?.toISOString(), OPEN);
    assert.equal(jobCardOpenedAt("2026-10-24", "00:30")?.toISOString(), "2026-10-23T21:30:00.000Z");
    assert.equal(jobCardOpenedAt("2026-10-24", ""), null);
    assert.equal(jobCardOpenedAt(null, "08:00"), null);
    assert.equal(jobCardOpenedAt("2026-10-24", "25:00"), null);
  });
});
