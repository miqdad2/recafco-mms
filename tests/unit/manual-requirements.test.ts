// Job Card manual materials / outside services: pure rules shared by the New
// Job Card wizard, Edit Job Card and the server. Run with `npm run test:unit`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MANUAL_REQUIREMENT_UNITS,
  isManualEntry,
  isManualUnit,
  manualRequirementProblem,
  normalizeManualDescription,
  parseManualQuantity,
  planManualRequirementEdits,
} from "@/lib/work-orders/manual-requirements";

const line = (description: string, quantity = "1", unit = "JOB", notes = "") => ({ description, quantity, unit, notes });

describe("manual requirement validation", () => {
  it("accepts a typed outside service or material with a quantity and a unit", () => {
    assert.equal(manualRequirementProblem(line("Starter Motor Repairing")), null);
    assert.equal(manualRequirementProblem(line("Special Hydraulic Hose", "2", "pcs")), null, "unit case does not matter");
    assert.equal(manualRequirementProblem(line("Outside welding", "1.5", "SERVICE", "Night shift")), null);
  });

  it("refuses an empty description, a missing / zero / negative / over-precise quantity, a missing or unknown unit", () => {
    assert.match(manualRequirementProblem(line("   ")) ?? "", /Type the material, repair or service/);
    assert.match(manualRequirementProblem(line("Radiator Repair", "")) ?? "", /Enter the quantity/);
    for (const q of ["0", "-1", "1.234", "1e3", "abc", "0.00"]) {
      assert.match(manualRequirementProblem(line("Radiator Repair", q)) ?? "", /greater than 0/, `quantity ${q}`);
    }
    assert.match(manualRequirementProblem(line("Radiator Repair", "1", "")) ?? "", /Choose the unit/);
    assert.match(manualRequirementProblem(line("Radiator Repair", "1", "BUCKETS")) ?? "", /listed units/);
    assert.match(manualRequirementProblem(line("x".repeat(201))) ?? "", /under 200 characters/);
  });

  it("parses quantities with up to 2 decimals and normalizes text", () => {
    assert.equal(parseManualQuantity("2"), 2);
    assert.equal(parseManualQuantity(" 1.25 "), 1.25);
    assert.equal(parseManualQuantity("1.255"), null);
    assert.equal(normalizeManualDescription("  Engine   Water Pump  Repair "), "Engine Water Pump Repair");
    assert.ok(isManualUnit("job") && isManualUnit("LTR") && !isManualUnit("BARREL"));
    assert.ok(MANUAL_REQUIREMENT_UNITS.includes("JOB") && MANUAL_REQUIREMENT_UNITS.includes("SERVICE"));
    assert.ok(isManualEntry("manual") && !isManualEntry("inventory") && !isManualEntry(null));
  });
});

describe("Edit Job Card: planning a posted manual list", () => {
  type Line = { id: string; description: string; quantity_required: number; unit_of_measure: string; notes: string | null };
  const existing: Line[] = [
    { id: "a", description: "Starter Motor Repairing", quantity_required: 1, unit_of_measure: "JOB", notes: null },
    { id: "b", description: "Radiator Repair", quantity_required: 1, unit_of_measure: "JOB", notes: "Outside shop" },
  ];
  const posted = (rows: Array<Partial<Omit<Line, "id">> & { id: string | null }>) =>
    rows.map((r) => ({ description: "x", quantity_required: 1, unit_of_measure: "JOB", notes: null, ...r }));

  it("nothing changes when the same list is saved again", () => {
    const plan = planManualRequirementEdits(existing, posted([{ ...existing[0] }, { ...existing[1] }]));
    assert.equal(plan.changed, false);
  });

  it("updates edited lines, adds new ones and removes lines left out", () => {
    const plan = planManualRequirementEdits(
      existing,
      posted([{ ...existing[0], quantity_required: 2, unit_of_measure: "SERVICE" }, { id: null, description: "Outside machining work" }])
    );
    assert.deepEqual(plan.update.map((u) => [u.id, u.line.quantity_required, u.line.unit_of_measure]), [["a", 2, "SERVICE"]]);
    assert.deepEqual(plan.add.map((l) => l.description), ["Outside machining work"]);
    assert.deepEqual(plan.remove.map((r) => r.id), ["b"]);
  });

  it("a repeated save of a just-added line never creates a second copy", () => {
    // First save added "Radiator Repair" (now id b); a retry posts it again without an id.
    const plan = planManualRequirementEdits(existing, posted([{ ...existing[0] }, { ...existing[1], id: null }]));
    assert.equal(plan.changed, false);
    assert.deepEqual([plan.add.length, plan.remove.length], [0, 0]);
  });

  it("an id that is not a manual line of this Job Card is reported", () => {
    const plan = planManualRequirementEdits(existing, posted([{ ...existing[0] }, { id: "inventory-row", description: "Fuel Filter" }]));
    assert.deepEqual(plan.unknownIds, ["inventory-row"]);
  });
});
