// Daily Activity Status Accuracy unit tests — run with `npm run test:unit`.
// The summary cards and the list filter both go through these functions, so
// "count N" must always mean "clicking shows N rows".
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyDailyActivity,
  kuwaitDayRange,
  matchesDailyActivityFilter,
  summarizeDailyActivity,
  DAILY_ACTIVITY_STATUS_FILTERS,
  type DailyActivityInput,
} from "@/lib/work-orders/daily-activity-status";

const notStarted = { assignmentStatus: "active", sessionStatus: "Not Started" };
const working = { assignmentStatus: "active", sessionStatus: "Active" };
const paused = { assignmentStatus: "active", sessionStatus: "Paused" };
// Resumed after an earlier pause: latest state is a running session.
const resumed = working;
// Finish Work from a paused state: assignment finished, last session row
// still "Paused" — the exact data shape behind the original miscount.
const finishedFromPaused = { assignmentStatus: "finished", sessionStatus: "Paused" };
const finished = { assignmentStatus: "finished", sessionStatus: "Completed" };

function card(overrides: Partial<DailyActivityInput>): DailyActivityInput {
  return { status: "In Progress", workers: [], closureReady: false, materialsPending: false, ...overrides };
}

function listFor(inputs: DailyActivityInput[]) {
  return inputs.map(classifyDailyActivity);
}

describe("classifyDailyActivity — Paused", () => {
  it("does not count a worker finished from a paused state as paused", () => {
    const c = classifyDailyActivity(card({ status: "Closure Requested", workers: [finishedFromPaused, finishedFromPaused], closureReady: true }));
    assert.equal(c.isPaused, false);
    assert.equal(c.pausedWorkers, 0);
    assert.equal(c.isWaitingApproval, true);
  });

  it("counts one Job Card (two workers) when two workers are paused on the same card", () => {
    const s = summarizeDailyActivity(listFor([card({ workers: [paused, paused] })]));
    assert.equal(s.paused, 1);
    assert.equal(s.workersPaused, 2);
  });

  it("does not count a resumed worker as paused", () => {
    const c = classifyDailyActivity(card({ workers: [resumed] }));
    assert.equal(c.isPaused, false);
    assert.equal(c.isWorking, true);
  });

  // Paused Workers Count Fix: the Paused filter lists every Job Card that
  // contains a currently paused worker (the dashboard's Paused Workers card
  // links here), so this card is under BOTH Working Now and Paused; its own
  // label still reads "Working Now".
  it("lists a card with one worker working and one paused under Paused too, labelled Working Now", () => {
    const c = classifyDailyActivity(card({ workers: [working, paused] }));
    assert.equal(c.isWorking, true);
    assert.equal(c.isPaused, true);
    assert.equal(c.pausedWorkers, 1);
    assert.equal(c.plainStatus.label, "Working Now");
  });
});

describe("classifyDailyActivity — each state", () => {
  it("open not-started card", () => {
    const c = classifyDailyActivity(card({ status: "Approved", closureReady: true }));
    assert.equal(c.isNotStarted, true);
    // No worker has finished anything, so it is not "Ready to Close".
    assert.equal(c.isReadyToClose, false);
    assert.equal(c.plainStatus.label, "Not Started");
  });

  it("ready to close needs finished workers and closure readiness", () => {
    assert.equal(classifyDailyActivity(card({ workers: [finished], closureReady: true })).isReadyToClose, true);
    assert.equal(classifyDailyActivity(card({ workers: [finished], closureReady: false })).isReadyToClose, false);
  });

  it("closure requested is Waiting for Approval only, not Ready to Close", () => {
    const c = classifyDailyActivity(card({ status: "Closure Requested", workers: [finished], closureReady: true }));
    assert.equal(c.isWaitingApproval, true);
    assert.equal(c.isReadyToClose, false);
    assert.equal(matchesDailyActivityFilter(c, "all"), true);
  });

  it("closed card appears only under Closed, never as active", () => {
    const c = classifyDailyActivity(card({ status: "Closed", workers: [finished], closureReady: true }));
    for (const f of DAILY_ACTIVITY_STATUS_FILTERS) {
      assert.equal(matchesDailyActivityFilter(c, f), f === "closed", `filter ${f}`);
    }
    assert.equal(c.plainStatus.label, "Closed");
  });

  it("a card returned to work (back to an active status) is active again", () => {
    // No reject/return transition exists today; this guards the display rule
    // if one is added: classification follows the current stored status.
    const c = classifyDailyActivity(card({ status: "In Progress", workers: [working] }));
    assert.equal(c.isWaitingApproval, false);
    assert.equal(c.isWorking, true);
  });
});

describe("summary counts match the filtered list", () => {
  const scoped = listFor([
    card({ status: "Approved" }), // not started
    card({ workers: [working] }),
    card({ workers: [paused] }),
    card({ workers: [paused, paused] }),
    card({ workers: [resumed, finished] }),
    card({ workers: [finished], closureReady: true }),
    card({ status: "Closure Requested", workers: [finishedFromPaused, finishedFromPaused], closureReady: true }),
    card({ status: "Closed", workers: [finished], closureReady: true }),
    card({ workers: [notStarted], materialsPending: true }),
  ]);
  const s = summarizeDailyActivity(scoped);
  const listLength = (f: (typeof DAILY_ACTIVITY_STATUS_FILTERS)[number]) => scoped.filter((c) => matchesDailyActivityFilter(c, f)).length;

  it("every summary card equals its filter's row count", () => {
    assert.equal(s.open, listLength("all"));
    assert.equal(s.working, listLength("working"));
    assert.equal(s.paused, listLength("paused"));
    assert.equal(s.readyToClose, listLength("ready-closure"));
    assert.equal(s.waitingApproval, listLength("waiting-approval"));
    assert.equal(s.closed, listLength("closed"));
  });

  it("produces the expected distinct Job Card counts", () => {
    assert.deepEqual(
      { open: s.open, working: s.working, paused: s.paused, ready: s.readyToClose, waiting: s.waitingApproval, closed: s.closed },
      { open: 8, working: 2, paused: 2, ready: 1, waiting: 1, closed: 1 }
    );
    assert.equal(s.workersWorking, 2);
    assert.equal(s.workersPaused, 3);
  });

  it("an empty scope counts zero everywhere", () => {
    const empty = summarizeDailyActivity([]);
    assert.deepEqual(Object.values(empty), [0, 0, 0, 0, 0, 0, 0, 0]);
  });
});

describe("kuwaitDayRange", () => {
  it("starts at 00:00 Kuwait (21:00 UTC the previous day)", () => {
    const { start, end } = kuwaitDayRange(new Date("2026-10-26T10:00:00Z"));
    assert.equal(start.toISOString(), "2026-10-25T21:00:00.000Z");
    assert.equal(end.toISOString(), "2026-10-26T21:00:00.000Z");
  });

  it("rolls over exactly at Kuwait midnight", () => {
    assert.equal(kuwaitDayRange(new Date("2026-10-26T20:59:59.999Z")).start.toISOString(), "2026-10-25T21:00:00.000Z");
    assert.equal(kuwaitDayRange(new Date("2026-10-26T21:00:00.000Z")).start.toISOString(), "2026-10-26T21:00:00.000Z");
  });

  it("23:30 UTC is already the next Kuwait day", () => {
    assert.equal(kuwaitDayRange(new Date("2026-10-26T23:30:00Z")).start.toISOString(), "2026-10-26T21:00:00.000Z");
  });
});
