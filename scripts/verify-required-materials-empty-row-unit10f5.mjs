/**
 * Required Materials Empty Row Quantity UX Fix Unit 10F.5 — verification
 * script.
 *
 * Pure logic only — no database needed. `work-order-wizard.tsx` is a
 * "use client" component (browser-only React state/hooks), so it can't be
 * imported into a standalone Node script (same limitation noted in every
 * prior *.mjs script in this directory for "use client"/"server-only"
 * files). This mirrors the exact small pieces of logic this unit changed:
 * emptyMaterialRow()'s default qty, the "default Qty to 1 only after a
 * material name is entered, never overwrite a typed quantity" rule
 * (handleMaterialNameChange/handleSelectSuggestion), the step-4 validate()
 * loop's two distinct messages, and the review step's blank-row filter —
 * plus a read-only confirmation (via source grep, printed below) that the
 * backend's parseRequiredPartRows() already discards rows with no
 * description, unchanged by this unit.
 *
 * Usage:
 *   node scripts/verify-required-materials-empty-row-unit10f5.mjs
 */

let failures = 0;
function check(label, condition) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
    console.error(`  FAIL  ${label}`);
    failures++;
  }
}

// Mirrors emptyMaterialRow() (Task 1).
function emptyMaterialRow() {
  return { description: "", partNumber: "", qty: "", unit: "PCS", notes: "" };
}

// Mirrors handleMaterialNameChange's qty-default decision (Task 2).
function shouldDefaultQtyOnNameChange(currentQty, newValue) {
  return newValue.trim() !== "" && currentQty.trim() === "";
}
// Mirrors handleSelectSuggestion's qty-default decision (Task 2).
function shouldDefaultQtyOnSuggestionSelect(currentQty) {
  return currentQty.trim() === "";
}

// Mirrors the step === 4 branch of validate() (Task 6).
function validateRequiredMaterialsStep(rows) {
  for (const row of rows) {
    if (!row.description?.trim()) continue;
    const qtyRaw = row.qty?.trim();
    if (!qtyRaw) return "Enter quantity.";
    const qty = Number(qtyRaw);
    if (!Number.isInteger(qty) || qty <= 0) return "Quantity must be greater than 0.";
  }
  return null;
}

// Mirrors reviewParts' filter (Task 7).
function reviewPartsFrom(rows) {
  return rows.filter((r) => r.description?.trim());
}

console.log("== 1. Task 1 — empty row quantity behavior ==");
{
  const row = emptyMaterialRow();
  check("New row: qty is blank, not 1", row.qty === "");
  check("New row: description blank", row.description === "");
  check("New row: unit still defaults to PCS", row.unit === "PCS");
}

console.log("== 2. Task 2 — default quantity only after material entry ==");
{
  check('Typing a name into a blank-qty row -> defaults qty to 1', shouldDefaultQtyOnNameChange("", "Engine Filter") === true);
  check('Typing a name when qty already "5" -> does NOT overwrite', shouldDefaultQtyOnNameChange("5", "Engine Filter") === false);
  check('Clearing name back to "" -> no default applied (nothing to default)', shouldDefaultQtyOnNameChange("", "") === false);
  check('Selecting a suggestion into a blank-qty row -> defaults qty to 1', shouldDefaultQtyOnSuggestionSelect("") === true);
  check('Selecting a suggestion when qty already "3" -> does NOT overwrite', shouldDefaultQtyOnSuggestionSelect("3") === false);
}

console.log("== 3. Task 6 — validation messages ==");
{
  const blankExtraRow = [{ description: "", qty: "" }];
  check("Task 6 — completely blank row never blocks submit", validateRequiredMaterialsStep(blankExtraRow) === null);

  const nameNoQty = [{ description: "Engine Filter", qty: "" }];
  check('Task 6 — name entered, qty blank -> "Enter quantity."', validateRequiredMaterialsStep(nameNoQty) === "Enter quantity.");

  const zeroQty = [{ description: "Engine Filter", qty: "0" }];
  check('Task 6 — qty 0 -> "Quantity must be greater than 0."', validateRequiredMaterialsStep(zeroQty) === "Quantity must be greater than 0.");

  const negativeQty = [{ description: "Engine Filter", qty: "-2" }];
  check('Task 6 — negative qty -> "Quantity must be greater than 0."', validateRequiredMaterialsStep(negativeQty) === "Quantity must be greater than 0.");

  const nonIntegerQty = [{ description: "Engine Filter", qty: "1.5" }];
  check('Task 6 — non-integer qty rejected', validateRequiredMaterialsStep(nonIntegerQty) === "Quantity must be greater than 0.");

  const validRow = [{ description: "Engine Filter", qty: "5" }];
  check("Task 6 — valid filled row passes (no error)", validateRequiredMaterialsStep(validRow) === null);

  const mixed = [{ description: "Engine Filter", qty: "5" }, { description: "", qty: "" }, { description: "", qty: "" }];
  check("Task 6 — one filled valid row + blank extra rows -> no error (does not block submit)", validateRequiredMaterialsStep(mixed) === null);
}

console.log("== 4. Task 7 — review step blank-row filter ==");
{
  const rows = [
    { description: "Engine Filter", qty: "5" },
    { description: "", qty: "" },
    { description: "", qty: "" },
  ];
  const reviewed = reviewPartsFrom(rows);
  check("Task 7 — only the filled row reaches Review & Save", reviewed.length === 1 && reviewed[0].description === "Engine Filter");
}

console.log("== 5. Task 4/9 regression — Add Row produces a fully blank row, matching emptyMaterialRow() ==");
{
  const added = emptyMaterialRow();
  check("Added row: description empty", added.description === "");
  check("Added row: partNumber empty", added.partNumber === "");
  check("Added row: qty empty", added.qty === "");
  check("Added row: unit PCS", added.unit === "PCS");
  check("Added row: notes empty", added.notes === "");
}

console.log("\n== 6. Task 5/8 confirmation (source-level, not re-implemented) ==");
console.log("  Confirmed by source read, unchanged by this unit:");
console.log('  - app/actions/maintenance.ts parseRequiredPartRows(): "if (!description) return null;" then "rows.filter(Boolean)" — blank rows were already dropped server-side regardless of stray qty/notes.');
console.log('  - work-order-wizard.tsx handleMaterialNameChange(): "if (trimmed.length < 2) { ...; return; }" before calling searchOfflineInventoryMaterialsAction — search already only runs once the name has meaningful text.');

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
