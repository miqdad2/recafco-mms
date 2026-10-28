// Currently paused work — the one definition behind the dashboards' Paused
// Workers card and the Daily Activity Paused filter. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCurrentlyPaused, summarizePausedWork, timerStateOf } from "@/lib/work-orders/paused-work";

const p = (status: string, started: string, manual = false) => ({ status, is_manual_entry: manual, started_at: started });

describe("timerStateOf", () => {
  it("latest timer period decides; manual and cancelled periods are ignored", () => {
    assert.equal(timerStateOf([p("Paused", "2026-10-27T05:00:00Z")]), "Paused");
    assert.equal(timerStateOf([p("Paused", "2026-10-27T05:00:00Z"), p("Completed", "2026-10-27T07:00:00Z")]), "Completed");
    assert.equal(timerStateOf([p("Paused", "2026-10-27T05:00:00Z"), p("Active", "2026-10-27T07:00:00Z")]), "Active");
    assert.equal(timerStateOf([p("Completed", "2026-10-27T09:00:00Z", true)]), "Not Started");
    assert.equal(timerStateOf([p("Paused", "2026-10-27T05:00:00Z"), p("Completed", "2026-10-27T09:00:00Z", true)]), "Paused");
    assert.equal(timerStateOf([p("Cancelled", "2026-10-27T09:00:00Z")]), "Not Started");
  });
});

describe("isCurrentlyPaused", () => {
  it("a worker finished from a paused state is not paused (the original miscount)", () => {
    assert.equal(isCurrentlyPaused("finished", "Paused"), false);
    assert.equal(isCurrentlyPaused("active", "Paused"), true);
    assert.equal(isCurrentlyPaused("active", "Active"), false);
  });
});

describe("summarizePausedWork", () => {
  const row = (workOrderId: string, workerId: string, timerState: string, assignmentStatus = "active") => ({ workOrderId, workerId, assignmentStatus, timerState });

  it("two paused workers on one Job Card → 2 workers / 1 card", () => {
    const s = summarizePausedWork([row("jc1", "w1", "Paused"), row("jc1", "w2", "Paused")]);
    assert.equal(s.pausedWorkers, 2);
    assert.equal(s.pausedJobCards, 1);
  });

  it("two paused workers on separate Job Cards → 2 / 2", () => {
    const s = summarizePausedWork([row("jc1", "w1", "Paused"), row("jc2", "w2", "Paused")]);
    assert.deepEqual([s.pausedWorkers, s.pausedJobCards], [2, 2]);
  });

  it("a worker paused on two cards counts once", () => {
    const s = summarizePausedWork([row("jc1", "w1", "Paused"), row("jc2", "w1", "Paused")]);
    assert.deepEqual([s.pausedWorkers, s.pausedJobCards], [1, 2]);
  });

  it("a worker working elsewhere is not a paused worker, but the paused card still counts", () => {
    const s = summarizePausedWork([row("jc1", "w1", "Paused"), row("jc2", "w1", "Active")]);
    assert.deepEqual([s.pausedWorkers, s.pausedJobCards], [0, 1]);
  });

  it("finished-from-paused and manual-only workers are not counted", () => {
    const s = summarizePausedWork([row("jc1", "w1", "Paused", "finished"), row("jc2", "w2", "Not Started")]);
    assert.deepEqual([s.pausedWorkers, s.pausedJobCards], [0, 0]);
  });
});
