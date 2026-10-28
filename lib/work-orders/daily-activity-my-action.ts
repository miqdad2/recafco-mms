// Daily Activity "Needs My Action".
//
// Client-safe (no "server-only"/prisma import — same convention as
// daily-activity-status.ts). Decides whether a Job Card needs an action THIS
// viewer is allowed to take, which one, and how urgent it is — from the same
// inputs the page already uses to show the panel's buttons (closure readiness
// from the shared closure rules, worker states via deriveSimpleWorkerState,
// workers/materials requirements via checkClosureRequirements, and the
// viewer's existing permission flags). Nothing here re-decides readiness, so
// the filter, its count, the list message and the panel buttons agree.
//
// Rank (lower first): 1 Ready to Close · 2 paused / active work · 3 missing
// worker or material decision (and a returned closure request) · 4 not
// started · 5 other (materials to process, time waiting for the Manager).

import { deriveSimpleWorkerState } from "@/lib/work-orders/hours-variance";
import type { RequirementState } from "@/lib/work-orders/closure-readiness";

export type MyActionRank = 1 | 2 | 3 | 4 | 5;
export type MyAction = { rank: MyActionRank; message: string };

export type MyActionInput = {
  status: string;
  // The page's shared closure readiness (materials, workers finished,
  // workers/materials requirement, no time waiting for the Manager).
  closureReady: boolean;
  workers: { assignmentStatus: string; sessionStatus: string; manualMinutes?: number }[];
  requirements: { workers: RequirementState; materials: RequirementState };
  // Required materials still to receive / issue on this Job Card.
  materialsNeedProcessing: boolean;
  // The last closure decision was "Closure Returned" (Manager sent it back).
  closureReturned: boolean;
  pendingTimeReviews: number;
  can: {
    requestClosure: boolean;
    manageSessions: boolean;
    assignWorkers: boolean;
    addMaterials: boolean;
    confirmNotRequired: boolean;
    processMaterials: boolean;
    reviewClosure: boolean;
    reviewTime: boolean;
  };
};

export function deriveMyAction(input: MyActionInput): MyAction | null {
  const { can } = input;
  if (input.status === "Closed") return null;
  if (input.status === "Closure Requested") {
    // Only the Manager has anything to do here; Data Entry waits.
    return can.reviewClosure ? { rank: 1, message: "Review closure request" } : null;
  }

  const states = input.workers.map((w) => deriveSimpleWorkerState(w.assignmentStatus, w.sessionStatus));
  const working = states.filter((s) => s === "Working").length;
  const paused = states.filter((s) => s === "Paused").length;
  const manualNotFinished = input.workers.filter((w, i) => states[i] === "Not Started" && (w.manualMinutes ?? 0) > 0).length;
  const notStarted = states.filter((s) => s === "Not Started").length - manualNotFinished;

  if (input.closureReady && can.requestClosure) {
    return { rank: 1, message: input.closureReturned ? "Check the return remarks, then request closure" : "Request closure" };
  }
  if (can.manageSessions) {
    if (paused > 0) return { rank: 2, message: "Resume or finish paused work" };
    if (working > 0) return { rank: 2, message: "Finish worker time when the work is done" };
    if (manualNotFinished > 0) return { rank: 2, message: "Mark worker time finished" };
  }
  if (input.closureReturned) return { rank: 3, message: "Review the Manager's return remarks" };

  const fixWorkers = input.requirements.workers === "missing" && (can.assignWorkers || can.confirmNotRequired);
  const fixMaterials = input.requirements.materials === "missing" && (can.addMaterials || can.confirmNotRequired);
  if (fixWorkers && fixMaterials) return { rank: 3, message: "Add workers and materials, or confirm not required" };
  if (fixWorkers) return { rank: 3, message: "Assign workers or confirm not required" };
  if (fixMaterials) return { rank: 3, message: "Add materials or confirm not required" };

  if (notStarted > 0 && can.manageSessions) return { rank: 4, message: "Start or record worker time" };
  if (input.materialsNeedProcessing && can.processMaterials) return { rank: 5, message: "Process materials" };
  if (input.pendingTimeReviews > 0 && can.reviewTime) return { rank: 5, message: "Review worker time entries" };
  return null;
}
