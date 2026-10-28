// Daily Activity "Needs My Action" — which Job Cards need an action the
// viewer can take, which action, its rank, and that the filter count always
// equals the rows the filter shows. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveMyAction, type MyActionInput } from "@/lib/work-orders/daily-activity-my-action";
import { classifyDailyActivity, matchesDailyActivityFilter, summarizeDailyActivity } from "@/lib/work-orders/daily-activity-status";

const dataEntryCan: MyActionInput["can"] = {
  requestClosure: true,
  manageSessions: true,
  assignWorkers: true,
  addMaterials: true,
  confirmNotRequired: true,
  processMaterials: false,
  reviewClosure: false,
  reviewTime: false,
};
const managerCan: MyActionInput["can"] = { ...dataEntryCan, processMaterials: true, reviewClosure: true, reviewTime: true };
const noneCan: MyActionInput["can"] = {
  requestClosure: false,
  manageSessions: false,
  assignWorkers: false,
  addMaterials: false,
  confirmNotRequired: false,
  processMaterials: false,
  reviewClosure: false,
  reviewTime: false,
};

const finished = { assignmentStatus: "finished", sessionStatus: "Completed" };
const working = { assignmentStatus: "active", sessionStatus: "Active" };
const paused = { assignmentStatus: "active", sessionStatus: "Paused" };
const notStarted = { assignmentStatus: "active", sessionStatus: "Not Started" };

const base: MyActionInput = {
  status: "Materials Issued",
  closureReady: false,
  workers: [],
  requirements: { workers: "missing", materials: "missing" },
  materialsNeedProcessing: false,
  closureReturned: false,
  pendingTimeReviews: 0,
  can: dataEntryCan,
};
const card = (over: Partial<MyActionInput>) => ({ ...base, ...over });

describe("deriveMyAction — Data Entry", () => {
  it("3/7. new Job Card with no workers and no materials", () => {
    assert.deepEqual(deriveMyAction(base), { rank: 3, message: "Add workers and materials, or confirm not required" });
  });

  it("5. only workers missing", () => {
    assert.deepEqual(deriveMyAction(card({ requirements: { workers: "missing", materials: "present" } })), {
      rank: 3,
      message: "Assign workers or confirm not required",
    });
  });

  it("6. only materials missing", () => {
    const a = deriveMyAction(card({ workers: [finished], requirements: { workers: "present", materials: "missing" } }));
    assert.deepEqual(a, { rank: 3, message: "Add materials or confirm not required" });
  });

  it("8. worker currently working", () => {
    const a = deriveMyAction(card({ workers: [working], requirements: { workers: "present", materials: "missing" } }));
    assert.equal(a?.rank, 2);
    assert.equal(a?.message, "Finish worker time when the work is done");
  });

  it("9. paused worker outranks everything but Ready to Close", () => {
    const a = deriveMyAction(card({ workers: [paused, working], requirements: { workers: "present", materials: "missing" } }));
    assert.deepEqual(a, { rank: 2, message: "Resume or finish paused work" });
  });

  it("10. Ready to Close", () => {
    const a = deriveMyAction(card({ workers: [finished], closureReady: true, requirements: { workers: "present", materials: "not_required" } }));
    assert.deepEqual(a, { rank: 1, message: "Request closure" });
  });

  it("11. Waiting for Manager Approval is not Data Entry's action", () => {
    assert.equal(deriveMyAction(card({ status: "Closure Requested", closureReady: true, workers: [finished] })), null);
  });

  it("12. returned closure request: review the remarks; once ready, request closure again", () => {
    const fixing = deriveMyAction(card({ workers: [finished], closureReturned: true, requirements: { workers: "present", materials: "present" } }));
    assert.deepEqual(fixing, { rank: 3, message: "Review the Manager's return remarks" });
    const ready = deriveMyAction(
      card({ workers: [finished], closureReturned: true, closureReady: true, requirements: { workers: "present", materials: "present" } })
    );
    assert.deepEqual(ready, { rank: 1, message: "Check the return remarks, then request closure" });
  });

  it("13. Closed Job Card never needs action", () => {
    assert.equal(deriveMyAction(card({ status: "Closed" })), null);
    assert.equal(deriveMyAction(card({ status: "Closed", can: managerCan })), null);
  });

  it("assigned but not started: start or record worker time", () => {
    const a = deriveMyAction(card({ workers: [notStarted], requirements: { workers: "present", materials: "present" } }));
    assert.deepEqual(a, { rank: 4, message: "Start or record worker time" });
  });

  it("materials to process / time waiting for the Manager are not Data Entry actions", () => {
    const done = card({ workers: [finished], requirements: { workers: "present", materials: "present" }, materialsNeedProcessing: true, pendingTimeReviews: 2 });
    assert.equal(deriveMyAction(done), null);
  });

  it("confirmed Not Required is not a missing decision", () => {
    const a = deriveMyAction(card({ requirements: { workers: "not_required", materials: "not_required" } }));
    assert.equal(a, null);
  });
});

describe("deriveMyAction — role permissions", () => {
  it("18. a viewer without the needed permission gets no action", () => {
    assert.equal(deriveMyAction(card({ can: noneCan })), null);
    assert.equal(deriveMyAction(card({ can: noneCan, workers: [paused], requirements: { workers: "present", materials: "present" } })), null);
    assert.equal(deriveMyAction(card({ can: noneCan, workers: [finished], closureReady: true })), null);
  });

  it("Manager: closure requests and time reviews are their action", () => {
    assert.deepEqual(deriveMyAction(card({ status: "Closure Requested", can: managerCan })), { rank: 1, message: "Review closure request" });
    const done = card({ can: managerCan, workers: [finished], requirements: { workers: "present", materials: "present" }, pendingTimeReviews: 1 });
    assert.deepEqual(deriveMyAction(done), { rank: 5, message: "Review worker time entries" });
    const materials = card({ can: managerCan, workers: [finished], requirements: { workers: "present", materials: "present" }, materialsNeedProcessing: true });
    assert.deepEqual(deriveMyAction(materials), { rank: 5, message: "Process materials" });
  });
});

describe("Needs My Action filter and count", () => {
  it("7. the count equals the rows the filter shows, and other counts do not change", () => {
    const inputs: MyActionInput[] = [
      base,
      card({ status: "Closure Requested", workers: [finished], closureReady: true }),
      card({ status: "Closed", workers: [finished] }),
      card({ workers: [finished], closureReady: true, requirements: { workers: "present", materials: "present" } }),
      card({ workers: [finished], requirements: { workers: "present", materials: "present" }, pendingTimeReviews: 1 }),
    ];
    const classified = inputs.map((i) =>
      classifyDailyActivity({
        status: i.status,
        workers: i.workers,
        closureReady: i.closureReady,
        materialsPending: false,
        needsMyAction: deriveMyAction(i) !== null,
      })
    );
    const summary = summarizeDailyActivity(classified);
    const shown = classified.filter((c) => matchesDailyActivityFilter(c, "needs-action")).length;
    assert.equal(summary.needsMyAction, shown);
    assert.equal(shown, 2);
    // Other counts are computed exactly as before.
    assert.equal(summary.open, 4);
    assert.equal(summary.waitingApproval, 1);
    assert.equal(summary.closed, 1);
    assert.equal(summary.readyToClose, 1);
  });

  it("a Closed card is never under Needs My Action even if flagged", () => {
    const c = classifyDailyActivity({ status: "Closed", workers: [], closureReady: false, materialsPending: false, needsMyAction: true });
    assert.equal(matchesDailyActivityFilter(c, "needs-action"), false);
  });
});
