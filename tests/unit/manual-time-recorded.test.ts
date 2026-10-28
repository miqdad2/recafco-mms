// "Manual Time Recorded" worker state — run with `npm run test:unit`.
// A worker whose hours were entered manually (no timer running or paused)
// is not "not started": closure readiness and the Daily Activity status say
// "manual time recorded — mark work finished", per assignment.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkWorkersReadyForClosure } from "@/lib/work-orders/closure-readiness";
import { classifyDailyActivity } from "@/lib/work-orders/daily-activity-status";

describe("closure readiness with manual time", () => {
  it("manual-only worker blocks closure with a 'mark work finished' reason, not 'not started'", () => {
    const check = checkWorkersReadyForClosure([
      { workerAssignmentId: "a", workerName: "worker1", assignmentStatus: "active", sessionStatus: "Not Started", manualMinutes: 300 },
      { workerAssignmentId: "b", workerName: "worker2", assignmentStatus: "active", sessionStatus: "Not Started" },
    ]);
    assert.equal(check.ready, false);
    assert.deepEqual(check.reasons, [
      "Manual time recorded - mark work finished before closure: worker1.",
      "Worker not started - finish or remove assignment before closure: worker2.",
    ]);
  });

  it("finished manual worker + finished timer worker → ready", () => {
    const check = checkWorkersReadyForClosure([
      { workerAssignmentId: "a", workerName: "worker1", assignmentStatus: "finished", sessionStatus: "Not Started", manualMinutes: 300 },
      { workerAssignmentId: "b", workerName: "worker2", assignmentStatus: "finished", sessionStatus: "Completed" },
    ]);
    assert.equal(check.ready, true);
  });
});

describe("Daily Activity status with manual time", () => {
  const base = { status: "Approved", closureReady: false, materialsPending: false };

  it("all unfinished workers have manual time → 'Manual Time Recorded', not in 'Not Started'", () => {
    const c = classifyDailyActivity({ ...base, workers: [{ assignmentStatus: "active", sessionStatus: "Not Started", manualMinutes: 180 }] });
    assert.equal(c.plainStatus.label, "Manual Time Recorded");
    assert.equal(c.isNotStarted, false);
  });

  it("a worker with no time at all still makes the card 'Not Started'", () => {
    const c = classifyDailyActivity({
      ...base,
      workers: [
        { assignmentStatus: "active", sessionStatus: "Not Started", manualMinutes: 180 },
        { assignmentStatus: "active", sessionStatus: "Not Started" },
      ],
    });
    assert.equal(c.plainStatus.label, "Not Started");
    assert.equal(c.isNotStarted, true);
  });

  it("a running timer on another worker still reads 'Working Now'", () => {
    const c = classifyDailyActivity({
      ...base,
      workers: [
        { assignmentStatus: "active", sessionStatus: "Not Started", manualMinutes: 300 },
        { assignmentStatus: "active", sessionStatus: "Active" },
      ],
    });
    assert.equal(c.plainStatus.label, "Working Now");
  });
});
