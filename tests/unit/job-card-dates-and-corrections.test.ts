// Job Card Dates, Job Card deletion eligibility and worker time correction
// rules — run with `npm run test:unit`. These pure functions are what the
// Job Card page, the printed Job Card and the server actions all use.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDurationMinutes, formatKuwaitDateTime, parseKuwaitInputValue, toKuwaitInputValue } from "@/lib/format/kuwait-time";
import { computeJobCardDates, type JobCardDatesInput } from "@/lib/work-orders/job-card-dates";
import { evaluateJobCardDeletion, type JobCardDeletionFacts } from "@/lib/work-orders/job-card-deletion-rules";
import { checkTimeCorrection, checkWorkPeriod, LONG_PERIOD_REVIEW_MINUTES } from "@/lib/work-orders/work-time-correction-rules";

describe("Kuwait time helpers", () => {
  it("formats in Kuwait time regardless of the machine's time zone", () => {
    // 21:30 UTC = 00:30 next day in Kuwait.
    assert.equal(formatKuwaitDateTime("2026-10-25T21:30:00.000Z"), "26 Oct 2026, 12:30 AM");
    assert.equal(formatKuwaitDateTime(null), "Not recorded");
  });

  it("round-trips form values with an explicit +03:00 offset", () => {
    const d = parseKuwaitInputValue("2026-10-26T00:30");
    assert.equal(d?.toISOString(), "2026-10-25T21:30:00.000Z");
    assert.equal(toKuwaitInputValue("2026-10-25T21:30:00.000Z"), "2026-10-26T00:30");
  });

  it("rejects impossible calendar values", () => {
    assert.equal(parseKuwaitInputValue("2026-02-30T10:00"), null);
    assert.equal(parseKuwaitInputValue("2026-10-26T25:00"), null);
    assert.equal(parseKuwaitInputValue("not a date"), null);
    assert.equal(parseKuwaitInputValue(""), null);
  });

  it("formats durations", () => {
    assert.equal(formatDurationMinutes(45), "45 min");
    assert.equal(formatDurationMinutes(120), "2 h");
    assert.equal(formatDurationMinutes(135), "2 h 15 min");
  });
});

function dates(overrides: Partial<JobCardDatesInput>) {
  return computeJobCardDates({
    createdAt: "2026-10-20T05:00:00.000Z",
    status: "Approved",
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

describe("Job Card dates", () => {
  it("not started: created only", () => {
    const d = dates({ workerAssignmentStatuses: ["active"] });
    assert.deepEqual(d.created, { recorded: true, at: "2026-10-20T05:00:00.000Z", source: "status" });
    assert.deepEqual(d.workStart, { recorded: false, label: "Not started" });
    assert.deepEqual(d.workEnd, { recorded: false, label: "Not started" });
    assert.equal(d.closed, null);
  });

  it("started but a worker is still working: not finished", () => {
    const d = dates({
      workerAssignmentStatuses: ["active"],
      sessions: [{ startedAt: "2026-10-20T06:00:00.000Z", endedAt: null, status: "Active" }],
    });
    assert.deepEqual(d.workStart, { recorded: true, at: "2026-10-20T06:00:00.000Z", source: "timer" });
    assert.deepEqual(d.workEnd, { recorded: false, label: "Not finished" });
  });

  it("paused and resumed keeps the first start; paused worker means not finished", () => {
    const d = dates({
      workerAssignmentStatuses: ["active"],
      sessions: [
        { startedAt: "2026-10-20T06:00:00.000Z", endedAt: "2026-10-20T09:00:00.000Z", status: "Paused" },
        { startedAt: "2026-10-20T10:00:00.000Z", endedAt: "2026-10-20T12:00:00.000Z", status: "Paused" },
      ],
    });
    assert.equal(d.workStart.recorded && d.workStart.at, "2026-10-20T06:00:00.000Z");
    assert.deepEqual(d.workEnd, { recorded: false, label: "Not finished" });
  });

  it("all workers finished: end of the last work period, across midnight", () => {
    const d = dates({
      workerAssignmentStatuses: ["finished", "finished"],
      sessions: [
        { startedAt: "2026-10-20T18:00:00.000Z", endedAt: "2026-10-20T22:30:00.000Z", status: "Completed" }, // 21:00 → 01:30 Kuwait
        { startedAt: "2026-10-20T19:00:00.000Z", endedAt: "2026-10-20T21:00:00.000Z", status: "Paused" }, // finished from paused
      ],
    });
    assert.deepEqual(d.workEnd, { recorded: true, at: "2026-10-20T22:30:00.000Z", source: "timer" });
    assert.equal(formatKuwaitDateTime((d.workEnd as { at: string }).at), "21 Oct 2026, 1:30 AM");
  });

  it("a worker added after others finished re-opens the work (no end yet)", () => {
    const d = dates({
      workerAssignmentStatuses: ["finished", "active"],
      sessions: [{ startedAt: "2026-10-20T06:00:00.000Z", endedAt: "2026-10-20T08:00:00.000Z", status: "Completed" }],
    });
    assert.deepEqual(d.workEnd, { recorded: false, label: "Not finished" });
  });

  it("closure approval is never used as work end", () => {
    const d = dates({
      status: "Closed",
      closedAt: "2026-10-22T07:00:00.000Z",
      workerAssignmentStatuses: ["finished"],
      sessions: [{ startedAt: "2026-10-20T06:00:00.000Z", endedAt: "2026-10-20T08:00:00.000Z", status: "Completed" }],
    });
    assert.equal(d.workEnd.recorded && d.workEnd.at, "2026-10-20T08:00:00.000Z");
    assert.deepEqual(d.closed, { recorded: true, at: "2026-10-22T07:00:00.000Z", source: "closure" });
  });

  it("technician / external job: status start and completion events", () => {
    const d = dates({ status: "Closed", statusStartAt: "2026-10-20T06:00:00.000Z", statusEndAt: "2026-10-20T10:00:00.000Z", closedAt: "2026-10-20T10:00:00.000Z" });
    assert.deepEqual(d.workStart, { recorded: true, at: "2026-10-20T06:00:00.000Z", source: "status" });
    assert.deepEqual(d.workEnd, { recorded: true, at: "2026-10-20T10:00:00.000Z", source: "status" });
  });

  it("old Job Card: typed form times are used and labelled; otherwise Not recorded", () => {
    const withForm = dates({ status: "Closed", formStartAt: "2026-06-01T05:00:00.000Z", formEndAt: "2026-06-01T09:00:00.000Z" });
    assert.equal(withForm.workStart.recorded && withForm.workStart.source, "form");
    assert.equal(withForm.workEnd.recorded && withForm.workEnd.source, "form");
    const bare = dates({ status: "Closed" });
    assert.deepEqual(bare.workStart, { recorded: false, label: "Not recorded" });
    assert.deepEqual(bare.workEnd, { recorded: false, label: "Not recorded" });
  });

  it("closed internal job whose workers never finished: end not recorded (not guessed)", () => {
    const d = dates({
      status: "Closed",
      workerAssignmentStatuses: ["active"],
      sessions: [{ startedAt: "2026-10-20T06:00:00.000Z", endedAt: "2026-10-20T08:00:00.000Z", status: "Completed" }],
    });
    assert.deepEqual(d.workEnd, { recorded: false, label: "Not recorded" });
  });
});

const clean: JobCardDeletionFacts = {
  status: "Approved",
  deleted: false,
  workSessionCount: 0,
  materialsRequestNumbers: [],
  stockMovementCount: 0,
  materialsUsedCount: 0,
  purchaseRequestCount: 0,
  laborRecordCount: 0,
};

describe("Job Card deletion eligibility", () => {
  it("a Job Card with nothing recorded can be deleted", () => {
    assert.deepEqual(evaluateJobCardDeletion(clean), { eligible: true, reasons: [] });
  });

  it("recorded work hours, materials, stock, purchase and labor each block with a reason", () => {
    const cases: Array<Partial<JobCardDeletionFacts>> = [
      { workSessionCount: 1 },
      { materialsRequestNumbers: ["REC/MR/0001"] },
      { stockMovementCount: 2 },
      { materialsUsedCount: 1 },
      { purchaseRequestCount: 1 },
      { laborRecordCount: 1 },
      { status: "Closed" },
      { status: "Closure Requested" },
    ];
    for (const c of cases) {
      const result = evaluateJobCardDeletion({ ...clean, ...c });
      assert.equal(result.eligible, false, JSON.stringify(c));
      assert.equal(result.reasons.length, 1, JSON.stringify(c));
    }
    assert.match(evaluateJobCardDeletion({ ...clean, materialsRequestNumbers: ["REC/MR/0001"] }).reasons[0], /REC\/MR\/0001/);
  });

  it("an already deleted Job Card says so", () => {
    assert.deepEqual(evaluateJobCardDeletion({ ...clean, deleted: true }), { eligible: false, reasons: ["This Job Card has already been deleted."] });
  });
});

describe("Worker time correction rules", () => {
  const originalStart = new Date("2026-10-20T05:00:00.000Z");
  const originalEnd = new Date("2026-10-20T13:00:00.000Z");
  const now = new Date("2026-10-26T10:00:00.000Z");
  const base = { originalStart, originalEnd, now, otherPeriods: [], longPeriodConfirmed: false };

  it("accepts a shorter corrected period and returns its minutes", () => {
    const r = checkTimeCorrection({ ...base, correctedStart: new Date("2026-10-20T05:00:00.000Z"), correctedEnd: new Date("2026-10-20T09:30:00.000Z") });
    assert.deepEqual(r, { ok: true, durationMinutes: 270, unusuallyLong: false });
  });

  it("accepts a period across midnight (Kuwait)", () => {
    const r = checkTimeCorrection({
      ...base,
      correctedStart: parseKuwaitInputValue("2026-10-20T22:00"),
      correctedEnd: parseKuwaitInputValue("2026-10-21T02:00"),
    });
    assert.deepEqual(r, { ok: true, durationMinutes: 240, unusuallyLong: false });
  });

  it("rejects invalid, reversed, future and unchanged times", () => {
    assert.equal(checkTimeCorrection({ ...base, correctedStart: null, correctedEnd: originalEnd }).ok, false);
    assert.equal(checkTimeCorrection({ ...base, correctedStart: originalEnd, correctedEnd: originalStart }).ok, false);
    assert.equal(checkTimeCorrection({ ...base, correctedStart: originalStart, correctedEnd: originalStart }).ok, false);
    assert.equal(checkTimeCorrection({ ...base, correctedStart: new Date("2026-10-26T09:00:00Z"), correctedEnd: new Date("2026-10-26T11:00:00Z") }).ok, false);
    // Recorded times carry seconds; the form sends whole minutes — still "unchanged".
    const r = checkTimeCorrection({
      ...base,
      originalStart: new Date("2026-10-20T05:00:42.000Z"),
      originalEnd: new Date("2026-10-20T13:00:13.000Z"),
      correctedStart: new Date("2026-10-20T05:00:00.000Z"),
      correctedEnd: new Date("2026-10-20T13:00:00.000Z"),
    });
    assert.deepEqual(r, { ok: false, message: "The corrected times are the same as the recorded times." });
  });

  it("rejects overlap with another period of the same worker, allows touching periods", () => {
    const other = { start: new Date("2026-10-20T14:00:00.000Z"), end: new Date("2026-10-20T16:00:00.000Z"), jobCardNumber: "REC/JOB/0002" };
    const overlap = checkTimeCorrection({ ...base, otherPeriods: [other], correctedStart: originalStart, correctedEnd: new Date("2026-10-20T14:30:00.000Z") });
    assert.equal(overlap.ok, false);
    assert.match((overlap as { message: string }).message, /REC\/JOB\/0002/);
    const touching = checkTimeCorrection({ ...base, otherPeriods: [other], correctedStart: originalStart, correctedEnd: new Date("2026-10-20T14:00:00.000Z") });
    assert.equal(touching.ok, true);
  });

  // Final Integration Review: no unconditional length limit (no approved
  // policy) — an unusually long period needs an explicit confirmation.
  it("an unusually long period is not refused outright: it needs confirmation, then is accepted and flagged", () => {
    const longEnd = new Date(originalStart.getTime() + (LONG_PERIOD_REVIEW_MINUTES + 30) * 60000);
    const unconfirmed = checkTimeCorrection({ ...base, correctedStart: originalStart, correctedEnd: longEnd });
    assert.equal(unconfirmed.ok, false);
    assert.equal((unconfirmed as { needsLongPeriodConfirmation?: boolean }).needsLongPeriodConfirmation, true);
    assert.match((unconfirmed as { message: string }).message, /unusually long/);
    const confirmed = checkTimeCorrection({ ...base, correctedStart: originalStart, correctedEnd: longEnd, longPeriodConfirmed: true });
    assert.deepEqual(confirmed, { ok: true, durationMinutes: LONG_PERIOD_REVIEW_MINUTES + 30, unusuallyLong: true });
    // 20 hours (above the old 16 h ceiling) is possible once confirmed.
    const twenty = checkTimeCorrection({ ...base, correctedStart: originalStart, correctedEnd: new Date(originalStart.getTime() + 20 * 3600_000), longPeriodConfirmed: true });
    assert.equal(twenty.ok, true);
    // Exactly at the threshold is not "unusually long".
    const atLimit = checkTimeCorrection({ ...base, correctedStart: originalStart, correctedEnd: new Date(originalStart.getTime() + LONG_PERIOD_REVIEW_MINUTES * 60000) });
    assert.deepEqual(atLimit, { ok: true, durationMinutes: LONG_PERIOD_REVIEW_MINUTES, unusuallyLong: false });
  });

  it("impossible periods stay refused even when confirmed: reversed, future, overlapping", () => {
    const c = { now, otherPeriods: [], longPeriodConfirmed: true };
    assert.equal(checkWorkPeriod({ ...c, start: originalEnd, end: originalStart }).ok, false);
    assert.equal(checkWorkPeriod({ ...c, start: new Date("2026-10-26T09:00:00Z"), end: new Date("2026-10-26T11:00:00Z") }).ok, false);
    const other = { start: new Date("2026-10-20T06:00:00.000Z"), end: new Date("2026-10-20T07:00:00.000Z"), jobCardNumber: null };
    assert.equal(checkWorkPeriod({ ...c, otherPeriods: [other], start: originalStart, end: originalEnd }).ok, false);
  });

  it("the Manager path (checkWorkPeriod) has no unchanged-times rule but the same overlap rule", () => {
    const r = checkWorkPeriod({ now, otherPeriods: [], longPeriodConfirmed: false, start: originalStart, end: originalEnd });
    assert.deepEqual(r, { ok: true, durationMinutes: 480, unusuallyLong: false });
  });
});
