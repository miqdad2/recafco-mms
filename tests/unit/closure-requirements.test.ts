// Workers / materials requirement before closure (No Workers / No Materials
// Required) and its effect on the Daily Activity "Ready to Close" bucket.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  NO_MATERIALS_REASON,
  NO_WORKERS_REASON,
  checkClosureRequirements,
  type RequirementConfirmation,
} from "@/lib/work-orders/closure-readiness";
import { classifyDailyActivity } from "@/lib/work-orders/daily-activity-status";

const confirmed: RequirementConfirmation = { confirmedByName: "Data Entry", confirmedAt: "2026-10-28T09:00:00.000Z", reason: "Inspection only" };
const base = { workerCount: 0, workersNotRequired: null, materialsPresent: false, materialsNotRequired: null };

describe("checkClosureRequirements", () => {
  it("1. no workers and no materials: both missing, not ready", () => {
    const c = checkClosureRequirements(base);
    assert.equal(c.workers, "missing");
    assert.equal(c.materials, "missing");
    assert.deepEqual(c.reasons, [NO_WORKERS_REASON, NO_MATERIALS_REASON]);
    assert.equal(c.ready, false);
  });

  it("2. workers only: materials still missing", () => {
    const c = checkClosureRequirements({ ...base, workerCount: 2 });
    assert.equal(c.workers, "present");
    assert.deepEqual(c.reasons, [NO_MATERIALS_REASON]);
    assert.equal(c.ready, false);
  });

  it("3. materials only: workers still missing", () => {
    const c = checkClosureRequirements({ ...base, materialsPresent: true });
    assert.equal(c.materials, "present");
    assert.deepEqual(c.reasons, [NO_WORKERS_REASON]);
    assert.equal(c.ready, false);
  });

  it("4. both present: requirement satisfied (progress checks stay with the caller)", () => {
    const c = checkClosureRequirements({ ...base, workerCount: 1, materialsPresent: true });
    assert.equal(c.ready, true);
    assert.deepEqual(c.reasons, []);
  });

  it("5. workers confirmed Not Required", () => {
    const c = checkClosureRequirements({ ...base, workersNotRequired: confirmed, materialsPresent: true });
    assert.equal(c.workers, "not_required");
    assert.equal(c.workersConfirmation, confirmed);
    assert.equal(c.ready, true);
  });

  it("6. materials confirmed Not Required", () => {
    const c = checkClosureRequirements({ ...base, workerCount: 1, materialsNotRequired: confirmed });
    assert.equal(c.materials, "not_required");
    assert.equal(c.materialsConfirmation, confirmed);
    assert.equal(c.ready, true);
  });

  it("7. both confirmed Not Required", () => {
    const c = checkClosureRequirements({ ...base, workersNotRequired: confirmed, materialsNotRequired: confirmed });
    assert.equal(c.ready, true);
  });

  it("8. workers assigned after Not Required: the confirmation no longer applies", () => {
    const c = checkClosureRequirements({ ...base, workerCount: 1, workersNotRequired: confirmed, materialsNotRequired: confirmed });
    assert.equal(c.workers, "present");
    assert.equal(c.workersConfirmation, null);
  });

  it("9. materials added after Not Required: the confirmation no longer applies", () => {
    const c = checkClosureRequirements({ ...base, workersNotRequired: confirmed, materialsPresent: true, materialsNotRequired: confirmed });
    assert.equal(c.materials, "present");
    assert.equal(c.materialsConfirmation, null);
  });
});

describe("Daily Activity Ready to Close with no workers", () => {
  const card = { status: "Materials Issued", workers: [], materialsPending: false };

  it("an empty team is never Ready to Close unless No Workers Required is confirmed", () => {
    assert.equal(classifyDailyActivity({ ...card, closureReady: true }).isReadyToClose, false);
    assert.equal(classifyDailyActivity({ ...card, closureReady: false, workersNotRequired: true }).isReadyToClose, false);
    const ready = classifyDailyActivity({ ...card, closureReady: true, workersNotRequired: true });
    assert.equal(ready.isReadyToClose, true);
    assert.equal(ready.plainStatus.label, "Ready to Close");
  });

  it("a confirmed no-worker card is not counted as Not Started", () => {
    const c = classifyDailyActivity({ ...card, closureReady: false, workersNotRequired: true });
    assert.equal(c.isNotStarted, false);
    assert.equal(c.plainStatus.label, "No Workers Needed");
  });

  it("the confirmation is ignored once workers exist", () => {
    const c = classifyDailyActivity({
      ...card,
      workers: [{ assignmentStatus: "active", sessionStatus: "Not Started" }],
      closureReady: false,
      workersNotRequired: true,
    });
    assert.equal(c.isNotStarted, true);
  });
});
