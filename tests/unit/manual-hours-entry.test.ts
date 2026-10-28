// Manual worker hours (dates + actual hours), possible conflicts, and the
// closure "Return for Correction" target — run with `npm run test:unit`.
// These pure rules are used by the Enter Time Manually form (live preview)
// and by the server (lib/backend/work-orders/work-time-corrections.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatKuwaitDate, formatKuwaitMoment } from "@/lib/format/kuwait-time";
import { closureReturnTarget } from "@/lib/workflows/status-rules";
import { computeJobCardDates } from "@/lib/work-orders/job-card-dates";
import {
  checkManualHoursEntry,
  kuwaitDateOf,
  parseActualHours,
  possibleConflicts,
  suggestedManualMinutes,
  type ManualHoursInput,
} from "@/lib/work-orders/work-time-correction-rules";

// 28 Oct 2026, 10:00 Kuwait.
const NOW = new Date("2026-10-28T07:00:00.000Z");
const base: ManualHoursInput = { startDate: "2026-10-27", startTime: "", endDate: "2026-10-27", endTime: "", actualHours: "4", now: NOW, longPeriodConfirmed: false };
const check = (over: Partial<ManualHoursInput>) => checkManualHoursEntry({ ...base, ...over });

describe("Manual hours — dates and actual hours are separate", () => {
  it("9 hours over three calendar days saves 9 hours, not the 72 between the dates", () => {
    const r = check({ startDate: "2026-10-25", endDate: "2026-10-27", actualHours: "9" });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.actualMinutes, 540);
    assert.equal(r.isSpan, true);
    assert.equal(r.startTimeKnown, false);
    assert.equal(r.endTimeKnown, false);
    // Kuwait day boundaries: 25 Oct 00:00 → 27 Oct 23:59 (Kuwait).
    assert.equal(r.start.toISOString(), "2026-10-24T21:00:00.000Z");
    assert.equal(r.end.toISOString(), "2026-10-27T20:59:00.000Z");
  });

  it("single day without times is allowed (when permitted: dates only)", () => {
    const r = check({ actualHours: "4.5" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.actualMinutes, 270);
  });

  it("same-day period with both times and equal hours is an exact (continuous) period", () => {
    const r = check({ startTime: "08:00", endTime: "12:30", actualHours: "4.5" });
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.isSpan, false);
      assert.equal(r.actualMinutes, 270);
    }
  });

  it("same-day times with fewer hours (a break) is allowed and treated as hours over the period", () => {
    const r = check({ startTime: "08:00", endTime: "17:00", actualHours: "8" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.isSpan, true);
  });

  it("hours more than the time between start and end are refused", () => {
    const r = check({ startTime: "08:00", endTime: "10:00", actualHours: "3" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.field, "hours");
    // A whole day is at most 24 h.
    assert.equal(check({ actualHours: "25", longPeriodConfirmed: true }).ok, false);
  });

  it("long entries need the explicit confirmation, like other hand-entered time", () => {
    const r = check({ startDate: "2026-10-25", endDate: "2026-10-27", actualHours: "20" });
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.needsLongPeriodConfirmation, true);
    assert.equal(check({ startDate: "2026-10-25", endDate: "2026-10-27", actualHours: "20", longPeriodConfirmed: true }).ok, true);
  });

  it("refuses future dates/times, end before start, and bad numbers", () => {
    assert.equal(check({ endDate: "2026-10-29" }).ok, false);
    assert.equal(check({ startDate: "2026-10-28", endDate: "2026-10-28", startTime: "11:00", actualHours: "1" }).ok, false);
    assert.equal(check({ startDate: "2026-10-27", endDate: "2026-10-26" }).ok, false);
    assert.equal(check({ startTime: "10:00", endTime: "09:00" }).ok, false);
    for (const bad of ["", "0", "abc", "4,5", "-2", "1.234"]) assert.equal(check({ actualHours: bad }).ok, false, bad);
    assert.equal(check({ startDate: "2026-02-30", endDate: "2026-02-30" }).ok, false);
  });

  it("today without an end time ends at now, so hours cannot exceed time so far", () => {
    // 10:00 Kuwait now; 00:00 → now = 10 h available.
    assert.equal(check({ startDate: "2026-10-28", endDate: "2026-10-28", actualHours: "10" }).ok, true);
    assert.equal(check({ startDate: "2026-10-28", endDate: "2026-10-28", actualHours: "10.5" }).ok, false);
  });

  it("work past midnight: start one day, end the next", () => {
    const r = check({ startDate: "2026-10-26", startTime: "22:00", endDate: "2026-10-27", endTime: "02:00", actualHours: "4" });
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.isSpan, false);
  });
});

describe("Manual hours — helpers", () => {
  it("parses hours to whole minutes", () => {
    assert.equal(parseActualHours("9"), 540);
    assert.equal(parseActualHours("0.25"), 15);
    assert.equal(parseActualHours("1.33"), 80);
    assert.equal(parseActualHours("0"), null);
  });

  it("suggests the duration only for a same-day period with both times", () => {
    assert.equal(suggestedManualMinutes("2026-10-27", "08:00", "2026-10-27", "12:30"), 270);
    assert.equal(suggestedManualMinutes("2026-10-25", "08:00", "2026-10-27", "12:30"), null);
    assert.equal(suggestedManualMinutes("2026-10-27", "", "2026-10-27", "12:30"), null);
  });

  it("Kuwait calendar day of an instant (midnight boundary)", () => {
    assert.equal(kuwaitDateOf(new Date("2026-10-27T20:59:00.000Z")), "2026-10-27");
    assert.equal(kuwaitDateOf(new Date("2026-10-27T21:00:00.000Z")), "2026-10-28");
    assert.equal(formatKuwaitDate("2026-10-27T21:30:00.000Z"), "28 Oct 2026");
    assert.equal(formatKuwaitMoment("2026-10-27T21:30:00.000Z", false), "28 Oct 2026");
    assert.equal(formatKuwaitMoment("2026-10-27T21:30:00.000Z", true), "28 Oct 2026, 12:30 AM");
  });

  it("flags other periods inside a span as possible conflicts (never blocks)", () => {
    const span = { start: new Date("2026-10-24T21:00:00Z"), end: new Date("2026-10-27T20:59:00Z") };
    const inside = { start: new Date("2026-10-26T05:00:00Z"), end: new Date("2026-10-26T08:00:00Z"), jobCardNumber: "JC-2" };
    const outside = { start: new Date("2026-10-28T05:00:00Z"), end: new Date("2026-10-28T08:00:00Z"), jobCardNumber: "JC-3" };
    assert.deepEqual(possibleConflicts(span, [inside, outside]).map((p) => p.jobCardNumber), ["JC-2"]);
  });
});

describe("Job Card Work Start / End from a manual entry without times", () => {
  it("is marked date-only so no time is invented", () => {
    const dates = computeJobCardDates({
      createdAt: "2026-10-20T05:00:00.000Z",
      status: "Closed",
      sessions: [
        { startedAt: "2026-10-22T21:00:00.000Z", endedAt: "2026-10-25T20:59:00.000Z", status: "Completed", startTimeKnown: false, endTimeKnown: false },
      ],
      workerAssignmentStatuses: ["finished"],
      statusStartAt: null,
      statusEndAt: null,
      formStartAt: null,
      formEndAt: null,
      closedAt: "2026-10-27T05:00:00.000Z",
    });
    assert.equal(dates.workStart.recorded && dates.workStart.dateOnly, true);
    assert.equal(dates.workEnd.recorded && dates.workEnd.dateOnly, true);
  });

  it("timer periods keep their times", () => {
    const dates = computeJobCardDates({
      createdAt: "2026-10-20T05:00:00.000Z",
      status: "Approved",
      sessions: [{ startedAt: "2026-10-22T05:00:00.000Z", endedAt: null, status: "Active" }],
      workerAssignmentStatuses: ["active"],
      statusStartAt: null,
      statusEndAt: null,
      formStartAt: null,
      formEndAt: null,
      closedAt: null,
    });
    assert.equal(dates.workStart.recorded && dates.workStart.dateOnly, undefined);
  });
});

describe("Closure Return for Correction target", () => {
  it("goes back to the active status closure was requested from", () => {
    for (const s of ["Approved", "Waiting Materials", "Partially Issued", "Materials Issued", "Assigned", "In Progress"]) {
      assert.equal(closureReturnTarget(s), s);
    }
  });

  it("falls back to Approved (Active) for anything else", () => {
    for (const s of [null, undefined, "Created", "Closed", "Closure Requested", "Nonsense"]) {
      assert.equal(closureReturnTarget(s), "Approved");
    }
  });
});
