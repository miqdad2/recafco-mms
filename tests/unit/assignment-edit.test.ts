// Edit Assignment rules: who may be taken off a Job Card, and which tab opens.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { countedWorkers, isOverseeingSupervisor } from "@/lib/work-orders/closure-readiness";
import { assignmentGates, initialAssignmentTab, matchesWorkerSearch, rosterLockReason, workersBeingRemoved } from "@/lib/work-orders/assignment-edit";

describe("Workers who stay on the Job Card", () => {
  it("locks finished, working and paused workers", () => {
    assert.equal(rosterLockReason("finished", "Completed", 96), "Finished");
    assert.equal(rosterLockReason("finished", "Paused", 30), "Finished");
    assert.equal(rosterLockReason("active", "Active", 0), "Working now");
    assert.equal(rosterLockReason("active", "Paused", 30), "Paused");
  });

  it("locks a worker with manual time or a stopped timer, even at zero minutes", () => {
    assert.equal(rosterLockReason("active", "Not Started", 60), "Time recorded");
    assert.equal(rosterLockReason("active", "Completed", 0), "Time recorded");
  });

  it("allows removing only a worker with nothing recorded", () => {
    assert.equal(rosterLockReason("active", "Not Started", 0), null);
  });
});

describe("Supervisor is separate from worker time", () => {
  const row = (worker_role: string, status = "Not Started", total_minutes = 0, assignment_status = "active") => ({ worker_role, status, total_minutes, assignment_status });

  it("an overseeing Supervisor is not a worker", () => {
    assert.equal(isOverseeingSupervisor(row("Supervisor")), true);
    assert.deepEqual(countedWorkers([row("Supervisor"), row("Technician"), row("Helper/Labor")]).map((w) => w.worker_role), ["Technician", "Helper/Labor"]);
  });

  it("a Supervisor with work recorded counts", () => {
    assert.equal(isOverseeingSupervisor(row("Supervisor", "Active")), false);
    assert.equal(isOverseeingSupervisor(row("Supervisor", "Paused", 30)), false);
    assert.equal(isOverseeingSupervisor(row("Supervisor", "Completed")), false);
    assert.equal(isOverseeingSupervisor(row("Supervisor", "Not Started", 60)), false, "manual time");
    assert.equal(isOverseeingSupervisor(row("Supervisor", "Completed", 96, "finished")), false);
  });

  it("an unstarted Technician or Helper always counts", () => {
    assert.equal(isOverseeingSupervisor(row("Technician")), false);
    assert.equal(isOverseeingSupervisor(row("Helper/Labor")), false);
  });
});

describe("Who may edit the assignment", () => {
  const ctx = (slug: string, permissions: string[] = []) => ({ role: { slug }, permissions }) as unknown as Parameters<typeof assignmentGates>[0];
  const open = { hasPendingCorrection: false, hasActiveMaterialsRequest: false };

  it("Data Entry with assign permission can do both on an open card", () => {
    assert.deepEqual(assignmentGates(ctx("maintenance_data_entry", ["work_orders.assign"]), "In Progress", open), { canAssign: true, canManageRoster: true });
  });

  it("a role without permission can do neither", () => {
    assert.deepEqual(assignmentGates(ctx("viewer"), "In Progress", open), { canAssign: false, canManageRoster: false });
  });

  it("a Closed Job Card or a pending correction blocks both", () => {
    assert.deepEqual(assignmentGates(ctx("super_admin"), "Closed", open), { canAssign: false, canManageRoster: false });
    assert.deepEqual(assignmentGates(ctx("super_admin"), "In Progress", { ...open, hasPendingCorrection: true }), { canAssign: false, canManageRoster: false });
  });

  it("an open Materials Request holds back Freelancer and Company, not the team", () => {
    assert.deepEqual(assignmentGates(ctx("super_admin"), "Approved", { ...open, hasActiveMaterialsRequest: true }), { canAssign: false, canManageRoster: true });
    assert.equal(assignmentGates(ctx("super_admin"), "In Progress", { ...open, hasActiveMaterialsRequest: true }).canAssign, true);
  });
});

describe("Opening tab", () => {
  const both = { internal: true, external: true };

  it("opens on the saved type", () => {
    assert.equal(initialAssignmentTab("FREELANCER", both), "freelancer");
    assert.equal(initialAssignmentTab("EXTERNAL_COMPANY", both), "company");
    assert.equal(initialAssignmentTab("INTERNAL_TECHNICIAN", both), "internal");
  });

  it("defaults to Internal Team", () => {
    assert.equal(initialAssignmentTab(null, both), "internal");
    assert.equal(initialAssignmentTab("OTHER", both), "internal");
  });

  it("does not open on a tab that is not allowed right now", () => {
    assert.equal(initialAssignmentTab("FREELANCER", { internal: true, external: false }), "internal");
    assert.equal(initialAssignmentTab(null, { internal: false, external: true }), "freelancer");
  });
});

describe("Removal summary and search", () => {
  const roster = [
    { worker_id: "a", worker_role: "Technician", lock: null },
    { worker_id: "b", worker_role: "Helper/Labor", lock: null },
  ];

  it("lists only saved workers left out of the selection", () => {
    assert.deepEqual(workersBeingRemoved(roster, ["a", "new"]).map((r) => r.worker_id), ["b"]);
    assert.deepEqual(workersBeingRemoved(roster, ["a", "b"]), []);
  });

  it("matches every typed word in any order, ignoring case", () => {
    assert.equal(matchesWorkerSearch("Riyad Thanniyil Ansari", "ansari riyad"), true);
    assert.equal(matchesWorkerSearch("Riyad Thanniyil Ansari", "RIY"), true);
    assert.equal(matchesWorkerSearch("Riyad Thanniyil Ansari", "worker"), false);
    assert.equal(matchesWorkerSearch("worker1", "  "), true);
  });
});
