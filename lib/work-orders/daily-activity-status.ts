// Daily Activity Status Accuracy Unit.
//
// Client-safe (no "server-only"/prisma import — same convention as
// closure-readiness.ts) single source of truth for which Daily Activity
// status bucket(s) a Job Card belongs to. The summary cards and the list
// filter tabs BOTH call classifyDailyActivity() + matchesDailyActivityFilter()
// over the same scoped rows, so a summary count and the list it filters to
// can no longer disagree.
//
// Root cause this replaces: the old "Paused" summary counted raw worker
// session rows whose latest status was "Paused". Finish Work from a paused
// state (finishWorkSession) marks the ASSIGNMENT "finished" but leaves that
// last session row as "Paused" — so finished workers kept inflating the
// Paused count, while the filter (correctly) treated them as Finished and
// showed nothing. Worker state here always goes through
// deriveSimpleWorkerState(), which checks the assignment first.
//
// Status definitions (display buckets only — no database value or
// workflow transition is changed by any of this):
//  - Closed:               status === "Closed".
//  - Waiting for Approval: status === "Closure Requested".
//  - Working Now:          not Closed, at least one worker currently Working.
//  - Paused:               not Closed, at least one worker currently Paused and
//                          nobody Working (same rule as the existing work-time
//                          chip, so the row's own label always agrees).
//  - Ready to Close:       not Closed / not already requested, the existing
//                          closure-readiness check passes, and at least one
//                          worker exists (so every worker is Finished — work
//                          is actually done, not just never started).
//  - Not Started:          not Closed / not requested, nobody Working/Paused,
//                          and at least one worker (or the whole team) has not
//                          started — the existing work-time chip rule.
//  - Materials Pending:    not Closed, the materials chip reads "Materials
//                          Pending".
// Buckets may overlap (e.g. Waiting for Approval + Working when a worker was
// resumed after the request); they are not meant to sum to Open.

import { deriveSimpleWorkerState } from "@/lib/work-orders/hours-variance";

export const DAILY_ACTIVITY_STATUS_FILTERS = [
  "all",
  "working",
  "paused",
  "ready-closure",
  "waiting-approval",
  "closed",
  "materials-pending",
  "not-started",
] as const;
export type DailyActivityStatusFilter = (typeof DAILY_ACTIVITY_STATUS_FILTERS)[number];

export function parseDailyActivityStatusFilter(value: string | undefined): DailyActivityStatusFilter {
  return DAILY_ACTIVITY_STATUS_FILTERS.includes((value ?? "all") as DailyActivityStatusFilter)
    ? ((value ?? "all") as DailyActivityStatusFilter)
    : "all";
}

export type DailyActivityTone = "green" | "amber" | "red" | "blue" | "gray";

export type DailyActivityPlainStatus = {
  label: string;
  description: string;
  tone: DailyActivityTone;
};

export type DailyActivityInput = {
  status: string;
  // manualMinutes: hours entered manually on the assignment. A worker with
  // manual time and no timer running/paused is "Manual Time Recorded" (not
  // finished yet), not "Not Started".
  workers: { assignmentStatus: string; sessionStatus: string; manualMinutes?: number }[];
  // The existing closure-readiness result (no pending Materials Request,
  // required materials fully issued, every worker Finished).
  closureReady: boolean;
  materialsPending: boolean;
};

export type DailyActivityClassification = {
  isClosed: boolean;
  isWaitingApproval: boolean;
  isWorking: boolean;
  isPaused: boolean;
  isReadyToClose: boolean;
  isNotStarted: boolean;
  isMaterialsPending: boolean;
  workingWorkers: number;
  pausedWorkers: number;
  plainStatus: DailyActivityPlainStatus;
};

export function classifyDailyActivity(input: DailyActivityInput): DailyActivityClassification {
  const states = input.workers.map((w) => deriveSimpleWorkerState(w.assignmentStatus, w.sessionStatus));
  const workingWorkers = states.filter((s) => s === "Working").length;
  const pausedWorkers = states.filter((s) => s === "Paused").length;
  const manualOnlyWorkers = input.workers.filter((w, i) => states[i] === "Not Started" && (w.manualMinutes ?? 0) > 0).length;
  const notStartedWorkers = states.filter((s) => s === "Not Started").length - manualOnlyWorkers;
  const finishedWorkers = states.filter((s) => s === "Finished").length;

  const isClosed = input.status === "Closed";
  const isWaitingApproval = input.status === "Closure Requested";
  const isOpenForWork = !isClosed && !isWaitingApproval;

  const isWorking = !isClosed && workingWorkers > 0;
  // Paused filter / count: Job Cards with at least one CURRENTLY paused worker
  // (lib/work-orders/paused-work.ts — the same definition the dashboards
  // count), even if another worker on the card is working. The card's own
  // label still reads "Working Now" in that case (see plainStatus below).
  const isPaused = !isClosed && pausedWorkers > 0;
  const isReadyToClose = isOpenForWork && input.closureReady && states.length > 0;
  const isNotStarted = isOpenForWork && workingWorkers === 0 && pausedWorkers === 0 && (states.length === 0 || notStartedWorkers > 0);
  const isMaterialsPending = !isClosed && input.materialsPending;

  let plainStatus: DailyActivityPlainStatus;
  if (isClosed) plainStatus = { label: "Closed", description: "Job Card closed.", tone: "gray" };
  else if (isWaitingApproval) plainStatus = { label: "Waiting for Approval", description: "Closure request sent to manager.", tone: "amber" };
  else if (isWorking) plainStatus = { label: "Working Now", description: "A worker is currently working.", tone: "green" };
  else if (isPaused && workingWorkers === 0) plainStatus = { label: "Paused", description: "Work has been paused.", tone: "amber" };
  else if (isReadyToClose) plainStatus = { label: "Ready to Close", description: "Work is finished.", tone: "blue" };
  else if (manualOnlyWorkers > 0 && notStartedWorkers === 0)
    plainStatus = { label: "Manual Time Recorded", description: "Hours were entered manually. Mark the work finished.", tone: "blue" };
  else if (states.length > 0 && notStartedWorkers === 0) plainStatus = { label: "Work Finished", description: "Complete materials before closing.", tone: "blue" };
  else if (finishedWorkers > 0) plainStatus = { label: "Partly Done", description: "Some workers have not started yet.", tone: "gray" };
  else plainStatus = { label: "Not Started", description: "Work has not started.", tone: "gray" };

  return {
    isClosed,
    isWaitingApproval,
    isWorking,
    isPaused,
    isReadyToClose,
    isNotStarted,
    isMaterialsPending,
    workingWorkers: isClosed ? 0 : workingWorkers,
    pausedWorkers: isClosed ? 0 : pausedWorkers,
    plainStatus,
  };
}

export function matchesDailyActivityFilter(c: DailyActivityClassification, filter: DailyActivityStatusFilter): boolean {
  switch (filter) {
    case "all":
      return !c.isClosed;
    case "working":
      return c.isWorking;
    case "paused":
      return c.isPaused;
    case "ready-closure":
      return c.isReadyToClose;
    case "waiting-approval":
      return c.isWaitingApproval;
    case "closed":
      return c.isClosed;
    case "materials-pending":
      return c.isMaterialsPending;
    case "not-started":
      return c.isNotStarted;
  }
}

export type DailyActivitySummary = {
  open: number;
  working: number;
  paused: number;
  readyToClose: number;
  waitingApproval: number;
  closed: number;
  // Worker headcounts — shown only as a secondary line under the Job Card
  // count, never as the card's main number.
  workersWorking: number;
  workersPaused: number;
};

export function summarizeDailyActivity(items: DailyActivityClassification[]): DailyActivitySummary {
  const count = (filter: DailyActivityStatusFilter) => items.filter((c) => matchesDailyActivityFilter(c, filter)).length;
  return {
    open: count("all"),
    working: count("working"),
    paused: count("paused"),
    readyToClose: count("ready-closure"),
    waitingApproval: count("waiting-approval"),
    closed: count("closed"),
    workersWorking: items.reduce((n, c) => n + c.workingWorkers, 0),
    workersPaused: items.reduce((n, c) => n + c.pausedWorkers, 0),
  };
}

// Kuwait is UTC+3 all year (no DST), so the Kuwait calendar day is a fixed
// 24h window: [00:00 Kuwait, next 00:00 Kuwait), returned as UTC instants.
const KUWAIT_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function kuwaitDayRange(now: Date): { start: Date; end: Date } {
  const kuwaitMidnightAsUtc = Math.floor((now.getTime() + KUWAIT_OFFSET_MS) / DAY_MS) * DAY_MS;
  const start = new Date(kuwaitMidnightAsUtc - KUWAIT_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}
