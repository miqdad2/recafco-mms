// Manual Worker Time Entry — pure rules. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatKuwaitDateTime, parseKuwaitInputValue } from "@/lib/format/kuwait-time";
import { computeJobCardDates } from "@/lib/work-orders/job-card-dates";
import { evaluateJobCardDeletion } from "@/lib/work-orders/job-card-deletion-rules";
import { checkWorkPeriod, workPeriodSource } from "@/lib/work-orders/work-time-correction-rules";

describe("work period source labels", () => {
  it("tells timer, manual and corrected periods apart", () => {
    assert.equal(workPeriodSource({ is_manual_entry: false, original_started_at: null }), "System Recorded");
    assert.equal(workPeriodSource({ is_manual_entry: false, original_started_at: "2026-10-26T05:00:00Z" }), "System Recorded — Manually Corrected");
    assert.equal(workPeriodSource({ is_manual_entry: true, original_started_at: null }), "Manually Entered");
    assert.equal(workPeriodSource({ is_manual_entry: true, original_started_at: new Date() }), "Manually Entered — Corrected");
  });
});

describe("manual entry periods (Kuwait time, overnight)", () => {
  const now = new Date("2026-10-27T10:00:00.000Z");
  it("an overnight Kuwait shift 22:00 → 06:00 is 8 h", () => {
    const start = parseKuwaitInputValue("2026-10-25T22:00");
    const end = parseKuwaitInputValue("2026-10-26T06:00");
    assert.deepEqual(checkWorkPeriod({ start, end, now, otherPeriods: [], longPeriodConfirmed: false }), { ok: true, durationMinutes: 480, unusuallyLong: false });
    assert.equal(start?.toISOString(), "2026-10-25T19:00:00.000Z");
  });
  it("end before start, future, and an overlap with a pending entry are refused", () => {
    const s = parseKuwaitInputValue("2026-10-26T08:00");
    const e = parseKuwaitInputValue("2026-10-26T12:00");
    assert.equal(checkWorkPeriod({ start: e, end: s, now, otherPeriods: [], longPeriodConfirmed: false }).ok, false);
    assert.equal(checkWorkPeriod({ start: s, end: parseKuwaitInputValue("2026-10-28T12:00"), now, otherPeriods: [], longPeriodConfirmed: true }).ok, false);
    const pending = { start: parseKuwaitInputValue("2026-10-26T11:00")!, end: parseKuwaitInputValue("2026-10-26T13:00")!, jobCardNumber: "REC/JOB/9" };
    const r = checkWorkPeriod({ start: s, end: e, now, otherPeriods: [pending], longPeriodConfirmed: false });
    assert.equal(r.ok, false);
    assert.match((r as { message: string }).message, /REC\/JOB\/9/);
  });
  it("two separate periods the same day are both allowed (they only touch)", () => {
    const first = { start: parseKuwaitInputValue("2026-10-26T08:00")!, end: parseKuwaitInputValue("2026-10-26T12:00")!, jobCardNumber: null };
    const r = checkWorkPeriod({ start: parseKuwaitInputValue("2026-10-26T12:00"), end: parseKuwaitInputValue("2026-10-26T15:30"), now, otherPeriods: [first], longPeriodConfirmed: false });
    assert.deepEqual(r, { ok: true, durationMinutes: 210, unusuallyLong: false });
  });
});

describe("Job Card dates with an approved manual period", () => {
  const base = { createdAt: "2026-10-25T05:00:00.000Z", status: "Approved", statusStartAt: null, statusEndAt: null, formStartAt: null, formEndAt: null, closedAt: null };
  it("work start/end come from the approved manual period once the worker is finished", () => {
    const sessions = [{ startedAt: "2026-10-25T19:00:00.000Z", endedAt: "2026-10-26T03:00:00.000Z", status: "Completed" }];
    const notFinished = computeJobCardDates({ ...base, sessions, workerAssignmentStatuses: ["active"] });
    assert.deepEqual(notFinished.workStart, { recorded: true, at: "2026-10-25T19:00:00.000Z", source: "timer" });
    assert.deepEqual(notFinished.workEnd, { recorded: false, label: "Not finished" });
    const finished = computeJobCardDates({ ...base, sessions, workerAssignmentStatuses: ["finished"] });
    assert.deepEqual(finished.workEnd, { recorded: true, at: "2026-10-26T03:00:00.000Z", source: "timer" });
    // Kuwait display: 22:00 on 25 Oct → 06:00 on 26 Oct.
    assert.equal(formatKuwaitDateTime(finished.workStart.recorded ? finished.workStart.at : null), "25 Oct 2026, 10:00 PM");
    assert.equal(formatKuwaitDateTime(finished.workEnd.recorded ? finished.workEnd.at : null), "26 Oct 2026, 6:00 AM");
  });
  it("a pending manual entry (no session yet) leaves the dates untouched", () => {
    const d = computeJobCardDates({ ...base, sessions: [], workerAssignmentStatuses: ["active"] });
    assert.deepEqual(d.workStart, { recorded: false, label: "Not started" });
  });
});

describe("deletion waits for worker time under review", () => {
  const clean = { status: "Approved", deleted: false, workSessionCount: 0, materialsRequestNumbers: [], stockMovementCount: 0, materialsUsedCount: 0, purchaseRequestCount: 0, laborRecordCount: 0 };
  it("is blocked while manual time or a correction waits; allowed without (older callers omit the fact)", () => {
    assert.equal(evaluateJobCardDeletion({ ...clean, pendingTimeEntryCount: 1 }).eligible, false);
    assert.match(evaluateJobCardDeletion({ ...clean, pendingTimeEntryCount: 2 }).reasons[0], /waiting for Manager review/);
    assert.equal(evaluateJobCardDeletion(clean).eligible, true);
  });
});
