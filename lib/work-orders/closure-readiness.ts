// Worker Timer and Closure Logic Hardening Unit 10G.53, Task 4.
//
// Client-safe (no "server-only"/prisma import — same convention as
// hours-variance.ts) single source of truth for "are this Job Card's workers
// ready for closure," used identically in four places: the real server-side
// guard (lib/backend/work-orders/service.ts's requestJobCardClosure), the
// Daily Activity board's per-card readiness chip/reasons, the Job Card
// detail page's Closure panel, and the Request Closure modal's own live
// checklist. All four call this with the same worker rows (already-fetched
// WorkerLaborRow-shaped data, never re-queried here) so they can never
// silently disagree about what blocks closure.
//
// Main business rule (unchanged across all four call sites): a Job Card can
// request closure only when every assigned worker is Finished. A Working or
// Paused worker always blocks — paused work is not completed work. A
// Not Started worker also blocks (the assignment exists but nothing was
// ever done against it) — the way out is exactly what the UI tells the user:
// finish that worker (Start then Finish Work) or remove the assignment from
// the roster. A Job Card with no assigned workers passes THIS check; whether
// "no workers" is acceptable is decided by checkClosureRequirements below
// (only once "No Workers Required" is confirmed).

import { deriveSimpleWorkerState, type SimpleWorkerState } from "@/lib/work-orders/hours-variance";

export type WorkerClosureInput = {
  workerAssignmentId: string;
  workerName: string;
  assignmentStatus: string;
  sessionStatus: string;
  // Minutes entered manually on this assignment. A worker with manual time
  // and no running/paused timer is still "Not Started" for the timer, but
  // the way out is only "mark work finished" — the reason says so.
  manualMinutes?: number;
};

export type WorkerClosureState = {
  workerAssignmentId: string;
  workerName: string;
  state: SimpleWorkerState;
};

export type WorkersClosureCheck = {
  ready: boolean;
  workers: WorkerClosureState[];
  workingWorkers: WorkerClosureState[];
  pausedWorkers: WorkerClosureState[];
  notStartedWorkers: WorkerClosureState[];
  // Ready-made, UI-facing reason strings — Task 4's exact wording, with
  // worker names appended so a blocker is immediately actionable, not just
  // "something is wrong." Empty when `ready` is true.
  reasons: string[];
};

export function checkWorkersReadyForClosure(workers: WorkerClosureInput[]): WorkersClosureCheck {
  const states: WorkerClosureState[] = workers.map((w) => ({
    workerAssignmentId: w.workerAssignmentId,
    workerName: w.workerName,
    state: deriveSimpleWorkerState(w.assignmentStatus, w.sessionStatus),
  }));

  const workingWorkers = states.filter((w) => w.state === "Working");
  const pausedWorkers = states.filter((w) => w.state === "Paused");
  const notStartedWorkers = states.filter((w) => w.state === "Not Started");
  const manualById = new Map(workers.map((w) => [w.workerAssignmentId, (w.manualMinutes ?? 0) > 0]));
  const manualNotFinished = notStartedWorkers.filter((w) => manualById.get(w.workerAssignmentId));
  const trulyNotStarted = notStartedWorkers.filter((w) => !manualById.get(w.workerAssignmentId));

  const reasons: string[] = [];
  if (workingWorkers.length) {
    reasons.push(`Worker still working: ${workingWorkers.map((w) => w.workerName).join(", ")}.`);
  }
  if (pausedWorkers.length) {
    reasons.push(`Worker paused - finish work before closure: ${pausedWorkers.map((w) => w.workerName).join(", ")}.`);
  }
  if (manualNotFinished.length) {
    reasons.push(`Manual time recorded - mark work finished before closure: ${manualNotFinished.map((w) => w.workerName).join(", ")}.`);
  }
  if (trulyNotStarted.length) {
    reasons.push(`Worker not started - finish or remove assignment before closure: ${trulyNotStarted.map((w) => w.workerName).join(", ")}.`);
  }

  return {
    ready: workingWorkers.length === 0 && pausedWorkers.length === 0 && notStartedWorkers.length === 0,
    workers: states,
    workingWorkers,
    pausedWorkers,
    notStartedWorkers,
    reasons,
  };
}

// ── Workers / materials requirement (No Workers / No Materials Required) ────
//
// Workers and materials are optional when a Job Card is created, but an
// empty list is never taken as "done": before closure each must be either
// present and complete, or explicitly confirmed as not required. Same rule
// on every surface (server guard in requestJobCardClosure, Daily Activity,
// Dashboard, Job Cards list, Job Card detail, closure modals), so no page
// can say "Ready" while another refuses.
//
//  - Workers:   satisfied when at least one worker is on the team and all are
//               Finished (checkWorkersReadyForClosure), OR no worker is on the
//               team and "No Workers Required" is confirmed.
//  - Materials: satisfied when the Job Card has materials and none is pending
//               (the caller's existing pending-request / not-fully-issued
//               checks, unchanged), OR it has none and "No Materials
//               Required" is confirmed.
// A confirmation is ignored once workers / materials exist — adding them
// supersedes it.

export type RequirementConfirmation = {
  confirmedByName: string | null;
  confirmedAt: string;
  reason: string | null;
};

export type RequirementState = "present" | "not_required" | "missing";

export type ClosureRequirementsInput = {
  workerCount: number;
  workersNotRequired: RequirementConfirmation | null;
  materialsPresent: boolean;
  materialsNotRequired: RequirementConfirmation | null;
};

export type ClosureRequirementsCheck = {
  workers: RequirementState;
  materials: RequirementState;
  // Active confirmations only (null once superseded by real workers/materials).
  workersConfirmation: RequirementConfirmation | null;
  materialsConfirmation: RequirementConfirmation | null;
  // Missing workers/materials only — worker progress and pending materials
  // keep their own existing checks and reasons.
  reasons: string[];
  // Neither requirement is missing. Callers AND this with their existing checks.
  ready: boolean;
};

export const NO_WORKERS_REASON = "No workers assigned - assign workers or confirm No Workers Required.";
export const NO_MATERIALS_REASON = "No materials added - add materials or confirm No Materials Required.";

export function checkClosureRequirements(input: ClosureRequirementsInput): ClosureRequirementsCheck {
  const workers: RequirementState = input.workerCount > 0 ? "present" : input.workersNotRequired ? "not_required" : "missing";
  const materials: RequirementState = input.materialsPresent ? "present" : input.materialsNotRequired ? "not_required" : "missing";
  const reasons: string[] = [];
  if (workers === "missing") reasons.push(NO_WORKERS_REASON);
  if (materials === "missing") reasons.push(NO_MATERIALS_REASON);
  return {
    workers,
    materials,
    workersConfirmation: workers === "not_required" ? input.workersNotRequired : null,
    materialsConfirmation: materials === "not_required" ? input.materialsNotRequired : null,
    reasons,
    ready: reasons.length === 0,
  };
}
