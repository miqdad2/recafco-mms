// Edit Assignment rules (client-safe, pure).
//
// A Job Card has two separate assignment records:
// - the Internal Team roster (work_order_worker_assignments): Supervisor,
//   Technicians and Helpers from Worker Profiles, who carry worker time;
// - Assign Work (work_order_assignments): one login technician, Freelancer or
//   Company. Saving replaces that record and can move the Job Card to Assigned.
// The popup saves one of them at a time.

import type { CurrentUserContext } from "@/lib/auth/context";
import { deriveSimpleWorkerState } from "@/lib/work-orders/hours-variance";

export const EDIT_ASSIGNMENT_SUBTITLE = "Choose who will carry out the work on this Job Card.";

export type AssignmentTab = "internal" | "freelancer" | "company";

export type RosterEntry = {
  worker_id: string;
  worker_role: string;
  // Why this worker cannot be taken off the Job Card; null when they can.
  lock: string | null;
};

export type EditAssignmentRosterRow = RosterEntry & {
  name: string;
  estimated_hours: number | null;
  notes: string | null;
};

export type EditAssignmentCurrent = {
  type: string;
  technicianId: string | null;
  technicianName: string | null;
  externalName: string | null;
  externalCompany: string | null;
  contactPerson: string | null;
  phone: string | null;
  trade: string | null;
  visitDate: string | null;
  notes: string | null;
  // Only sent to viewers who may see costs.
  agreedAmount: number | null;
  hasAgreedAmount: boolean;
} | null;

export type AssignmentWorker = { id: string; name: string; worker_type: string; is_active: boolean; hourly_rate: number | null };

export type EditAssignmentData = {
  workOrderId: string;
  status: string;
  workers: AssignmentWorker[];
  roster: EditAssignmentRosterRow[];
  current: EditAssignmentCurrent;
  canViewCosts: boolean;
  canManageRoster: boolean;
  canAssign: boolean;
};

/**
 * Who may change what, right now. Freelancer and Company follow the assignment
 * step of the workflow; the Internal Team stays editable until the Job Card is
 * Closed. The save actions check their own permissions on the server.
 */
export function assignmentGates(
  context: CurrentUserContext,
  status: string,
  facts: { hasPendingCorrection: boolean; hasActiveMaterialsRequest: boolean }
) {
  const superAdmin = context.role?.slug === "super_admin";
  const can = (permission: "work_orders.approve" | "work_orders.assign") => superAdmin || context.permissions.includes(permission);
  const manager = superAdmin || context.role?.slug === "maintenance_manager";
  return {
    canAssign:
      !facts.hasPendingCorrection &&
      (can("work_orders.approve") || can("work_orders.assign")) &&
      ["Approved", "Partially Issued", "Materials Issued", "Assigned", "In Progress"].includes(status) &&
      (status === "Assigned" || status === "In Progress" || !facts.hasActiveMaterialsRequest),
    canManageRoster: !facts.hasPendingCorrection && (can("work_orders.assign") || manager) && status !== "Closed",
  };
}

/**
 * A worker with recorded work stays on the Job Card: their hours and any
 * running timer only count while the assignment is on the team. The server
 * refuses the same removal (worker-roster.ts).
 */
export function rosterLockReason(assignmentStatus: string, sessionStatus: string, totalMinutes: number): string | null {
  const state = deriveSimpleWorkerState(assignmentStatus, sessionStatus);
  if (state === "Finished") return "Finished";
  if (state === "Working") return "Working now";
  if (state === "Paused") return "Paused";
  if (sessionStatus !== "Not Started" || totalMinutes > 0) return "Time recorded";
  return null;
}

/** Opens on the existing assignment type, otherwise Internal Team. */
export function initialAssignmentTab(type: string | null | undefined, allowed: { internal: boolean; external: boolean }): AssignmentTab {
  if (allowed.external && type === "FREELANCER") return "freelancer";
  if (allowed.external && type === "EXTERNAL_COMPANY") return "company";
  return allowed.internal ? "internal" : allowed.external ? "freelancer" : "internal";
}

/** Workers on the saved roster that the current selection leaves out. */
export function workersBeingRemoved(roster: RosterEntry[], selectedIds: Iterable<string>): RosterEntry[] {
  const selected = new Set(selectedIds);
  return roster.filter((r) => !selected.has(r.worker_id));
}

/** Text a worker list is searched by: every word typed must appear in the name. */
export function matchesWorkerSearch(name: string, search: string): boolean {
  const lower = name.toLowerCase();
  return search.toLowerCase().split(/\s+/).filter(Boolean).every((word) => lower.includes(word));
}
