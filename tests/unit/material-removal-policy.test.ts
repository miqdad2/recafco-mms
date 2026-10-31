// Super Admin material removal decision: delete vs archive vs blocked.
// Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assessMaterialRemoval, type MaterialRemovalFacts } from "@/lib/store/material-removal-policy";

const unused: MaterialRemovalFacts = {
  balance: 0,
  stockMovementCount: 0,
  linkedMovementCount: 0,
  jobCardMaterialReferenceCount: 0,
  materialsRequestReferenceCount: 0,
  generalRequestReferenceCount: 0,
  isArchived: false,
};

describe("assessMaterialRemoval", () => {
  it("unused zero-stock material can be permanently deleted", () => {
    assert.equal(assessMaterialRemoval(unused).outcome, "delete");
  });

  it("material with stock is blocked, whatever else is true", () => {
    assert.equal(assessMaterialRemoval({ ...unused, balance: 5 }).outcome, "blocked");
    assert.equal(assessMaterialRemoval({ ...unused, balance: 5, stockMovementCount: 3 }).outcome, "blocked");
  });

  it("negative balance is blocked for review", () => {
    const a = assessMaterialRemoval({ ...unused, balance: -2, stockMovementCount: 2 });
    assert.equal(a.outcome, "blocked");
    assert.match(a.reasons[0], /Negative balance/);
  });

  it("zero balance with movement history is archive only", () => {
    const a = assessMaterialRemoval({ ...unused, stockMovementCount: 2 });
    assert.equal(a.outcome, "archive");
    assert.match(a.reasons.join(" "), /2 stock movements/);
  });

  it("zero balance with a Job Card or request reference is archive only", () => {
    assert.equal(assessMaterialRemoval({ ...unused, jobCardMaterialReferenceCount: 1 }).outcome, "archive");
    assert.equal(assessMaterialRemoval({ ...unused, materialsRequestReferenceCount: 1 }).outcome, "archive");
    assert.equal(assessMaterialRemoval({ ...unused, generalRequestReferenceCount: 1 }).outcome, "archive");
    assert.equal(assessMaterialRemoval({ ...unused, linkedMovementCount: 1, stockMovementCount: 1 }).outcome, "archive");
  });

  it("already archived is reported, never re-processed", () => {
    assert.equal(assessMaterialRemoval({ ...unused, isArchived: true }).outcome, "already_archived");
  });
});
