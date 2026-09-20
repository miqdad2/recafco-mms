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
// the roster. A Job Card with no assigned workers at all is unaffected by
// this check (the caller's own materials/other guards still apply) — Task 4:
// "If no workers are assigned: use current business behavior."

import { deriveSimpleWorkerState, type SimpleWorkerState } from "@/lib/work-orders/hours-variance";

export type WorkerClosureInput = {
  workerAssignmentId: string;
  workerName: string;
  assignmentStatus: string;
  sessionStatus: string;
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

  const reasons: string[] = [];
  if (workingWorkers.length) {
    reasons.push(`Worker still working: ${workingWorkers.map((w) => w.workerName).join(", ")}.`);
  }
  if (pausedWorkers.length) {
    reasons.push(`Worker paused - finish work before closure: ${pausedWorkers.map((w) => w.workerName).join(", ")}.`);
  }
  if (notStartedWorkers.length) {
    reasons.push(`Worker not started - finish or remove assignment before closure: ${notStartedWorkers.map((w) => w.workerName).join(", ")}.`);
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
